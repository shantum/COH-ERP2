/**
 * Transaction Routes
 * Handles inward, outward, and transaction management
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requirePermission, requireAnyPermission } from '../../middleware/permissions.js';
import {
    calculateInventoryBalance,
    validateTransactionDeletion,
    validateSku,
    TXN_REASON,
    TXN_TYPE,
} from '../../utils/queryPatterns.js';
import type { PrismaTransactionClient } from '../../utils/queryPatterns.js';
import {
    NotFoundError,
    ValidationError,
    BusinessLogicError,
} from '../../utils/errors.js';
import { inventoryBalanceCache } from '../../services/inventoryBalanceCache.js';
import type {
    SkuWithRelations,
    ProductionBatch,
    RepackingQueueItem,
    InventoryTransaction,
    TransactionsQuery,
    InwardOutwardBody,
    QuickInwardBody,
    InwardHistoryQuery,
    EditInwardBody,
} from './types.js';

const router: Router = Router();

// ============================================
// INVENTORY TRANSACTIONS
// ============================================

/**
 * GET /transactions
 * Get all transactions with filters
 */
router.get('/transactions', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { skuId, txnType, reason, startDate, endDate, limit = '100', offset = '0' } = req.query as TransactionsQuery;

    const where: Record<string, unknown> = {};
    if (skuId) where.skuId = skuId;
    if (txnType) where.txnType = txnType;
    if (reason) where.reason = reason;
    if (startDate || endDate) {
        where.createdAt = {} as Record<string, Date>;
        if (startDate) (where.createdAt as Record<string, Date>).gte = new Date(startDate);
        if (endDate) (where.createdAt as Record<string, Date>).lte = new Date(endDate);
    }

    const transactions = await req.prisma.inventoryTransaction.findMany({
        where,
        include: {
            sku: {
                include: {
                    variation: {
                        include: { product: true },
                    },
                },
            },
            createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip: Number(offset),
    });

    res.json(transactions);
}));

/**
 * POST /inward
 * Create inventory inward transaction.
 *
 * @param {string} skuId - SKU ID
 * @param {number} qty - Quantity to add
 * @param {string} reason - Transaction reason (production, rto_received, adjustment, etc.)
 * @param {string} [referenceId] - Reference to source record (e.g., ProductionBatch ID)
 * @param {string} [notes] - Transaction notes
 * @param {string} [warehouseLocation] - Physical location
 * @param {string} [adjustmentReason] - Required for 'adjustment' reason (audit trail)
 * @returns {Object} Created transaction with updated balance
 *
 * Audit Trail: For adjustments, notes are auto-enhanced with timestamp and user info
 */
router.post('/inward', authenticateToken, requirePermission('inventory:inward'), asyncHandler(async (req: Request, res: Response) => {
    const { skuId, qty, reason, referenceId, notes, warehouseLocation, adjustmentReason } = req.body as InwardOutwardBody;

    // Validate required fields
    if (!skuId || !qty || !reason) {
        throw new ValidationError('Missing required fields: skuId, qty, reason');
    }

    // For adjustments, require a reason/justification
    if (reason === 'adjustment' && !adjustmentReason && !notes) {
        throw new ValidationError('Adjustment transactions require a reason (adjustmentReason or notes)');
    }

    // Build enhanced notes for audit trail
    let auditNotes = notes || '';
    if (reason === 'adjustment') {
        const timestamp = new Date().toISOString();
        auditNotes = `[MANUAL ADJUSTMENT by ${req.user!.email} at ${timestamp}] ${adjustmentReason || ''} ${notes ? '| ' + notes : ''}`.trim();
    }

    const transaction = await req.prisma.inventoryTransaction.create({
        data: {
            skuId,
            txnType: 'inward',
            qty,
            reason,
            referenceId,
            notes: auditNotes || null,
            warehouseLocation,
            createdById: req.user!.id,
        },
        include: {
            sku: true,
            createdBy: { select: { id: true, name: true } },
        },
    });

    // Invalidate cache for this SKU
    inventoryBalanceCache.invalidate([skuId]);

    // Get updated balance
    const balance = await calculateInventoryBalance(req.prisma, skuId);

    res.status(201).json({
        ...transaction,
        newBalance: balance.currentBalance,
        availableBalance: balance.availableBalance
    });
}));

/**
 * POST /outward
 * Create inventory outward transaction with stock validation.
 *
 * @param {string} skuId - SKU ID
 * @param {number} qty - Quantity to remove
 * @param {string} reason - Transaction reason (order_fulfillment, damage, adjustment, etc.)
 * @param {string} [referenceId] - Reference to source record
 * @param {string} [notes] - Transaction notes
 * @param {string} [warehouseLocation] - Physical location
 * @param {string} [adjustmentReason] - Required for 'adjustment'/'damage' reasons
 * @returns {Object} Created transaction with updated balance
 *
 * Validation:
 * - Blocks if balance already negative (data integrity issue)
 * - Blocks if insufficient available stock (balance - reserved < qty)
 *
 * Audit Trail: For adjustments/damage, notes auto-enhanced with timestamp and user
 */
router.post('/outward', authenticateToken, requirePermission('inventory:outward'), asyncHandler(async (req: Request, res: Response) => {
    const { skuId, qty, reason, referenceId, notes, warehouseLocation, adjustmentReason } = req.body as InwardOutwardBody;

    // Validate required fields
    if (!skuId || !qty || !reason) {
        throw new ValidationError('Missing required fields: skuId, qty, reason');
    }

    // For adjustments/damage, require a reason/justification
    if ((reason === 'adjustment' || reason === 'damage') && !adjustmentReason && !notes) {
        throw new ValidationError('Adjustment/damage transactions require a reason (adjustmentReason or notes)');
    }

    // Check available balance (currentBalance minus reserved)
    // Note: calculateInventoryBalance now returns true negative balances
    const balance = await calculateInventoryBalance(req.prisma, skuId);

    // Block if balance is already negative (data integrity issue)
    if (balance.currentBalance < 0) {
        throw new BusinessLogicError(
            'Cannot create outward: inventory balance is already negative. Please reconcile inventory first.',
            'NEGATIVE_BALANCE'
        );
    }

    // Block if insufficient stock
    if (balance.availableBalance < qty) {
        throw new BusinessLogicError(
            `Insufficient stock: available ${balance.availableBalance}, requested ${qty}`,
            'INSUFFICIENT_STOCK'
        );
    }

    // Build enhanced notes for audit trail
    let auditNotes = notes || '';
    if (reason === 'adjustment' || reason === 'damage') {
        const timestamp = new Date().toISOString();
        auditNotes = `[MANUAL ${reason.toUpperCase()} by ${req.user!.email} at ${timestamp}] ${adjustmentReason || ''} ${notes ? '| ' + notes : ''}`.trim();
    }

    const transaction = await req.prisma.inventoryTransaction.create({
        data: {
            skuId,
            txnType: 'outward',
            qty,
            reason,
            referenceId,
            notes: auditNotes || null,
            warehouseLocation,
            createdById: req.user!.id,
        },
        include: {
            sku: true,
            createdBy: { select: { id: true, name: true } },
        },
    });

    // Invalidate cache for this SKU
    inventoryBalanceCache.invalidate([skuId]);

    // Get updated balance
    const newBalance = await calculateInventoryBalance(req.prisma, skuId);

    res.status(201).json({
        ...transaction,
        newBalance: newBalance.currentBalance,
        availableBalance: newBalance.availableBalance
    });
}));

/**
 * POST /quick-inward
 * Simplified inward for barcode scanning. Auto-matches production batches.
 *
 * @param {string} [skuCode] - SKU code (alternative to barcode)
 * @param {string} [barcode] - Barcode scan (alternative to skuCode)
 * @param {number} qty - Quantity (must be positive integer)
 * @param {string} [reason='production'] - Transaction reason
 * @param {string} [notes] - Transaction notes
 * @returns {Object} Transaction, new balance, and matched production batch (if any)
 *
 * Auto-Matching:
 * - If reason='production', finds oldest pending/in_progress batch for SKU
 * - Links transaction via referenceId for undo support
 * - Updates ProductionBatch.qtyCompleted and status
 *
 * Race Condition Protection: Uses $transaction to ensure atomic batch matching
 */
router.post('/quick-inward', authenticateToken, requirePermission('inventory:inward'), asyncHandler(async (req: Request, res: Response) => {
    const { skuCode, barcode, qty, reason = 'production', notes } = req.body as QuickInwardBody;

    // Validate quantity
    if (!qty || qty <= 0 || !Number.isInteger(qty)) {
        throw new ValidationError('Quantity must be a positive integer');
    }

    // Validate SKU exists and is active
    const skuValidation = await validateSku(req.prisma, { skuCode, barcode });
    if (!skuValidation.valid) {
        throw new ValidationError(skuValidation.error || 'Invalid SKU');
    }

    const sku = skuValidation.sku!;

    // Use transaction for atomic operation to prevent race conditions
    // Balance calculation moved inside for performance (single DB roundtrip)
    const result = await req.prisma.$transaction(async (tx) => {
        // Create inward transaction
        const transaction = await tx.inventoryTransaction.create({
            data: {
                skuId: sku.id,
                txnType: 'inward',
                qty,
                reason,
                notes: notes || null,
                createdById: req.user!.id,
            },
            include: {
                sku: {
                    include: {
                        variation: { include: { product: true } },
                    },
                },
            },
        });

        // Try to match to pending production batch (within same transaction)
        let matchedBatch: ProductionBatch | null = null;
        let updatedTransaction = transaction;
        if (reason === 'production') {
            matchedBatch = await matchProductionBatchInTransaction(tx, sku.id, qty);

            // Link the transaction to the matched batch for undo support
            if (matchedBatch) {
                updatedTransaction = await tx.inventoryTransaction.update({
                    where: { id: transaction.id },
                    data: { referenceId: matchedBatch.id },
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true } },
                            },
                        },
                    },
                });
            }
        }

        // Calculate balance inside transaction (avoids extra DB roundtrip)
        const balance = await calculateInventoryBalance(tx, sku.id);

        return { transaction: updatedTransaction, matchedBatch, balance };
    });

    // Invalidate cache for this SKU
    inventoryBalanceCache.invalidate([sku.id]);

    res.status(201).json({
        transaction: result.transaction,
        newBalance: result.balance.currentBalance,
        matchedBatch: result.matchedBatch ? {
            id: result.matchedBatch.id,
            batchCode: result.matchedBatch.batchCode,
            qtyCompleted: result.matchedBatch.qtyCompleted,
            qtyPlanned: result.matchedBatch.qtyPlanned,
            status: result.matchedBatch.status,
        } : null,
    });
}));

/**
 * GET /inward-history
 * Get inward history for Production Inward page
 */
router.get('/inward-history', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { date, limit = '50' } = req.query as InwardHistoryQuery;

    // Default to today
    let startDate: Date, endDate: Date;
    if (date === 'today' || !date) {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
    } else {
        startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);
    }

    const transactions = await req.prisma.inventoryTransaction.findMany({
        where: {
            txnType: 'inward',
            createdAt: { gte: startDate, lte: endDate },
        },
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
            createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
    }) as InventoryTransaction[];

    // Batch fetch production batches for all SKUs (avoid N+1)
    const skuIds = [...new Set(transactions.map(t => t.skuId))];
    const batches = await req.prisma.productionBatch.findMany({
        where: {
            skuId: { in: skuIds },
            status: { in: ['in_progress', 'completed'] },
        },
        orderBy: { batchDate: 'desc' },
        select: { skuId: true, batchCode: true },
    });

    // Create Map for O(1) batch lookups (use first match per SKU since ordered by date desc)
    const batchMap = new Map<string, string | null>();
    for (const batch of batches) {
        if (!batchMap.has(batch.skuId)) {
            batchMap.set(batch.skuId, batch.batchCode);
        }
    }

    // Enrich transactions with batch info (no more N+1)
    const enrichedTransactions = transactions.map(txn => ({
        ...txn,
        productName: txn.sku?.variation?.product?.name,
        colorName: txn.sku?.variation?.colorName,
        size: txn.sku?.size,
        imageUrl: txn.sku?.variation?.imageUrl || txn.sku?.variation?.product?.imageUrl,
        batchCode: batchMap.get(txn.skuId) || null,
    }));

    res.json(enrichedTransactions);
}));

/**
 * PUT /inward/:id
 * Edit inward transaction
 */
router.put('/inward/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { qty, notes } = req.body as EditInwardBody;

    const existing = await req.prisma.inventoryTransaction.findUnique({
        where: { id },
    }) as InventoryTransaction | null;

    if (!existing) {
        throw new NotFoundError('Transaction not found', 'InventoryTransaction', id);
    }

    if (existing.txnType !== 'inward') {
        throw new ValidationError('Can only edit inward transactions');
    }

    const updated = await req.prisma.inventoryTransaction.update({
        where: { id },
        data: {
            qty: qty !== undefined ? qty : existing.qty,
            notes: notes !== undefined ? notes : existing.notes,
        },
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
        },
    });

    // Invalidate cache
    inventoryBalanceCache.invalidate([existing.skuId]);

    res.json(updated);
}));

/**
 * DELETE /inward/:id
 * Delete inward transaction with dependency validation
 */
router.delete('/inward/:id', authenticateToken, requirePermission('inventory:delete:inward'), asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const force = req.query.force as string | undefined; // Allow force delete for admins

    const existing = await req.prisma.inventoryTransaction.findUnique({
        where: { id },
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
        },
    }) as InventoryTransaction | null;

    if (!existing) {
        throw new NotFoundError('Transaction not found', 'InventoryTransaction', id);
    }

    if (existing.txnType !== 'inward') {
        throw new ValidationError('Can only delete inward transactions');
    }

    // Validate deletion is safe (check for dependencies)
    const validation = await validateTransactionDeletion(req.prisma, id);
    if (!validation.canDelete) {
        // Only admins can force delete with dependencies
        if (force === 'true' && req.user!.role === 'admin') {
            console.warn(`Admin ${req.user!.id} force-deleting transaction ${id} with dependencies:`, validation.dependencies);
        } else {
            throw new BusinessLogicError(
                `Cannot delete transaction: ${validation.reason}`,
                'HAS_DEPENDENCIES'
            );
        }
    }

    await req.prisma.inventoryTransaction.delete({ where: { id } });

    // Invalidate cache
    inventoryBalanceCache.invalidate([existing.skuId]);

    // Get updated balance
    const balance = await calculateInventoryBalance(req.prisma, existing.skuId);

    res.json({
        success: true,
        message: 'Transaction deleted',
        deleted: {
            id: existing.id,
            skuCode: existing.sku?.skuCode,
            qty: existing.qty,
            reason: existing.reason
        },
        newBalance: balance.currentBalance
    });
}));

/**
 * DELETE /transactions/:id
 * Delete any inventory transaction (admin only) with full side effect handling
 */
router.delete('/transactions/:id', authenticateToken, requireAnyPermission('inventory:delete:inward', 'inventory:delete:outward'), asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const force = req.query.force as string | undefined;

    const existing = await req.prisma.inventoryTransaction.findUnique({
        where: { id },
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
        },
    }) as InventoryTransaction | null;

    if (!existing) {
        throw new NotFoundError('Transaction not found', 'InventoryTransaction', id);
    }

    // Validate deletion is safe (check for dependencies)
    const validation = await validateTransactionDeletion(req.prisma, id);
    if (!validation.canDelete && force !== 'true') {
        throw new BusinessLogicError(
            `Cannot delete transaction: ${validation.reason}`,
            'HAS_DEPENDENCIES'
        );
    }

    if (!validation.canDelete && force === 'true') {
        console.warn(`Admin ${req.user!.id} (${req.user!.email}) force-deleting transaction ${id} with dependencies:`, {
            transaction: validation.transaction,
            dependencies: validation.dependencies
        });
    }

    let revertedQueueItem: RepackingQueueItem | null = null;
    let revertedProductionBatch: { id: string; skuCode?: string; isCustomSku?: boolean } | null = null;
    let deletedFabricTxn = false;
    let revertedAllocation: string | null = null;

    // Use transaction for atomic operation
    await req.prisma.$transaction(async (tx) => {
        // If this is a return_receipt transaction with a referenceId, revert the repacking queue item
        if (existing.reason === 'return_receipt' && existing.referenceId) {
            const queueItem = await tx.repackingQueueItem.findUnique({
                where: { id: existing.referenceId },
            }) as RepackingQueueItem | null;

            if (queueItem && queueItem.status === 'ready') {
                // Revert the queue item back to pending
                await tx.repackingQueueItem.update({
                    where: { id: existing.referenceId },
                    data: {
                        status: 'pending',
                        qcComments: null,
                        processedAt: null,
                        processedById: null,
                    },
                });
                revertedQueueItem = queueItem;
            }
        }

        // If this is a production transaction, revert the production batch and delete fabric outward
        if ((existing.reason === TXN_REASON.PRODUCTION || existing.reason === 'production_custom') && existing.referenceId) {
            const productionBatch = await tx.productionBatch.findUnique({
                where: { id: existing.referenceId },
                include: { sku: { include: { variation: true } } }
            }) as (ProductionBatch & { sku: SkuWithRelations }) | null;

            // Handle both 'completed' and 'in_progress' batches
            if (productionBatch && (productionBatch.status === 'completed' || productionBatch.status === 'in_progress')) {
                // Check if this is a custom SKU batch that was auto-allocated
                const isCustomSkuBatch = productionBatch.sku.isCustomSku && productionBatch.sourceOrderLineId;

                // If custom SKU with completed batch, check if order line has progressed beyond allocation
                if (isCustomSkuBatch && productionBatch.status === 'completed') {
                    const orderLine = await tx.orderLine.findUnique({
                        where: { id: productionBatch.sourceOrderLineId! }
                    });

                    if (orderLine && ['picked', 'packed', 'shipped'].includes(orderLine.lineStatus)) {
                        throw new BusinessLogicError(
                            `Cannot delete - order line has progressed to ${orderLine.lineStatus}. Unship or unpick first.`,
                            'ORDER_LINE_PROGRESSED'
                        );
                    }

                    // Reverse auto-allocation: delete reserved transaction
                    await tx.inventoryTransaction.deleteMany({
                        where: {
                            skuId: productionBatch.skuId,
                            referenceId: productionBatch.sourceOrderLineId,
                            txnType: TXN_TYPE.RESERVED,
                            reason: TXN_REASON.ORDER_ALLOCATION
                        }
                    });

                    // Reset order line status back to pending
                    await tx.orderLine.update({
                        where: { id: productionBatch.sourceOrderLineId! },
                        data: {
                            lineStatus: 'pending',
                            allocatedAt: null
                        }
                    });

                    revertedAllocation = productionBatch.sourceOrderLineId ?? null;
                }

                // Calculate new qtyCompleted after reverting this transaction
                const newQtyCompleted = Math.max(0, productionBatch.qtyCompleted - existing.qty);
                const newStatus = newQtyCompleted === 0 ? 'planned' : 'in_progress';

                // Revert production batch status
                await tx.productionBatch.update({
                    where: { id: existing.referenceId },
                    data: {
                        qtyCompleted: newQtyCompleted,
                        status: newStatus,
                        completedAt: null
                    }
                });

                // Delete fabric outward transaction (only if batch was completed - fabric is deducted on completion)
                let deletedFabric = { count: 0 };
                if (productionBatch.status === 'completed') {
                    deletedFabric = await tx.fabricTransaction.deleteMany({
                        where: {
                            referenceId: existing.referenceId,
                            reason: TXN_REASON.PRODUCTION,
                            txnType: 'outward'
                        }
                    });
                }

                revertedProductionBatch = {
                    id: productionBatch.id,
                    skuCode: productionBatch.sku?.skuCode,
                    isCustomSku: productionBatch.sku?.isCustomSku
                };
                deletedFabricTxn = deletedFabric.count > 0;
            }
        }

        await tx.inventoryTransaction.delete({ where: { id } });
    });

    // Invalidate cache
    inventoryBalanceCache.invalidate([existing.skuId]);

    // Get updated balance
    const balance = await calculateInventoryBalance(req.prisma, existing.skuId);

    // Build response message
    let message = 'Transaction deleted';
    if (revertedQueueItem) {
        message = 'Transaction deleted and item returned to QC queue';
    } else if (revertedProductionBatch) {
        message = `Transaction deleted, production batch reverted to planned${deletedFabricTxn ? ', fabric usage reversed' : ''}${revertedAllocation ? ', order allocation reversed' : ''}`;
    }

    res.json({
        success: true,
        message,
        deleted: {
            id: existing.id,
            txnType: existing.txnType,
            qty: existing.qty,
            skuCode: existing.sku?.skuCode,
            productName: existing.sku?.variation?.product?.name,
        },
        revertedToQueue: revertedQueueItem ? true : false,
        revertedProductionBatch,
        revertedAllocation: revertedAllocation ? true : false,
        newBalance: balance.currentBalance,
        forcedDeletion: !validation.canDelete && force === 'true',
    });
}));

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Helper: Match production batch for inward (transaction-safe version)
 * Uses the passed transaction client to ensure atomicity
 */
async function matchProductionBatchInTransaction(tx: PrismaTransactionClient, skuId: string, quantity: number): Promise<ProductionBatch | null> {
    // Find oldest pending/in_progress batch for this SKU that isn't fully completed
    const batch = await tx.productionBatch.findFirst({
        where: {
            skuId,
            status: { in: ['planned', 'in_progress'] },
        },
        orderBy: { batchDate: 'asc' },
    }) as ProductionBatch | null;

    if (batch && batch.qtyCompleted < batch.qtyPlanned) {
        const newCompleted = Math.min(batch.qtyCompleted + quantity, batch.qtyPlanned);
        const isComplete = newCompleted >= batch.qtyPlanned;

        const updated = await tx.productionBatch.update({
            where: { id: batch.id },
            data: {
                qtyCompleted: newCompleted,
                status: isComplete ? 'completed' : 'in_progress',
                completedAt: isComplete ? new Date() : null,
            },
        }) as ProductionBatch;

        return updated;
    }

    return null;
}

export default router;
