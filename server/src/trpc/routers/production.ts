/**
 * @module trpc/routers/production
 * Production batch management and capacity planning tRPC router.
 *
 * Status flow:
 *   planned -> completed
 *   (legacy batches may still have in_progress status)
 *
 * Key operations:
 * - Batch completion: Creates inventory inward + fabric outward
 * - Custom SKU batches: Auto-allocate to linked order line on completion
 * - Locked dates: Prevents new batches on locked production dates
 * - Atomic batch codes: YYYYMMDD-XXX (handles concurrent creation via retry loop)
 *
 * Critical gotchas:
 * - Custom SKU batches auto-allocate on completion (standard batches don't)
 * - Fabric consumption cascade: SKU.fabricConsumption ?? Product.defaultFabricConsumption ?? 1.5
 * - Cannot delete batches with inventory/fabric transactions (use uncomplete first)
 * - Uncompleting custom SKU batch blocks if order line progressed beyond 'allocated'
 *
 * @see productionUtils.js for locked dates helpers
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';
import { router, protectedProcedure } from '../index.js';
import { getLockedDates, saveLockedDates } from '../../utils/productionUtils.js';
import {
    calculateAllInventoryBalances,
    calculateFabricBalance,
    getEffectiveFabricConsumption,
    TXN_TYPE,
    TXN_REASON,
} from '../../utils/queryPatterns.js';
import { broadcastOrderUpdate } from '../../routes/sse.js';
import { deferredExecutor } from '../../services/deferredExecutor.js';
import { inventoryBalanceCache } from '../../services/inventoryBalanceCache.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

type BatchStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
type BatchPriority = 'low' | 'normal' | 'high' | 'urgent' | 'order_fulfillment';

interface BatchData {
    batchDate: Date;
    tailorId: string | null;
    skuId: string | null;
    sampleCode: string | null;
    sampleName: string | null;
    sampleColour: string | null;
    sampleSize: string | null;
    qtyPlanned: number;
    priority: BatchPriority;
    sourceOrderLineId: string | null;
    notes: string | null;
}

interface SkuWithRelations {
    id: string;
    skuCode: string;
    size: string;
    isCustomSku: boolean;
    customizationType?: string | null;
    customizationValue?: string | null;
    customizationNotes?: string | null;
    fabricConsumption?: number | null;
    variation: {
        colorName: string;
        fabricId: string | null;
        product: {
            name: string;
            baseProductionTimeMins?: number | null;
            defaultFabricConsumption?: number | null;
            fabricType?: { name: string } | null;
        };
        fabric?: { id: string } | null;
    };
}

interface PrismaError extends Error {
    code?: string;
    meta?: { target?: string[] };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate batch code atomically using database sequence pattern
 * Format: YYYYMMDD-XXX (e.g., 20260107-001)
 */
const generateBatchCode = async (prisma: PrismaClient, targetDate: Date): Promise<string> => {
    const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const latestBatch = await prisma.productionBatch.findFirst({
        where: {
            batchDate: { gte: startOfDay, lte: endOfDay },
            batchCode: { startsWith: dateStr }
        },
        orderBy: { batchCode: 'desc' },
        select: { batchCode: true }
    });

    let nextSerial = 1;
    if (latestBatch?.batchCode) {
        const match = latestBatch.batchCode.match(/-(\d+)$/);
        if (match) {
            nextSerial = parseInt(match[1], 10) + 1;
        }
    }

    return `${dateStr}-${String(nextSerial).padStart(3, '0')}`;
};

/**
 * Generate a unique sample code (SAMPLE-XX format)
 */
const generateSampleCode = async (prisma: PrismaClient): Promise<string> => {
    const latest = await prisma.productionBatch.findFirst({
        where: { sampleCode: { not: null } },
        orderBy: { sampleCode: 'desc' },
        select: { sampleCode: true }
    });

    let nextSerial = 1;
    if (latest?.sampleCode) {
        const match = latest.sampleCode.match(/SAMPLE-(\d+)$/);
        if (match) {
            nextSerial = parseInt(match[1], 10) + 1;
        }
    }
    return `SAMPLE-${String(nextSerial).padStart(2, '0')}`;
};

/**
 * Create batch with atomic batch code generation
 * Handles race conditions by catching unique constraint violations and retrying
 */
const createBatchWithAtomicCode = async (
    prisma: PrismaClient,
    batchData: BatchData,
    targetDate: Date,
    maxRetries = 5
): Promise<any> => {
    const isSampleBatch = !batchData.skuId && batchData.sampleName;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const batchCode = isSampleBatch ? null : await generateBatchCode(prisma, targetDate);
            const sampleCode = isSampleBatch ? await generateSampleCode(prisma) : null;

            const batch = await prisma.productionBatch.create({
                data: {
                    ...batchData,
                    batchCode,
                    sampleCode,
                },
                include: {
                    tailor: true,
                    sku: batchData.skuId ? { include: { variation: { include: { product: true } } } } : false
                },
            });

            return batch;
        } catch (error) {
            const prismaError = error as PrismaError;
            const constraintTarget = prismaError.meta?.target || [];
            if (prismaError.code === 'P2002' && (constraintTarget.includes('batchCode') || constraintTarget.includes('sampleCode'))) {
                if (attempt === maxRetries - 1) {
                    throw new TRPCError({
                        code: 'INTERNAL_SERVER_ERROR',
                        message: 'Failed to generate unique batch/sample code after multiple attempts',
                    });
                }
                await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
                continue;
            }
            throw error;
        }
    }
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create batch' });
};

/**
 * Determine appropriate batch status based on quantities
 */
const determineBatchStatus = (
    qtyPlanned: number,
    qtyCompleted: number,
    currentStatus: string
): BatchStatus | null => {
    if (qtyCompleted >= qtyPlanned && qtyCompleted > 0) {
        return currentStatus !== 'completed' ? 'completed' : null;
    }
    if (qtyCompleted > 0 && qtyCompleted < qtyPlanned) {
        return currentStatus !== 'in_progress' ? 'in_progress' : null;
    }
    if (qtyCompleted === 0 && currentStatus === 'completed') {
        return 'planned';
    }
    return null;
};

// ============================================
// INPUT SCHEMAS
// ============================================

const batchListInput = z.object({
    status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).optional(),
    tailorId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    customOnly: z.boolean().optional(),
});

const createTailorInput = z.object({
    name: z.string().min(1),
    specializations: z.string().optional(),
    dailyCapacityMins: z.number().positive().optional(),
});

const createBatchInput = z.object({
    batchDate: z.string().optional(),
    tailorId: z.string().optional(),
    skuId: z.string().optional(),
    sampleName: z.string().optional(),
    sampleColour: z.string().optional(),
    sampleSize: z.string().optional(),
    qtyPlanned: z.number().positive(),
    priority: z.enum(['low', 'normal', 'high', 'urgent', 'order_fulfillment']).optional(),
    sourceOrderLineId: z.string().optional(),
    notes: z.string().optional(),
});

const updateBatchInput = z.object({
    id: z.string(),
    batchDate: z.string().optional(),
    qtyPlanned: z.number().positive().optional(),
    tailorId: z.string().optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent', 'order_fulfillment']).optional(),
    notes: z.string().optional(),
});

const completeBatchInput = z.object({
    id: z.string(),
    qtyCompleted: z.number().positive(),
});

const lockDateInput = z.object({
    date: z.string(),
});

const capacityInput = z.object({
    date: z.string().optional(),
});

const pendingBySkuInput = z.object({
    skuId: z.string(),
});

// ============================================
// PROCEDURES
// ============================================

// Get all tailors
const getTailors = protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.tailor.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' }
    });
});

// Create tailor
const createTailor = protectedProcedure
    .input(createTailorInput)
    .mutation(async ({ input, ctx }) => {
        return ctx.prisma.tailor.create({
            data: {
                name: input.name,
                specializations: input.specializations || null,
                dailyCapacityMins: input.dailyCapacityMins || 480
            }
        });
    });

// Get all production batches
const getBatches = protectedProcedure
    .input(batchListInput)
    .query(async ({ input, ctx }) => {
        const where: Record<string, unknown> = {};
        if (input.status) where.status = input.status;
        if (input.tailorId) where.tailorId = input.tailorId;
        if (input.startDate || input.endDate) {
            where.batchDate = {} as Record<string, Date>;
            if (input.startDate) (where.batchDate as Record<string, Date>).gte = new Date(input.startDate);
            if (input.endDate) (where.batchDate as Record<string, Date>).lte = new Date(input.endDate);
        }
        if (input.customOnly) {
            where.sku = { isCustomSku: true };
        }

        const batches = await ctx.prisma.productionBatch.findMany({
            where,
            include: {
                tailor: true,
                sku: { include: { variation: { include: { product: true, fabric: true } } } },
                orderLines: {
                    include: {
                        order: {
                            select: { id: true, orderNumber: true, customerName: true }
                        }
                    }
                }
            },
            orderBy: { batchDate: 'desc' },
        });

        // Enrich batches with customization display info and sample info
        return batches.map((batch: any) => {
            const isCustom = batch.sku?.isCustomSku || false;
            const isSample = !batch.skuId && batch.sampleCode;

            return {
                ...batch,
                isCustomSku: isCustom,
                isSampleBatch: isSample,
                ...(isSample && {
                    sampleInfo: {
                        sampleCode: batch.sampleCode,
                        sampleName: batch.sampleName,
                        sampleColour: batch.sampleColour,
                        sampleSize: batch.sampleSize
                    }
                }),
                ...(isCustom && batch.sku && {
                    customization: {
                        type: batch.sku.customizationType || null,
                        value: batch.sku.customizationValue || null,
                        notes: batch.sku.customizationNotes || null,
                        sourceOrderLineId: batch.sourceOrderLineId,
                        linkedOrder: batch.orderLines?.[0]?.order || null
                    }
                })
            };
        });
    });

// Create batch
const createBatch = protectedProcedure
    .input(createBatchInput)
    .mutation(async ({ input, ctx }) => {
        // Check permission
        if (!ctx.userPermissions.includes('production:create')) {
            throw new TRPCError({
                code: 'FORBIDDEN',
                message: 'Missing production:create permission',
            });
        }

        // Validate: Either skuId OR sampleName must be provided
        if (!input.skuId && !input.sampleName) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Either skuId or sampleName must be provided',
            });
        }
        if (input.skuId && input.sampleName) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Cannot provide both skuId and sampleName - choose one',
            });
        }

        // Check if date is locked
        const targetDate = input.batchDate ? new Date(input.batchDate) : new Date();
        const dateStr = targetDate.toISOString().split('T')[0];

        const lockedDates = await getLockedDates(ctx.prisma);
        if (lockedDates.includes(dateStr)) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Production date ${dateStr} is locked. Cannot add new items.`,
            });
        }

        // Validate scheduled date is not in the past
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const targetDateNormalized = new Date(targetDate);
        targetDateNormalized.setHours(0, 0, 0, 0);

        if (targetDateNormalized < today) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Cannot schedule batch for a past date',
            });
        }

        // Sample batches cannot be linked to order lines
        if (input.sampleName && input.sourceOrderLineId) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Sample batches cannot be linked to order lines',
            });
        }

        const batchData: BatchData = {
            batchDate: targetDate,
            tailorId: input.tailorId || null,
            skuId: input.skuId || null,
            sampleCode: null,
            sampleName: input.sampleName || null,
            sampleColour: input.sampleColour || null,
            sampleSize: input.sampleSize || null,
            qtyPlanned: input.qtyPlanned,
            priority: input.priority || 'normal',
            sourceOrderLineId: input.sourceOrderLineId || null,
            notes: input.notes || null
        };

        const batch = await createBatchWithAtomicCode(ctx.prisma, batchData, targetDate);

        // If linked to order line, update it
        if (input.sourceOrderLineId) {
            await ctx.prisma.orderLine.update({
                where: { id: input.sourceOrderLineId },
                data: { productionBatchId: batch.id }
            });
        }

        // Defer SSE broadcast for real-time sync
        if (input.sourceOrderLineId) {
            const batchId = batch.id;
            const userId = ctx.user?.id || null;
            deferredExecutor.enqueue(async () => {
                broadcastOrderUpdate({
                    type: 'production_batch_created',
                    view: 'open',
                    lineId: input.sourceOrderLineId!,
                    changes: {
                        productionBatchId: batchId,
                        productionDate: dateStr,
                    },
                }, userId);
            });
        }

        return batch;
    });

// Update batch
const updateBatch = protectedProcedure
    .input(updateBatchInput)
    .mutation(async ({ input, ctx }) => {
        const currentBatch = await ctx.prisma.productionBatch.findUnique({
            where: { id: input.id },
            select: { qtyPlanned: true, qtyCompleted: true, status: true, sourceOrderLineId: true }
        });

        if (!currentBatch) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch not found' });
        }

        const updateData: Record<string, unknown> = {};
        if (input.batchDate) updateData.batchDate = new Date(input.batchDate);
        if (input.tailorId) updateData.tailorId = input.tailorId;
        if (input.priority) updateData.priority = input.priority;
        if (input.notes !== undefined) updateData.notes = input.notes;

        // Validate qtyPlanned doesn't go below already completed quantity
        if (input.qtyPlanned !== undefined) {
            if (input.qtyPlanned < currentBatch.qtyCompleted) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: `Cannot reduce qtyPlanned (${input.qtyPlanned}) below already completed quantity (${currentBatch.qtyCompleted})`,
                });
            }
            updateData.qtyPlanned = input.qtyPlanned;
        }

        // Auto-update status if qtyPlanned changes
        const newQtyPlanned = input.qtyPlanned ?? currentBatch.qtyPlanned;
        const newStatus = determineBatchStatus(newQtyPlanned, currentBatch.qtyCompleted, currentBatch.status);
        if (newStatus) {
            updateData.status = newStatus;
            if (newStatus === 'completed') {
                updateData.completedAt = new Date();
            }
        }

        const batch = await ctx.prisma.productionBatch.update({
            where: { id: input.id },
            data: updateData,
            select: {
                id: true,
                batchCode: true,
                batchDate: true,
                status: true,
                qtyPlanned: true,
                qtyCompleted: true,
                tailorId: true,
                priority: true,
                notes: true,
                sourceOrderLineId: true,
            },
        });

        // Defer SSE broadcast for real-time sync
        if (input.batchDate && batch.sourceOrderLineId) {
            const batchId = batch.id;
            const lineId = batch.sourceOrderLineId;
            const newDate = new Date(input.batchDate).toISOString().split('T')[0];
            const userId = ctx.user?.id || null;
            deferredExecutor.enqueue(async () => {
                broadcastOrderUpdate({
                    type: 'production_batch_updated',
                    view: 'open',
                    lineId,
                    changes: {
                        productionBatchId: batchId,
                        productionDate: newDate,
                    },
                }, userId);
            });
        }

        return batch;
    });

// Delete batch
const deleteBatch = protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
        // Check permission
        if (!ctx.userPermissions.includes('production:delete')) {
            throw new TRPCError({
                code: 'FORBIDDEN',
                message: 'Missing production:delete permission',
            });
        }

        const batch = await ctx.prisma.productionBatch.findUnique({ where: { id: input.id } });
        if (!batch) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch not found' });
        }

        // Safety check: Prevent deletion if batch has inventory transactions
        const inventoryTxnCount = await ctx.prisma.inventoryTransaction.count({
            where: { referenceId: batch.id, reason: TXN_REASON.PRODUCTION }
        });

        if (inventoryTxnCount > 0) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Cannot delete batch with inventory transactions. Use uncomplete first.',
            });
        }

        // Also check for fabric transactions
        const fabricTxnCount = await ctx.prisma.fabricTransaction.count({
            where: { referenceId: batch.id, reason: 'production' }
        });

        if (fabricTxnCount > 0) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Cannot delete batch with fabric transactions. Use uncomplete first.',
            });
        }

        // Unlink from order line if connected
        const linkedLineId = batch.sourceOrderLineId;
        if (linkedLineId) {
            await ctx.prisma.orderLine.update({
                where: { id: linkedLineId },
                data: { productionBatchId: null }
            });
        }

        await ctx.prisma.productionBatch.delete({ where: { id: input.id } });

        // Defer SSE broadcast for real-time sync
        if (linkedLineId) {
            const userId = ctx.user?.id || null;
            deferredExecutor.enqueue(async () => {
                broadcastOrderUpdate({
                    type: 'production_batch_deleted',
                    view: 'open',
                    lineId: linkedLineId,
                    changes: {
                        productionBatchId: null,
                        productionDate: null,
                    },
                }, userId);
            });
        }

        return { success: true };
    });

// Complete batch (creates inventory inward + fabric outward)
const completeBatch = protectedProcedure
    .input(completeBatchInput)
    .mutation(async ({ input, ctx }) => {
        // Check permission
        if (!ctx.userPermissions.includes('production:complete')) {
            throw new TRPCError({
                code: 'FORBIDDEN',
                message: 'Missing production:complete permission',
            });
        }

        const batch = await ctx.prisma.productionBatch.findUnique({
            where: { id: input.id },
            include: { sku: { include: { variation: { include: { product: true } } } } }
        }) as any;

        if (!batch) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch not found' });
        }

        // Check if this is a sample batch
        const isSampleBatch = !batch.skuId && batch.sampleCode;

        // Pre-calculate fabric consumption
        const consumptionPerUnit = isSampleBatch ? 0 : getEffectiveFabricConsumption(batch.sku!);
        const totalFabricConsumption = consumptionPerUnit * input.qtyCompleted;
        const fabricId = isSampleBatch ? null : batch.sku?.variation?.fabricId;

        // Check if this is a custom SKU batch that should auto-allocate
        const isCustomSkuBatch = !isSampleBatch && batch.sku?.isCustomSku && batch.sourceOrderLineId;

        let autoAllocated = false;
        await ctx.prisma.$transaction(async (tx) => {
            // Re-fetch inside transaction to prevent race condition
            const currentBatch = await tx.productionBatch.findUnique({
                where: { id: input.id },
                select: { completedAt: true, qtyCompleted: true, qtyPlanned: true }
            });

            if (currentBatch?.completedAt) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Batch already completed',
                });
            }

            // Validate qty doesn't exceed planned
            const totalCompleted = (currentBatch?.qtyCompleted || 0) + input.qtyCompleted;
            if (totalCompleted > (currentBatch?.qtyPlanned || 0)) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: `Cannot complete ${input.qtyCompleted} units - would exceed planned quantity of ${currentBatch?.qtyPlanned} (already completed: ${currentBatch?.qtyCompleted})`,
                });
            }

            // Check fabric balance inside transaction
            if (fabricId) {
                const fabricBalance = await calculateFabricBalance(tx as any, fabricId);
                if (fabricBalance.currentBalance < totalFabricConsumption) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: `Insufficient fabric balance. Required: ${totalFabricConsumption}, Available: ${fabricBalance.currentBalance}`,
                    });
                }
            }

            // Update batch
            await tx.productionBatch.update({
                where: { id: input.id },
                data: {
                    qtyCompleted: totalCompleted,
                    status: 'completed',
                    completedAt: new Date()
                }
            });

            // Sample batches skip inventory/fabric transactions
            if (!isSampleBatch && batch.skuId) {
                const inwardReason = isCustomSkuBatch ? 'production_custom' : TXN_REASON.PRODUCTION;
                await tx.inventoryTransaction.create({
                    data: {
                        skuId: batch.skuId,
                        txnType: TXN_TYPE.INWARD,
                        qty: input.qtyCompleted,
                        reason: inwardReason,
                        referenceId: batch.id,
                        notes: isCustomSkuBatch
                            ? `Custom production: ${batch.sku!.skuCode}`
                            : `Production ${batch.batchCode || batch.id}`,
                        createdById: ctx.user!.id
                    },
                });

                // Create fabric outward transaction
                if (fabricId) {
                    await tx.fabricTransaction.create({
                        data: {
                            fabricId: fabricId,
                            txnType: 'outward',
                            qty: totalFabricConsumption,
                            unit: 'meter',
                            reason: 'production',
                            referenceId: batch.id,
                            createdById: ctx.user!.id
                        },
                    });
                }
            }

            // Custom SKU auto-allocation
            if (isCustomSkuBatch && batch.sourceOrderLineId && batch.skuId) {
                await tx.inventoryTransaction.create({
                    data: {
                        skuId: batch.skuId,
                        txnType: TXN_TYPE.OUTWARD,
                        qty: input.qtyCompleted,
                        reason: TXN_REASON.ORDER_ALLOCATION,
                        referenceId: batch.sourceOrderLineId,
                        notes: `Auto-allocated from custom production: ${batch.sku!.skuCode}`,
                        createdById: ctx.user!.id
                    },
                });

                await tx.orderLine.update({
                    where: { id: batch.sourceOrderLineId },
                    data: {
                        lineStatus: 'allocated',
                        allocatedAt: new Date()
                    }
                });

                autoAllocated = true;
            }
        });

        // Invalidate inventory cache
        if (batch.skuId) {
            inventoryBalanceCache.invalidate([batch.skuId]);
        }

        const updated = await ctx.prisma.productionBatch.findUnique({
            where: { id: input.id },
            include: { tailor: true, sku: true }
        });

        return {
            ...updated,
            autoAllocated,
            isSampleBatch,
            isCustomSku: batch.sku?.isCustomSku || false,
            ...(isCustomSkuBatch && {
                allocationInfo: {
                    orderLineId: batch.sourceOrderLineId,
                    qtyAllocated: input.qtyCompleted,
                    message: 'Custom SKU auto-allocated to order line'
                }
            }),
            ...(isSampleBatch && {
                sampleInfo: {
                    sampleCode: batch.sampleCode,
                    sampleName: batch.sampleName,
                    sampleColour: batch.sampleColour,
                    sampleSize: batch.sampleSize,
                    message: 'Sample batch completed - no inventory transactions created'
                }
            })
        };
    });

// Uncomplete batch (reverses inventory inward + fabric outward)
const uncompleteBatch = protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
        // Check permission
        if (!ctx.userPermissions.includes('production:complete')) {
            throw new TRPCError({
                code: 'FORBIDDEN',
                message: 'Missing production:complete permission',
            });
        }

        const batch = await ctx.prisma.productionBatch.findUnique({
            where: { id: input.id },
            include: { sku: { include: { variation: true } } }
        }) as any;

        if (!batch) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch not found' });
        }
        if (batch.status !== 'completed') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Batch is not completed' });
        }

        // Check if this is a custom SKU batch that was auto-allocated
        const isCustomSkuBatch = batch.sku?.isCustomSku && batch.sourceOrderLineId;

        let allocationReversed = false;
        await ctx.prisma.$transaction(async (tx) => {
            // Check order line status inside transaction
            if (isCustomSkuBatch && batch.sourceOrderLineId) {
                const currentLine = await tx.orderLine.findUnique({
                    where: { id: batch.sourceOrderLineId },
                    select: { lineStatus: true }
                });

                if (currentLine && ['picked', 'packed', 'shipped'].includes(currentLine.lineStatus)) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'Cannot uncomplete batch - order line has already progressed beyond allocation',
                    });
                }
            }

            // Update batch status back to planned
            await tx.productionBatch.update({
                where: { id: input.id },
                data: { qtyCompleted: 0, status: 'planned', completedAt: null }
            });

            // Delete inventory inward transaction
            await tx.inventoryTransaction.deleteMany({
                where: {
                    referenceId: batch.id,
                    reason: { in: [TXN_REASON.PRODUCTION, 'production_custom'] },
                    txnType: TXN_TYPE.INWARD
                }
            });

            // Delete fabric outward transaction
            await tx.fabricTransaction.deleteMany({
                where: { referenceId: batch.id, reason: TXN_REASON.PRODUCTION, txnType: 'outward' }
            });

            // Custom SKU: Reverse auto-allocation
            if (isCustomSkuBatch && batch.sourceOrderLineId) {
                await tx.inventoryTransaction.deleteMany({
                    where: {
                        referenceId: batch.sourceOrderLineId,
                        txnType: TXN_TYPE.OUTWARD,
                        reason: TXN_REASON.ORDER_ALLOCATION,
                        skuId: batch.skuId
                    }
                });

                await tx.orderLine.update({
                    where: { id: batch.sourceOrderLineId },
                    data: {
                        lineStatus: 'pending',
                        allocatedAt: null
                    }
                });

                allocationReversed = true;
            }
        });

        // Invalidate inventory cache
        if (batch.skuId) {
            inventoryBalanceCache.invalidate([batch.skuId]);
        }

        const updated = await ctx.prisma.productionBatch.findUnique({
            where: { id: input.id },
            include: { tailor: true, sku: { include: { variation: { include: { product: true } } } } }
        });

        if (!updated) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch not found after uncomplete' });
        }

        return {
            ...updated,
            allocationReversed,
            isCustomSku: batch.sku?.isCustomSku,
            message: allocationReversed ? 'Custom SKU allocation reversed - order line reset to pending' : undefined
        };
    });

// Get locked production dates
const getLockedDatesQuery = protectedProcedure.query(async ({ ctx }) => {
    return getLockedDates(ctx.prisma);
});

// Lock a production date
const lockDate = protectedProcedure
    .input(lockDateInput)
    .mutation(async ({ input, ctx }) => {
        const dateStr = input.date.split('T')[0];
        const lockedDates = await getLockedDates(ctx.prisma);

        if (!lockedDates.includes(dateStr)) {
            lockedDates.push(dateStr);
            await saveLockedDates(ctx.prisma, lockedDates);
        }

        return { success: true, lockedDates };
    });

// Unlock a production date
const unlockDate = protectedProcedure
    .input(lockDateInput)
    .mutation(async ({ input, ctx }) => {
        const dateStr = input.date.split('T')[0];
        let lockedDates = await getLockedDates(ctx.prisma);

        lockedDates = lockedDates.filter((d: string) => d !== dateStr);
        await saveLockedDates(ctx.prisma, lockedDates);

        return { success: true, lockedDates };
    });

// Capacity dashboard
const getCapacity = protectedProcedure
    .input(capacityInput)
    .query(async ({ input, ctx }) => {
        const targetDate = input.date ? new Date(input.date) : new Date();
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const tailors = await ctx.prisma.tailor.findMany({ where: { isActive: true } });
        const batches = await ctx.prisma.productionBatch.findMany({
            where: { batchDate: { gte: startOfDay, lte: endOfDay }, status: { not: 'cancelled' } },
            include: { sku: { include: { variation: { include: { product: true } } } } },
        }) as any[];

        return tailors.map((tailor) => {
            const tailorBatches = batches.filter((b) => b.tailorId === tailor.id);
            const allocatedMins = tailorBatches.reduce((sum, b) => {
                const timePer = b.sku?.variation?.product?.baseProductionTimeMins || 0;
                return sum + (timePer * b.qtyPlanned);
            }, 0);

            return {
                tailorId: tailor.id,
                tailorName: tailor.name,
                dailyCapacityMins: tailor.dailyCapacityMins,
                allocatedMins,
                availableMins: Math.max(0, tailor.dailyCapacityMins - allocatedMins),
                utilizationPct: ((allocatedMins / tailor.dailyCapacityMins) * 100).toFixed(0),
                batches: tailorBatches,
            };
        });
    });

// Get production requirements from open orders
const getRequirements = protectedProcedure.query(async ({ ctx }) => {
    // Get all open orders with their lines (only pending)
    const openOrders = await ctx.prisma.order.findMany({
        where: { status: 'open' },
        include: {
            orderLines: {
                where: { lineStatus: 'pending' },
                include: {
                    sku: {
                        include: {
                            variation: {
                                include: {
                                    product: { include: { fabricType: true } },
                                    fabric: true
                                }
                            }
                        }
                    }
                }
            },
            customer: true
        },
        orderBy: { orderDate: 'asc' }
    });

    // Collect unique SKU IDs from pending order lines
    const pendingSkuIds = new Set<string>();
    openOrders.forEach(order => {
        order.orderLines.forEach(line => {
            pendingSkuIds.add(line.skuId);
        });
    });

    // Get current inventory only for pending SKUs
    const balanceMap = pendingSkuIds.size > 0
        ? await calculateAllInventoryBalances(ctx.prisma, Array.from(pendingSkuIds))
        : new Map();

    const inventoryBalance: Record<string, number> = {};
    for (const [skuId, balance] of balanceMap) {
        inventoryBalance[skuId] = balance.availableBalance;
    }

    // Get planned/in-progress production batches
    const plannedBatches = pendingSkuIds.size > 0
        ? await ctx.prisma.productionBatch.findMany({
            where: {
                status: { in: ['planned', 'in_progress'] },
                skuId: { in: Array.from(pendingSkuIds) }
            },
            select: { skuId: true, qtyPlanned: true, qtyCompleted: true, sourceOrderLineId: true }
        })
        : [];

    // Calculate scheduled production per SKU
    const scheduledProduction: Record<string, number> = {};
    const scheduledByOrderLine: Record<string, number> = {};
    plannedBatches.forEach(batch => {
        if (batch.skuId) {
            if (!scheduledProduction[batch.skuId]) scheduledProduction[batch.skuId] = 0;
            scheduledProduction[batch.skuId] += (batch.qtyPlanned - batch.qtyCompleted);
        }
        if (batch.sourceOrderLineId) {
            scheduledByOrderLine[batch.sourceOrderLineId] = (scheduledByOrderLine[batch.sourceOrderLineId] || 0) + batch.qtyPlanned;
        }
    });

    // Build order-wise requirements
    interface RequirementItem {
        orderLineId: string;
        orderId: string;
        orderNumber: string;
        orderDate: Date;
        customerName: string;
        skuId: string;
        skuCode: string;
        productName: string;
        colorName: string;
        size: string;
        fabricType: string;
        qty: number;
        currentInventory: number;
        scheduledForLine: number;
        shortage: number;
        lineStatus: string;
    }

    const requirements: RequirementItem[] = [];

    openOrders.forEach(order => {
        order.orderLines.forEach(line => {
            const sku = line.sku as unknown as SkuWithRelations;
            const currentInventory = inventoryBalance[line.skuId] || 0;
            const scheduledForThisLine = scheduledByOrderLine[line.id] || 0;

            // Skip if inventory already covers this line
            if (currentInventory >= line.qty) {
                return;
            }

            const shortage = Math.max(0, line.qty - scheduledForThisLine);

            if (shortage > 0) {
                const customer = order.customer as { firstName?: string | null; lastName?: string | null } | null;
                const customerName = customer
                    ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Unknown'
                    : 'Unknown';

                requirements.push({
                    orderLineId: line.id,
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    orderDate: order.orderDate,
                    customerName,
                    skuId: line.skuId,
                    skuCode: sku.skuCode,
                    productName: sku.variation.product.name,
                    colorName: sku.variation.colorName || '',
                    size: sku.size || '',
                    fabricType: sku.variation.product.fabricType?.name || 'N/A',
                    qty: line.qty,
                    currentInventory,
                    scheduledForLine: scheduledForThisLine,
                    shortage,
                    lineStatus: line.lineStatus
                });
            }
        });
    });

    // Sort by order date
    requirements.sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());

    return {
        requirements,
        summary: {
            totalLinesNeedingProduction: requirements.length,
            totalUnitsNeeded: requirements.reduce((sum, r) => sum + r.shortage, 0),
            totalOrdersAffected: new Set(requirements.map(r => r.orderId)).size
        }
    };
});

// Get pending production batches for a SKU
const getPendingBySku = protectedProcedure
    .input(pendingBySkuInput)
    .query(async ({ input, ctx }) => {
        const batches = await ctx.prisma.productionBatch.findMany({
            where: {
                skuId: input.skuId,
                status: { in: ['planned', 'in_progress'] },
            },
            include: {
                tailor: { select: { id: true, name: true } },
            },
            orderBy: { batchDate: 'asc' },
        });

        const pendingBatches = batches.map(batch => ({
            id: batch.id,
            batchCode: batch.batchCode,
            batchDate: batch.batchDate,
            qtyPlanned: batch.qtyPlanned,
            qtyCompleted: batch.qtyCompleted,
            qtyPending: batch.qtyPlanned - batch.qtyCompleted,
            status: batch.status,
            tailor: batch.tailor,
        }));

        return {
            batches: pendingBatches,
            totalPending: pendingBatches.reduce((sum, b) => sum + b.qtyPending, 0)
        };
    });

// ============================================
// ROUTER EXPORT
// ============================================

export const productionRouter = router({
    // Queries
    getTailors,
    getBatches,
    getLockedDates: getLockedDatesQuery,
    getCapacity,
    getRequirements,
    getPendingBySku,

    // Mutations - Tailors
    createTailor,

    // Mutations - Batches
    createBatch,
    updateBatch,
    deleteBatch,
    completeBatch,
    uncompleteBatch,

    // Mutations - Date Locking
    lockDate,
    unlockDate,
});
