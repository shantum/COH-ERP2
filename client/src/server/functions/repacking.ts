/**
 * Repacking/QC Server Functions
 *
 * TanStack Start Server Functions for repacking queue operations.
 * Uses Prisma for database access.
 *
 * IMPORTANT: Prisma client is dynamically imported to prevent Node.js code
 * from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';

// ============================================
// INPUT SCHEMAS
// ============================================

const processItemInputSchema = z.object({
    itemId: z.string().uuid(),
    action: z.enum(['approve', 'write_off', 'ready']),
    qcComments: z.string().optional(),
    writeOffReason: z.string().optional(),
    notes: z.string().optional(),
});

const addToQueueInputSchema = z.object({
    skuId: z.string().uuid().optional(),
    skuCode: z.string().optional(),
    qty: z.number().int().positive().optional().default(1),
    condition: z.string().optional(),
    inspectionNotes: z.string().optional(),
});

const updateQueueItemInputSchema = z.object({
    id: z.string().uuid(),
    status: z.string().optional(),
    condition: z.string().optional(),
    inspectionNotes: z.string().optional(),
    orderLineId: z.string().uuid().optional(),
});

const deleteQueueItemInputSchema = z.object({
    itemId: z.string().uuid(),
});

// ============================================
// OUTPUT TYPES
// ============================================

export interface QueueItem {
    id: string;
    skuId: string;
    skuCode: string;
    barcode: string | null;
    productName: string;
    colorName: string;
    size: string;
    imageUrl: string | null;
    qty: number;
    sourceReference: string | null;
    condition: string | null;
    inspectionNotes: string | null;
    status: 'pending' | 'approved' | 'written_off';
    qcComments: string | null;
    writeOffReason: string | null;
    createdAt: string;
    processedAt: string | null;
}

export interface QueueResponse {
    items: QueueItem[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    };
}

export interface RepackingQueueItemResult {
    id: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    condition: string | null;
    status: string;
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Process repacking queue item (approve or write-off)
 *
 * MUTATION: Marks item as approved/written-off and creates inventory transaction.
 */
export const processRepackingItem = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => processItemInputSchema.parse(input))
    .handler(async ({ data, context }): Promise<{ success: boolean; message: string; action?: string; skuCode?: string; qty?: number }> => {
        const prisma = await getPrisma();

        const { itemId, qcComments, writeOffReason, notes } = data;

        // Normalize 'ready' to 'approve'
        const normalizedAction = data.action === 'ready' ? 'approve' : data.action;

        // Verify item exists and is pending
        const item = await prisma.repackingQueueItem.findUnique({
            where: { id: itemId },
            include: {
                sku: {
                    select: { skuCode: true },
                },
            },
        });

        if (!item) {
            throw new Error('Queue item not found');
        }

        if (item.status !== 'pending') {
            throw new Error('Item has already been processed');
        }

        // Process item in transaction
        await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Update queue item
            await tx.repackingQueueItem.update({
                where: { id: itemId },
                data: {
                    status: normalizedAction === 'approve' ? 'approved' : 'written_off',
                    qcComments: qcComments || null,
                    writeOffReason: normalizedAction === 'write_off' ? writeOffReason : null,
                    processedAt: new Date(),
                    processedById: context.user.id,
                },
            });

            // Create inventory transaction if approved
            if (normalizedAction === 'approve') {
                await tx.inventoryTransaction.create({
                    data: {
                        skuId: item.skuId,
                        qty: item.qty,
                        txnType: 'inward',
                        reason: 'repack_complete',
                        referenceId: item.id,
                        notes: notes || qcComments || 'QC passed - added to stock',
                        createdById: context.user.id,
                    },
                });
            }

            // If written off, create outward transaction + WriteOffLog + SKU writeOffCount
            if (normalizedAction === 'write_off') {
                await tx.inventoryTransaction.create({
                    data: {
                        skuId: item.skuId,
                        qty: item.qty,
                        txnType: 'outward',
                        reason: `Written Off - ${writeOffReason || 'QC Rejected'}`,
                        notes: notes || qcComments || 'Written off from repacking queue',
                        createdById: context.user.id,
                    },
                });

                // Create WriteOffLog for tracking
                await tx.writeOffLog.create({
                    data: {
                        skuId: item.skuId,
                        qty: item.qty,
                        reason: writeOffReason || 'defective',
                        sourceType: 'repacking',
                        sourceId: itemId,
                        notes: notes || qcComments || 'QC failed - written off',
                        createdById: context.user.id,
                    },
                });

                // Update SKU write-off count
                await tx.sku.update({
                    where: { id: item.skuId },
                    data: { writeOffCount: { increment: item.qty } },
                });
            }
        });

        // Invalidate caches
        const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
        inventoryBalanceCache.invalidate([item.skuId]);

        // 1J: Cascade QC result back to linked return OrderLine
        if (item.orderLineId) {
            const qcResult = normalizedAction === 'approve' ? 'approved' : 'written_off';
            const prismaForCascade = await getPrisma();

            // Load the linked OrderLine to check resolution
            const linkedLine = await prismaForCascade.orderLine.findUnique({
                where: { id: item.orderLineId },
                select: {
                    id: true,
                    returnStatus: true,
                    returnResolution: true,
                    returnExchangeSkuId: true,
                    returnExchangeOrderId: true,
                    returnQty: true,
                    qty: true,
                },
            });

            if (linkedLine && linkedLine.returnStatus === 'received') {
                await prismaForCascade.orderLine.update({
                    where: { id: item.orderLineId },
                    data: {
                        returnStatus: 'qc_inspected',
                        returnQcResult: qcResult,
                    },
                });

                // Note: Exchange orders are created immediately at initiation (JIT production).
                // QC result just updates the return line status — no auto-exchange needed here.

                // SSE broadcast for return status change
                try {
                    const { getInternalApiBaseUrl } = await import('../utils');
                    const baseUrl = getInternalApiBaseUrl();
                    fetch(`${baseUrl}/api/internal/sse-broadcast`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            event: {
                                type: 'return_status_updated',
                                lineId: item.orderLineId,
                                changes: { returnStatus: 'qc_inspected', returnQcResult: qcResult },
                            },
                            excludeUserId: context.user.id,
                        }),
                    }).catch(() => {});
                } catch {
                    // Non-critical
                }
            }
        }

        return {
            success: true,
            message: normalizedAction === 'approve'
                ? `${item.sku.skuCode} added to stock`
                : `${item.sku.skuCode} written off`,
            action: normalizedAction,
            skuCode: item.sku.skuCode,
            qty: item.qty,
        };
    });

/**
 * Delete repacking queue item
 *
 * MUTATION: Removes item from queue (only if pending).
 */
export const deleteRepackingQueueItem = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteQueueItemInputSchema.parse(input))
    .handler(async ({ data }): Promise<{ success: boolean; message: string }> => {
        const prisma = await getPrisma();

        const { itemId } = data;

        // Verify item exists
        const item = await prisma.repackingQueueItem.findUnique({
            where: { id: itemId },
        });

        if (!item) {
            throw new Error('Queue item not found');
        }

        // Only allow deletion of pending items
        if (item.status !== 'pending') {
            throw new Error('Cannot delete processed items. Use undo instead.');
        }

        // Delete item
        await prisma.repackingQueueItem.delete({
            where: { id: itemId },
        });

        return {
            success: true,
            message: 'Queue item deleted',
        };
    });

/**
 * Add item to repacking queue
 * Supports: skuId or skuCode lookup
 */
export const addToRepackingQueue = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => addToQueueInputSchema.parse(input))
    .handler(async ({ data }): Promise<{ success: boolean; queueItem: RepackingQueueItemResult }> => {
        const prisma = await getPrisma();

        let skuId = data.skuId;

        // If no skuId, try to find by skuCode
        if (!skuId) {
            if (!data.skuCode) {
                throw new Error('Either skuId or skuCode is required');
            }

            const sku = await prisma.sku.findFirst({
                where: { skuCode: data.skuCode },
                select: { id: true, skuCode: true },
            });

            if (!sku) {
                throw new Error(`SKU not found: ${data.skuCode}`);
            }

            skuId = sku.id;
        }

        // Create queue item
        const queueItem = await prisma.repackingQueueItem.create({
            data: {
                skuId,
                qty: data.qty,
                condition: data.condition || 'pending_inspection',
                inspectionNotes: data.inspectionNotes || null,
                status: 'pending',
            },
        });

        // Fetch SKU details separately for the response
        const sku = await prisma.sku.findUnique({
            where: { id: skuId },
            include: {
                variation: {
                    include: {
                        product: true,
                    },
                },
            },
        });

        return {
            success: true,
            queueItem: {
                id: queueItem.id,
                skuId: queueItem.skuId,
                skuCode: sku?.skuCode || '',
                productName: sku?.variation?.product?.name || '',
                colorName: sku?.variation?.colorName || '',
                size: sku?.size || '',
                qty: queueItem.qty,
                condition: queueItem.condition,
                status: queueItem.status,
            },
        };
    });

/**
 * Update repacking queue item
 * Used for: linking to return/RTO, updating condition, etc.
 */
export const updateRepackingQueueItem = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateQueueItemInputSchema.parse(input))
    .handler(async ({ data }) => {
        const prisma = await getPrisma();

        const { id, ...updateData } = data;

        // Verify item exists
        const existing = await prisma.repackingQueueItem.findUnique({
            where: { id },
        });

        if (!existing) {
            throw new Error('Queue item not found');
        }

        // Build update object (only include defined fields)
        const updateFields: Record<string, unknown> = {};
        if (updateData.status !== undefined) updateFields.status = updateData.status;
        if (updateData.condition !== undefined) updateFields.condition = updateData.condition;
        if (updateData.inspectionNotes !== undefined) updateFields.inspectionNotes = updateData.inspectionNotes;
        if (updateData.orderLineId !== undefined) updateFields.orderLineId = updateData.orderLineId;

        const updated = await prisma.repackingQueueItem.update({
            where: { id },
            data: updateFields,
        });

        return { success: true, queueItem: updated };
    });
