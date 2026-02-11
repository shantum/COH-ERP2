/**
 * Chat Agent Service
 *
 * AI-powered conversational agent for the COH ERP system.
 * Wraps the Anthropic SDK with tool-use capabilities for querying
 * inventory, orders, fabrics, and performing stock adjustments.
 *
 * Read-only tools execute automatically. Mutating tools pause for
 * user confirmation before executing.
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { env } from '../config/env.js';
import { prisma } from '../db/index.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'chatAgent' });

// ============================================
// CONSTANTS
// ============================================

const AI_MODEL = 'claude-sonnet-4-5-20250929';
const MAX_LOOP_ITERATIONS = 10;

// ============================================
// TYPES
// ============================================

/** SSE chunk types sent to the client */
export type SSEChunk =
    | { type: 'text_delta'; text: string }
    | { type: 'action_pending'; actionId: string; toolName: string; toolInput: Record<string, unknown>; description: string }
    | { type: 'tool_result'; toolName: string; result: unknown }
    | { type: 'error'; message: string }
    | { type: 'done' };

/** Chat message format matching Anthropic's API */
export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string | Anthropic.Messages.ContentBlockParam[];
}

/** File attachment for image/PDF uploads */
export interface FileAttachment {
    base64Data: string;
    mimeType: string;
    fileName: string;
}

// ============================================
// SYSTEM PROMPT
// ============================================

const SYSTEM_PROMPT = `You are the COH ERP Assistant — a helpful AI that answers questions about Cult of Homage's fashion/clothing business.

DOMAIN KNOWLEDGE:
- Materials have a 3-tier hierarchy: Material → Fabric → FabricColour
  Example: "Linen" → "60 Lea" → "Navy Blue"
- Products have a 3-tier hierarchy: Product → Variation → Sku
  Example: "Pleated Formal Trousers" → "Oversize White" → size "M", SKU code "PFT-OVRS-WHT-M"
- Fabric quantities are tracked in meters or kg. Inventory (finished goods) is tracked in units.
- Orders have OrderLines. Each line maps to one SKU.
- Both FabricColour.currentBalance and Sku.currentBalance are kept up-to-date automatically by database triggers whenever a transaction is created.

BEHAVIOUR RULES:
- Keep answers concise and helpful. Use simple language.
- When showing data, format it clearly (use bullet points, short tables, etc.).
- ALWAYS confirm before making any changes (inventory adjustments, fabric inward, etc.).
- If a search returns no results, suggest tweaking the search query.
- When asked about stock/balance, use the specific lookup tools rather than guessing.`;

// ============================================
// TOOL DEFINITIONS (Anthropic format)
// ============================================

const TOOLS: Anthropic.Messages.Tool[] = [
    // --- Read-only tools ---
    {
        name: 'search_inventory',
        description: 'Search SKUs by name, code, or product name. Returns up to 20 matching results with current stock balance.',
        input_schema: {
            type: 'object' as const,
            properties: {
                query: { type: 'string', description: 'Text to search in SKU code, product name, or variation name' },
            },
            required: ['query'],
        },
    },
    {
        name: 'get_sku_balance',
        description: 'Get the current stock balance for a specific SKU by its code (e.g. "PFT-OVRS-WHT-M").',
        input_schema: {
            type: 'object' as const,
            properties: {
                skuCode: { type: 'string', description: 'Exact SKU code' },
            },
            required: ['skuCode'],
        },
    },
    {
        name: 'search_orders',
        description: 'Search orders by order number or customer name. Returns up to 10 matching orders with their line items.',
        input_schema: {
            type: 'object' as const,
            properties: {
                query: { type: 'string', description: 'Order number or customer name to search' },
            },
            required: ['query'],
        },
    },
    {
        name: 'search_fabrics',
        description: 'Search fabric materials and colours by name. Returns up to 20 results with current balance and cost.',
        input_schema: {
            type: 'object' as const,
            properties: {
                query: { type: 'string', description: 'Text to search in colour name, fabric name, or material name' },
            },
            required: ['query'],
        },
    },
    {
        name: 'lookup_sku',
        description: 'Find a specific SKU by exact code or by product name + size. Use this when you need the SKU ID for a transaction.',
        input_schema: {
            type: 'object' as const,
            properties: {
                code: { type: 'string', description: 'Exact SKU code (e.g. "PFT-OVRS-WHT-M")' },
                productName: { type: 'string', description: 'Product name to search (used if code is not provided)' },
                size: { type: 'string', description: 'Size filter (e.g. "M", "L", "32")' },
            },
            required: [],
        },
    },
    // --- Mutating tools ---
    {
        name: 'add_fabric_inward',
        description: 'Record a fabric receipt (inward transaction). Requires fabricColourId, qty, and unit.',
        input_schema: {
            type: 'object' as const,
            properties: {
                fabricColourId: { type: 'string', description: 'ID of the FabricColour to add stock to' },
                qty: { type: 'number', description: 'Quantity received' },
                unit: { type: 'string', description: 'Unit of measurement (e.g. "m", "kg")' },
                costPerUnit: { type: 'number', description: 'Cost per unit (optional)' },
                notes: { type: 'string', description: 'Optional notes about this receipt' },
            },
            required: ['fabricColourId', 'qty', 'unit'],
        },
    },
    {
        name: 'add_inventory_inward',
        description: 'Add stock (inward) for a finished goods SKU. Requires skuId, qty, and reason.',
        input_schema: {
            type: 'object' as const,
            properties: {
                skuId: { type: 'string', description: 'ID of the SKU' },
                qty: { type: 'number', description: 'Quantity to add' },
                reason: { type: 'string', description: 'Reason for inward (e.g. "production_complete", "return_restock")' },
                notes: { type: 'string', description: 'Optional notes' },
            },
            required: ['skuId', 'qty', 'reason'],
        },
    },
    {
        name: 'add_inventory_outward',
        description: 'Remove stock (outward) for a finished goods SKU. Requires skuId, qty, and reason.',
        input_schema: {
            type: 'object' as const,
            properties: {
                skuId: { type: 'string', description: 'ID of the SKU' },
                qty: { type: 'number', description: 'Quantity to remove' },
                reason: { type: 'string', description: 'Reason for outward (e.g. "damaged", "sample")' },
                notes: { type: 'string', description: 'Optional notes' },
            },
            required: ['skuId', 'qty', 'reason'],
        },
    },
    {
        name: 'adjust_inventory',
        description: 'Set a SKU balance to a specific number by creating a corrective transaction. Use when the physical count differs from system balance.',
        input_schema: {
            type: 'object' as const,
            properties: {
                skuId: { type: 'string', description: 'ID of the SKU' },
                newBalance: { type: 'number', description: 'Target balance after adjustment' },
                reason: { type: 'string', description: 'Reason for adjustment (e.g. "physical_count", "cycle_count")' },
                notes: { type: 'string', description: 'Optional notes about the adjustment' },
            },
            required: ['skuId', 'newBalance', 'reason'],
        },
    },
];

// ============================================
// TOOL CLASSIFICATION
// ============================================

const READ_ONLY_TOOLS = new Set([
    'search_inventory',
    'get_sku_balance',
    'search_orders',
    'search_fabrics',
    'lookup_sku',
]);

const MUTATING_TOOLS = new Set([
    'add_fabric_inward',
    'add_inventory_inward',
    'add_inventory_outward',
    'adjust_inventory',
]);

// ============================================
// TOOL EXECUTION FUNCTIONS
// ============================================

type ToolInput = Record<string, unknown>;

async function execSearchInventory(input: ToolInput) {
    const query = String(input.query ?? '');
    const results = await prisma.sku.findMany({
        where: {
            isActive: true,
            OR: [
                { skuCode: { contains: query, mode: 'insensitive' } },
                { variation: { colorName: { contains: query, mode: 'insensitive' } } },
                { variation: { product: { name: { contains: query, mode: 'insensitive' } } } },
            ],
        },
        include: {
            variation: {
                include: { product: { select: { name: true } } },
            },
        },
        take: 20,
        orderBy: { skuCode: 'asc' },
    });

    return results.map(s => ({
        skuCode: s.skuCode,
        productName: s.variation.product.name,
        variationName: s.variation.colorName,
        size: s.size,
        currentBalance: s.currentBalance,
        mrp: s.mrp,
    }));
}

async function execGetSkuBalance(input: ToolInput) {
    const skuCode = String(input.skuCode ?? '');
    const sku = await prisma.sku.findUnique({
        where: { skuCode },
        include: {
            variation: {
                include: { product: { select: { name: true } } },
            },
        },
    });

    if (!sku) {
        return { error: `SKU "${skuCode}" not found` };
    }

    return {
        skuCode: sku.skuCode,
        productName: sku.variation.product.name,
        variationName: sku.variation.colorName,
        size: sku.size,
        currentBalance: sku.currentBalance,
    };
}

async function execSearchOrders(input: ToolInput) {
    const query = String(input.query ?? '');
    const orders = await prisma.order.findMany({
        where: {
            OR: [
                { orderNumber: { contains: query, mode: 'insensitive' } },
                { customerName: { contains: query, mode: 'insensitive' } },
            ],
        },
        include: {
            orderLines: {
                include: {
                    sku: {
                        select: {
                            skuCode: true,
                            size: true,
                            variation: {
                                select: {
                                    colorName: true,
                                    product: { select: { name: true } },
                                },
                            },
                        },
                    },
                },
            },
        },
        take: 10,
        orderBy: { orderDate: 'desc' },
    });

    return orders.map(o => ({
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        orderDate: o.orderDate.toISOString().split('T')[0],
        status: o.status,
        totalAmount: o.totalAmount,
        lines: o.orderLines.map(l => ({
            skuCode: l.sku.skuCode,
            productName: l.sku.variation.product.name,
            variationName: l.sku.variation.colorName,
            size: l.sku.size,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineStatus: l.lineStatus,
        })),
    }));
}

async function execSearchFabrics(input: ToolInput) {
    const query = String(input.query ?? '');
    const results = await prisma.fabricColour.findMany({
        where: {
            isActive: true,
            OR: [
                { colourName: { contains: query, mode: 'insensitive' } },
                { fabric: { name: { contains: query, mode: 'insensitive' } } },
                { fabric: { material: { name: { contains: query, mode: 'insensitive' } } } },
            ],
        },
        include: {
            fabric: {
                include: { material: { select: { name: true } } },
            },
        },
        take: 20,
        orderBy: { colourName: 'asc' },
    });

    return results.map(fc => ({
        id: fc.id,
        code: fc.code,
        colourName: fc.colourName,
        fabricName: fc.fabric.name,
        materialName: fc.fabric.material?.name ?? null,
        currentBalance: fc.currentBalance,
        unit: fc.fabric.unit,
        costPerUnit: fc.costPerUnit ?? fc.fabric.costPerUnit,
    }));
}

async function execLookupSku(input: ToolInput) {
    const code = input.code ? String(input.code) : undefined;
    const productName = input.productName ? String(input.productName) : undefined;
    const size = input.size ? String(input.size) : undefined;

    if (code) {
        const sku = await prisma.sku.findUnique({
            where: { skuCode: code },
            include: {
                variation: {
                    include: { product: { select: { name: true } } },
                },
            },
        });
        if (!sku) return { error: `SKU "${code}" not found` };
        return {
            id: sku.id,
            skuCode: sku.skuCode,
            productName: sku.variation.product.name,
            variationName: sku.variation.colorName,
            size: sku.size,
            currentBalance: sku.currentBalance,
        };
    }

    if (productName) {
        const skus = await prisma.sku.findMany({
            where: {
                isActive: true,
                variation: {
                    product: { name: { contains: productName, mode: 'insensitive' } },
                },
                ...(size ? { size: { equals: size, mode: 'insensitive' } } : {}),
            },
            include: {
                variation: {
                    include: { product: { select: { name: true } } },
                },
            },
            take: 20,
            orderBy: { skuCode: 'asc' },
        });

        if (skus.length === 0) return { error: `No SKUs found for product "${productName}"${size ? ` size "${size}"` : ''}` };

        return skus.map(s => ({
            id: s.id,
            skuCode: s.skuCode,
            productName: s.variation.product.name,
            variationName: s.variation.colorName,
            size: s.size,
            currentBalance: s.currentBalance,
        }));
    }

    return { error: 'Provide either "code" or "productName" to look up a SKU' };
}

async function execAddFabricInward(input: ToolInput, userId: string) {
    const fabricColourId = String(input.fabricColourId);
    const qty = Number(input.qty);
    const unit = String(input.unit);
    const costPerUnit = input.costPerUnit != null ? Number(input.costPerUnit) : undefined;
    const notes = input.notes ? String(input.notes) : undefined;

    // Verify the fabric colour exists
    const fc = await prisma.fabricColour.findUnique({
        where: { id: fabricColourId },
        include: { fabric: { select: { name: true } } },
    });
    if (!fc) return { error: `FabricColour with ID "${fabricColourId}" not found` };

    const txn = await prisma.fabricColourTransaction.create({
        data: {
            fabricColourId,
            txnType: 'inward',
            qty,
            unit,
            reason: 'receipt',
            ...(costPerUnit != null ? { costPerUnit } : {}),
            ...(notes ? { notes } : {}),
            createdById: userId,
        },
    });

    return {
        transactionId: txn.id,
        fabricColour: `${fc.fabric.name} - ${fc.colourName}`,
        qty,
        unit,
        message: `Added ${qty} ${unit} inward for ${fc.fabric.name} - ${fc.colourName}`,
    };
}

async function execAddInventoryInward(input: ToolInput, userId: string) {
    const skuId = String(input.skuId);
    const qty = Math.round(Number(input.qty));
    const reason = String(input.reason);
    const notes = input.notes ? String(input.notes) : undefined;

    const sku = await prisma.sku.findUnique({
        where: { id: skuId },
        select: { skuCode: true },
    });
    if (!sku) return { error: `SKU with ID "${skuId}" not found` };

    const txn = await prisma.inventoryTransaction.create({
        data: {
            skuId,
            txnType: 'inward',
            qty,
            reason,
            ...(notes ? { notes } : {}),
            createdById: userId,
        },
    });

    return {
        transactionId: txn.id,
        skuCode: sku.skuCode,
        qty,
        message: `Added ${qty} units inward for ${sku.skuCode}`,
    };
}

async function execAddInventoryOutward(input: ToolInput, userId: string) {
    const skuId = String(input.skuId);
    const qty = Math.round(Number(input.qty));
    const reason = String(input.reason);
    const notes = input.notes ? String(input.notes) : undefined;

    const sku = await prisma.sku.findUnique({
        where: { id: skuId },
        select: { skuCode: true, currentBalance: true },
    });
    if (!sku) return { error: `SKU with ID "${skuId}" not found` };
    if (sku.currentBalance < qty) {
        return { error: `Insufficient stock: ${sku.skuCode} has ${sku.currentBalance} units, cannot remove ${qty}` };
    }

    const txn = await prisma.inventoryTransaction.create({
        data: {
            skuId,
            txnType: 'outward',
            qty,
            reason,
            ...(notes ? { notes } : {}),
            createdById: userId,
        },
    });

    return {
        transactionId: txn.id,
        skuCode: sku.skuCode,
        qty,
        message: `Removed ${qty} units from ${sku.skuCode}`,
    };
}

async function execAdjustInventory(input: ToolInput, userId: string) {
    const skuId = String(input.skuId);
    const newBalance = Math.round(Number(input.newBalance));
    const reason = String(input.reason);
    const notes = input.notes ? String(input.notes) : undefined;

    const sku = await prisma.sku.findUnique({
        where: { id: skuId },
        select: { skuCode: true, currentBalance: true },
    });
    if (!sku) return { error: `SKU with ID "${skuId}" not found` };

    const diff = newBalance - sku.currentBalance;
    if (diff === 0) {
        return { skuCode: sku.skuCode, message: `Balance is already ${newBalance}, no adjustment needed` };
    }

    const txnType = diff > 0 ? 'inward' : 'outward';
    const qty = Math.abs(diff);

    const txn = await prisma.inventoryTransaction.create({
        data: {
            skuId,
            txnType,
            qty,
            reason,
            ...(notes ? { notes } : {}),
            createdById: userId,
        },
    });

    return {
        transactionId: txn.id,
        skuCode: sku.skuCode,
        previousBalance: sku.currentBalance,
        newBalance,
        adjustment: `${txnType} ${qty}`,
        message: `Adjusted ${sku.skuCode} from ${sku.currentBalance} → ${newBalance} (${txnType} ${qty})`,
    };
}

// ============================================
// TOOL ROUTER
// ============================================

/** Map of tool name → executor function */
const TOOL_EXECUTORS: Record<string, (input: ToolInput, userId: string) => Promise<unknown>> = {
    search_inventory: execSearchInventory,
    get_sku_balance: execGetSkuBalance,
    search_orders: execSearchOrders,
    search_fabrics: execSearchFabrics,
    lookup_sku: execLookupSku,
    add_fabric_inward: execAddFabricInward,
    add_inventory_inward: execAddInventoryInward,
    add_inventory_outward: execAddInventoryOutward,
    adjust_inventory: execAdjustInventory,
};

// ============================================
// ACTION DESCRIPTION HELPER
// ============================================

/**
 * Returns a human-readable description of a mutating action.
 * Shown on the confirmation card before the user approves.
 */
export function generateActionDescription(toolName: string, toolInput: Record<string, unknown>): string {
    switch (toolName) {
        case 'add_fabric_inward': {
            const qty = toolInput.qty ?? '?';
            const unit = toolInput.unit ?? 'units';
            return `Add ${qty} ${unit} of fabric inward`;
        }
        case 'add_inventory_inward': {
            const qty = toolInput.qty ?? '?';
            return `Add ${qty} units of inventory inward (${toolInput.reason ?? 'unspecified reason'})`;
        }
        case 'add_inventory_outward': {
            const qty = toolInput.qty ?? '?';
            return `Remove ${qty} units of inventory (${toolInput.reason ?? 'unspecified reason'})`;
        }
        case 'adjust_inventory': {
            const newBal = toolInput.newBalance ?? '?';
            return `Adjust inventory balance to ${newBal} units (${toolInput.reason ?? 'unspecified reason'})`;
        }
        default:
            return `Execute ${toolName}`;
    }
}

// ============================================
// EXECUTE CONFIRMED ACTION
// ============================================

/**
 * Execute a mutating tool after the user has confirmed it.
 *
 * @param toolName - Name of the mutating tool
 * @param toolInput - Tool parameters
 * @param userId - ID of the user who confirmed (used as createdById)
 */
export async function executeAction(
    toolName: string,
    toolInput: Record<string, unknown>,
    userId: string,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
    if (!MUTATING_TOOLS.has(toolName)) {
        return { success: false, error: `Unknown or non-mutating tool: ${toolName}` };
    }

    const executor = TOOL_EXECUTORS[toolName];
    if (!executor) {
        return { success: false, error: `No executor found for tool: ${toolName}` };
    }

    try {
        log.info({ toolName, toolInput, userId }, 'Executing confirmed action');
        const result = await executor(toolInput, userId);

        // Check if the tool returned an error object
        if (result && typeof result === 'object' && 'error' in result) {
            return { success: false, error: String((result as { error: string }).error) };
        }

        return { success: true, data: result };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error executing action';
        log.error({ toolName, toolInput, error: message }, 'Action execution failed');
        return { success: false, error: message };
    }
}

// ============================================
// STREAM CHAT (MAIN ENTRY POINT)
// ============================================

/**
 * Stream a chat response, automatically executing read-only tools
 * and pausing for confirmation on mutating tools.
 *
 * @param messages - Conversation history
 * @param userId - Current user ID (for transaction attribution)
 * @param files - Optional file attachments (images/PDFs)
 * @yields SSEChunk objects for the client to render
 */
export async function* streamChat(
    messages: ChatMessage[],
    userId: string,
    files?: FileAttachment[],
): AsyncGenerator<SSEChunk> {
    if (!env.ANTHROPIC_API_KEY) {
        yield { type: 'error', message: 'Anthropic API key is not configured.' };
        yield { type: 'done' };
        return;
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    // Build the messages array for the API call
    const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((msg, idx) => {
        // For the last user message, attach files if provided
        if (msg.role === 'user' && idx === messages.length - 1 && files && files.length > 0) {
            const fileBlocks: Anthropic.Messages.ContentBlockParam[] = files.map(f => {
                if (f.mimeType === 'application/pdf') {
                    return {
                        type: 'document' as const,
                        source: {
                            type: 'base64' as const,
                            media_type: 'application/pdf' as const,
                            data: f.base64Data,
                        },
                    };
                }
                return {
                    type: 'image' as const,
                    source: {
                        type: 'base64' as const,
                        media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                        data: f.base64Data,
                    },
                };
            });

            const textContent = typeof msg.content === 'string' ? msg.content : '';
            return {
                role: 'user' as const,
                content: [
                    ...fileBlocks,
                    { type: 'text' as const, text: textContent },
                ],
            };
        }

        return {
            role: msg.role,
            content: msg.content as string | Anthropic.Messages.ContentBlockParam[],
        };
    });

    // Conversation loop: Claude may call read-only tools multiple times
    for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration++) {
        try {
            // Use streaming for text deltas
            const stream = client.messages.stream({
                model: AI_MODEL,
                max_tokens: 4096,
                system: SYSTEM_PROMPT,
                tools: TOOLS,
                messages: apiMessages,
            });

            // Collect the full response for tool handling
            const response = await stream.finalMessage();

            // Process each content block
            let hasToolUse = false;
            let pendingAction = false;

            for (const block of response.content) {
                if (block.type === 'text' && block.text) {
                    yield { type: 'text_delta', text: block.text };
                }

                if (block.type === 'tool_use') {
                    const toolName = block.name;
                    const toolInput = block.input as Record<string, unknown>;
                    const toolUseId = block.id;

                    if (READ_ONLY_TOOLS.has(toolName)) {
                        // Auto-execute read-only tools
                        hasToolUse = true;
                        log.info({ toolName, toolInput }, 'Auto-executing read-only tool');

                        const executor = TOOL_EXECUTORS[toolName];
                        let result: unknown;
                        try {
                            result = executor
                                ? await executor(toolInput, userId)
                                : { error: `Unknown tool: ${toolName}` };
                        } catch (error: unknown) {
                            const errMsg = error instanceof Error ? error.message : 'Tool execution failed';
                            log.error({ toolName, error: errMsg }, 'Read-only tool execution failed');
                            result = { error: errMsg };
                        }

                        yield { type: 'tool_result', toolName, result };

                        // Append assistant message + tool result for next loop iteration
                        apiMessages.push({
                            role: 'assistant',
                            content: response.content,
                        });
                        apiMessages.push({
                            role: 'user',
                            content: [{
                                type: 'tool_result',
                                tool_use_id: toolUseId,
                                content: JSON.stringify(result),
                            }],
                        });

                    } else if (MUTATING_TOOLS.has(toolName)) {
                        // Pause for confirmation
                        pendingAction = true;
                        const actionId = randomUUID();
                        const description = generateActionDescription(toolName, toolInput);

                        log.info({ toolName, toolInput, actionId }, 'Mutating tool requires confirmation');

                        yield {
                            type: 'action_pending',
                            actionId,
                            toolName,
                            toolInput,
                            description,
                        };
                        // Stop the loop — client must confirm before we continue
                        break;
                    }
                }
            }

            // If a mutating tool is pending, stop the loop
            if (pendingAction) {
                break;
            }

            // If no tool was used, the response is complete
            if (!hasToolUse) {
                break;
            }

            // If stop_reason is end_turn (no more tools), break
            if (response.stop_reason === 'end_turn') {
                break;
            }

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error during chat';
            log.error({ error: message, iteration }, 'Chat stream error');
            yield { type: 'error', message };
            break;
        }
    }

    yield { type: 'done' };
}
