/**
 * @module routes/production
 * Production batch management and capacity planning.
 *
 * Status flow:
 *   planned -> completed
 *   (legacy batches may still have in_progress status)
 *
 * Key operations:
 * - Batch completion: Creates inventory inward + fabric outward (cascade: SKU -> Product -> 1.5m default)
 * - Custom SKU batches: Auto-allocate to linked order line on completion
 * - Locked dates: Prevents new batches on locked production dates
 * - Atomic batch codes: YYYYMMDD-XXX (handles concurrent creation via retry loop)
 *
 * Critical gotchas:
 * - Custom SKU batches auto-allocate on completion (standard batches don't - manual allocation)
 * - Fabric consumption cascade: SKU.fabricConsumption ?? Product.defaultFabricConsumption ?? 1.5
 * - Batch codes generated atomically (race condition safe via unique constraint + retry)
 * - Cannot delete batches with inventory/fabric transactions (use uncomplete first)
 * - Uncompleting custom SKU batch blocks if order line progressed beyond 'allocated'
 * - Locked dates stored in SystemSetting table (key: production_locked_dates, JSON array)
 *
 * @see getEffectiveFabricConsumption in queryPatterns.ts
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/permissions.js';
import {
    NotFoundError,
    ValidationError,
    BusinessLogicError,
} from '../utils/errors.js';
import { calculateAllInventoryBalances, calculateFabricBalance, getEffectiveFabricConsumption, TXN_TYPE, TXN_REASON } from '../utils/queryPatterns.js';
import { getLockedDates, saveLockedDates } from '../utils/productionUtils.js';
import { broadcastOrderUpdate } from './sse.js';
import { deferredExecutor } from '../services/deferredExecutor.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Batch status enum
 */
type BatchStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Batch priority enum
 */
type BatchPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Query parameters for listing batches
 */
interface BatchListQuery {
    status?: string;
    tailorId?: string;
    startDate?: string;
    endDate?: string;
    customOnly?: string;
}

/**
 * Request body for creating a batch
 */
interface CreateBatchBody {
    batchDate?: string;
    tailorId?: string;
    skuId?: string;          // Either skuId OR sampleName required
    sampleName?: string;     // Name for sample batch
    sampleColour?: string;   // Colour for sample batch
    sampleSize?: string;     // Size for sample batch
    qtyPlanned: number;
    priority?: BatchPriority;
    sourceOrderLineId?: string;
    notes?: string;
}

/**
 * Request body for updating a batch
 */
interface UpdateBatchBody {
    batchDate?: string;
    qtyPlanned?: number;
    tailorId?: string;
    priority?: BatchPriority;
    notes?: string;
}

/**
 * Request body for completing a batch
 */
interface CompleteBatchBody {
    qtyCompleted: number;
}

/**
 * Request body for locking/unlocking dates
 */
interface LockDateBody {
    date: string;
}

/**
 * Query parameters for capacity endpoint
 */
interface CapacityQuery {
    date?: string;
}

/**
 * Batch data for atomic creation
 */
interface BatchData {
    batchDate: Date;
    tailorId: string | null;
    skuId: string | null;       // Nullable for sample batches
    sampleCode: string | null;  // SAMPLE-XX for sample batches
    sampleName: string | null;  // Description for sample batches
    sampleColour: string | null; // Colour for sample batches
    sampleSize: string | null;  // Size for sample batches
    qtyPlanned: number;
    priority: BatchPriority;
    sourceOrderLineId: string | null;
    notes: string | null;
}

/**
 * SKU with variation and product relations for batch operations
 */
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
            fabricType?: {
                name: string;
            } | null;
        };
        fabric?: {
            id: string;
        } | null;
    };
}

/**
 * Production batch with full relations
 */
interface BatchWithRelations {
    id: string;
    batchCode: string | null;
    batchDate: Date;
    status: BatchStatus;
    qtyPlanned: number;
    qtyCompleted: number;
    completedAt: Date | null;
    priority: BatchPriority;
    notes: string | null;
    skuId: string;
    tailorId: string | null;
    sourceOrderLineId: string | null;
    tailor: {
        id: string;
        name: string;
        dailyCapacityMins: number;
    } | null;
    sku: SkuWithRelations;
    orderLines?: Array<{
        order: {
            id: string;
            orderNumber: string;
            customerName: string | null;
        };
    }>;
}

/**
 * Prisma error with code property
 */
interface PrismaError extends Error {
    code?: string;
    meta?: {
        target?: string[];
    };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate batch code atomically using database sequence pattern
 * Format: YYYYMMDD-XXX (e.g., 20260107-001)
 *
 * Race condition safety: Uses retry loop with unique constraint.
 * If concurrent requests create batches for same date, only one succeeds
 * per code - others retry with incremented serial (50ms exponential backoff).
 *
 * @param prisma - Prisma client instance
 * @param targetDate - Date for batch code generation
 * @returns Unique batch code (YYYYMMDD-XXX)
 *
 * @example
 * const code = await generateBatchCode(prisma, new Date('2026-01-07'));
 * // Returns: "20260107-001" (or higher if others exist)
 */
const generateBatchCode = async (prisma: PrismaClient, targetDate: Date): Promise<string> => {
    const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get the highest existing batch code for this date
    const latestBatch = await prisma.productionBatch.findFirst({
        where: {
            batchDate: { gte: startOfDay, lte: endOfDay },
            batchCode: { startsWith: dateStr }
        },
        orderBy: { batchCode: 'desc' },
        select: { batchCode: true }
    });

    let nextSerial = 1;
    if (latestBatch && latestBatch.batchCode) {
        // Extract serial number from batch code (e.g., "20260107-003" -> 3)
        const match = latestBatch.batchCode.match(/-(\d+)$/);
        if (match) {
            nextSerial = parseInt(match[1], 10) + 1;
        }
    }

    const serial = String(nextSerial).padStart(3, '0');
    return `${dateStr}-${serial}`;
};

/**
 * Generate a unique sample code (SAMPLE-XX format)
 * Finds the highest existing sample code and increments the serial number
 *
 * @param prisma - Prisma client instance
 * @returns Unique sample code (SAMPLE-XX)
 *
 * @example
 * const code = await generateSampleCode(prisma);
 * // Returns: "SAMPLE-01" (or higher if others exist)
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
 * For sample batches (no skuId), generates a sampleCode instead of batchCode
 */
const createBatchWithAtomicCode = async (
    prisma: PrismaClient,
    batchData: BatchData,
    targetDate: Date,
    maxRetries: number = 5
): Promise<BatchWithRelations> => {
    const isSampleBatch = !batchData.skuId && batchData.sampleName;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // Generate appropriate code based on batch type
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

            return batch as unknown as BatchWithRelations;
        } catch (error) {
            const prismaError = error as PrismaError;
            // P2002 is Prisma's unique constraint violation error code
            const constraintTarget = prismaError.meta?.target || [];
            if (prismaError.code === 'P2002' && (constraintTarget.includes('batchCode') || constraintTarget.includes('sampleCode'))) {
                // Race condition occurred, retry with new code
                if (attempt === maxRetries - 1) {
                    throw new Error('Failed to generate unique batch/sample code after multiple attempts');
                }
                // Small delay before retry to reduce contention
                await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
                continue;
            }
            throw error;
        }
    }
    throw new Error('Failed to create batch');
};

/**
 * Determine appropriate batch status based on quantities
 * @param qtyPlanned - Planned quantity
 * @param qtyCompleted - Completed quantity
 * @param currentStatus - Current status
 * @returns New status or null if no change needed
 */
const determineBatchStatus = (
    qtyPlanned: number,
    qtyCompleted: number,
    currentStatus: string
): BatchStatus | null => {
    // If fully completed, should be 'completed'
    if (qtyCompleted >= qtyPlanned && qtyCompleted > 0) {
        return currentStatus !== 'completed' ? 'completed' : null;
    }

    // If partially completed, should be 'in_progress'
    if (qtyCompleted > 0 && qtyCompleted < qtyPlanned) {
        return currentStatus !== 'in_progress' ? 'in_progress' : null;
    }

    // If nothing completed and currently 'completed', reset to 'planned'
    if (qtyCompleted === 0 && currentStatus === 'completed') {
        return 'planned';
    }

    return null; // No status change needed
};

// ============================================
// ROUTES
// ============================================

// Get all tailors
router.get('/tailors', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const tailors = await req.prisma.tailor.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    res.json(tailors);
}));

// Create tailor
router.post('/tailors', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { name, specializations, dailyCapacityMins } = req.body as {
        name: string;
        specializations?: string;
        dailyCapacityMins?: number;
    };
    const tailor = await req.prisma.tailor.create({ data: { name, specializations: specializations || null, dailyCapacityMins: dailyCapacityMins || 480 } });
    res.status(201).json(tailor);
}));

// Get all production batches
// Custom batches include customization details and linked order info
router.get('/batches', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { status, tailorId, startDate, endDate, customOnly } = req.query as BatchListQuery;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (tailorId) where.tailorId = tailorId;
    if (startDate || endDate) {
        where.batchDate = {} as Record<string, Date>;
        if (startDate) (where.batchDate as Record<string, Date>).gte = new Date(startDate);
        if (endDate) (where.batchDate as Record<string, Date>).lte = new Date(endDate);
    }
    // Optional filter to show only custom SKU batches
    if (customOnly === 'true') {
        where.sku = { isCustomSku: true };
    }

    const batches = await req.prisma.productionBatch.findMany({
        where,
        include: {
            tailor: true,
            sku: { include: { variation: { include: { product: true, fabric: true } } } },
            // Include linked order line details for custom batches
            orderLines: {
                include: {
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            customerName: true
                        }
                    }
                }
            }
        },
        orderBy: { batchDate: 'desc' },
    }) as unknown as BatchWithRelations[];

    // Enrich batches with customization display info and sample info
    const enrichedBatches = batches.map((batch: any) => {
        const isCustom = batch.sku?.isCustomSku || false;
        const isSample = !batch.skuId && batch.sampleCode;

        return {
            ...batch,
            // Add explicit custom SKU indicator
            isCustomSku: isCustom,
            // Add sample batch indicator
            isSampleBatch: isSample,
            // Add sample info if this is a sample batch
            ...(isSample && {
                sampleInfo: {
                    sampleCode: batch.sampleCode,
                    sampleName: batch.sampleName,
                    sampleColour: batch.sampleColour,
                    sampleSize: batch.sampleSize
                }
            }),
            // Add customization details if this is a custom batch
            ...(isCustom && batch.sku && {
                customization: {
                    type: batch.sku.customizationType || null,
                    value: batch.sku.customizationValue || null,
                    notes: batch.sku.customizationNotes || null,
                    sourceOrderLineId: batch.sourceOrderLineId,
                    // Include linked order info
                    linkedOrder: batch.orderLines?.[0]?.order || null
                }
            })
        };
    });

    res.json(enrichedBatches);
}));

// Create batch
router.post('/batches', authenticateToken, requirePermission('production:create'), asyncHandler(async (req: Request, res: Response) => {
    const { batchDate, tailorId, skuId, sampleName, sampleColour, sampleSize, qtyPlanned, priority, sourceOrderLineId, notes } = req.body as CreateBatchBody;

    // Validate: Either skuId OR sampleName must be provided (but not both)
    if (!skuId && !sampleName) {
        throw new ValidationError('Either skuId or sampleName must be provided');
    }
    if (skuId && sampleName) {
        throw new ValidationError('Cannot provide both skuId and sampleName - choose one');
    }

    // Check if date is locked
    const targetDate = batchDate ? new Date(batchDate) : new Date();
    const dateStr = targetDate.toISOString().split('T')[0];

    const lockedDates = await getLockedDates(req.prisma);

    if (lockedDates.includes(dateStr)) {
        throw new BusinessLogicError(`Production date ${dateStr} is locked. Cannot add new items.`, 'DATE_LOCKED');
    }

    // Validate scheduled date is not in the past (allow today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDateNormalized = new Date(targetDate);
    targetDateNormalized.setHours(0, 0, 0, 0);

    if (targetDateNormalized < today) {
        throw new ValidationError('Cannot schedule batch for a past date');
    }

    // Sample batches cannot be linked to order lines
    if (sampleName && sourceOrderLineId) {
        throw new ValidationError('Sample batches cannot be linked to order lines');
    }

    // Create batch with atomic batch code generation (handles race conditions)
    const batchData: BatchData = {
        batchDate: targetDate,
        tailorId: tailorId || null,
        skuId: skuId || null,
        sampleCode: null,  // Will be generated if sampleName is provided
        sampleName: sampleName || null,
        sampleColour: sampleColour || null,
        sampleSize: sampleSize || null,
        qtyPlanned,
        priority: priority || 'normal',
        sourceOrderLineId: sourceOrderLineId || null,
        notes: notes || null
    };

    const batch = await createBatchWithAtomicCode(req.prisma, batchData, targetDate);

    // If linked to order line, update it
    if (sourceOrderLineId) {
        await req.prisma.orderLine.update({ where: { id: sourceOrderLineId }, data: { productionBatchId: batch.id } });
    }

    // Send response immediately, broadcast SSE in background
    res.status(201).json(batch);

    // Defer SSE broadcast for real-time sync
    if (sourceOrderLineId) {
        const batchId = batch.id;
        const userId = req.user?.id || null;
        deferredExecutor.enqueue(async () => {
            broadcastOrderUpdate({
                type: 'production_batch_created',
                view: 'open',
                lineId: sourceOrderLineId,
                changes: {
                    productionBatchId: batchId,
                    productionDate: dateStr,
                },
            }, userId);
        });
    }
}));

// Update batch (change date, qty, notes)
router.put('/batches/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { batchDate, qtyPlanned, tailorId, priority, notes } = req.body as UpdateBatchBody;

    // Fetch current batch state first
    const currentBatch = await req.prisma.productionBatch.findUnique({
        where: { id },
        select: { qtyPlanned: true, qtyCompleted: true, status: true }
    });

    if (!currentBatch) {
        throw new NotFoundError('Batch not found', 'ProductionBatch', id);
    }

    const updateData: Record<string, unknown> = {};
    if (batchDate) updateData.batchDate = new Date(batchDate);
    if (tailorId) updateData.tailorId = tailorId;
    if (priority) updateData.priority = priority;
    if (notes !== undefined) updateData.notes = notes;

    // Validate qtyPlanned doesn't go below already completed quantity
    if (qtyPlanned !== undefined) {
        if (qtyPlanned < currentBatch.qtyCompleted) {
            throw new ValidationError(
                `Cannot reduce qtyPlanned (${qtyPlanned}) below already completed quantity (${currentBatch.qtyCompleted})`
            );
        }
        updateData.qtyPlanned = qtyPlanned;
    }

    // AUTO-UPDATE STATUS: If qtyPlanned changes, check if status needs update
    const newQtyPlanned = qtyPlanned ?? currentBatch.qtyPlanned;
    const newStatus = determineBatchStatus(newQtyPlanned, currentBatch.qtyCompleted, currentBatch.status);
    if (newStatus) {
        updateData.status = newStatus;
        // If status changes to completed, set completedAt
        if (newStatus === 'completed') {
            updateData.completedAt = new Date();
        }
    }

    // Return minimal data - frontend uses optimistic updates with cached data
    const batch = await req.prisma.productionBatch.update({
        where: { id },
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
    res.json(batch);

    // Defer SSE broadcast for real-time sync (only if date changed and linked to order)
    if (batchDate && batch.sourceOrderLineId) {
        const batchId = batch.id;
        const lineId = batch.sourceOrderLineId;
        const newDate = new Date(batchDate).toISOString().split('T')[0];
        const userId = req.user?.id || null;
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
}));

// Delete batch
router.delete('/batches/:id', authenticateToken, requirePermission('production:delete'), asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const batch = await req.prisma.productionBatch.findUnique({ where: { id } });
    if (!batch) {
        throw new NotFoundError('Batch not found', 'ProductionBatch', id);
    }

    // SAFETY CHECK: Prevent deletion if batch has inventory transactions
    // This protects data integrity - completed batches have created inventory
    const inventoryTxnCount = await req.prisma.inventoryTransaction.count({
        where: {
            referenceId: batch.id,
            reason: TXN_REASON.PRODUCTION
        }
    });

    if (inventoryTxnCount > 0) {
        throw new BusinessLogicError(
            'Cannot delete batch with inventory transactions. Use uncomplete first.',
            'HAS_INVENTORY_TRANSACTIONS'
        );
    }

    // Also check for fabric transactions
    const fabricTxnCount = await req.prisma.fabricTransaction.count({
        where: {
            referenceId: batch.id,
            reason: 'production'
        }
    });

    if (fabricTxnCount > 0) {
        throw new BusinessLogicError(
            'Cannot delete batch with fabric transactions. Use uncomplete first.',
            'HAS_FABRIC_TRANSACTIONS'
        );
    }

    // Unlink from order line if connected
    const linkedLineId = batch.sourceOrderLineId;
    if (linkedLineId) {
        await req.prisma.orderLine.update({ where: { id: linkedLineId }, data: { productionBatchId: null } });
    }

    await req.prisma.productionBatch.delete({ where: { id } });
    res.json({ success: true });

    // Defer SSE broadcast for real-time sync
    if (linkedLineId) {
        const batchId = id;
        const userId = req.user?.id || null;
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
}));

// NOTE: getEffectiveFabricConsumption is now imported from queryPatterns.ts
// This ensures consistent fabric consumption logic across production and COGS calculations

// Complete batch (creates inventory inward + fabric outward)
// Custom SKUs auto-allocate to their linked order line
// Sample batches skip inventory/fabric transactions entirely
router.post('/batches/:id/complete', authenticateToken, requirePermission('production:complete'), asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { qtyCompleted } = req.body as CompleteBatchBody;

    if (!qtyCompleted || qtyCompleted <= 0) {
        throw new ValidationError('qtyCompleted must be a positive number');
    }

    // Fetch batch details needed for transaction
    const batch = await req.prisma.productionBatch.findUnique({
        where: { id },
        include: { sku: { include: { variation: { include: { product: true } } } } }
    }) as unknown as (BatchWithRelations & { sku: SkuWithRelations | null; sampleCode?: string | null; sampleName?: string | null }) | null;

    if (!batch) {
        throw new NotFoundError('Batch not found', 'ProductionBatch', id);
    }

    // Check if this is a sample batch (no SKU, has sampleCode)
    const isSampleBatch = !batch.skuId && batch.sampleCode;

    // Pre-calculate fabric consumption for use in transaction (only for non-sample batches)
    // Now uses shared utility from queryPatterns.ts for consistency
    const consumptionPerUnit = isSampleBatch ? 0 : getEffectiveFabricConsumption(batch.sku!);
    const totalFabricConsumption = consumptionPerUnit * qtyCompleted;
    const fabricId = isSampleBatch ? null : batch.sku?.variation?.fabricId;

    // Check if this is a custom SKU batch that should auto-allocate
    const isCustomSkuBatch = !isSampleBatch && batch.sku?.isCustomSku && batch.sourceOrderLineId;

    let autoAllocated = false;
    await req.prisma.$transaction(async (tx) => {
        // Re-fetch and check inside transaction to prevent race condition
        const currentBatch = await tx.productionBatch.findUnique({
            where: { id },
            select: { completedAt: true, qtyCompleted: true, qtyPlanned: true }
        });

        if (currentBatch?.completedAt) {
            throw new BusinessLogicError('Batch already completed', 'ALREADY_COMPLETED');
        }

        // Validate qty doesn't exceed planned
        const totalCompleted = (currentBatch?.qtyCompleted || 0) + qtyCompleted;
        if (totalCompleted > (currentBatch?.qtyPlanned || 0)) {
            throw new ValidationError(
                `Cannot complete ${qtyCompleted} units - would exceed planned quantity of ${currentBatch?.qtyPlanned} (already completed: ${currentBatch?.qtyCompleted})`
            );
        }

        // Check fabric balance inside transaction
        if (fabricId) {
            const fabricBalance = await calculateFabricBalance(tx, fabricId);
            if (fabricBalance.currentBalance < totalFabricConsumption) {
                throw new BusinessLogicError(
                    `Insufficient fabric balance. Required: ${totalFabricConsumption}, Available: ${fabricBalance.currentBalance}`,
                    'INSUFFICIENT_FABRIC'
                );
            }
        }

        // Update batch
        await tx.productionBatch.update({
            where: { id },
            data: {
                qtyCompleted: totalCompleted,
                status: 'completed',
                completedAt: new Date()
            }
        });

        // SAMPLE BATCHES: Skip inventory/fabric transactions entirely
        // Sample batches are for trial/prototype items that don't need inventory tracking
        if (!isSampleBatch && batch.skuId) {
            // Create inventory inward with batch code for tracking
            const inwardReason = isCustomSkuBatch ? 'production_custom' : TXN_REASON.PRODUCTION;
            await tx.inventoryTransaction.create({
                data: {
                    skuId: batch.skuId,
                    txnType: TXN_TYPE.INWARD,
                    qty: qtyCompleted,
                    reason: inwardReason,
                    referenceId: batch.id,
                    notes: isCustomSkuBatch
                        ? `Custom production: ${batch.sku!.skuCode}`
                        : `Production ${batch.batchCode || batch.id}`,
                    createdById: req.user!.id
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
                        createdById: req.user!.id
                    },
                });
            }
        }

        // CUSTOM SKU AUTO-ALLOCATION:
        // When a custom SKU batch completes, auto-allocate to the linked order line
        // Standard order-linked batches do NOT auto-allocate (staff allocates manually)
        if (isCustomSkuBatch && batch.sourceOrderLineId && batch.skuId) {
            // Create OUTWARD transaction (simplified model - allocation deducts immediately)
            await tx.inventoryTransaction.create({
                data: {
                    skuId: batch.skuId,
                    txnType: TXN_TYPE.OUTWARD,
                    qty: qtyCompleted,
                    reason: TXN_REASON.ORDER_ALLOCATION,
                    referenceId: batch.sourceOrderLineId,
                    notes: `Auto-allocated from custom production: ${batch.sku!.skuCode}`,
                    createdById: req.user!.id
                },
            });

            // Update order line status to 'allocated'
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

    const updated = await req.prisma.productionBatch.findUnique({
        where: { id },
        include: { tailor: true, sku: true }
    });

    // Include auto-allocation info in response
    res.json({
        ...updated,
        autoAllocated,
        isSampleBatch,
        isCustomSku: batch.sku?.isCustomSku || false,
        ...(isCustomSkuBatch && {
            allocationInfo: {
                orderLineId: batch.sourceOrderLineId,
                qtyAllocated: qtyCompleted,
                message: 'Custom SKU auto-allocated to order line'
            }
        }),
        ...(isSampleBatch && {
            sampleInfo: {
                sampleCode: batch.sampleCode,
                sampleName: batch.sampleName,
                sampleColour: (batch as any).sampleColour,
                sampleSize: (batch as any).sampleSize,
                message: 'Sample batch completed - no inventory transactions created'
            }
        })
    });
}));

// Uncomplete batch (reverses inventory inward + fabric outward)
// For custom SKUs, also reverses auto-allocation
router.post('/batches/:id/uncomplete', authenticateToken, requirePermission('production:complete'), asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const batch = await req.prisma.productionBatch.findUnique({
        where: { id },
        include: { sku: { include: { variation: true } } }
    }) as unknown as BatchWithRelations | null;

    if (!batch) {
        throw new NotFoundError('Batch not found', 'ProductionBatch', id);
    }
    if (batch.status !== 'completed') {
        throw new ValidationError('Batch is not completed');
    }

    // Check if this is a custom SKU batch that was auto-allocated
    const isCustomSkuBatch = batch.sku.isCustomSku && batch.sourceOrderLineId;

    let allocationReversed = false;
    await req.prisma.$transaction(async (tx) => {
        // Check order line status INSIDE transaction to prevent race condition
        if (isCustomSkuBatch && batch.sourceOrderLineId) {
            const currentLine = await tx.orderLine.findUnique({
                where: { id: batch.sourceOrderLineId },
                select: { lineStatus: true }
            });

            if (currentLine && ['picked', 'packed', 'shipped'].includes(currentLine.lineStatus)) {
                throw new BusinessLogicError(
                    'Cannot uncomplete batch - order line has already progressed beyond allocation',
                    'ORDER_LINE_PROGRESSED'
                );
            }
        }

        // Update batch status back to planned
        await tx.productionBatch.update({
            where: { id },
            data: { qtyCompleted: 0, status: 'planned', completedAt: null }
        });

        // Delete inventory inward transaction (includes both 'production' and 'production_custom' reasons)
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

        // CUSTOM SKU: Reverse auto-allocation
        if (isCustomSkuBatch && batch.sourceOrderLineId) {
            // Delete OUTWARD transaction for this order line (simplified model)
            await tx.inventoryTransaction.deleteMany({
                where: {
                    referenceId: batch.sourceOrderLineId,
                    txnType: TXN_TYPE.OUTWARD,
                    reason: TXN_REASON.ORDER_ALLOCATION,
                    skuId: batch.skuId
                }
            });

            // Reset order line status back to pending
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

    const updated = await req.prisma.productionBatch.findUnique({
        where: { id },
        include: { tailor: true, sku: { include: { variation: { include: { product: true } } } } }
    });

    const response: Record<string, unknown> = {
        ...updated,
        allocationReversed,
        isCustomSku: batch.sku.isCustomSku,
    };
    if (allocationReversed) {
        response.message = 'Custom SKU allocation reversed - order line reset to pending';
    }
    res.json(response);
}));

// Get locked production dates
router.get('/locked-dates', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const lockedDates = await getLockedDates(req.prisma);
    res.json(lockedDates);
}));

// Lock a production date
router.post('/lock-date', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { date } = req.body as LockDateBody;
    if (!date) {
        throw new ValidationError('Date is required');
    }

    const dateStr = date.split('T')[0]; // Normalize to YYYY-MM-DD

    const lockedDates = await getLockedDates(req.prisma);

    if (!lockedDates.includes(dateStr)) {
        lockedDates.push(dateStr);
        await saveLockedDates(req.prisma, lockedDates);
    }

    res.json({ success: true, lockedDates });
}));

// Unlock a production date
router.post('/unlock-date', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { date } = req.body as LockDateBody;
    if (!date) {
        throw new ValidationError('Date is required');
    }

    const dateStr = date.split('T')[0]; // Normalize to YYYY-MM-DD

    let lockedDates = await getLockedDates(req.prisma);

    lockedDates = lockedDates.filter((d: string) => d !== dateStr);
    await saveLockedDates(req.prisma, lockedDates);

    res.json({ success: true, lockedDates });
}));

// Capacity dashboard
router.get('/capacity', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { date } = req.query as CapacityQuery;
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    const tailors = await req.prisma.tailor.findMany({ where: { isActive: true } });
    const batches = await req.prisma.productionBatch.findMany({
        where: { batchDate: { gte: startOfDay, lte: endOfDay }, status: { not: 'cancelled' } },
        include: { sku: { include: { variation: { include: { product: true } } } } },
    }) as unknown as BatchWithRelations[];

    const capacity = tailors.map((tailor) => {
        const tailorBatches = batches.filter((b) => b.tailorId === tailor.id);
        const allocatedMins = tailorBatches.reduce((sum, b) => {
            const timePer = b.sku.variation.product.baseProductionTimeMins || 0;
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

    res.json(capacity);
}));

// Get production requirements from open orders (order-wise)
router.get('/requirements', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    // Get all open orders with their lines (only pending - allocated already have inventory)
    const openOrders = await req.prisma.order.findMany({
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

    // Collect unique SKU IDs from pending order lines (optimization: only calculate balances for these)
    const pendingSkuIds = new Set<string>();
    openOrders.forEach(order => {
        order.orderLines.forEach(line => {
            pendingSkuIds.add(line.skuId);
        });
    });

    // Get current inventory only for pending SKUs (major performance improvement)
    const balanceMap = pendingSkuIds.size > 0
        ? await calculateAllInventoryBalances(req.prisma, Array.from(pendingSkuIds))
        : new Map();

    // Convert to simple object for lookup (use availableBalance for production planning)
    const inventoryBalance: Record<string, number> = {};
    for (const [skuId, balance] of balanceMap) {
        inventoryBalance[skuId] = balance.availableBalance;
    }

    // Get planned/in-progress production batches only for relevant SKUs
    const plannedBatches = pendingSkuIds.size > 0
        ? await req.prisma.productionBatch.findMany({
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
        if (!scheduledProduction[batch.skuId]) scheduledProduction[batch.skuId] = 0;
        scheduledProduction[batch.skuId] += (batch.qtyPlanned - batch.qtyCompleted);
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
                return; // No production needed - inventory available
            }

            // Skip if production is already scheduled for this line
            const shortage = Math.max(0, line.qty - scheduledForThisLine);

            if (shortage > 0) {
                // Get customer display name from firstName/lastName or fallback
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

    // Sort by order date (oldest first)
    requirements.sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());

    // Summary stats
    const summary = {
        totalLinesNeedingProduction: requirements.length,
        totalUnitsNeeded: requirements.reduce((sum, r) => sum + r.shortage, 0),
        totalOrdersAffected: new Set(requirements.map(r => r.orderId)).size
    };

    res.json({ requirements, summary });
}));

// Get pending production batches for a SKU (for Production Inward page)
router.get('/pending-by-sku/:skuId', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const skuId = req.params.skuId as string;

    const batches = await req.prisma.productionBatch.findMany({
        where: {
            skuId,
            status: { in: ['planned', 'in_progress'] },
        },
        include: {
            tailor: { select: { id: true, name: true } },
        },
        orderBy: { batchDate: 'asc' },
    });

    // Calculate pending quantity for each batch
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

    const totalPending = pendingBatches.reduce((sum, b) => sum + b.qtyPending, 0);

    res.json({ batches: pendingBatches, totalPending });
}));

export default router;
