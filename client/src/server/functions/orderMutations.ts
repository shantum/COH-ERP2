/**
 * Order Mutations Server Functions
 *
 * TanStack Start Server Functions for order line mutations.
 * Phase 2 implementation with Prisma, SSE broadcasting via deferredExecutor.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';
import type { Prisma } from '@prisma/client';
import {
    hasAllocatedInventory as sharedHasAllocatedInventory,
    computeOrderStatus,
} from '@coh/shared/domain';
import { getInternalApiBaseUrl } from '../utils';

// ============================================
// INPUT SCHEMAS
// ============================================

const updateLineSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    qty: z.number().int().positive().optional(),
    unitPrice: z.number().nonnegative().optional(),
    notes: z.string().optional(),
    awbNumber: z.string().optional(),
    courier: z.string().optional(),
});

const addLineSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
    skuId: z.string().uuid('Invalid SKU ID'),
    qty: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
});

const updateOrderSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
    customerName: z.string().optional(),
    customerEmail: z.string().email().nullable().optional(),
    customerPhone: z.string().nullable().optional(),
    shippingAddress: z.string().nullable().optional(),
    internalNotes: z.string().nullable().optional(),
    shipByDate: z.string().nullable().optional(),
    isExchange: z.boolean().optional(),
});

const markPaidSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
});

const deleteOrderSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
});

const createOrderSchema = z.object({
    orderNumber: z.string().optional(),
    channel: z.string().default('offline'),
    customerId: z.string().uuid().optional().nullable(),
    customerName: z.string().min(1, 'Customer name is required').trim(),
    customerEmail: z.string().email().optional().nullable(),
    customerPhone: z.string().optional().nullable(),
    shippingAddress: z.string().optional().nullable(),
    internalNotes: z.string().optional().nullable(),
    totalAmount: z.number().optional(),
    shipByDate: z.string().optional().nullable(),
    paymentMethod: z.enum(['Prepaid', 'COD']).default('Prepaid'),
    paymentStatus: z.enum(['pending', 'paid']).default('pending'),
    isExchange: z.boolean().default(false),
    originalOrderId: z.string().uuid().optional().nullable(),
    lines: z.array(z.object({
        skuId: z.string().uuid('Invalid SKU ID'),
        qty: z.number().int().positive('Quantity must be positive'),
        unitPrice: z.number().nonnegative().optional(),
        shippingAddress: z.string().optional().nullable(),
    })).min(1, 'At least one line is required'),
});

const cancelOrderSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
    reason: z.string().optional(),
});

const uncancelOrderSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
});

const customizeLineSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    type: z.enum(['length', 'size', 'measurements', 'other']),
    value: z.string().min(1, 'Value is required'),
    notes: z.string().optional(),
});

const removeLineCustomizationSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    force: z.boolean().optional().default(false),
});

const updateLineNotesSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    notes: z.string(),
});

// ============================================
// RESULT TYPES
// ============================================

export interface MutationResult<T> {
    success: boolean;
    data?: T;
    error?: {
        code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'INTERNAL';
        message: string;
    };
}

export interface UpdateLineResult {
    lineId: string;
    orderId: string;
    updated: boolean;
}

export interface AddLineResult {
    lineId: string;
    orderId: string;
    skuId: string;
    qty: number;
}

export interface UpdateOrderResult {
    orderId: string;
    updated: boolean;
}

export interface MarkPaidResult {
    orderId: string;
    paidAt: string;
}

export interface DeleteOrderResult {
    orderId: string;
    deleted: boolean;
}

export interface CreateOrderResult {
    orderId: string;
    orderNumber: string;
    customerId: string | null;
    lineCount: number;
    totalAmount: number;
}

export interface CancelOrderResult {
    orderId: string;
    status: string;  // Computed from line states - could be 'cancelled', 'shipped', 'partially_shipped', etc.
    linesAffected: number;
    inventoryReleased: boolean;
}

export interface UncancelOrderResult {
    orderId: string;
    status: string;  // Computed from line states - could be 'open', 'partially_shipped', etc.
    linesRestored: number;
}

export interface CustomizeLineResult {
    lineId: string;
    customSkuId: string;
    customSkuCode: string;
    originalSkuCode: string;
    isCustomized: boolean;
}

export interface RemoveLineCustomizationResult {
    lineId: string;
    skuId: string;
    skuCode: string;
    deletedCustomSkuCode: string;
    forcedCleanup: boolean;
}

export interface UpdateLineNotesResult {
    lineId: string;
    orderId: string;
    notes: string;
}

// ============================================
// CONSTANTS
// ============================================

const TXN_TYPE = {
    INWARD: 'inward',
    OUTWARD: 'outward',
} as const;

const TXN_REASON = {
    ORDER_ALLOCATION: 'order_allocation',
    RTO_RECEIVED: 'rto_received',
} as const;

// ============================================
// SSE BROADCAST HELPER
// ============================================

interface OrderUpdateEvent {
    type: string;
    lineId?: string;
    orderId?: string;
    view?: string;
    affectedViews?: string[];
    changes?: Record<string, unknown>;
}

async function broadcastUpdate(event: OrderUpdateEvent, excludeUserId: string): Promise<void> {
    try {
        // Dynamic import of SSE broadcast from server
        // In TanStack Start, we need to call the Express server's SSE endpoint
        // For now, we'll use a fetch call to the internal API
        const baseUrl = getInternalApiBaseUrl();
        await fetch(`${baseUrl}/api/internal/sse-broadcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, excludeUserId }),
        });
    } catch {
        console.warn('[orderMutations] SSE broadcast failed (non-critical)');
    }
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Update order line fields (qty, price, notes, tracking)
 */
export const updateLine = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateLineSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<UpdateLineResult>> => {
        const prisma = await getPrisma();
        const { lineId, qty, unitPrice, notes, awbNumber, courier } = data;

        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { order: true },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Build update data
        const updateData: Prisma.OrderLineUpdateInput = {};
        if (qty !== undefined) updateData.qty = qty;
        if (unitPrice !== undefined) updateData.unitPrice = unitPrice;
        if (notes !== undefined) updateData.notes = notes;
        if (awbNumber !== undefined) updateData.awbNumber = awbNumber || null;
        if (courier !== undefined) updateData.courier = courier || null;

        const hasQtyOrPrice = qty !== undefined || unitPrice !== undefined;

        // If only updating simple fields, no transaction needed
        if (!hasQtyOrPrice) {
            await prisma.orderLine.update({
                where: { id: lineId },
                data: updateData,
            });
        } else {
            // qty/unitPrice changes need transaction to update order total
            await prisma.$transaction(async (tx: PrismaTransaction) => {
                await tx.orderLine.update({
                    where: { id: lineId },
                    data: updateData,
                });

                const allLines = await tx.orderLine.findMany({
                    where: { orderId: line.orderId },
                });
                const newTotal = allLines.reduce((sum: number, l: { id: string; qty: number; unitPrice: number }) => {
                    const lineQty = l.id === lineId ? (qty ?? l.qty) : l.qty;
                    const linePrice = l.id === lineId ? (unitPrice ?? l.unitPrice) : l.unitPrice;
                    return sum + lineQty * linePrice;
                }, 0);
                await tx.order.update({
                    where: { id: line.orderId },
                    data: { totalAmount: newTotal },
                });
            });
        }

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'line_status',
                view: 'open',
                lineId,
                orderId: line.orderId,
                changes: updateData,
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                lineId,
                orderId: line.orderId,
                updated: true,
            },
        };
    });

/**
 * Add a new line to an order
 */
export const addLine = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => addLineSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<AddLineResult>> => {
        const prisma = await getPrisma();
        const { orderId, skuId, qty, unitPrice } = data;

        let newLineId: string = '';

        try {
            await prisma.$transaction(async (tx: PrismaTransaction) => {
                // Read fresh state INSIDE transaction to prevent TOCTOU race
                const order = await tx.order.findUnique({
                    where: { id: orderId },
                    select: { id: true, status: true },
                });

                if (!order) throw new Error('NOT_FOUND:Order not found');
                if (order.status === 'shipped' || order.status === 'cancelled') {
                    throw new Error(`BAD_REQUEST:Cannot add lines to ${order.status} orders`);
                }

                const newLine = await tx.orderLine.create({
                    data: {
                        orderId,
                        skuId,
                        qty,
                        unitPrice,
                        lineStatus: 'pending',
                    },
                });
                newLineId = newLine.id;

                const allLines = await tx.orderLine.findMany({
                    where: { orderId },
                });
                const newTotal = allLines.reduce((sum: number, l: { qty: number; unitPrice: number }) => sum + l.qty * l.unitPrice, 0);
                await tx.order.update({
                    where: { id: orderId },
                    data: { totalAmount: newTotal },
                });
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            const [code, msg] = message.includes(':') ? message.split(':', 2) : ['INTERNAL', message];
            return { success: false, error: { code: code as 'NOT_FOUND' | 'BAD_REQUEST' | 'INTERNAL', message: msg as string } };
        }

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'order_updated',
                orderId,
                affectedViews: ['open'],
                changes: { lineAdded: newLineId },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                lineId: newLineId,
                orderId,
                skuId,
                qty,
            },
        };
    });

/**
 * Update order details
 */
export const updateOrder = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateOrderSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<UpdateOrderResult>> => {
        const prisma = await getPrisma();
        const {
            orderId,
            customerName,
            customerEmail,
            customerPhone,
            shippingAddress,
            internalNotes,
            shipByDate,
            isExchange,
        } = data;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
        });

        if (!order) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order not found' },
            };
        }

        const updateData: Prisma.OrderUpdateInput = {};
        if (customerName !== undefined) updateData.customerName = customerName;
        if (customerEmail !== undefined) updateData.customerEmail = customerEmail;
        if (customerPhone !== undefined) updateData.customerPhone = customerPhone;
        if (shippingAddress !== undefined) updateData.shippingAddress = shippingAddress;
        if (internalNotes !== undefined) updateData.internalNotes = internalNotes;
        if (shipByDate !== undefined) updateData.shipByDate = shipByDate ? new Date(shipByDate) : null;
        if (isExchange !== undefined) updateData.isExchange = isExchange;

        await prisma.order.update({
            where: { id: orderId },
            data: updateData,
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'order_updated',
                orderId,
                affectedViews: ['open', 'shipped', 'cancelled'],
                changes: updateData,
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                orderId,
                updated: true,
            },
        };
    });

/**
 * Mark order as paid (for COD orders)
 */
export const markPaid = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => markPaidSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<MarkPaidResult>> => {
        const prisma = await getPrisma();
        const { orderId } = data;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
        });

        if (!order) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order not found' },
            };
        }

        const now = new Date();

        await prisma.order.update({
            where: { id: orderId },
            data: { codRemittedAt: now },
        });

        // No SSE broadcast needed for markPaid (per spec)

        return {
            success: true,
            data: {
                orderId,
                paidAt: now.toISOString(),
            },
        };
    });

/**
 * Delete an order (soft delete via deletedAt, only for manual orders)
 */
export const deleteOrder = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteOrderSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<DeleteOrderResult>> => {
        const prisma = await getPrisma();
        const { orderId } = data;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order not found' },
            };
        }

        // Cannot delete Shopify orders with line items
        if (order.shopifyOrderId && order.orderLines.length > 0) {
            return {
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'Cannot delete Shopify orders with line items. Use cancel instead.',
                },
            };
        }

        // Collect SKU IDs of lines with allocated inventory BEFORE transaction
        type DeleteOrderLine = { id: string; lineStatus: string; skuId: string; productionBatchId: string | null };
        const affectedSkuIds = order.orderLines
            .filter((line: DeleteOrderLine) => sharedHasAllocatedInventory(line.lineStatus))
            .map((line: DeleteOrderLine) => line.skuId);

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Handle production batches and inventory
            for (const line of order.orderLines) {
                if (line.productionBatchId) {
                    await tx.productionBatch.update({
                        where: { id: line.productionBatchId },
                        data: { sourceOrderLineId: null },
                    });
                }

                if (sharedHasAllocatedInventory(line.lineStatus)) {
                    const txn = await tx.inventoryTransaction.findFirst({
                        where: {
                            referenceId: line.id,
                            txnType: TXN_TYPE.OUTWARD,
                            reason: TXN_REASON.ORDER_ALLOCATION,
                        },
                    });
                    if (txn) {
                        await tx.inventoryTransaction.delete({ where: { id: txn.id } });
                    }
                }
            }

            // Delete order lines and order
            await tx.orderLine.deleteMany({ where: { orderId: order.id } });
            await tx.order.delete({ where: { id: order.id } });
        });

        // No SSE broadcast needed for deleteOrder (per spec)

        // Invalidate inventory cache for affected SKUs
        const uniqueSkuIds = [...new Set(affectedSkuIds)] as string[];
        if (uniqueSkuIds.length > 0) {
            try {
                const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
                inventoryBalanceCache.invalidate(uniqueSkuIds);
            } catch {
                // Non-critical
            }
        }

        return {
            success: true,
            data: {
                orderId,
                deleted: true,
            },
        };
    });

/**
 * Create a new order with lines
 * - Creates or finds customer
 * - Updates customer tier based on order history
 * - Creates Order with OrderLines
 * - SSE broadcast
 */
export const createOrder = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createOrderSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<CreateOrderResult>> => {
        const prisma = await getPrisma();
        const {
            orderNumber: providedOrderNumber,
            channel,
            customerId: providedCustomerId,
            customerName,
            customerEmail,
            customerPhone,
            shippingAddress,
            internalNotes,
            totalAmount,
            shipByDate,
            paymentMethod,
            paymentStatus,
            isExchange,
            originalOrderId,
            lines,
        } = data;

        // Validate originalOrderId exists if provided
        if (originalOrderId) {
            const originalOrder = await prisma.order.findUnique({
                where: { id: originalOrderId },
                select: { id: true },
            });
            if (!originalOrder) {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: 'Original order not found' },
                };
            }
        }

        // Generate order number: COH-MMYYXXXX or EXC-MMYYXXXX (sequential per month)
        let orderNumber = providedOrderNumber;
        if (!orderNumber) {
            const prefix = isExchange ? 'EXC' : 'COH';
            const now = new Date();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yy = String(now.getFullYear()).slice(-2);
            const monthPrefix = `${prefix}-${mm}${yy}`;

            // Find the highest existing number with this month prefix
            const latest = await prisma.order.findFirst({
                where: { orderNumber: { startsWith: monthPrefix } },
                orderBy: { orderNumber: 'desc' },
                select: { orderNumber: true },
            });

            let nextSeq = 1;
            if (latest) {
                // Extract the sequence part after the prefix (e.g. "COH-02260005" → "0005")
                const seqStr = latest.orderNumber.slice(monthPrefix.length);
                const parsed = parseInt(seqStr, 10);
                if (!isNaN(parsed)) nextSeq = parsed + 1;
            }

            orderNumber = `${monthPrefix}${String(nextSeq).padStart(4, '0')}`;
        }

        // Use provided customerId if given, otherwise find or create
        let customerId = providedCustomerId || null;
        if (!customerId && (customerEmail || customerPhone)) {
            // Find existing customer by email or phone
            const existingCustomer = await prisma.customer.findFirst({
                where: {
                    OR: [
                        ...(customerEmail ? [{ email: customerEmail }] : []),
                        ...(customerPhone ? [{ phone: customerPhone }] : []),
                    ],
                },
            });

            if (existingCustomer) {
                customerId = existingCustomer.id;
            } else {
                // Create new customer - email is required, generate placeholder if not provided
                const newCustomer = await prisma.customer.create({
                    data: {
                        email: customerEmail ?? `offline-${Date.now()}@placeholder.local`,
                        phone: customerPhone ?? null,
                        firstName: customerName?.split(' ')[0] ?? '',
                        lastName: customerName?.split(' ').slice(1).join(' ') ?? '',
                        defaultAddress: shippingAddress ?? null,
                    },
                });
                customerId = newCustomer.id;
            }
        }

        // Create order with lines in transaction
        const order = await prisma.$transaction(async (tx: PrismaTransaction) => {
            const created = await tx.order.create({
                data: {
                    orderNumber,
                    channel: channel || 'offline',
                    customerId,
                    customerName,
                    customerEmail,
                    customerPhone,
                    shippingAddress,
                    internalNotes,
                    totalAmount: totalAmount ?? 0,
                    isExchange: isExchange || false,
                    originalOrderId: originalOrderId || null,
                    shipByDate: shipByDate ? new Date(shipByDate) : null,
                    paymentMethod: paymentMethod || 'Prepaid',
                    paymentStatus: paymentStatus || 'pending',
                    orderLines: {
                        create: lines.map((line) => ({
                            sku: { connect: { id: line.skuId } },
                            qty: line.qty,
                            unitPrice: line.unitPrice ?? 0,
                            lineStatus: 'pending',
                            shippingAddress: line.shippingAddress || shippingAddress || null,
                        })),
                    },
                },
                include: { orderLines: true },
            });

            // Update customer order count and tier
            if (created.customerId) {
                await tx.customer.update({
                    where: { id: created.customerId },
                    data: { orderCount: { increment: 1 } },
                });
            }

            return created;
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'order_created',
                orderId: order.id,
                affectedViews: ['open'],
                changes: { orderNumber: order.orderNumber },
            },
            context.user.id
        );

        // Push to "Orders from COH" sheet (fire-and-forget, same pattern as SSE broadcast)
        const sheetBaseUrl = getInternalApiBaseUrl();
        fetch(`${sheetBaseUrl}/api/internal/push-order-to-sheet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.id }),
        }).catch((err: unknown) => {
            console.error('[Server Function] Sheet push failed:', err instanceof Error ? err.message : String(err));
        });

        return {
            success: true,
            data: {
                orderId: order.id,
                orderNumber: order.orderNumber,
                customerId: order.customerId,
                lineCount: order.orderLines.length,
                totalAmount: order.totalAmount,
            },
        };
    });

/**
 * Cancel entire order
 * - Cancel all non-shipped lines
 * - Release inventory allocations
 * - Invalidate inventoryBalanceCache
 * - SSE broadcast
 */
export const cancelOrder = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => cancelOrderSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<CancelOrderResult>> => {
        const prisma = await getPrisma();
        const { orderId, reason } = data;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order not found' },
            };
        }

        // Cannot cancel shipped orders
        if (order.status === 'shipped') {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Cannot cancel shipped orders. Use RTO flow instead.' },
            };
        }

        // Already cancelled - idempotent
        if (order.status === 'cancelled') {
            return {
                success: true,
                data: {
                    orderId,
                    status: 'cancelled',
                    linesAffected: 0,
                    inventoryReleased: false,
                },
            };
        }

        // Find lines with allocated inventory
        type CancelOrderLine = { id: string; lineStatus: string; skuId: string; productionBatchId: string | null };
        const linesWithInventory = order.orderLines.filter((l: CancelOrderLine) =>
            sharedHasAllocatedInventory(l.lineStatus)
        );
        const affectedSkuIds = linesWithInventory.map((l: CancelOrderLine) => l.skuId);
        let inventoryReleased = false;

        // Transaction returns computed status and whether inventory was released
        const { newOrderStatus, txInventoryReleased } = await prisma.$transaction(async (tx: PrismaTransaction) => {
            let released = false;

            // Release inventory for allocated lines
            for (const line of linesWithInventory) {
                const txn = await tx.inventoryTransaction.findFirst({
                    where: {
                        referenceId: line.id,
                        txnType: TXN_TYPE.OUTWARD,
                        reason: TXN_REASON.ORDER_ALLOCATION,
                    },
                });
                if (txn) {
                    await tx.inventoryTransaction.delete({ where: { id: txn.id } });
                    released = true;
                }
            }

            // Handle production batches
            const batchIds = [...new Set(
                order.orderLines
                    .filter((l: CancelOrderLine) => l.productionBatchId)
                    .map((l: CancelOrderLine) => l.productionBatchId as string)
            )];

            for (const batchId of batchIds) {
                const otherLinesCount = await tx.orderLine.count({
                    where: { productionBatchId: batchId, orderId: { not: orderId } },
                });

                const batch = await tx.productionBatch.findUnique({
                    where: { id: batchId },
                    select: { status: true, qtyCompleted: true },
                });

                if (otherLinesCount === 0 && batch?.status === 'planned' && batch.qtyCompleted === 0) {
                    await tx.productionBatch.delete({ where: { id: batchId } });
                } else {
                    await tx.productionBatch.update({
                        where: { id: batchId },
                        data: { sourceOrderLineId: null },
                    });
                }
            }

            // Cancel all non-shipped lines
            await tx.orderLine.updateMany({
                where: { orderId, lineStatus: { not: 'shipped' } },
                data: { lineStatus: 'cancelled', productionBatchId: null },
            });

            // Compute correct order status from resulting line states
            const updatedLines = await tx.orderLine.findMany({
                where: { orderId },
                select: { lineStatus: true },
            });
            const computedStatus = computeOrderStatus({ orderLines: updatedLines });

            // Update order with computed status
            await tx.order.update({
                where: { id: orderId },
                data: {
                    status: computedStatus,
                    internalNotes: reason
                        ? order.internalNotes
                            ? `${order.internalNotes}\n\nCancelled: ${reason}`
                            : `Cancelled: ${reason}`
                        : order.internalNotes,
                },
            });

            // Decrement customer order count only if fully cancelled
            if (order.customerId && computedStatus === 'cancelled') {
                await tx.customer.update({
                    where: { id: order.customerId },
                    data: { orderCount: { decrement: 1 } },
                });
            }

            return { newOrderStatus: computedStatus, txInventoryReleased: released };
        });

        inventoryReleased = txInventoryReleased;

        // Broadcast SSE update - include 'shipped' in affectedViews if order has shipped lines
        const affectedViews = ['open', 'cancelled'];
        if (newOrderStatus === 'shipped' || newOrderStatus === 'partially_shipped') {
            affectedViews.push('shipped');
        }
        broadcastUpdate(
            {
                type: 'order_cancelled',
                orderId,
                affectedViews,
                changes: { status: newOrderStatus, affectedSkuIds },
            },
            context.user.id
        );

        // Invalidate inventory cache if inventory was released
        if (inventoryReleased && affectedSkuIds.length > 0) {
            try {
                const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
                inventoryBalanceCache.invalidate(affectedSkuIds);
            } catch {
                // Non-critical
            }
        }

        return {
            success: true,
            data: {
                orderId,
                status: newOrderStatus,
                linesAffected: order.orderLines.filter((l: CancelOrderLine) => l.lineStatus !== 'shipped').length,
                inventoryReleased,
            },
        };
    });

/**
 * Restore cancelled order
 * - Restore all cancelled lines to 'pending'
 * - Compute order status from resulting line states
 * - SSE broadcast
 */
export const uncancelOrder = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => uncancelOrderSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<UncancelOrderResult>> => {
        const prisma = await getPrisma();
        const { orderId } = data;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order not found' },
            };
        }

        // Only allow uncancelling cancelled orders
        if (order.status !== 'cancelled') {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Order is not cancelled' },
            };
        }

        type UncancelOrderLine = { id: string; lineStatus: string };
        const cancelledLines = order.orderLines.filter((l: UncancelOrderLine) => l.lineStatus === 'cancelled');

        // Transaction returns computed status
        const newOrderStatus = await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Restore all cancelled lines to pending
            await tx.orderLine.updateMany({
                where: { orderId, lineStatus: 'cancelled' },
                data: { lineStatus: 'pending' },
            });

            // Compute correct order status from resulting line states
            const updatedLines = await tx.orderLine.findMany({
                where: { orderId },
                select: { lineStatus: true },
            });
            const computedStatus = computeOrderStatus({ orderLines: updatedLines });

            // Update order with computed status
            await tx.order.update({
                where: { id: orderId },
                data: { status: computedStatus },
            });

            // Increment customer order count
            if (order.customerId) {
                await tx.customer.update({
                    where: { id: order.customerId },
                    data: { orderCount: { increment: 1 } },
                });
            }

            return computedStatus;
        });

        // Broadcast SSE update - include 'shipped' in affectedViews if order has shipped lines
        const affectedViews = ['open', 'cancelled'];
        if (newOrderStatus === 'shipped' || newOrderStatus === 'partially_shipped') {
            affectedViews.push('shipped');
        }
        broadcastUpdate(
            {
                type: 'order_uncancelled',
                orderId,
                affectedViews,
                changes: { status: newOrderStatus, lineStatus: 'pending' },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                orderId,
                status: newOrderStatus,
                linesRestored: cancelledLines.length,
            },
        };
    });

/**
 * Create custom SKU for line
 * - Create CustomSKU record linked to line
 * - Update line with custom SKU reference
 * - SSE broadcast
 */
export const customizeLine = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => customizeLineSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<CustomizeLineResult>> => {
        const prisma = await getPrisma();
        const { lineId, type, value, notes } = data;

        // Fetch line with SKU
        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            include: {
                sku: true,
                order: { select: { orderNumber: true } },
            },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Must be pending to customize
        if (line.lineStatus !== 'pending') {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'Cannot customize an allocated/picked/packed line. Unallocate first.',
                },
            };
        }

        // Already customized
        if (line.isCustomized) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Order line is already customized' },
            };
        }

        const baseSku = line.sku;
        const baseSkuId = baseSku.id;

        const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Atomically increment counter and generate custom SKU code
            const updatedBaseSku = await tx.sku.update({
                where: { id: baseSkuId },
                data: { customizationCount: { increment: 1 } },
            });

            const count = updatedBaseSku.customizationCount;
            const customCode = `${baseSku.skuCode}-C${String(count).padStart(2, '0')}`;

            // Create custom SKU
            const customSku = await tx.sku.create({
                data: {
                    skuCode: customCode,
                    variationId: baseSku.variationId,
                    size: baseSku.size,
                    mrp: baseSku.mrp,
                    isActive: true,
                    isCustomSku: true,
                    parentSkuId: baseSkuId,
                    customizationType: type,
                    customizationValue: value,
                    customizationNotes: notes || null,
                    linkedOrderLineId: lineId,
                },
            });

            // Update order line to point to custom SKU
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    skuId: customSku.id,
                    originalSkuId: baseSkuId,
                    isCustomized: true,
                    isNonReturnable: true,
                    customizedAt: new Date(),
                    customizedById: context.user.id,
                },
            });

            return { customSku, originalSkuCode: baseSku.skuCode };
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'line_customized',
                lineId,
                orderId: line.orderId,
                changes: {
                    isCustomized: true,
                    customSkuCode: result.customSku.skuCode,
                },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                lineId,
                customSkuId: result.customSku.id,
                customSkuCode: result.customSku.skuCode,
                originalSkuCode: result.originalSkuCode,
                isCustomized: true,
            },
        };
    });

/**
 * Remove custom SKU from line
 * - Delete CustomSKU record
 * - Clear custom SKU reference from line
 * - SSE broadcast
 */
export const removeLineCustomization = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => removeLineCustomizationSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<RemoveLineCustomizationResult>> => {
        const prisma = await getPrisma();
        const { lineId, force } = data;

        // Fetch line with custom SKU
        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { sku: true },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Not customized
        if (!line.isCustomized || !line.originalSkuId) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Order line is not customized' },
            };
        }

        const customSkuId = line.skuId;
        const customSkuCode = line.sku.skuCode;
        const originalSkuId = line.originalSkuId;

        // Check for inventory transactions
        const txnCount = await prisma.inventoryTransaction.count({
            where: { skuId: customSkuId },
        });

        if (txnCount > 0 && !force) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'Cannot undo customization - inventory transactions exist for custom SKU',
                },
            };
        }

        // Check for production batches
        const batchCount = await prisma.productionBatch.count({
            where: { skuId: customSkuId },
        });

        if (batchCount > 0 && !force) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'Cannot undo customization - production batch exists for custom SKU',
                },
            };
        }

        // Fetch original SKU
        const originalSku = await prisma.sku.findUnique({
            where: { id: originalSkuId },
        });

        if (!originalSku) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Original SKU not found' },
            };
        }

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Delete inventory transactions if force
            if (force && txnCount > 0) {
                await tx.inventoryTransaction.deleteMany({
                    where: { skuId: customSkuId },
                });
            }

            // Delete production batches if force
            if (force && batchCount > 0) {
                await tx.productionBatch.deleteMany({
                    where: { skuId: customSkuId },
                });
            }

            // Revert order line to original SKU
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    skuId: originalSkuId,
                    originalSkuId: null,
                    isCustomized: false,
                    isNonReturnable: false,
                    customizedAt: null,
                    customizedById: null,
                },
            });

            // Delete the custom SKU
            await tx.sku.delete({ where: { id: customSkuId } });
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'line_customization_removed',
                lineId,
                orderId: line.orderId,
                changes: {
                    isCustomized: false,
                    skuCode: originalSku.skuCode,
                },
            },
            context.user.id
        );

        // Invalidate inventory cache if transactions were deleted (force cleanup)
        if (force && txnCount > 0) {
            try {
                const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
                inventoryBalanceCache.invalidate([customSkuId]);
            } catch {
                // Non-critical
            }
        }

        return {
            success: true,
            data: {
                lineId,
                skuId: originalSkuId,
                skuCode: originalSku.skuCode,
                deletedCustomSkuCode: customSkuCode,
                forcedCleanup: force && (txnCount > 0 || batchCount > 0),
            },
        };
    });

/**
 * Update notes on a line
 */
export const updateLineNotes = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateLineNotesSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<UpdateLineNotesResult>> => {
        const prisma = await getPrisma();
        const { lineId, notes } = data;

        // Fetch line
        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            select: { id: true, orderId: true },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Update notes
        await prisma.orderLine.update({
            where: { id: lineId },
            data: { notes },
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'line_notes_updated',
                lineId,
                orderId: line.orderId,
                changes: { notes },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                lineId,
                orderId: line.orderId,
                notes,
            },
        };
    });
