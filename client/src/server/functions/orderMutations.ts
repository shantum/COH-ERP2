/**
 * Order Mutations Server Functions
 *
 * TanStack Start Server Functions for order-level mutations.
 * Phase 2 implementation with Prisma, SSE broadcasting via deferredExecutor.
 *
 * Line mutations → orderLineMutations.ts
 * Status mutations → orderStatusMutations.ts
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';
import type { Prisma } from '@prisma/client';
import {
    hasAllocatedInventory as sharedHasAllocatedInventory,
} from '@coh/shared/domain';
import { callInternalApi } from '../utils';
import { notifySSE } from '@coh/shared/services/sseBroadcast';
import { serverLog } from './serverLog';

// Re-export line and status mutations for backward compatibility
export { updateLine, addLine, updateLineNotes } from './orderLineMutations';
export { cancelOrder, uncancelOrder, customizeLine, removeLineCustomization } from './orderStatusMutations';

// ============================================
// INPUT SCHEMAS
// ============================================

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

// ============================================
// RESULT TYPES (shared across mutation files)
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
// CONSTANTS (shared across mutation files)
// ============================================

export const TXN_TYPE = {
    INWARD: 'inward',
    OUTWARD: 'outward',
} as const;

export const TXN_REASON = {
    ORDER_ALLOCATION: 'order_allocation',
    RTO_RECEIVED: 'rto_received',
} as const;

// ============================================
// SSE BROADCAST HELPER (shared across mutation files)
// ============================================

export interface OrderUpdateEvent {
    type: string;
    lineId?: string;
    orderId?: string;
    view?: string;
    affectedViews?: string[];
    changes?: Record<string, unknown>;
}

export async function broadcastUpdate(event: OrderUpdateEvent, excludeUserId: string): Promise<void> {
    await notifySSE(event, excludeUserId);
}

// ============================================
// SERVER FUNCTIONS (order-level)
// ============================================

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

        // Log domain event
        import('@coh/shared/services/eventLog').then(({ logEvent }) =>
            logEvent({ domain: 'orders', event: 'order.updated', entityType: 'Order', entityId: orderId, summary: `Order #${order.orderNumber} updated`, meta: { changes: Object.keys(updateData) }, actorId: context.user.id })
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
            data: { codRemittedAt: now, paymentStatus: 'paid' },
        });

        // Log domain event
        import('@coh/shared/services/eventLog').then(({ logEvent }) =>
            logEvent({ domain: 'orders', event: 'order.paid', entityType: 'Order', entityId: orderId, summary: `Order #${order.orderNumber} marked paid`, meta: { paymentMethod: order.paymentMethod, totalAmount: order.totalAmount } })
        );

        return {
            success: true,
            data: {
                orderId,
                paidAt: now.toISOString(),
            },
        };
    });

/**
 * Delete an order (hard delete, only for manual orders)
 */
export const deleteOrder = createServerFn({ method: 'POST' })
    .middleware([adminMiddleware])
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

        // Invalidate inventory cache for affected SKUs
        const uniqueSkuIds = [...new Set(affectedSkuIds)] as string[];
        if (uniqueSkuIds.length > 0) {
            try {
                const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
                inventoryBalanceCache.invalidate(uniqueSkuIds);
            } catch (cacheErr) {
                serverLog.warn({ domain: 'orders', fn: 'deleteOrder' }, 'Inventory cache invalidation failed (non-critical)', { error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr) });
            }
        }

        // Log domain event
        import('@coh/shared/services/eventLog').then(({ logEvent }) =>
            logEvent({ domain: 'orders', event: 'order.deleted', entityType: 'Order', entityId: orderId, summary: `Order #${order.orderNumber} deleted`, meta: { lineCount: order.orderLines.length } })
        );

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

        // Log domain event
        import('@coh/shared/services/eventLog').then(({ logEvent }) =>
            logEvent({ domain: 'orders', event: 'order.created', entityType: 'Order', entityId: order.id, summary: `Order #${order.orderNumber} — ₹${order.totalAmount.toLocaleString('en-IN')} via ${channel}`, meta: { channel, lineCount: order.orderLines.length, totalAmount: order.totalAmount, paymentMethod, isExchange }, actorId: context.user.id })
        );

        // Push to "Orders from COH" sheet (fire-and-forget)
        callInternalApi('/api/internal/push-order-to-sheet', { orderId: order.id });

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
