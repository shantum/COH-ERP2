/**
 * Order Status Mutations Server Functions
 *
 * Status-related mutations: cancelOrder, uncancelOrder, customizeLine, removeLineCustomization.
 * Extracted from orderMutations.ts for maintainability.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';
import {
    hasAllocatedInventory as sharedHasAllocatedInventory,
    computeOrderStatus,
} from '@coh/shared/domain';
import type {
    MutationResult,
    CancelOrderResult,
    UncancelOrderResult,
    CustomizeLineResult,
    RemoveLineCustomizationResult,
} from './orderMutations';
import { broadcastUpdate, TXN_TYPE, TXN_REASON } from './orderMutations';

// ============================================
// INPUT SCHEMAS
// ============================================

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

// ============================================
// SERVER FUNCTIONS
// ============================================

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

        // Log domain event
        import('@coh/shared/services/eventLog').then(({ logEvent }) =>
            logEvent({ domain: 'orders', event: 'order.cancelled', entityType: 'Order', entityId: orderId, summary: `Order #${order.orderNumber} cancelled${reason ? ` — ${reason}` : ''}`, meta: { reason, linesAffected: order.orderLines.filter((l: CancelOrderLine) => l.lineStatus !== 'shipped').length, inventoryReleased }, actorId: context.user.id })
        );

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

        // Log domain event
        import('@coh/shared/services/eventLog').then(({ logEvent }) =>
            logEvent({ domain: 'orders', event: 'order.uncancelled', entityType: 'Order', entityId: orderId, summary: `Order #${order.orderNumber} restored — ${cancelledLines.length} lines`, meta: { linesRestored: cancelledLines.length, newStatus: newOrderStatus }, actorId: context.user.id })
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
