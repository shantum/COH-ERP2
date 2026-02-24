/**
 * Chat Agent — Tool definitions, classification, system prompt, and constants
 */

import type Anthropic from '@anthropic-ai/sdk';

// ============================================
// CONSTANTS
// ============================================

export const AI_MODEL = 'claude-sonnet-4-5-20250929';
export const MAX_LOOP_ITERATIONS = 10;

// ============================================
// SYSTEM PROMPT
// ============================================

export const SYSTEM_PROMPT = `You are the COH ERP Assistant — a helpful AI that answers questions about Cult of Homage's fashion/clothing business.

DOMAIN KNOWLEDGE:
- Materials have a 3-tier hierarchy: Material \u2192 Fabric \u2192 FabricColour
  Example: "Linen" \u2192 "60 Lea" \u2192 "Navy Blue"
- Products have a 3-tier hierarchy: Product \u2192 Variation \u2192 Sku
  Example: "Pleated Formal Trousers" \u2192 "Oversize White" \u2192 size "M", SKU code "PFT-OVRS-WHT-M"
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

export const TOOLS: Anthropic.Messages.Tool[] = [
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

export const READ_ONLY_TOOLS = new Set([
    'search_inventory',
    'get_sku_balance',
    'search_orders',
    'search_fabrics',
    'lookup_sku',
]);

export const MUTATING_TOOLS = new Set([
    'add_fabric_inward',
    'add_inventory_inward',
    'add_inventory_outward',
    'adjust_inventory',
]);
