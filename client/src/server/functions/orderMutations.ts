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
    type LineStatus,
    hasAllocatedInventory as sharedHasAllocatedInventory,
    isValidTransition,
    buildTransitionError,
    computeOrderStatus,
} from '@coh/shared/domain';

// ============================================
// INPUT SCHEMAS
// ============================================

const markLineDeliveredSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    deliveredAt: z.string().datetime().optional(),
});

const markLineRtoSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
});

const receiveLineRtoSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    condition: z.enum(['good', 'damaged', 'missing']).optional().default('good'),
    notes: z.string().optional(),
});

const cancelLineSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    reason: z.string().optional(),
});

const uncancelLineSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
});

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

const releaseToShippedSchema = z.object({
    orderIds: z.array(z.string().uuid()).optional(),
});

const releaseToCancelledSchema = z.object({
    orderIds: z.array(z.string().uuid()).optional(),
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

// ============================================
// PHASE 3 INPUT SCHEMAS - Complex Order Operations
// ============================================

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

const allocateOrderSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
    lineIds: z.array(z.string().uuid()).optional(), // Optional: if not provided, allocate all pending lines
});

const adminShipOrderSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
    awbNumber: z.string().trim()
        .transform((val) => val.toUpperCase() || 'ADMIN-MANUAL')
        .optional()
        .default('ADMIN-MANUAL'),
    courier: z.string().trim()
        .transform((val) => val || 'Manual')
        .optional()
        .default('Manual'),
});

const unshipOrderSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
    lineIds: z.array(z.string().uuid()).optional(), // Optional: if not provided, unship all shipped lines
});

const cancelOrderSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
    reason: z.string().optional(),
});

const uncancelOrderSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
});

const setLineStatusSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    status: z.enum(['pending', 'allocated', 'picked', 'packed', 'cancelled']),
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

// ============================================
// RESULT TYPES
// ============================================

export interface MutationResult<T> {
    success: boolean;
    data?: T;
    error?: {
        code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN';
        message: string;
    };
}

export interface MarkLineDeliveredResult {
    lineId: string;
    orderId: string;
    deliveredAt: string;
    orderTerminal: boolean;
}

export interface MarkLineRtoResult {
    lineId: string;
    orderId: string;
    rtoInitiatedAt: string;
}

export interface ReceiveLineRtoResult {
    lineId: string;
    orderId: string;
    rtoReceivedAt: string;
    rtoCondition: string;
    orderTerminal: boolean;
    inventoryRestored: boolean;
}

export interface CancelLineResult {
    lineId: string;
    orderId: string;
    lineStatus: 'cancelled';
    inventoryReleased: boolean;
}

export interface UncancelLineResult {
    lineId: string;
    orderId: string;
    lineStatus: 'pending';
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

export interface ReleaseResult {
    count: number;
    message: string;
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

// ============================================
// PHASE 3 RESULT TYPES - Complex Order Operations
// ============================================

export interface CreateOrderResult {
    orderId: string;
    orderNumber: string;
    customerId: string | null;
    lineCount: number;
    totalAmount: number;
}

export interface AllocateOrderResult {
    orderId: string;
    allocated: number;
    lineIds: string[];
    failed?: Array<{ lineId: string; reason: string }>;
}

export interface AdminShipOrderResult {
    orderId: string;
    shipped: number;
    lineIds: string[];
    awbNumber: string;
    courier: string;
    orderUpdated: boolean;
}

export interface UnshipOrderResult {
    orderId: string;
    unshipped: number;
    lineIds: string[];
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

export interface SetLineStatusResult {
    lineId: string;
    orderId: string;
    previousStatus: string;
    newStatus: string;
    inventoryUpdated: boolean;
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
// INVENTORY CACHE HELPER
// ============================================

// Cached import to avoid repeated dynamic import overhead (~50-150ms per call)
let _inventoryBalanceCache: Awaited<typeof import('@coh/shared/services/inventory')>['inventoryBalanceCache'] | null = null;

async function getInventoryBalanceCache() {
    if (!_inventoryBalanceCache) {
        const mod = await import('@coh/shared/services/inventory');
        _inventoryBalanceCache = mod.inventoryBalanceCache;
    }
    return _inventoryBalanceCache;
}

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
        const baseUrl = process.env.VITE_API_URL || 'http://localhost:3001';
        await fetch(`${baseUrl}/api/internal/sse-broadcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, excludeUserId }),
        }).catch(() => {
            // Silently fail - SSE broadcast is non-critical
            console.log('[Server Function] SSE broadcast failed (non-critical)');
        });
    } catch {
        // Silently fail
    }
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Mark a shipped line as delivered
 */
export const markLineDelivered = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => markLineDeliveredSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<MarkLineDeliveredResult>> => {
        const prisma = await getPrisma();
        const { lineId, deliveredAt } = data;
        const deliveryTime = deliveredAt ? new Date(deliveredAt) : new Date();

        // Fetch line with order context
        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                lineStatus: true,
                deliveredAt: true,
                orderId: true,
                order: {
                    select: { id: true, customerId: true },
                },
            },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Validate line is shipped
        if (line.lineStatus !== 'shipped') {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: `Cannot mark as delivered: line status is '${line.lineStatus}', must be 'shipped'`,
                },
            };
        }

        // Already delivered - idempotent
        if (line.deliveredAt) {
            return {
                success: true,
                data: {
                    lineId,
                    deliveredAt: line.deliveredAt.toISOString(),
                    orderId: line.orderId,
                    orderTerminal: false,
                },
            };
        }

        const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Update line-level deliveredAt and trackingStatus
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    deliveredAt: deliveryTime,
                    trackingStatus: 'delivered',
                },
            });

            // Check if ALL shipped lines are now delivered
            const undeliveredShippedLines = await tx.orderLine.count({
                where: {
                    orderId: line.orderId,
                    lineStatus: 'shipped',
                    deliveredAt: null,
                    id: { not: lineId },
                },
            });

            let orderTerminal = false;
            if (undeliveredShippedLines === 0) {
                // All shipped lines are delivered - update order status
                await tx.order.update({
                    where: { id: line.orderId },
                    data: { status: 'delivered' },
                });
                orderTerminal = true;
            }

            return { orderTerminal };
        });

        // Broadcast SSE update (fire and forget)
        broadcastUpdate(
            {
                type: 'line_delivered',
                lineId,
                orderId: line.orderId,
                affectedViews: ['shipped', 'cod_pending'],
                changes: {
                    deliveredAt: deliveryTime.toISOString(),
                    trackingStatus: 'delivered',
                    ...(result.orderTerminal ? { terminalStatus: 'delivered' } : {}),
                },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                lineId,
                deliveredAt: deliveryTime.toISOString(),
                orderId: line.orderId,
                orderTerminal: result.orderTerminal,
            },
        };
    });

/**
 * Initiate RTO for a shipped line
 */
export const markLineRto = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => markLineRtoSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<MarkLineRtoResult>> => {
        const prisma = await getPrisma();
        const { lineId } = data;
        const now = new Date();

        // Fetch line with order context and value fields
        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                lineStatus: true,
                rtoInitiatedAt: true,
                orderId: true,
                unitPrice: true,
                qty: true,
                order: {
                    select: {
                        id: true,
                        customerId: true,
                        orderLines: {
                            where: { rtoInitiatedAt: { not: null } },
                            select: { id: true },
                        },
                    },
                },
            },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Validate line is shipped
        if (line.lineStatus !== 'shipped') {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: `Cannot initiate RTO: line status is '${line.lineStatus}', must be 'shipped'`,
                },
            };
        }

        // Already RTO initiated - idempotent
        if (line.rtoInitiatedAt) {
            return {
                success: true,
                data: {
                    lineId,
                    rtoInitiatedAt: line.rtoInitiatedAt.toISOString(),
                    orderId: line.orderId,
                },
            };
        }

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Update line-level rtoInitiatedAt and trackingStatus
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    rtoInitiatedAt: now,
                    trackingStatus: 'rto_initiated',
                },
            });

            // Update customer RTO stats
            if (line.order?.customerId) {
                const lineValue = line.unitPrice * line.qty;
                const isFirstRtoForOrder = (line.order.orderLines?.length ?? 0) === 0;

                await tx.customer.update({
                    where: { id: line.order.customerId },
                    data: {
                        rtoCount: { increment: 1 },
                        rtoValue: { increment: lineValue },
                        ...(isFirstRtoForOrder ? { rtoOrderCount: { increment: 1 } } : {}),
                    },
                });
            }
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'line_rto',
                lineId,
                orderId: line.orderId,
                affectedViews: ['shipped', 'rto'],
                changes: {
                    rtoInitiatedAt: now.toISOString(),
                    trackingStatus: 'rto_initiated',
                },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                lineId,
                rtoInitiatedAt: now.toISOString(),
                orderId: line.orderId,
            },
        };
    });

/**
 * Receive RTO at warehouse
 */
export const receiveLineRto = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => receiveLineRtoSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<ReceiveLineRtoResult>> => {
        const prisma = await getPrisma();
        const { lineId, condition, notes } = data;
        const now = new Date();

        // Fetch line with order context
        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                lineStatus: true,
                rtoInitiatedAt: true,
                rtoReceivedAt: true,
                skuId: true,
                qty: true,
                orderId: true,
                order: {
                    select: { id: true },
                },
            },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Validate line has RTO initiated
        if (!line.rtoInitiatedAt) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'Cannot receive RTO: RTO has not been initiated for this line',
                },
            };
        }

        // Already received - idempotent
        if (line.rtoReceivedAt) {
            return {
                success: true,
                data: {
                    lineId,
                    rtoReceivedAt: line.rtoReceivedAt.toISOString(),
                    orderId: line.orderId,
                    rtoCondition: condition,
                    orderTerminal: false,
                    inventoryRestored: false,
                },
            };
        }

        const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Update line-level rtoReceivedAt, condition, and trackingStatus
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    rtoReceivedAt: now,
                    rtoCondition: condition,
                    rtoNotes: notes || null,
                    trackingStatus: 'rto_delivered',
                },
            });

            // Create inventory inward transaction (restore inventory)
            await tx.inventoryTransaction.create({
                data: {
                    skuId: line.skuId,
                    txnType: TXN_TYPE.INWARD,
                    qty: line.qty,
                    reason: TXN_REASON.RTO_RECEIVED,
                    referenceId: lineId,
                    createdById: context.user.id,
                },
            });

            // Check if ALL RTO-initiated lines are now received
            const unreceived = await tx.orderLine.count({
                where: {
                    orderId: line.orderId,
                    rtoInitiatedAt: { not: null },
                    rtoReceivedAt: null,
                    id: { not: lineId },
                },
            });

            return { orderTerminal: unreceived === 0 };
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'line_rto_received',
                lineId,
                orderId: line.orderId,
                affectedViews: ['rto', 'open'],
                changes: {
                    rtoReceivedAt: now.toISOString(),
                    rtoCondition: condition,
                    trackingStatus: 'rto_delivered',
                    ...(result.orderTerminal ? { terminalStatus: 'rto_received' } : {}),
                },
            },
            context.user.id
        );

        // Invalidate inventory cache (INWARD created)
        if (line.skuId) {
            try {
                const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
                inventoryBalanceCache.invalidate([line.skuId]);
                console.log('[receiveLineRto] Invalidated cache for SKU:', line.skuId);
            } catch {
                // Non-critical
            }
        }

        return {
            success: true,
            data: {
                lineId,
                rtoReceivedAt: now.toISOString(),
                orderId: line.orderId,
                rtoCondition: condition,
                orderTerminal: result.orderTerminal,
                inventoryRestored: true,
            },
        };
    });

/**
 * Cancel an order line
 *
 * Uses state machine validation and wraps inventory release + status update
 * in a transaction for atomicity. Production batch link is cleared via
 * productionBatchId = null; batch queries derive linked lines from this field.
 */
export const cancelLine = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => cancelLineSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<CancelLineResult>> => {
        const prisma = await getPrisma();
        const { lineId } = data;

        // Fetch line with minimal fields
        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                lineStatus: true,
                skuId: true,
                qty: true,
                orderId: true,
            },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Idempotent - already cancelled
        if (line.lineStatus === 'cancelled') {
            return {
                success: true,
                data: {
                    lineId,
                    orderId: line.orderId,
                    lineStatus: 'cancelled',
                    inventoryReleased: false,
                },
            };
        }

        // Validate transition using state machine
        if (!isValidTransition(line.lineStatus as LineStatus, 'cancelled')) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: buildTransitionError(line.lineStatus, 'cancelled'),
                },
            };
        }

        // Execute in transaction for atomicity (inventory release + status update)
        const inventoryReleased = await prisma.$transaction(async (tx: PrismaTransaction) => {
            let released = false;

            // Release inventory if allocated (state machine: delete_outward for allocated/picked/packed -> cancelled)
            if (sharedHasAllocatedInventory(line.lineStatus)) {
                const result = await tx.inventoryTransaction.deleteMany({
                    where: {
                        referenceId: lineId,
                        txnType: TXN_TYPE.OUTWARD,
                        reason: TXN_REASON.ORDER_ALLOCATION,
                    },
                });
                released = result.count > 0;
            }

            // Update line status and clear production batch link
            // (batch queries use OrderLine.productionBatchId to find linked lines)
            await tx.orderLine.update({
                where: { id: lineId },
                data: { lineStatus: 'cancelled', productionBatchId: null },
            });

            return released;
        });

        // Broadcast SSE update (async, non-blocking)
        broadcastUpdate(
            {
                type: 'line_status',
                view: 'open',
                lineId,
                orderId: line.orderId,
                changes: { lineStatus: 'cancelled' },
            },
            context.user.id
        );

        // Invalidate inventory cache if inventory was released
        if (inventoryReleased && line.skuId) {
            try {
                const cache = await getInventoryBalanceCache();
                cache.invalidate([line.skuId]);
            } catch {
                // Non-critical
            }
        }

        return {
            success: true,
            data: {
                lineId,
                orderId: line.orderId,
                lineStatus: 'cancelled',
                inventoryReleased,
            },
        };
    });

/**
 * Uncancel a previously cancelled line
 */
export const uncancelLine = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => uncancelLineSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<UncancelLineResult>> => {
        const prisma = await getPrisma();
        const { lineId } = data;

        // Fetch line
        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                lineStatus: true,
                qty: true,
                unitPrice: true,
                orderId: true,
                order: { select: { customerId: true } },
            },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Idempotent - not cancelled
        if (line.lineStatus !== 'cancelled') {
            return {
                success: true,
                data: {
                    lineId,
                    orderId: line.orderId,
                    lineStatus: 'pending',
                },
            };
        }

        // Update line status to pending
        await prisma.orderLine.update({
            where: { id: lineId },
            data: { lineStatus: 'pending' },
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'line_status',
                view: 'open',
                lineId,
                orderId: line.orderId,
                changes: { lineStatus: 'pending' },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                lineId,
                orderId: line.orderId,
                lineStatus: 'pending',
            },
        };
    });

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: any = {};
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

        const order = await prisma.order.findUnique({
            where: { id: orderId },
        });

        if (!order) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order not found' },
            };
        }

        // Cannot add lines to shipped/cancelled orders
        if (order.status === 'shipped' || order.status === 'cancelled') {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: `Cannot add lines to ${order.status} orders`,
                },
            };
        }

        let newLineId: string = '';

        await prisma.$transaction(async (tx: PrismaTransaction) => {
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
 * Release orders to shipped view
 */
export const releaseToShipped = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => releaseToShippedSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<ReleaseResult>> => {
        const prisma = await getPrisma();
        const { orderIds } = data;

        // Build where clause - must match the Open view's "fully shipped but not released" condition
        // Uses AND to explicitly combine conditions, avoiding potential Prisma issues
        const whereClause: Prisma.OrderWhereInput = {
            AND: [
                { isArchived: false },
                { releasedToShipped: false },
                // Must have at least one shipped line
                { orderLines: { some: { lineStatus: 'shipped' } } },
                // All lines must be shipped or cancelled (no pending/allocated/picked/packed)
                {
                    NOT: {
                        orderLines: {
                            some: {
                                lineStatus: { notIn: ['shipped', 'cancelled'] },
                            },
                        },
                    },
                },
                // Add orderIds filter if provided
                ...(orderIds && orderIds.length > 0 ? [{ id: { in: orderIds } }] : []),
            ],
        };

        const result = await prisma.order.updateMany({
            where: whereClause,
            data: { releasedToShipped: true },
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'order_updated',
                affectedViews: ['open', 'shipped'],
                changes: { releasedToShipped: true, count: result.count },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                count: result.count,
                message: `Released ${result.count} orders to shipped view`,
            },
        };
    });

/**
 * Release orders to cancelled view
 */
export const releaseToCancelled = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => releaseToCancelledSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<ReleaseResult>> => {
        const prisma = await getPrisma();
        const { orderIds } = data;

        // Build where clause - must match the Open view's "fully cancelled but not released" condition
        // Uses AND to explicitly combine conditions
        const whereClause: Prisma.OrderWhereInput = {
            AND: [
                { isArchived: false },
                { releasedToCancelled: false },
                // Must have at least one cancelled line
                { orderLines: { some: { lineStatus: 'cancelled' } } },
                // All lines must be cancelled (no other statuses)
                {
                    NOT: {
                        orderLines: {
                            some: {
                                lineStatus: { not: 'cancelled' },
                            },
                        },
                    },
                },
                // Add orderIds filter if provided
                ...(orderIds && orderIds.length > 0 ? [{ id: { in: orderIds } }] : []),
            ],
        };

        const result = await prisma.order.updateMany({
            where: whereClause,
            data: { releasedToCancelled: true },
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'order_updated',
                affectedViews: ['open', 'cancelled'],
                changes: { releasedToCancelled: true, count: result.count },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                count: result.count,
                message: `Released ${result.count} orders to cancelled view`,
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: any = {};
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
                console.log('[deleteOrder] Invalidated cache for SKUs:', uniqueSkuIds);
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

// ============================================
// PHASE 3 SERVER FUNCTIONS - Complex Order Operations
// ============================================

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

        // Generate order number with EXC- prefix for exchanges
        const orderNumber =
            providedOrderNumber ||
            (isExchange
                ? `EXC-${Date.now().toString().slice(-8)}`
                : `COH-${Date.now().toString().slice(-8)}`);

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
 * Allocate inventory for order lines
 * - Check stock for all lines
 * - Create OUTWARD transactions for each line
 * - Update lineStatus='allocated' using state machine
 * - Invalidate inventoryBalanceCache
 * - SSE broadcast
 */
export const allocateOrder = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => allocateOrderSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<AllocateOrderResult>> => {
        try {
        const t0 = performance.now();
        console.log('[allocateOrder] Starting allocation:', { orderId: data.orderId, lineIds: data.lineIds });

        const prisma = await getPrisma();
        const t1 = performance.now();
        console.log(`[allocateOrder] ⏱ getPrisma: ${(t1 - t0).toFixed(0)}ms`);

        const { orderId, lineIds } = data;

        // Fetch order with lines
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                orderLines: {
                    where: lineIds && lineIds.length > 0
                        ? { id: { in: lineIds } }
                        : { lineStatus: 'pending' },
                    select: { id: true, skuId: true, qty: true, lineStatus: true },
                },
            },
        });
        const t2 = performance.now();
        console.log(`[allocateOrder] ⏱ findUnique order: ${(t2 - t1).toFixed(0)}ms`);

        if (!order) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order not found' },
            };
        }

        type OrderLineForAllocation = { id: string; skuId: string; qty: number; lineStatus: string };
        const linesToAllocate = order.orderLines.filter((l: OrderLineForAllocation) => l.lineStatus === 'pending');
        if (linesToAllocate.length === 0) {
            return {
                success: true,
                data: {
                    orderId,
                    allocated: 0,
                    lineIds: [],
                    failed: order.orderLines
                        .filter((l: OrderLineForAllocation) => l.lineStatus !== 'pending')
                        .map((l: OrderLineForAllocation) => ({ lineId: l.id, reason: `Invalid status: ${l.lineStatus}` })),
                },
            };
        }

        // Group lines by SKU for efficient balance checking
        const linesBySku = new Map<string, OrderLineForAllocation[]>();
        for (const line of linesToAllocate) {
            if (!linesBySku.has(line.skuId)) {
                linesBySku.set(line.skuId, []);
            }
            linesBySku.get(line.skuId)!.push(line);
        }

        // Calculate required qty per SKU
        const skuRequirements = new Map<string, { lines: OrderLineForAllocation[]; totalQty: number }>();
        for (const [skuId, skuLines] of linesBySku) {
            const totalQty = skuLines.reduce((sum: number, l: OrderLineForAllocation) => sum + l.qty, 0);
            skuRequirements.set(skuId, { lines: skuLines, totalQty });
        }

        const skuIds = Array.from(skuRequirements.keys());
        const failed: Array<{ lineId: string; reason: string }> = [];

        // FAST-FAIL: Check cached balances before entering transaction
        // This avoids starting doomed transactions when cache shows insufficient stock
        const t3 = performance.now();
        const inventoryCache = await getInventoryBalanceCache();
        const t4 = performance.now();
        console.log(`[allocateOrder] ⏱ getInventoryBalanceCache: ${(t4 - t3).toFixed(0)}ms`);

        const cachedBalances = await inventoryCache.get(prisma, skuIds);
        const t5 = performance.now();
        console.log(`[allocateOrder] ⏱ inventoryCache.get: ${(t5 - t4).toFixed(0)}ms (${skuIds.length} SKUs)`);

        const skusToVerify = new Map<string, { lines: OrderLineForAllocation[]; totalQty: number }>();
        for (const [skuId, { lines: skuLines, totalQty }] of skuRequirements) {
            const cached = cachedBalances.get(skuId);
            // If cache shows insufficient stock, fail immediately (cache may be stale but never shows MORE than actual)
            if (cached && cached.currentBalance < totalQty) {
                for (const line of skuLines) {
                    failed.push({
                        lineId: line.id,
                        reason: `Insufficient stock: ${cached.currentBalance} available, ${totalQty} required`,
                    });
                }
                continue;
            }
            // Cache shows sufficient or unknown - verify in transaction
            skusToVerify.set(skuId, { lines: skuLines, totalQty });
        }

        // If all SKUs failed fast-fail check, return early without starting transaction
        if (skusToVerify.size === 0) {
            console.log('[allocateOrder] Fast-fail: all SKUs have insufficient stock per cache');
            return {
                success: true,
                data: {
                    orderId,
                    allocated: 0,
                    lineIds: [],
                    ...(failed.length > 0 ? { failed } : {}),
                },
            };
        }

        // Collect lines to allocate (cache already verified balance, skip re-check in transaction)
        // NOTE: Rare race condition may cause slight over-allocation (shows negative balance) - acceptable per business rules
        const linesToProcess: OrderLineForAllocation[] = [];
        for (const [, { lines: skuLines }] of skusToVerify) {
            linesToProcess.push(...skuLines);
        }

        if (linesToProcess.length === 0) {
            return {
                success: true,
                data: {
                    orderId,
                    allocated: 0,
                    lineIds: [],
                    ...(failed.length > 0 ? { failed } : {}),
                },
            };
        }

        // Transaction: write-only (no balance re-check)
        const t6 = performance.now();
        const timestamp = new Date();
        const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Batch create all OUTWARD transactions at once
            await tx.inventoryTransaction.createMany({
                data: linesToProcess.map((line: OrderLineForAllocation) => ({
                    skuId: line.skuId,
                    txnType: TXN_TYPE.OUTWARD,
                    qty: line.qty,
                    reason: TXN_REASON.ORDER_ALLOCATION,
                    referenceId: line.id,
                    createdById: context.user.id,
                })),
            });

            // Batch update all line statuses at once
            const lineIdsToUpdate = linesToProcess.map((l: OrderLineForAllocation) => l.id);
            await tx.orderLine.updateMany({
                where: { id: { in: lineIdsToUpdate } },
                data: { lineStatus: 'allocated', allocatedAt: timestamp },
            });

            return { allocated: lineIdsToUpdate };
        });
        const t7 = performance.now();
        console.log(`[allocateOrder] ⏱ transaction (writes only): ${(t7 - t6).toFixed(0)}ms`);

        console.log('[allocateOrder] Allocated:', result.allocated.length, 'lines, failed:', failed.length);

        // Invalidate inventory cache for affected SKUs (reuse cached getter)
        if (result.allocated.length > 0) {
            const allocatedSkuIds = [...new Set(
                linesToAllocate
                    .filter((l: OrderLineForAllocation) => result.allocated.includes(l.id))
                    .map((l: OrderLineForAllocation) => l.skuId)
            )] as string[];
            if (allocatedSkuIds.length > 0) {
                inventoryCache.invalidate(allocatedSkuIds);
            }
        }

        // Broadcast SSE update (fire and forget)
        if (result.allocated.length > 0) {
            broadcastUpdate(
                {
                    type: 'order_allocated',
                    orderId,
                    affectedViews: ['open'],
                    changes: { lineStatus: 'allocated', lineIds: result.allocated },
                },
                context.user.id
            );
        }

        const t8 = performance.now();
        console.log(`[allocateOrder] ⏱ cache invalidate + SSE: ${(t8 - t7).toFixed(0)}ms`);

        const tEnd = performance.now();
        console.log(`[allocateOrder] ⏱ TOTAL: ${(tEnd - t0).toFixed(0)}ms`);
        console.log(`[allocateOrder] ⏱ BREAKDOWN: prisma=${(t1-t0).toFixed(0)}ms, query=${(t2-t1).toFixed(0)}ms, cacheGet=${(t5-t3).toFixed(0)}ms, txn=${(t7-t6).toFixed(0)}ms, cleanup=${(t8-t7).toFixed(0)}ms`);

        return {
            success: true,
            data: {
                orderId,
                allocated: result.allocated.length,
                lineIds: result.allocated,
                ...(failed.length > 0 ? { failed } : {}),
            },
        };
        } catch (error: unknown) {
            console.error('[allocateOrder] ERROR:', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Admin force ship bypassing status checks (ADMIN ONLY)
 * - Check ENABLE_ADMIN_SHIP env var
 * - Require admin role
 * - Force ship all lines regardless of current status
 * - SSE broadcast
 */
export const adminShipOrder = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => adminShipOrderSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<AdminShipOrderResult>> => {
        const prisma = await getPrisma();
        const { orderId, awbNumber, courier } = data;

        // Check feature flag
        const enableAdminShip = process.env.ENABLE_ADMIN_SHIP !== 'false';
        if (!enableAdminShip) {
            return {
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'Admin ship feature is disabled',
                },
            };
        }

        // Check admin role
        if (context.user.role !== 'admin') {
            return {
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'Admin ship requires admin role',
                },
            };
        }

        // Fetch order with lines
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

        // Ship all non-shipped, non-cancelled lines
        type AdminShipOrderLine = { id: string; lineStatus: string };
        const linesToShip = order.orderLines.filter((l: AdminShipOrderLine) =>
            l.lineStatus !== 'shipped' && l.lineStatus !== 'cancelled'
        );

        if (linesToShip.length === 0) {
            return {
                success: true,
                data: {
                    orderId,
                    shipped: 0,
                    lineIds: [],
                    awbNumber,
                    courier,
                    orderUpdated: false,
                },
            };
        }

        const now = new Date();
        const shippedLineIds = linesToShip.map((l: AdminShipOrderLine) => l.id);

        const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Force update all lines to shipped (skip status validation)
            await tx.orderLine.updateMany({
                where: { id: { in: shippedLineIds } },
                data: {
                    lineStatus: 'shipped',
                    shippedAt: now,
                    awbNumber,
                    courier,
                    trackingStatus: 'in_transit',
                },
            });

            // Update order status
            await tx.order.update({
                where: { id: orderId },
                data: { status: 'shipped' },
            });

            return { orderUpdated: true };
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'order_shipped',
                orderId,
                affectedViews: ['open', 'shipped'],
                changes: {
                    lineStatus: 'shipped',
                    awbNumber,
                    courier,
                    shippedAt: now.toISOString(),
                    adminShip: true,
                },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                orderId,
                shipped: shippedLineIds.length,
                lineIds: shippedLineIds,
                awbNumber,
                courier,
                orderUpdated: result.orderUpdated,
            },
        };
    });

/**
 * Unship order - reverse ship operation
 * - Clear shippedAt, awbNumber, courier
 * - Set lineStatus='packed' (reverse transition)
 * - SSE broadcast
 */
export const unshipOrder = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => unshipOrderSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<UnshipOrderResult>> => {
        const prisma = await getPrisma();
        const { orderId, lineIds } = data;

        // Fetch order with lines
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                orderLines: lineIds && lineIds.length > 0
                    ? { where: { id: { in: lineIds } } }
                    : { where: { lineStatus: 'shipped' } },
            },
        });

        if (!order) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order not found' },
            };
        }

        // Filter shipped lines
        type UnshipOrderLine = { id: string; lineStatus: string };
        const linesToUnship = order.orderLines.filter((l: UnshipOrderLine) => l.lineStatus === 'shipped');
        if (linesToUnship.length === 0) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'No shipped lines to unship' },
            };
        }

        const unshippedLineIds = linesToUnship.map((l: UnshipOrderLine) => l.id);

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Revert line statuses and clear tracking fields
            await tx.orderLine.updateMany({
                where: { id: { in: unshippedLineIds } },
                data: {
                    lineStatus: 'packed',
                    shippedAt: null,
                    awbNumber: null,
                    courier: null,
                    trackingStatus: null,
                },
            });

            // Update order status back to open
            await tx.order.update({
                where: { id: orderId },
                data: {
                    status: 'open',
                    releasedToShipped: false,
                },
            });
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'order_unshipped',
                orderId,
                affectedViews: ['open', 'shipped'],
                changes: { lineStatus: 'packed' },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                orderId,
                unshipped: unshippedLineIds.length,
                lineIds: unshippedLineIds,
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
                console.log('[cancelOrder] Invalidated cache for SKUs:', affectedSkuIds);
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
 * Manual status transition
 * - Use state machine for valid transitions
 * - Handle inventory for allocated transition
 * - SSE broadcast
 */
export const setLineStatus = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => setLineStatusSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<SetLineStatusResult>> => {
        const prisma = await getPrisma();
        const { lineId, status: targetStatus } = data;

        // Fetch current line state
        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                skuId: true,
                qty: true,
                lineStatus: true,
                orderId: true,
            },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        const currentStatus = line.lineStatus;

        // Validate transition using shared state machine
        if (!isValidTransition(currentStatus as LineStatus, targetStatus as LineStatus)) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: buildTransitionError(currentStatus, targetStatus),
                },
            };
        }

        let inventoryUpdated = false;
        const timestamp = new Date();

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Build update data based on transition
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const updateData: any = { lineStatus: targetStatus };

            // Handle inventory effects
            if (currentStatus === 'pending' && targetStatus === 'allocated') {
                // Allocate: create OUTWARD transaction
                await tx.inventoryTransaction.create({
                    data: {
                        skuId: line.skuId,
                        txnType: TXN_TYPE.OUTWARD,
                        qty: line.qty,
                        reason: TXN_REASON.ORDER_ALLOCATION,
                        referenceId: lineId,
                        createdById: context.user.id,
                    },
                });
                updateData.allocatedAt = timestamp;
                inventoryUpdated = true;
            } else if (currentStatus === 'allocated' && targetStatus === 'pending') {
                // Unallocate: delete OUTWARD transaction
                await tx.inventoryTransaction.deleteMany({
                    where: {
                        referenceId: lineId,
                        txnType: TXN_TYPE.OUTWARD,
                        reason: TXN_REASON.ORDER_ALLOCATION,
                    },
                });
                updateData.allocatedAt = null;
                inventoryUpdated = true;
            } else if (targetStatus === 'cancelled' && sharedHasAllocatedInventory(currentStatus)) {
                // Cancel with allocated inventory: release it
                await tx.inventoryTransaction.deleteMany({
                    where: {
                        referenceId: lineId,
                        txnType: TXN_TYPE.OUTWARD,
                        reason: TXN_REASON.ORDER_ALLOCATION,
                    },
                });
                inventoryUpdated = true;
            }

            // Handle timestamp updates
            const status = targetStatus as string;
            const current = currentStatus as string;
            if (status === 'picked') {
                updateData.pickedAt = timestamp;
            } else if (current === 'picked' && status === 'allocated') {
                updateData.pickedAt = null;
            } else if (status === 'packed') {
                updateData.packedAt = timestamp;
            } else if (current === 'packed' && status === 'picked') {
                updateData.packedAt = null;
            }

            await tx.orderLine.update({
                where: { id: lineId },
                data: updateData,
            });
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'line_status',
                view: 'open',
                lineId,
                orderId: line.orderId,
                changes: { lineStatus: targetStatus },
            },
            context.user.id
        );

        // Invalidate inventory cache if inventory was updated
        if (inventoryUpdated && line.skuId) {
            try {
                const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
                inventoryBalanceCache.invalidate([line.skuId]);
                console.log('[setLineStatus] Invalidated cache for SKU:', line.skuId);
            } catch {
                // Non-critical
            }
        }

        return {
            success: true,
            data: {
                lineId,
                orderId: line.orderId,
                previousStatus: currentStatus,
                newStatus: targetStatus,
                inventoryUpdated,
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
                    fabricConsumption: baseSku.fabricConsumption,
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
                console.log('[removeLineCustomization] Invalidated cache for custom SKU:', customSkuId);
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

// ============================================
// ADDITIONAL SHIPPING MUTATIONS
// ============================================

/**
 * Ship multiple lines with tracking info
 */
const shipLinesSchema = z.object({
    lineIds: z.array(z.string().uuid()).min(1, 'At least one line ID is required'),
    awbNumber: z.string().min(1, 'AWB number is required').trim().transform((val) => val.toUpperCase()),
    courier: z.string().min(1, 'Courier is required').trim(),
});

export interface ShipLinesResult {
    shipped: Array<{ lineId: string; skuCode?: string; qty: number }>;
    skipped: Array<{ lineId: string; skuCode?: string; qty: number; reason?: string }>;
    errors: Array<{ lineId?: string; skuCode?: string; error: string; code: string; currentStatus?: string }>;
    orderUpdated: boolean;
    orderId?: string | null;
}

export const shipLines = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => shipLinesSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<ShipLinesResult>> => {
        const prisma = await getPrisma();
        const { lineIds, awbNumber, courier } = data;

        try {
            // Import shipOrderLines from shared services
            const { shipOrderLines } = await import('@coh/shared/services/orders');

            const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
                return await shipOrderLines(tx, {
                    orderLineIds: lineIds,
                    awbNumber,
                    courier,
                    userId: context.user.id,
                });
            });

            // Broadcast SSE update for shipped lines
            if (result.shipped.length > 0) {
                const orderId = result.orderId;
                broadcastUpdate(
                    {
                        type: 'lines_shipped',
                        orderId: orderId || undefined,
                        affectedViews: ['open', 'shipped'],
                        changes: {
                            awbNumber,
                            courier,
                            shippedCount: result.shipped.length,
                        },
                    },
                    context.user.id
                );
            }

            return {
                success: true,
                data: result,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: {
                    code: errorMessage.includes('AWB') ? 'CONFLICT' : 'BAD_REQUEST',
                    message: errorMessage,
                },
            };
        }
    });

/**
 * Mark a single line as shipped with AWB
 */
const markShippedLineSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    awbNumber: z.string().min(1, 'AWB number is required').trim().transform((val) => val.toUpperCase()),
    courier: z.string().min(1, 'Courier is required').trim(),
});

export interface MarkShippedLineResult {
    lineId: string;
    orderId: string;
    shippedAt: string;
    awbNumber: string;
    courier: string;
    orderUpdated: boolean;
}

export const markShippedLine = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => markShippedLineSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<MarkShippedLineResult>> => {
        const prisma = await getPrisma();
        const { lineId, awbNumber, courier } = data;

        try {
            // Import shipOrderLines from shared services
            const { shipOrderLines } = await import('@coh/shared/services/orders');

            const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
                return await shipOrderLines(tx, {
                    orderLineIds: [lineId],
                    awbNumber,
                    courier,
                    userId: context.user.id,
                });
            });

            if (result.errors.length > 0) {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST',
                        message: result.errors[0].error,
                    },
                };
            }

            if (result.skipped.length > 0) {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST',
                        message: result.skipped[0].reason || 'Line cannot be shipped',
                    },
                };
            }

            const shippedLine = result.shipped[0];
            if (!shippedLine) {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST',
                        message: 'Failed to ship line',
                    },
                };
            }

            // Fetch updated line for response
            const line = await prisma.orderLine.findUnique({
                where: { id: lineId },
                select: { orderId: true, shippedAt: true },
            });

            if (!line) {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: 'Line not found after shipping' },
                };
            }

            // Broadcast SSE update
            broadcastUpdate(
                {
                    type: 'line_shipped',
                    lineId,
                    orderId: line.orderId,
                    affectedViews: ['open', 'shipped'],
                    changes: {
                        lineStatus: 'shipped',
                        awbNumber,
                        courier,
                        shippedAt: line.shippedAt?.toISOString(),
                    },
                },
                context.user.id
            );

            return {
                success: true,
                data: {
                    lineId,
                    orderId: line.orderId,
                    shippedAt: line.shippedAt?.toISOString() || new Date().toISOString(),
                    awbNumber,
                    courier,
                    orderUpdated: result.orderUpdated,
                },
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: {
                    code: errorMessage.includes('AWB') ? 'CONFLICT' : 'BAD_REQUEST',
                    message: errorMessage,
                },
            };
        }
    });

/**
 * Revert shipped line back to packed
 */
const unmarkShippedLineSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
});

export interface UnmarkShippedLineResult {
    lineId: string;
    orderId: string;
    lineStatus: string;
}

export const unmarkShippedLine = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => unmarkShippedLineSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<UnmarkShippedLineResult>> => {
        const prisma = await getPrisma();
        const { lineId } = data;

        // Fetch line
        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                lineStatus: true,
                orderId: true,
                deliveredAt: true,
                rtoInitiatedAt: true,
            },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Validate line is shipped and not delivered/RTO
        if (line.lineStatus !== 'shipped') {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: `Cannot unship: line status is '${line.lineStatus}', must be 'shipped'`,
                },
            };
        }

        if (line.deliveredAt) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'Cannot unship a delivered line',
                },
            };
        }

        if (line.rtoInitiatedAt) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'Cannot unship a line with RTO initiated',
                },
            };
        }

        // Revert to packed status
        await prisma.$transaction(async (tx: PrismaTransaction) => {
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    lineStatus: 'packed',
                    shippedAt: null,
                    awbNumber: null,
                    courier: null,
                    trackingStatus: null,
                },
            });

            // Check if order status should be reverted
            const remainingShippedLines = await tx.orderLine.count({
                where: {
                    orderId: line.orderId,
                    lineStatus: 'shipped',
                    id: { not: lineId },
                },
            });

            if (remainingShippedLines === 0) {
                await tx.order.update({
                    where: { id: line.orderId },
                    data: {
                        status: 'open',
                        releasedToShipped: false,
                    },
                });
            }
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'line_unshipped',
                lineId,
                orderId: line.orderId,
                affectedViews: ['open', 'shipped'],
                changes: {
                    lineStatus: 'packed',
                },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                lineId,
                orderId: line.orderId,
                lineStatus: 'packed',
            },
        };
    });

/**
 * Update tracking info on a line
 */
const updateLineTrackingSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    awbNumber: z.string().optional(),
    courier: z.string().optional(),
    trackingStatus: z.string().optional(),
});

export interface UpdateLineTrackingResult {
    lineId: string;
    orderId: string;
    updated: {
        awbNumber?: string | null;
        courier?: string | null;
        trackingStatus?: string | null;
    };
}

export const updateLineTracking = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateLineTrackingSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<UpdateLineTrackingResult>> => {
        const prisma = await getPrisma();
        const { lineId, awbNumber, courier, trackingStatus } = data;

        // Fetch line
        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            select: { id: true, orderId: true, lineStatus: true },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Build update object
        const updateData: Record<string, string | null> = {};
        if (awbNumber !== undefined) {
            updateData.awbNumber = awbNumber.trim() || null;
        }
        if (courier !== undefined) {
            updateData.courier = courier.trim() || null;
        }
        if (trackingStatus !== undefined) {
            updateData.trackingStatus = trackingStatus.trim() || null;
        }

        if (Object.keys(updateData).length === 0) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'No tracking fields provided to update',
                },
            };
        }

        // Update line
        await prisma.orderLine.update({
            where: { id: lineId },
            data: updateData,
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'line_tracking_updated',
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
                updated: updateData,
            },
        };
    });

/**
 * Update notes on a line
 */
const updateLineNotesSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    notes: z.string(),
});

export interface UpdateLineNotesResult {
    lineId: string;
    orderId: string;
    notes: string;
}

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

// ============================================
// ORDER-LEVEL DELIVERY/RTO MUTATIONS
// ============================================

/**
 * Mark all shipped lines of an order as delivered
 */
const markDeliveredSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
});

export interface MarkDeliveredResult {
    orderId: string;
    status: 'delivered';
    linesDelivered: number;
}

export const markDelivered = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => markDeliveredSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<MarkDeliveredResult>> => {
        const prisma = await getPrisma();
        const { orderId } = data;
        const now = new Date();

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                status: true,
                orderLines: {
                    where: { lineStatus: 'shipped', deliveredAt: null },
                    select: { id: true },
                },
            },
        });

        if (!order) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order not found' },
            };
        }

        const shippedLineIds = order.orderLines.map((l: { id: string }) => l.id);

        if (shippedLineIds.length === 0) {
            // No shipped lines to deliver - just update order status
            await prisma.order.update({
                where: { id: orderId },
                data: { status: 'delivered' },
            });
        } else {
            // Update all shipped lines to delivered
            await prisma.$transaction(async (tx: PrismaTransaction) => {
                await tx.orderLine.updateMany({
                    where: { id: { in: shippedLineIds } },
                    data: {
                        deliveredAt: now,
                        trackingStatus: 'delivered',
                    },
                });

                await tx.order.update({
                    where: { id: orderId },
                    data: { status: 'delivered' },
                });
            });
        }

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'order_delivered',
                orderId,
                affectedViews: ['shipped', 'cod_pending'],
                changes: { status: 'delivered', deliveredAt: now.toISOString() },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                orderId,
                status: 'delivered',
                linesDelivered: shippedLineIds.length,
            },
        };
    });

/**
 * Initiate RTO for all shipped lines of an order
 */
const markRtoSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
});

export interface MarkRtoResult {
    orderId: string;
    rtoInitiatedAt: string;
    linesInitiated: number;
}

export const markRto = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => markRtoSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<MarkRtoResult>> => {
        const prisma = await getPrisma();
        const { orderId } = data;
        const now = new Date();

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                status: true,
                customerId: true,
                orderLines: {
                    where: { lineStatus: 'shipped', rtoInitiatedAt: null },
                    select: { id: true, unitPrice: true, qty: true },
                },
                _count: {
                    select: {
                        orderLines: { where: { rtoInitiatedAt: { not: null } } },
                    },
                },
            },
        });

        if (!order) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order not found' },
            };
        }

        type MarkRtoOrderLine = { id: string; unitPrice: number; qty: number };
        const shippedLines = order.orderLines;
        const shippedLineIds = shippedLines.map((l: MarkRtoOrderLine) => l.id);
        const linesInitiated = shippedLineIds.length;
        const totalValue = shippedLines.reduce((sum: number, l: MarkRtoOrderLine) => sum + l.unitPrice * l.qty, 0);
        const isFirstRtoForOrder = order._count.orderLines === 0;

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Update all shipped lines to RTO initiated
            if (shippedLineIds.length > 0) {
                await tx.orderLine.updateMany({
                    where: { id: { in: shippedLineIds } },
                    data: {
                        rtoInitiatedAt: now,
                        trackingStatus: 'rto_initiated',
                    },
                });
            }

            // Update customer RTO stats
            if (linesInitiated > 0 && order.customerId) {
                await tx.customer.update({
                    where: { id: order.customerId },
                    data: {
                        rtoCount: { increment: linesInitiated },
                        rtoValue: { increment: totalValue },
                        ...(isFirstRtoForOrder ? { rtoOrderCount: { increment: 1 } } : {}),
                    },
                });
            }
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'order_rto',
                orderId,
                affectedViews: ['shipped', 'rto'],
                changes: { rtoInitiatedAt: now.toISOString() },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                orderId,
                rtoInitiatedAt: now.toISOString(),
                linesInitiated,
            },
        };
    });

/**
 * Receive RTO for all RTO-initiated lines of an order
 */
const receiveRtoSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
    condition: z.enum(['good', 'damaged', 'missing']).optional().default('good'),
    notes: z.string().optional(),
});

export interface ReceiveRtoResult {
    orderId: string;
    rtoReceivedAt: string;
    linesReceived: number;
    condition: string;
}

export const receiveRto = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => receiveRtoSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<ReceiveRtoResult>> => {
        const prisma = await getPrisma();
        const { orderId, condition, notes } = data;
        const now = new Date();

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                orderLines: {
                    where: {
                        rtoInitiatedAt: { not: null },
                        rtoReceivedAt: null,
                    },
                    select: { id: true, skuId: true, qty: true },
                },
            },
        });

        if (!order) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order not found' },
            };
        }

        const rtoLines = order.orderLines;
        const affectedSkuIds = rtoLines.map((l: { skuId: string }) => l.skuId);
        const lineIds = rtoLines.map((l: { id: string }) => l.id);

        if (rtoLines.length === 0) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'No RTO-initiated lines to receive',
                },
            };
        }

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Update all RTO-initiated lines
            const updateData: Record<string, unknown> = {
                rtoReceivedAt: now,
                rtoCondition: condition,
                trackingStatus: 'rto_delivered',
            };
            if (notes) {
                updateData.rtoNotes = notes;
            }

            await tx.orderLine.updateMany({
                where: { id: { in: lineIds } },
                data: updateData,
            });

            // Create inward transactions
            if (rtoLines.length > 0) {
                await tx.inventoryTransaction.createMany({
                    data: rtoLines.map((line: { id: string; skuId: string; qty: number }) => ({
                        skuId: line.skuId,
                        txnType: TXN_TYPE.INWARD,
                        qty: line.qty,
                        reason: TXN_REASON.RTO_RECEIVED,
                        referenceId: line.id,
                        createdById: context.user.id,
                    })),
                });
            }
        });

        // Invalidate inventory cache
        if (affectedSkuIds.length > 0) {
            try {
                const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
                inventoryBalanceCache.invalidate(affectedSkuIds);
            } catch {
                // Non-critical
            }
        }

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'order_rto_received',
                orderId,
                affectedViews: ['rto', 'open'],
                changes: { rtoReceivedAt: now.toISOString() },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                orderId,
                rtoReceivedAt: now.toISOString(),
                linesReceived: rtoLines.length,
                condition,
            },
        };
    });

/**
 * Admin migration helper - migrate Shopify fulfilled orders to shipped status
 */
const migrateShopifyFulfilledSchema = z.object({
    limit: z.number().int().positive().max(500).optional().default(50),
});

export interface MigrateShopifyFulfilledResult {
    migrated: number;
    skipped: number;
    remaining: number;
    message: string;
    errors?: Array<{ orderNumber: string; error: string }>;
}

export const migrateShopifyFulfilled = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => migrateShopifyFulfilledSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<MigrateShopifyFulfilledResult>> => {
        const prisma = await getPrisma();
        const { limit } = data;

        // Admin only
        if (context.user.role !== 'admin') {
            return {
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'Migration requires admin role',
                },
            };
        }

        // Only migrate OPEN orders
        const whereClause = {
            status: 'open',
            shopifyCache: {
                fulfillmentStatus: 'fulfilled',
                trackingNumber: { not: null },
                trackingCompany: { not: null },
            },
        };

        // Count total eligible first
        const totalEligible = await prisma.order.count({ where: whereClause });

        if (totalEligible === 0) {
            return {
                success: true,
                data: {
                    migrated: 0,
                    skipped: 0,
                    remaining: 0,
                    message: 'No eligible open orders found - migration complete!',
                },
            };
        }

        // Fetch batch of eligible orders
        const eligibleOrders = await prisma.order.findMany({
            where: whereClause,
            include: {
                orderLines: { select: { id: true } },
                shopifyCache: {
                    select: { trackingNumber: true, trackingCompany: true },
                },
            },
            orderBy: { orderDate: 'asc' },
            take: limit,
        });

        const results = {
            migrated: [] as Array<{ orderNumber: string; linesShipped: number }>,
            skipped: [] as Array<{ orderNumber: string; reason: string }>,
            errors: [] as Array<{ orderNumber: string; error: string }>,
        };

        // Import shipping service from shared services
        const { shipOrderLines } = await import('@coh/shared/services/orders');

        for (const order of eligibleOrders) {
            try {
                const lineIds = order.orderLines.map((l: { id: string }) => l.id);
                const awb = order.shopifyCache?.trackingNumber || 'MANUAL';
                const courier = order.shopifyCache?.trackingCompany || 'Manual';

                const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
                    return await shipOrderLines(tx, {
                        orderLineIds: lineIds,
                        awbNumber: awb,
                        courier: courier,
                        userId: context.user.id,
                        skipStatusValidation: true,
                        skipInventory: true,
                    });
                });

                if (result.shipped.length > 0) {
                    results.migrated.push({
                        orderNumber: order.orderNumber,
                        linesShipped: result.shipped.length,
                    });
                } else if (result.skipped.length > 0) {
                    results.skipped.push({
                        orderNumber: order.orderNumber,
                        reason: result.skipped[0]?.reason || 'Already shipped',
                    });
                }
            } catch (error: unknown) {
                results.errors.push({
                    orderNumber: order.orderNumber,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        const remaining = totalEligible - results.migrated.length;

        return {
            success: true,
            data: {
                migrated: results.migrated.length,
                skipped: results.skipped.length,
                remaining: remaining,
                message:
                    remaining > 0
                        ? `Migrated ${results.migrated.length} orders. ${remaining} remaining - click again to continue.`
                        : `Migrated ${results.migrated.length} orders. Migration complete!`,
                errors: results.errors.length > 0 ? results.errors : undefined,
            },
        };
    });
