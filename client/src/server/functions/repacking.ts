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

const getQueueInputSchema = z.object({
    limit: z.number().int().positive().optional().default(100),
    offset: z.number().int().nonnegative().optional().default(0),
});

const getQueueHistoryInputSchema = z.object({
    limit: z.number().int().positive().optional().default(100),
    offset: z.number().int().nonnegative().optional().default(0),
    status: z.enum(['approved', 'written_off', 'all']).optional().default('all'),
});

const processItemInputSchema = z.object({
    itemId: z.string().uuid(),
    action: z.enum(['approve', 'write_off']),
    qcComments: z.string().optional(),
    writeOffReason: z.string().optional(),
});

const undoProcessInputSchema = z.object({
    itemId: z.string().uuid(),
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

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get repacking queue (pending items)
 *
 * Returns items awaiting QC inspection.
 */
export const getRepackingQueue = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getQueueInputSchema.parse(input))
    .handler(async ({ data }): Promise<QueueResponse> => {
        const prisma = await getPrisma();

        const { limit, offset } = data;

        // Get pending items
        const [items, total] = await Promise.all([
            prisma.repackingQueueItem.findMany({
                where: {
                    status: 'pending',
                },
                include: {
                    sku: {
                        include: {
                            variation: {
                                include: {
                                    product: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { createdAt: 'asc' },
                take: limit,
                skip: offset,
            }),
            prisma.repackingQueueItem.count({
                where: {
                    status: 'pending',
                },
            }),
        ]);

        const queueItems: QueueItem[] = items.map((item: any) => ({
            id: item.id,
            skuId: item.skuId,
            skuCode: item.sku.skuCode,
            barcode: item.sku.barcode,
            productName: item.sku.variation.product.name,
            colorName: item.sku.variation.colorName,
            size: item.sku.size,
            imageUrl: item.sku.variation.imageUrl || item.sku.variation.product.imageUrl,
            qty: item.qty,
            sourceReference: item.returnRequestId || item.orderLineId || null,
            condition: item.condition,
            inspectionNotes: item.inspectionNotes,
            status: item.status as 'pending' | 'approved' | 'written_off',
            qcComments: item.qcComments,
            writeOffReason: item.writeOffReason,
            createdAt: item.createdAt.toISOString(),
            processedAt: item.processedAt?.toISOString() || null,
        }));

        return {
            items: queueItems,
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + items.length < total,
            },
        };
    });

/**
 * Get repacking queue history
 *
 * Returns processed items (approved/written-off).
 */
export const getRepackingQueueHistory = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getQueueHistoryInputSchema.parse(input))
    .handler(async ({ data }): Promise<QueueResponse> => {
        const prisma = await getPrisma();

        const { limit, offset, status } = data;

        // Build where clause
        const where: any =
            status === 'all'
                ? {
                      status: {
                          in: ['approved', 'written_off'],
                      },
                  }
                : {
                      status: status,
                  };

        // Get processed items
        const [items, total] = await Promise.all([
            prisma.repackingQueueItem.findMany({
                where,
                include: {
                    sku: {
                        include: {
                            variation: {
                                include: {
                                    product: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { processedAt: 'desc' },
                take: limit,
                skip: offset,
            }),
            prisma.repackingQueueItem.count({ where }),
        ]);

        const queueItems: QueueItem[] = items.map((item: any) => ({
            id: item.id,
            skuId: item.skuId,
            skuCode: item.sku.skuCode,
            barcode: item.sku.barcode,
            productName: item.sku.variation.product.name,
            colorName: item.sku.variation.colorName,
            size: item.sku.size,
            imageUrl: item.sku.variation.imageUrl || item.sku.variation.product.imageUrl,
            qty: item.qty,
            sourceReference: item.returnRequestId || item.orderLineId || null,
            condition: item.condition,
            inspectionNotes: item.inspectionNotes,
            status: item.status as 'pending' | 'approved' | 'written_off',
            qcComments: item.qcComments,
            writeOffReason: item.writeOffReason,
            createdAt: item.createdAt.toISOString(),
            processedAt: item.processedAt?.toISOString() || null,
        }));

        return {
            items: queueItems,
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + items.length < total,
            },
        };
    });

/**
 * Process repacking queue item (approve or write-off)
 *
 * MUTATION: Marks item as approved/written-off and creates inventory transaction.
 */
export const processRepackingItem = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => processItemInputSchema.parse(input))
    .handler(async ({ data }): Promise<{ success: boolean; message: string }> => {
        const prisma = await getPrisma();

        const { itemId, action, qcComments, writeOffReason } = data;

        // Verify item exists and is pending
        const item = await prisma.repackingQueueItem.findUnique({
            where: { id: itemId },
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
                    status: action === 'approve' ? 'approved' : 'written_off',
                    qcComments: qcComments || null,
                    writeOffReason: action === 'write_off' ? writeOffReason : null,
                    processedAt: new Date(),
                },
            });

            // Create inventory transaction if approved
            if (action === 'approve') {
                await tx.inventoryTransaction.create({
                    data: {
                        skuId: item.skuId,
                        qty: item.qty,
                        txnType: 'inward',
                        reason: `QC Approved - repacking queue`,
                        notes: qcComments || `Approved from repacking queue`,
                        createdById: 'system', // TODO: Get actual user ID from context
                    },
                });
            }

            // If written off, create a negative transaction or record
            if (action === 'write_off') {
                await tx.inventoryTransaction.create({
                    data: {
                        skuId: item.skuId,
                        qty: item.qty,
                        txnType: 'outward',
                        reason: `Written Off - ${writeOffReason || 'QC Rejected'}`,
                        notes: qcComments || `Written off from repacking queue`,
                        createdById: 'system', // TODO: Get actual user ID from context
                    },
                });
            }
        });

        // Invalidate caches
        const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
        inventoryBalanceCache.invalidate([item.skuId]);

        return {
            success: true,
            message: action === 'approve' ? 'Item approved and added to inventory' : 'Item written off',
        };
    });

/**
 * Undo repacking item processing
 *
 * MUTATION: Reverts item back to pending and removes inventory transaction.
 */
export const undoRepackingProcess = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => undoProcessInputSchema.parse(input))
    .handler(async ({ data }): Promise<{ success: boolean; message: string }> => {
        const prisma = await getPrisma();

        const { itemId } = data;

        // Verify item exists and is processed
        const item = await prisma.repackingQueueItem.findUnique({
            where: { id: itemId },
        });

        if (!item) {
            throw new Error('Queue item not found');
        }

        if (item.status === 'pending') {
            throw new Error('Item has not been processed yet');
        }

        const originalStatus = item.status;

        // Undo process in transaction
        await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Reset queue item to pending
            await tx.repackingQueueItem.update({
                where: { id: itemId },
                data: {
                    status: 'pending',
                    qcComments: null,
                    writeOffReason: null,
                    processedAt: null,
                },
            });

            // Delete the inventory transaction created during processing
            // Find transactions created around the processedAt time
            if (item.processedAt) {
                const timeWindow = 60000; // 1 minute
                const startTime = new Date(item.processedAt.getTime() - timeWindow);
                const endTime = new Date(item.processedAt.getTime() + timeWindow);

                await tx.inventoryTransaction.deleteMany({
                    where: {
                        skuId: item.skuId,
                        qty: item.qty,
                        createdAt: {
                            gte: startTime,
                            lte: endTime,
                        },
                        OR: [
                            { reason: { contains: 'QC Approved' } },
                            { reason: { contains: 'Written Off' } },
                        ],
                    },
                });
            }
        });

        // Invalidate caches
        const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
        inventoryBalanceCache.invalidate([item.skuId]);

        return {
            success: true,
            message: `${originalStatus === 'approved' ? 'Approval' : 'Write-off'} undone`,
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
