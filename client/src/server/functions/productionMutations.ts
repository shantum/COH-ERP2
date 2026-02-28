/**
 * Production Mutations Server Functions
 *
 * TanStack Start Server Functions for production batch management.
 * Phase 4 implementation with Prisma, cache invalidation, and SSE broadcasting.
 *
 * Status flow: planned -> completed
 * (legacy batches may still have in_progress status)
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { serverLog } from './serverLog';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';

// ============================================
// INPUT SCHEMAS
// ============================================

const createBatchSchema = z.object({
    name: z.string().optional(),
    batchDate: z.string().optional(),
    skuId: z.string().uuid('Invalid SKU ID').optional(),
    sampleName: z.string().optional(),
    sampleColour: z.string().optional(),
    sampleSize: z.string().optional(),
    quantity: z.number().int().positive('Quantity must be positive'),
    tailorId: z.string().uuid('Invalid tailor ID').optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent', 'order_fulfillment']).optional(),
    sourceOrderLineId: z.string().uuid('Invalid order line ID').optional(),
    notes: z.string().optional(),
});

const updateBatchSchema = z.object({
    batchId: z.string().uuid('Invalid batch ID'),
    batchDate: z.string().optional(),
    quantity: z.number().int().positive().optional(),
    tailorId: z.string().uuid('Invalid tailor ID').optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent', 'order_fulfillment']).optional(),
    notes: z.string().optional(),
});

const deleteBatchSchema = z.object({
    batchId: z.string().uuid('Invalid batch ID'),
});

const completeBatchSchema = z.object({
    batchId: z.string().uuid('Invalid batch ID'),
    actualQuantity: z.number().int().positive().optional(),
});

const uncompleteBatchSchema = z.object({
    batchId: z.string().uuid('Invalid batch ID'),
});

const createTailorSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    specializations: z.string().optional(),
    dailyCapacityMins: z.number().int().positive().optional(),
});

const updateTailorSchema = z.object({
    tailorId: z.string().uuid('Invalid tailor ID'),
    name: z.string().optional(),
    specializations: z.string().optional(),
    dailyCapacityMins: z.number().int().positive().optional(),
});

const lockDateSchema = z.object({
    date: z.string(),
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

export interface CreateBatchResult {
    batchId: string;
    batchCode: string | null;
    sampleCode: string | null;
    batchDate: string;
    skuId: string | null;
    quantity: number;
    status: string;
}

export interface UpdateBatchResult {
    batchId: string;
    updated: boolean;
}

export interface DeleteBatchResult {
    batchId: string;
    deleted: boolean;
}

export interface CompleteBatchResult {
    batchId: string;
    qtyCompleted: number;
    status: string;
    autoAllocated: boolean;
    isSampleBatch: boolean;
}

export interface UncompleteBatchResult {
    batchId: string;
    status: string;
    allocationReversed: boolean;
}

export interface CreateTailorResult {
    tailorId: string;
    name: string;
}

export interface UpdateTailorResult {
    tailorId: string;
    updated: boolean;
}

export interface LockDateResult {
    date: string;
    lockedDates: string[];
}

// ============================================
// CONSTANTS
// ============================================

const TXN_TYPE = {
    INWARD: 'inward',
    OUTWARD: 'outward',
} as const;

const TXN_REASON = {
    PRODUCTION: 'production',
    ORDER_ALLOCATION: 'order_allocation',
} as const;

/** Type alias for Prisma client instance */
type PrismaClientInstance = Awaited<ReturnType<typeof getPrisma>>;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate batch code atomically
 * Format: YYYYMMDD-XXX (e.g., 20260107-001)
 */
async function generateBatchCode(prisma: PrismaClientInstance | PrismaTransaction, targetDate: Date): Promise<string> {
    const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const latestBatch = await prisma.productionBatch.findFirst({
        where: {
            batchDate: { gte: startOfDay, lte: endOfDay },
            batchCode: { startsWith: dateStr },
        },
        orderBy: { batchCode: 'desc' },
        select: { batchCode: true },
    });

    let nextSerial = 1;
    if (latestBatch?.batchCode) {
        const match = latestBatch.batchCode.match(/-(\d+)$/);
        if (match) {
            nextSerial = parseInt(match[1], 10) + 1;
        }
    }

    return `${dateStr}-${String(nextSerial).padStart(3, '0')}`;
}

/**
 * Generate sample code (SAMPLE-XX format)
 */
async function generateSampleCode(prisma: PrismaClientInstance | PrismaTransaction): Promise<string> {
    const latest = await prisma.productionBatch.findFirst({
        where: { sampleCode: { not: null } },
        orderBy: { sampleCode: 'desc' },
        select: { sampleCode: true },
    });

    let nextSerial = 1;
    if (latest?.sampleCode) {
        const match = latest.sampleCode.match(/SAMPLE-(\d+)$/);
        if (match) {
            nextSerial = parseInt(match[1], 10) + 1;
        }
    }
    return `SAMPLE-${String(nextSerial).padStart(2, '0')}`;
}

/**
 * Get locked dates from SystemSetting table
 */
async function getLockedDates(prisma: PrismaClientInstance): Promise<string[]> {
    const setting = await prisma.systemSetting.findUnique({
        where: { key: 'locked_production_dates' },
    });
    return setting?.value ? JSON.parse(setting.value) : [];
}

/**
 * Save locked dates to SystemSetting table
 */
async function saveLockedDates(prisma: PrismaClientInstance, dates: string[]): Promise<void> {
    await prisma.systemSetting.upsert({
        where: { key: 'locked_production_dates' },
        update: { value: JSON.stringify(dates) },
        create: { key: 'locked_production_dates', value: JSON.stringify(dates) },
    });
}

// NOTE: getEffectiveFabricConsumption removed - no longer used after fabric consolidation
// NOTE: calculateFabricBalance removed - FabricTransaction table no longer exists
// Fabric balance is now tracked via FabricColourTransaction

// ============================================
// CACHE INVALIDATION HELPER
// ============================================

async function invalidateInventoryCache(skuIds: string[]): Promise<void> {
    try {
        const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
        inventoryBalanceCache.invalidate(skuIds);
    } catch {
        serverLog.warn({ domain: 'production', fn: 'cacheInvalidation' }, 'Cache invalidation skipped (server module not available)');
    }
}

// ============================================
// SSE BROADCAST HELPER
// ============================================

interface ProductionUpdateEvent {
    type: string;
    view?: string;
    lineId?: string;
    changes?: Record<string, unknown>;
}

async function broadcastUpdate(event: ProductionUpdateEvent, excludeUserId: string | null): Promise<void> {
    const { notifySSE } = await import('@coh/shared/services/sseBroadcast');
    await notifySSE(event, excludeUserId);
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Create production batch
 */
export const createBatch = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createBatchSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<CreateBatchResult>> => {
        const prisma = await getPrisma();
        const {
            batchDate,
            skuId,
            sampleName,
            sampleColour,
            sampleSize,
            quantity,
            tailorId,
            priority,
            sourceOrderLineId,
            notes,
        } = data;

        // Validate: Either skuId OR sampleName must be provided
        if (!skuId && !sampleName) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Either skuId or sampleName must be provided' },
            };
        }
        if (skuId && sampleName) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Cannot provide both skuId and sampleName - choose one' },
            };
        }

        // Parse target date
        const targetDate = batchDate ? new Date(batchDate) : new Date();
        const dateStr = targetDate.toISOString().split('T')[0];

        // Check if date is locked
        const lockedDates = await getLockedDates(prisma);
        if (lockedDates.includes(dateStr)) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: `Production date ${dateStr} is locked. Cannot add new items.` },
            };
        }

        // Validate scheduled date is not in the past
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const targetDateNormalized = new Date(targetDate);
        targetDateNormalized.setHours(0, 0, 0, 0);

        if (targetDateNormalized < today) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Cannot schedule batch for a past date' },
            };
        }

        // Sample batches cannot be linked to order lines
        if (sampleName && sourceOrderLineId) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Sample batches cannot be linked to order lines' },
            };
        }

        // Validate SKU if provided
        if (skuId) {
            const sku = await prisma.sku.findUnique({
                where: { id: skuId },
                select: { id: true, isActive: true },
            });
            if (!sku) {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: 'SKU not found' },
                };
            }
        }

        // Validate tailor if provided
        if (tailorId) {
            const tailor = await prisma.tailor.findUnique({
                where: { id: tailorId },
                select: { id: true },
            });
            if (!tailor) {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: 'Tailor not found' },
                };
            }
        }

        const isSampleBatch = !skuId && sampleName;

        const batch = await prisma.$transaction(async (tx: PrismaTransaction) => {
            const batchCode = isSampleBatch ? null : await generateBatchCode(tx, targetDate);
            const sampleCode = isSampleBatch ? await generateSampleCode(tx) : null;

            const created = await tx.productionBatch.create({
                data: {
                    batchCode,
                    sampleCode,
                    batchDate: targetDate,
                    tailorId: tailorId || null,
                    skuId: skuId || null,
                    sampleName: sampleName || null,
                    sampleColour: sampleColour || null,
                    sampleSize: sampleSize || null,
                    qtyPlanned: quantity,
                    priority: priority || 'normal',
                    sourceOrderLineId: sourceOrderLineId || null,
                    notes: notes || null,
                    status: 'planned',
                },
            });

            // If linked to order line, update it atomically
            if (sourceOrderLineId) {
                await tx.orderLine.update({
                    where: { id: sourceOrderLineId },
                    data: { productionBatchId: created.id },
                });
            }

            return created;
        });

        // Broadcast SSE update after transaction commits
        if (sourceOrderLineId) {
            broadcastUpdate(
                {
                    type: 'production_batch_created',
                    view: 'open',
                    lineId: sourceOrderLineId,
                    changes: {
                        productionBatchId: batch.id,
                        productionDate: dateStr,
                    },
                },
                context.user.id
            );
        }

        // Log domain event
        import('@coh/shared/services/eventLog').then(({ logEvent }) =>
            logEvent({ domain: 'production', event: 'batch.created', entityType: 'ProductionBatch', entityId: batch.id, summary: `Batch ${batch.batchCode ?? batch.sampleCode ?? batch.id.slice(0, 8)} — ${batch.qtyPlanned} units`, meta: { batchCode: batch.batchCode, sampleCode: batch.sampleCode, skuId: batch.skuId, quantity: batch.qtyPlanned }, actorId: context.user.id })
        );

        return {
            success: true,
            data: {
                batchId: batch.id,
                batchCode: batch.batchCode,
                sampleCode: batch.sampleCode,
                batchDate: batch.batchDate.toISOString(),
                skuId: batch.skuId,
                quantity: batch.qtyPlanned,
                status: batch.status,
            },
        };
    });

/**
 * Update batch details
 */
export const updateBatch = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateBatchSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<UpdateBatchResult>> => {
        const prisma = await getPrisma();
        const { batchId, batchDate, quantity, tailorId, priority, notes } = data;

        const currentBatch = await prisma.productionBatch.findUnique({
            where: { id: batchId },
            select: { qtyPlanned: true, qtyCompleted: true, status: true, sourceOrderLineId: true },
        });

        if (!currentBatch) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Batch not found' },
            };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: Record<string, any> = {};
        if (batchDate) updateData.batchDate = new Date(batchDate);
        if (tailorId) updateData.tailorId = tailorId;
        if (priority) updateData.priority = priority;
        if (notes !== undefined) updateData.notes = notes;

        // Validate qtyPlanned doesn't go below already completed quantity
        if (quantity !== undefined) {
            if (quantity < currentBatch.qtyCompleted) {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST',
                        message: `Cannot reduce qtyPlanned (${quantity}) below already completed quantity (${currentBatch.qtyCompleted})`,
                    },
                };
            }
            updateData.qtyPlanned = quantity;

            // Auto-update status if quantity changes
            const newQtyPlanned = quantity;
            if (currentBatch.qtyCompleted >= newQtyPlanned && currentBatch.qtyCompleted > 0) {
                if (currentBatch.status !== 'completed') {
                    updateData.status = 'completed';
                    updateData.completedAt = new Date();
                }
            } else if (currentBatch.qtyCompleted > 0 && currentBatch.qtyCompleted < newQtyPlanned) {
                if (currentBatch.status !== 'in_progress') {
                    updateData.status = 'in_progress';
                }
            }
        }

        await prisma.productionBatch.update({
            where: { id: batchId },
            data: updateData,
        });

        // Broadcast SSE update if date changed and linked to order
        if (batchDate && currentBatch.sourceOrderLineId) {
            const newDate = new Date(batchDate).toISOString().split('T')[0];
            broadcastUpdate(
                {
                    type: 'production_batch_updated',
                    view: 'open',
                    lineId: currentBatch.sourceOrderLineId,
                    changes: {
                        productionBatchId: batchId,
                        productionDate: newDate,
                    },
                },
                context.user.id
            );
        }

        return {
            success: true,
            data: {
                batchId,
                updated: true,
            },
        };
    });

/**
 * Delete batch
 */
export const deleteBatch = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteBatchSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<DeleteBatchResult>> => {
        const prisma = await getPrisma();
        const { batchId } = data;

        let linkedLineId: string | null = null;

        try {
            const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
                const batch = await tx.productionBatch.findUnique({
                    where: { id: batchId },
                });

                if (!batch) throw new Error('NOT_FOUND:Batch not found');

                // Safety check: Prevent deletion if batch has inventory transactions
                const inventoryTxnCount = await tx.inventoryTransaction.count({
                    where: { referenceId: batchId, reason: TXN_REASON.PRODUCTION },
                });

                if (inventoryTxnCount > 0) {
                    throw new Error('BAD_REQUEST:Cannot delete batch with inventory transactions. Use uncomplete first.');
                }

                // Unlink from order line if connected
                if (batch.sourceOrderLineId) {
                    await tx.orderLine.update({
                        where: { id: batch.sourceOrderLineId },
                        data: { productionBatchId: null },
                    });
                }

                await tx.productionBatch.delete({ where: { id: batchId } });
                return { linkedLineId: batch.sourceOrderLineId };
            });

            linkedLineId = result.linkedLineId;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            const [code, msg] = message.includes(':') ? message.split(':', 2) : ['INTERNAL', message];
            return { success: false, error: { code: code as 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN', message: msg as string } };
        }

        // Broadcast SSE update
        if (linkedLineId) {
            broadcastUpdate(
                {
                    type: 'production_batch_deleted',
                    view: 'open',
                    lineId: linkedLineId,
                    changes: {
                        productionBatchId: null,
                        productionDate: null,
                    },
                },
                context.user.id
            );
        }

        return {
            success: true,
            data: {
                batchId,
                deleted: true,
            },
        };
    });

/**
 * Mark batch complete (creates inventory inward + fabric outward)
 */
export const completeBatch = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => completeBatchSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<CompleteBatchResult>> => {
        const prisma = await getPrisma();
        const { batchId, actualQuantity } = data;

        const batch = await prisma.productionBatch.findUnique({
            where: { id: batchId },
            include: { sku: { include: { variation: { include: { product: true } } } } },
        });

        if (!batch) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Batch not found' },
            };
        }

        // Check if batch is already completed
        if (batch.completedAt) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Batch already completed' },
            };
        }

        const qtyCompleted = actualQuantity ?? batch.qtyPlanned;

        // Validate qty doesn't exceed planned
        if (qtyCompleted > batch.qtyPlanned) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: `Cannot complete ${qtyCompleted} units - exceeds planned quantity of ${batch.qtyPlanned}`,
                },
            };
        }

        const isSampleBatch = !batch.skuId && batch.sampleCode;
        const isCustomSkuBatch = !isSampleBatch && batch.sku?.isCustomSku && batch.sourceOrderLineId;

        // NOTE: Fabric balance checking removed - FabricTransaction table no longer exists
        // Fabric consumption is now tracked via FabricColourTransaction in BOM system

        let autoAllocated = false;

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Update batch
            await tx.productionBatch.update({
                where: { id: batchId },
                data: {
                    qtyCompleted,
                    status: 'completed',
                    completedAt: new Date(),
                },
            });

            // Sample batches skip inventory/fabric transactions
            if (!isSampleBatch && batch.skuId) {
                const inwardReason = isCustomSkuBatch ? 'production_custom' : TXN_REASON.PRODUCTION;

                await tx.inventoryTransaction.create({
                    data: {
                        skuId: batch.skuId,
                        txnType: TXN_TYPE.INWARD,
                        qty: qtyCompleted,
                        reason: inwardReason,
                        referenceId: batchId,
                        notes: isCustomSkuBatch
                            ? `Custom production: ${batch.sku!.skuCode}`
                            : `Production ${batch.batchCode || batchId}`,
                        createdById: context.user.id,
                    },
                });

                // NOTE: Fabric outward transaction removed - FabricTransaction table no longer exists
                // Fabric consumption is now tracked via FabricColourTransaction in BOM system
            }

            // Custom SKU auto-allocation
            if (isCustomSkuBatch && batch.sourceOrderLineId && batch.skuId) {
                await tx.inventoryTransaction.create({
                    data: {
                        skuId: batch.skuId,
                        txnType: TXN_TYPE.OUTWARD,
                        qty: qtyCompleted,
                        reason: TXN_REASON.ORDER_ALLOCATION,
                        referenceId: batch.sourceOrderLineId,
                        notes: `Auto-allocated from custom production: ${batch.sku!.skuCode}`,
                        createdById: context.user.id,
                    },
                });

                await tx.orderLine.update({
                    where: { id: batch.sourceOrderLineId },
                    data: {
                        lineStatus: 'allocated',
                        allocatedAt: new Date(),
                    },
                });

                autoAllocated = true;
            }
        });

        // Invalidate inventory cache
        if (batch.skuId) {
            await invalidateInventoryCache([batch.skuId]);
        }

        // Log domain event
        import('@coh/shared/services/eventLog').then(({ logEvent }) =>
            logEvent({ domain: 'production', event: 'batch.completed', entityType: 'ProductionBatch', entityId: batchId, summary: `Batch ${batch.batchCode ?? batch.sampleCode ?? batchId.slice(0, 8)} completed — ${qtyCompleted} units`, meta: { batchCode: batch.batchCode, qtyCompleted, autoAllocated, isSampleBatch: !!isSampleBatch }, actorId: context.user.id })
        );

        return {
            success: true,
            data: {
                batchId,
                qtyCompleted,
                status: 'completed',
                autoAllocated,
                isSampleBatch: !!isSampleBatch,
            },
        };
    });

/**
 * Undo batch completion (reverses inventory inward + fabric outward)
 */
export const uncompleteBatch = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => uncompleteBatchSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<UncompleteBatchResult>> => {
        const prisma = await getPrisma();
        const { batchId } = data;

        const batch = await prisma.productionBatch.findUnique({
            where: { id: batchId },
            include: { sku: { include: { variation: true } } },
        });

        if (!batch) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Batch not found' },
            };
        }

        if (batch.status !== 'completed') {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Batch is not completed' },
            };
        }

        const isCustomSkuBatch = batch.sku?.isCustomSku && batch.sourceOrderLineId;
        let allocationReversed = false;

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            // Check order line status for custom SKU batches
            if (isCustomSkuBatch && batch.sourceOrderLineId) {
                const currentLine = await tx.orderLine.findUnique({
                    where: { id: batch.sourceOrderLineId },
                    select: { lineStatus: true },
                });

                if (currentLine && ['picked', 'packed', 'shipped'].includes(currentLine.lineStatus)) {
                    throw new Error('Cannot uncomplete batch - order line has already progressed beyond allocation');
                }
            }

            // Update batch status back to planned
            await tx.productionBatch.update({
                where: { id: batchId },
                data: { qtyCompleted: 0, status: 'planned', completedAt: null },
            });

            // Delete inventory inward transaction
            await tx.inventoryTransaction.deleteMany({
                where: {
                    referenceId: batchId,
                    reason: { in: [TXN_REASON.PRODUCTION, 'production_custom'] },
                    txnType: TXN_TYPE.INWARD,
                },
            });

            // NOTE: Fabric outward deletion removed - FabricTransaction table no longer exists

            // Custom SKU: Reverse auto-allocation
            if (isCustomSkuBatch && batch.sourceOrderLineId) {
                await tx.inventoryTransaction.deleteMany({
                    where: {
                        referenceId: batch.sourceOrderLineId,
                        txnType: TXN_TYPE.OUTWARD,
                        reason: TXN_REASON.ORDER_ALLOCATION,
                        ...(batch.skuId ? { skuId: batch.skuId } : {}),
                    },
                });

                await tx.orderLine.update({
                    where: { id: batch.sourceOrderLineId },
                    data: {
                        lineStatus: 'pending',
                        allocatedAt: null,
                    },
                });

                allocationReversed = true;
            }
        });

        // Invalidate inventory cache
        if (batch.skuId) {
            await invalidateInventoryCache([batch.skuId]);
        }

        return {
            success: true,
            data: {
                batchId,
                status: 'planned',
                allocationReversed,
            },
        };
    });

/**
 * Create tailor
 */
export const createTailor = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createTailorSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<CreateTailorResult>> => {
        const prisma = await getPrisma();
        const { name, specializations, dailyCapacityMins } = data;

        const tailor = await prisma.tailor.create({
            data: {
                name,
                specializations: specializations || null,
                dailyCapacityMins: dailyCapacityMins || 480,
            },
        });

        return {
            success: true,
            data: {
                tailorId: tailor.id,
                name: tailor.name,
            },
        };
    });

/**
 * Update tailor
 */
export const updateTailor = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateTailorSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<UpdateTailorResult>> => {
        const prisma = await getPrisma();
        const { tailorId, name, specializations, dailyCapacityMins } = data;

        const existing = await prisma.tailor.findUnique({
            where: { id: tailorId },
        });

        if (!existing) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Tailor not found' },
            };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: Record<string, any> = {};
        if (name !== undefined) updateData.name = name;
        if (specializations !== undefined) updateData.specializations = specializations;
        if (dailyCapacityMins !== undefined) updateData.dailyCapacityMins = dailyCapacityMins;

        await prisma.tailor.update({
            where: { id: tailorId },
            data: updateData,
        });

        return {
            success: true,
            data: {
                tailorId,
                updated: true,
            },
        };
    });

/**
 * Lock a production date
 */
export const lockDate = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => lockDateSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<LockDateResult>> => {
        const prisma = await getPrisma();
        const dateStr = data.date.split('T')[0];

        const lockedDates = await getLockedDates(prisma);

        if (!lockedDates.includes(dateStr)) {
            lockedDates.push(dateStr);
            await saveLockedDates(prisma, lockedDates);
        }

        return {
            success: true,
            data: {
                date: dateStr,
                lockedDates,
            },
        };
    });

/**
 * Unlock a production date
 */
export const unlockDate = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => lockDateSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<LockDateResult>> => {
        const prisma = await getPrisma();
        const dateStr = data.date.split('T')[0];

        let lockedDates = await getLockedDates(prisma);
        lockedDates = lockedDates.filter((d: string) => d !== dateStr);
        await saveLockedDates(prisma, lockedDates);

        return {
            success: true,
            data: {
                date: dateStr,
                lockedDates,
            },
        };
    });
