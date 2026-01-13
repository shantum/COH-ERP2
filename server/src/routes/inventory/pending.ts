/**
 * Pending Queue & RTO Processing Routes
 * Handles inward hub, pending sources, and RTO line processing
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requirePermission } from '../../middleware/permissions.js';
import {
    calculateInventoryBalance,
    findExistingRtoInward,
} from '../../utils/queryPatterns.js';
import {
    NotFoundError,
    ValidationError,
    BusinessLogicError,
} from '../../utils/errors.js';
import { inventoryBalanceCache } from '../../services/inventoryBalanceCache.js';
import type {
    PendingSource,
    RtoCondition,
    AllocationType,
    SkuWithRelations,
    RtoOrderLine,
    ProductionBatch,
    ReturnRequestLine,
    RepackingQueueItem,
    InventoryTransaction,
    TransactionMatch,
    PreviousAllocation,
    PendingQueueItem,
    WriteOffLog,
    PendingQueueQuery,
    RecentInwardsQuery,
    InstantInwardBody,
    AllocateTransactionBody,
    RtoInwardLineBody,
    TransactionReason,
} from './types.js';

const router: Router = Router();

// ============================================
// CENTRALIZED INWARD HUB ENDPOINTS
// ============================================

/**
 * GET /pending-sources
 * Returns ONLY counts from all pending inward sources (fast endpoint for dashboard)
 * Uses count() queries instead of loading all items
 */
router.get('/pending-sources', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    // Use count queries for maximum speed - no data loading
    const [productionCount, returnsCount, rtoData, repackingCount] = await Promise.all([
        // Count pending production batches
        req.prisma.productionBatch.count({
            where: { status: { in: ['planned', 'in_progress'] } }
        }),

        // Count return request lines pending inspection
        req.prisma.returnRequestLine.count({
            where: {
                request: { status: { in: ['in_transit', 'received'] } },
                itemCondition: null
            }
        }),

        // For RTO, we need urgency counts so fetch minimal data
        req.prisma.orderLine.findMany({
            where: {
                order: {
                    trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                    isArchived: false
                },
                rtoCondition: null
            },
            select: {
                id: true,
                order: { select: { rtoInitiatedAt: true } }
            }
        }),

        // Count repacking queue items
        req.prisma.repackingQueueItem.count({
            where: { status: { in: ['pending', 'inspecting'] } }
        })
    ]);

    // Calculate RTO urgency from minimal data
    const now = Date.now();
    let rtoUrgent = 0;
    let rtoWarning = 0;

    for (const line of rtoData) {
        if (line.order.rtoInitiatedAt) {
            const daysInRto = Math.floor((now - new Date(line.order.rtoInitiatedAt).getTime()) / (1000 * 60 * 60 * 24));
            if (daysInRto > 14) rtoUrgent++;
            else if (daysInRto > 7) rtoWarning++;
        }
    }

    res.json({
        counts: {
            production: productionCount,
            returns: returnsCount,
            rto: rtoData.length,
            rtoUrgent,
            rtoWarning,
            repacking: repackingCount
        }
    });
}));

/**
 * GET /scan-lookup?code=XXX
 * Looks up SKU by code and finds matching pending sources
 */
router.get('/scan-lookup', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    if (!code) {
        throw new ValidationError('Code is required');
    }

    // Find SKU by skuCode (which also serves as barcode per schema)
    const sku = await req.prisma.sku.findFirst({
        where: { skuCode: code },
        include: {
            variation: {
                include: {
                    product: true,
                    fabric: true
                }
            }
        }
    }) as SkuWithRelations | null;

    if (!sku) {
        throw new NotFoundError('SKU not found', 'SKU', code);
    }

    // Run all queries in parallel for better performance
    const [balance, repackingItem, returnLine, rtoLine, productionBatch] = await Promise.all([
        // Get current balance
        calculateInventoryBalance(req.prisma, sku.id),

        // 1. Repacking (highest priority - already in warehouse)
        req.prisma.repackingQueueItem.findFirst({
            where: { skuId: sku.id, status: { in: ['pending', 'inspecting'] } },
            include: { returnRequest: { select: { requestNumber: true } } }
        }) as Promise<RepackingQueueItem | null>,

        // 2. Returns (in transit or received, not yet inspected)
        req.prisma.returnRequestLine.findFirst({
            where: {
                skuId: sku.id,
                itemCondition: null,
                request: { status: { in: ['in_transit', 'received'] } }
            },
            include: { request: { select: { id: true, requestNumber: true, reasonCategory: true } } }
        }) as Promise<ReturnRequestLine | null>,

        // 3. RTO orders (includes both rto_in_transit and rto_delivered)
        // Optimized: fetch both total count AND processed lines in one query
        req.prisma.orderLine.findFirst({
            where: {
                skuId: sku.id,
                rtoCondition: null,
                order: {
                    trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                    isArchived: false
                }
            },
            include: {
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        customerName: true,
                        trackingStatus: true,
                        rtoInitiatedAt: true,
                        // Total line count
                        _count: { select: { orderLines: true } },
                        // Processed lines (just IDs to count, avoids N+1 query)
                        orderLines: {
                            where: { rtoCondition: { not: null } },
                            select: { id: true }
                        }
                    }
                }
            }
        }) as Promise<RtoOrderLine | null>,

        // 4. Production batches (planned or in_progress)
        req.prisma.productionBatch.findFirst({
            where: {
                skuId: sku.id,
                status: { in: ['planned', 'in_progress'] }
            },
            select: {
                id: true,
                batchCode: true,
                batchDate: true,
                qtyPlanned: true,
                qtyCompleted: true
            }
        }) as Promise<ProductionBatch | null>
    ]);

    // Build matches array from parallel query results
    const matches: Array<{
        source: string;
        priority: number;
        data: Record<string, unknown>;
    }> = [];

    if (repackingItem) {
        matches.push({
            source: 'repacking',
            priority: 1,
            data: {
                queueItemId: repackingItem.id,
                condition: repackingItem.condition,
                qty: repackingItem.qty,
                returnRequestNumber: repackingItem.returnRequest?.requestNumber,
                notes: repackingItem.inspectionNotes
            }
        });
    }

    if (returnLine) {
        matches.push({
            source: 'return',
            priority: 2,
            data: {
                lineId: returnLine.id,
                requestId: returnLine.requestId,
                requestNumber: returnLine.request.requestNumber,
                qty: returnLine.qty,
                reasonCategory: returnLine.request.reasonCategory,
                customerName: null
            }
        });
    }

    if (rtoLine) {
        // Counts are now included in the query (no N+1)
        const totalLines = rtoLine.order._count?.orderLines || 0;
        const processedCount = rtoLine.order.orderLines?.length || 0; // Filtered IDs from inline query

        matches.push({
            source: 'rto',
            priority: 3,
            data: {
                lineId: rtoLine.id,
                orderId: rtoLine.orderId,
                orderNumber: rtoLine.order.orderNumber,
                customerName: rtoLine.order.customerName,
                trackingStatus: rtoLine.order.trackingStatus,
                atWarehouse: rtoLine.order.trackingStatus === 'rto_delivered',
                rtoInitiatedAt: rtoLine.order.rtoInitiatedAt,
                qty: rtoLine.qty,
                // Progress as counts instead of full line array
                progress: {
                    total: totalLines,
                    processed: processedCount,
                    remaining: totalLines - processedCount
                }
            }
        });
    }

    if (productionBatch) {
        matches.push({
            source: 'production',
            priority: 4,
            data: {
                batchId: productionBatch.id,
                batchCode: productionBatch.batchCode,
                batchDate: productionBatch.batchDate,
                qtyPlanned: productionBatch.qtyPlanned,
                qtyCompleted: productionBatch.qtyCompleted || 0,
                qtyPending: productionBatch.qtyPlanned - (productionBatch.qtyCompleted || 0)
            }
        });
    }

    res.json({
        sku: {
            id: sku.id,
            skuCode: sku.skuCode,
            productName: sku.variation.product.name,
            colorName: sku.variation.colorName,
            size: sku.size,
            mrp: sku.mrp,
            imageUrl: sku.variation.imageUrl || sku.variation.product.imageUrl
        },
        currentBalance: balance.currentBalance,
        availableBalance: balance.availableBalance,
        matches: matches.sort((a, b) => a.priority - b.priority),
        recommendedSource: matches.length > 0 ? matches[0].source : 'adjustment'
    });
}));

/**
 * POST /instant-inward
 * Ultra-fast inward: scan SKU → +1 to inventory immediately.
 * No forms, no decisions. Allocation happens later via allocate-transaction.
 *
 * @param {string} skuCode - SKU code to inward
 * @returns {Object} Transaction info and new balance
 *
 * Speed optimizations:
 * - Single transaction, minimal validation
 * - Balance calculated inside transaction
 * - No production batch matching (deferred to allocation)
 */
router.post('/instant-inward', authenticateToken, requirePermission('inventory:inward'), asyncHandler(async (req: Request, res: Response) => {
    const { skuCode } = req.body as InstantInwardBody;

    if (!skuCode) {
        throw new ValidationError('skuCode is required');
    }

    // Find SKU - minimal query for speed
    const sku = await req.prisma.sku.findFirst({
        where: { skuCode },
        select: {
            id: true,
            skuCode: true,
            size: true,
            variation: {
                select: {
                    colorName: true,
                    imageUrl: true,
                    product: { select: { name: true, imageUrl: true } }
                }
            }
        }
    }) as SkuWithRelations | null;

    if (!sku) {
        throw new NotFoundError('SKU not found', 'SKU', skuCode);
    }

    // Create transaction and get balance in single DB transaction
    const result = await req.prisma.$transaction(async (tx) => {
        const transaction = await tx.inventoryTransaction.create({
            data: {
                skuId: sku.id,
                txnType: 'inward',
                qty: 1,
                reason: 'received', // Unallocated - can be linked to source later
                createdById: req.user!.id,
            }
        });

        // Calculate balance inside transaction for consistency
        const balance = await calculateInventoryBalance(tx, sku.id);

        return { transaction, balance };
    });

    // Invalidate cache for this SKU
    inventoryBalanceCache.invalidate([sku.id]);

    res.status(201).json({
        success: true,
        transaction: {
            id: result.transaction.id,
            skuId: sku.id,
            skuCode: sku.skuCode,
            productName: sku.variation.product.name,
            colorName: sku.variation.colorName,
            size: sku.size,
            qty: 1,
            imageUrl: sku.variation.imageUrl || sku.variation.product.imageUrl,
        },
        newBalance: result.balance.currentBalance,
    });
}));

/**
 * GET /transaction-matches/:transactionId
 * Get available allocation options for an unallocated transaction.
 * Used by the allocation dropdown in recent inwards table.
 */
router.get('/transaction-matches/:transactionId', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const transactionId = req.params.transactionId as string;

    // Get transaction with SKU info
    const transaction = await req.prisma.inventoryTransaction.findUnique({
        where: { id: transactionId },
        select: {
            id: true,
            skuId: true,
            reason: true,
            referenceId: true,
            sku: { select: { skuCode: true } }
        }
    }) as (InventoryTransaction & { sku: { skuCode: string } }) | null;

    if (!transaction) {
        throw new NotFoundError('Transaction not found', 'InventoryTransaction', transactionId);
    }

    const isAllocated = transaction.reason !== 'received';
    const currentAllocation = isAllocated ? {
        type: transaction.reason,
        referenceId: transaction.referenceId
    } : null;

    // Always find available matches for this SKU (needed for re-allocation)
    const [productionBatches, rtoLines] = await Promise.all([
        // Production batches with pending quantity
        req.prisma.productionBatch.findMany({
            where: {
                skuId: transaction.skuId,
                status: { in: ['planned', 'in_progress'] }
            },
            select: {
                id: true,
                batchCode: true,
                batchDate: true,
                qtyPlanned: true,
                qtyCompleted: true
            },
            orderBy: { batchDate: 'asc' },
            take: 5
        }) as Promise<ProductionBatch[]>,

        // RTO order lines pending processing
        req.prisma.orderLine.findMany({
            where: {
                skuId: transaction.skuId,
                rtoCondition: null,
                order: {
                    trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                    isArchived: false
                }
            },
            select: {
                id: true,
                qty: true,
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        customerName: true,
                        trackingStatus: true,
                        rtoInitiatedAt: true
                    }
                }
            },
            take: 5
        }) as Promise<RtoOrderLine[]>
    ]);

    const matches: TransactionMatch[] = [];

    // Add production batch matches
    for (const batch of productionBatches) {
        const pending = batch.qtyPlanned - (batch.qtyCompleted || 0);
        if (pending > 0) {
            matches.push({
                type: 'production',
                id: batch.id,
                label: batch.batchCode || `Batch ${batch.id.slice(0, 8)}`,
                detail: `${batch.qtyCompleted || 0}/${batch.qtyPlanned} completed`,
                date: batch.batchDate,
                pending
            });
        }
    }

    // Add RTO matches
    for (const line of rtoLines) {
        matches.push({
            type: 'rto',
            id: line.id,
            orderId: line.order.id,
            label: `RTO #${line.order.orderNumber}`,
            detail: line.order.customerName || '',
            date: line.order.rtoInitiatedAt,
            atWarehouse: line.order.trackingStatus === 'rto_delivered'
        });
    }

    res.json({
        transactionId,
        skuCode: transaction.sku?.skuCode,
        isAllocated,
        currentAllocation,
        matches
    });
}));

/**
 * POST /allocate-transaction
 * Link an existing inward transaction to a source (production batch, RTO order).
 * This updates the transaction's reason/referenceId and triggers source-specific side effects.
 *
 * @param {string} transactionId - Transaction to allocate
 * @param {string} allocationType - 'production' | 'rto' | 'adjustment'
 * @param {string} [allocationId] - ID of the source (batchId for production, lineId for RTO)
 * @param {string} [rtoCondition] - Required for RTO: 'good' | 'unopened' | 'damaged' | 'wrong_product'
 */
router.post('/allocate-transaction', authenticateToken, requirePermission('inventory:inward'), asyncHandler(async (req: Request, res: Response) => {
    const { transactionId, allocationType, allocationId, rtoCondition } = req.body as AllocateTransactionBody;

    if (!transactionId || !allocationType) {
        throw new ValidationError('transactionId and allocationType are required');
    }

    if (!['production', 'rto', 'adjustment'].includes(allocationType)) {
        throw new ValidationError('allocationType must be: production, rto, or adjustment');
    }

    // Get transaction
    const transaction = await req.prisma.inventoryTransaction.findUnique({
        where: { id: transactionId },
        include: {
            sku: {
                include: { variation: { include: { product: true } } }
            }
        }
    }) as InventoryTransaction | null;

    if (!transaction) {
        throw new NotFoundError('Transaction not found', 'InventoryTransaction', transactionId);
    }

    // All allocations can now be reversed (including RTO)

    const previousAllocation: PreviousAllocation | null = transaction.reason !== 'received' ? {
        type: transaction.reason || '',
        referenceId: transaction.referenceId || null
    } : null;

    // Handle allocation based on type
    if (allocationType === 'production') {
        if (!allocationId) {
            throw new ValidationError('allocationId (batchId) is required for production allocation');
        }

        await req.prisma.$transaction(async (tx) => {
            // Revert previous production allocation
            if (previousAllocation?.type === 'production' && previousAllocation.referenceId) {
                const prevBatch = await tx.productionBatch.findUnique({
                    where: { id: previousAllocation.referenceId }
                }) as ProductionBatch | null;
                if (prevBatch) {
                    const newQtyCompleted = Math.max(0, prevBatch.qtyCompleted - transaction.qty);
                    const newStatus = newQtyCompleted === 0 ? 'planned' : 'in_progress';
                    await tx.productionBatch.update({
                        where: { id: previousAllocation.referenceId },
                        data: {
                            qtyCompleted: newQtyCompleted,
                            status: newStatus,
                            completedAt: null
                        }
                    });
                }
            }

            // Revert previous return allocation
            if (previousAllocation?.type === 'return_receipt' && previousAllocation.referenceId) {
                await tx.returnRequestLine.update({
                    where: { id: previousAllocation.referenceId },
                    data: { itemCondition: null }
                });
            }

            // Revert previous repacking allocation
            if (previousAllocation?.type === 'repack_complete' && previousAllocation.referenceId) {
                await tx.repackingQueueItem.update({
                    where: { id: previousAllocation.referenceId },
                    data: { status: 'pending', processedAt: null, processedById: null }
                });
            }

            // Revert previous RTO allocation
            if (previousAllocation?.type === 'rto_received' && previousAllocation.referenceId) {
                const orderLine = await tx.orderLine.findUnique({
                    where: { id: previousAllocation.referenceId },
                    include: { order: true }
                }) as RtoOrderLine | null;
                if (orderLine) {
                    await tx.orderLine.update({
                        where: { id: previousAllocation.referenceId },
                        data: { rtoCondition: null, rtoInwardedAt: null, rtoInwardedById: null }
                    });
                    if (orderLine.order.terminalStatus === 'rto_received') {
                        await tx.order.update({
                            where: { id: orderLine.orderId },
                            data: { rtoReceivedAt: null, terminalStatus: null, terminalAt: null }
                        });
                    }
                }
            }

            // Update transaction
            await tx.inventoryTransaction.update({
                where: { id: transactionId },
                data: {
                    reason: 'production',
                    referenceId: allocationId
                }
            });

            // Update production batch
            const batch = await tx.productionBatch.findUnique({
                where: { id: allocationId }
            }) as ProductionBatch | null;

            if (!batch) {
                throw new NotFoundError('Production batch not found', 'ProductionBatch', allocationId);
            }

            if (batch.skuId !== transaction.skuId) {
                throw new ValidationError('Batch SKU does not match transaction SKU');
            }

            const newCompleted = Math.min(batch.qtyCompleted + transaction.qty, batch.qtyPlanned);
            const isComplete = newCompleted >= batch.qtyPlanned;

            await tx.productionBatch.update({
                where: { id: allocationId },
                data: {
                    qtyCompleted: newCompleted,
                    status: isComplete ? 'completed' : 'in_progress',
                    completedAt: isComplete ? new Date() : null
                }
            });
        });

        return res.json({
            success: true,
            message: previousAllocation ? 'Allocation changed' : 'Transaction allocated to production batch',
            allocation: { type: 'production', referenceId: allocationId }
        });

    } else if (allocationType === 'rto') {
        if (!allocationId) {
            throw new ValidationError('allocationId (lineId) is required for RTO allocation');
        }

        const condition = rtoCondition || 'good'; // Default to good condition
        if (!['good', 'unopened', 'damaged', 'wrong_product'].includes(condition)) {
            throw new ValidationError('Invalid rtoCondition');
        }

        await req.prisma.$transaction(async (tx) => {
            // Revert previous allocations first (in case switching from production/return/repacking to RTO)
            if (previousAllocation?.type === 'production' && previousAllocation.referenceId) {
                const prevBatch = await tx.productionBatch.findUnique({
                    where: { id: previousAllocation.referenceId }
                }) as ProductionBatch | null;
                if (prevBatch) {
                    const newQtyCompleted = Math.max(0, prevBatch.qtyCompleted - transaction.qty);
                    const newStatus = newQtyCompleted === 0 ? 'planned' : 'in_progress';
                    await tx.productionBatch.update({
                        where: { id: previousAllocation.referenceId },
                        data: { qtyCompleted: newQtyCompleted, status: newStatus, completedAt: null }
                    });
                }
            }
            if (previousAllocation?.type === 'return_receipt' && previousAllocation.referenceId) {
                await tx.returnRequestLine.update({
                    where: { id: previousAllocation.referenceId },
                    data: { itemCondition: null }
                });
            }
            if (previousAllocation?.type === 'repack_complete' && previousAllocation.referenceId) {
                await tx.repackingQueueItem.update({
                    where: { id: previousAllocation.referenceId },
                    data: { status: 'pending', processedAt: null, processedById: null }
                });
            }

            // Get order line
            const orderLine = await tx.orderLine.findUnique({
                where: { id: allocationId },
                include: { order: { select: { id: true, orderNumber: true } } }
            }) as RtoOrderLine | null;

            if (!orderLine) {
                throw new NotFoundError('Order line not found', 'OrderLine', allocationId);
            }

            if (orderLine.skuId !== transaction.skuId) {
                throw new ValidationError('Order line SKU does not match transaction SKU');
            }

            if (orderLine.rtoCondition) {
                throw new BusinessLogicError('RTO line already processed', 'ALREADY_PROCESSED');
            }

            // For damaged/wrong_product, we need to reverse the inventory
            // since those shouldn't add to stock
            if (condition === 'damaged' || condition === 'wrong_product') {
                // Delete the inward transaction (it shouldn't have added stock)
                await tx.inventoryTransaction.delete({
                    where: { id: transactionId }
                });

                // Create write-off record instead
                await tx.writeOffLog.create({
                    data: {
                        skuId: transaction.skuId,
                        qty: transaction.qty,
                        reason: condition === 'damaged' ? 'defective' : 'wrong_product',
                        sourceType: 'rto',
                        sourceId: allocationId,
                        notes: `RTO write-off (${condition}) - Order ${orderLine.order.orderNumber}`,
                        createdById: req.user!.id
                    }
                });

                // Increment SKU write-off count
                await tx.sku.update({
                    where: { id: transaction.skuId },
                    data: { writeOffCount: { increment: transaction.qty } }
                });
            } else {
                // For good/unopened, just update the transaction
                await tx.inventoryTransaction.update({
                    where: { id: transactionId },
                    data: {
                        reason: 'rto_received',
                        referenceId: allocationId,
                        notes: `RTO from order ${orderLine.order.orderNumber}`
                    }
                });
            }

            // Mark order line as processed
            await tx.orderLine.update({
                where: { id: allocationId },
                data: {
                    rtoCondition: condition,
                    rtoInwardedAt: new Date(),
                    rtoInwardedById: req.user!.id
                }
            });

            // Check if all lines processed
            const allLines = await tx.orderLine.findMany({
                where: { orderId: orderLine.orderId }
            });
            const allProcessed = allLines.every(l => l.rtoCondition !== null);

            if (allProcessed) {
                await tx.order.update({
                    where: { id: orderLine.orderId },
                    data: {
                        rtoReceivedAt: new Date(),
                        terminalStatus: 'rto_received',
                        terminalAt: new Date()
                    }
                });
            }
        });

        return res.json({
            success: true,
            message: condition === 'damaged' || condition === 'wrong_product'
                ? `Transaction converted to write-off (${condition})`
                : 'Transaction allocated to RTO order',
            allocation: { type: 'rto', referenceId: allocationId, condition }
        });

    } else {
        // adjustment - revert previous allocation if needed, then mark as adjustment
        await req.prisma.$transaction(async (tx) => {
            // Revert previous production allocation
            if (previousAllocation?.type === 'production' && previousAllocation.referenceId) {
                const prevBatch = await tx.productionBatch.findUnique({
                    where: { id: previousAllocation.referenceId }
                }) as ProductionBatch | null;
                if (prevBatch) {
                    const newQtyCompleted = Math.max(0, prevBatch.qtyCompleted - transaction.qty);
                    const newStatus = newQtyCompleted === 0 ? 'planned' : 'in_progress';
                    await tx.productionBatch.update({
                        where: { id: previousAllocation.referenceId },
                        data: {
                            qtyCompleted: newQtyCompleted,
                            status: newStatus,
                            completedAt: null
                        }
                    });
                }
            }

            // Revert previous return allocation
            if (previousAllocation?.type === 'return_receipt' && previousAllocation.referenceId) {
                await tx.returnRequestLine.update({
                    where: { id: previousAllocation.referenceId },
                    data: {
                        itemCondition: null
                    }
                });
            }

            // Revert previous repacking allocation
            if (previousAllocation?.type === 'repack_complete' && previousAllocation.referenceId) {
                await tx.repackingQueueItem.update({
                    where: { id: previousAllocation.referenceId },
                    data: {
                        status: 'pending',
                        processedAt: null,
                        processedById: null
                    }
                });
            }

            // Revert previous RTO allocation
            if (previousAllocation?.type === 'rto_received' && previousAllocation.referenceId) {
                const orderLine = await tx.orderLine.findUnique({
                    where: { id: previousAllocation.referenceId },
                    include: { order: true }
                }) as RtoOrderLine | null;
                if (orderLine) {
                    // Clear RTO fields on order line
                    await tx.orderLine.update({
                        where: { id: previousAllocation.referenceId },
                        data: {
                            rtoCondition: null,
                            rtoInwardedAt: null,
                            rtoInwardedById: null
                        }
                    });

                    // If order was marked as fully RTO received, clear it
                    if (orderLine.order.terminalStatus === 'rto_received') {
                        await tx.order.update({
                            where: { id: orderLine.orderId },
                            data: {
                                rtoReceivedAt: null,
                                terminalStatus: null,
                                terminalAt: null
                            }
                        });
                    }
                }
            }

            await tx.inventoryTransaction.update({
                where: { id: transactionId },
                data: { reason: 'adjustment', referenceId: null }
            });
        });

        return res.json({
            success: true,
            message: previousAllocation ? 'Allocation removed' : 'Transaction marked as adjustment',
            allocation: { type: 'adjustment', referenceId: null }
        });
    }
}));

/**
 * GET /pending-queue/:source
 * Returns detailed pending items for a specific source with search and pagination support
 * Optimized: Uses database-level pagination when no search, minimal field selection
 */
router.get('/pending-queue/:source', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const source = req.params.source as PendingSource;
    const { search, limit = '50', offset = '0' } = req.query as PendingQueueQuery;
    const take = Number(limit);
    const skip = Number(offset);
    const searchLower = search?.toLowerCase();

    // Optimized SKU select - only fetch needed fields
    const skuSelect = {
        id: true,
        skuCode: true,
        size: true,
        variation: {
            select: {
                colorName: true,
                imageUrl: true,
                product: { select: { name: true, imageUrl: true } }
            }
        }
    };

    if (source === 'rto') {
        const baseWhere = {
            order: {
                trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                isArchived: false
            },
            rtoCondition: null
        };

        // Build search WHERE clause for database-level filtering
        const searchWhere = searchLower ? {
            OR: [
                { sku: { skuCode: { contains: searchLower, mode: 'insensitive' as const } } },
                { order: { orderNumber: { contains: searchLower, mode: 'insensitive' as const } } },
                { order: { customerName: { contains: searchLower, mode: 'insensitive' as const } } },
                { sku: { variation: { product: { name: { contains: searchLower, mode: 'insensitive' as const } } } } }
            ]
        } : {};

        const where = { ...baseWhere, ...searchWhere };

        // Run count and data queries in parallel
        const [totalCount, rtoPending] = await Promise.all([
            req.prisma.orderLine.count({ where }),
            req.prisma.orderLine.findMany({
                where,
                select: {
                    id: true,
                    skuId: true,
                    qty: true,
                    sku: { select: skuSelect },
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            customerName: true,
                            trackingStatus: true,
                            rtoInitiatedAt: true
                        }
                    }
                },
                orderBy: [{ order: { rtoInitiatedAt: 'asc' } }],
                skip,
                take
            })
        ]);

        const items: PendingQueueItem[] = rtoPending.map(l => {
            const sku = l.sku as SkuWithRelations;
            const daysInRto = l.order.rtoInitiatedAt
                ? Math.floor((Date.now() - new Date(l.order.rtoInitiatedAt).getTime()) / (1000 * 60 * 60 * 24))
                : 0;

            return {
                id: l.id,
                skuId: l.skuId,
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                qty: l.qty,
                imageUrl: sku.variation.imageUrl || sku.variation.product.imageUrl || null,
                contextLabel: 'Order',
                contextValue: l.order.orderNumber,
                source: 'rto',
                lineId: l.id,
                orderId: l.order.id,
                orderNumber: l.order.orderNumber,
                customerName: l.order.customerName,
                trackingStatus: l.order.trackingStatus,
                atWarehouse: l.order.trackingStatus === 'rto_delivered',
                rtoInitiatedAt: l.order.rtoInitiatedAt,
                daysInRto,
                urgency: daysInRto > 14 ? 'urgent' : daysInRto > 7 ? 'warning' : 'normal'
            };
        });

        res.json({
            source: 'rto',
            items,
            total: totalCount,
            pagination: { total: totalCount, limit: take, offset: skip, hasMore: skip + items.length < totalCount }
        });

    } else if (source === 'production') {
        const baseWhere = { status: { in: ['planned', 'in_progress'] } };

        const searchWhere = searchLower ? {
            OR: [
                { sku: { skuCode: { contains: searchLower, mode: 'insensitive' as const } } },
                { batchCode: { contains: searchLower, mode: 'insensitive' as const } },
                { sku: { variation: { product: { name: { contains: searchLower, mode: 'insensitive' as const } } } } }
            ]
        } : {};

        const where = { ...baseWhere, ...searchWhere };

        const [totalCount, productionPending] = await Promise.all([
            req.prisma.productionBatch.count({ where }),
            req.prisma.productionBatch.findMany({
                where,
                select: {
                    id: true,
                    skuId: true,
                    batchCode: true,
                    batchDate: true,
                    qtyPlanned: true,
                    qtyCompleted: true,
                    sku: { select: skuSelect }
                },
                orderBy: { batchDate: 'asc' },
                skip,
                take
            })
        ]);

        const items: PendingQueueItem[] = productionPending.map(b => {
            const sku = b.sku as SkuWithRelations;
            return {
                id: b.id,
                skuId: b.skuId,
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                qty: b.qtyPlanned - (b.qtyCompleted || 0),
                imageUrl: sku.variation.imageUrl || sku.variation.product.imageUrl || null,
                contextLabel: 'Batch',
                contextValue: b.batchCode || `Batch ${b.id.slice(0, 8)}`,
                source: 'production',
                batchId: b.id,
                batchCode: b.batchCode,
                qtyPlanned: b.qtyPlanned,
                qtyCompleted: b.qtyCompleted || 0,
                qtyPending: b.qtyPlanned - (b.qtyCompleted || 0),
                batchDate: b.batchDate
            };
        });

        res.json({
            source: 'production',
            items,
            total: totalCount,
            pagination: { total: totalCount, limit: take, offset: skip, hasMore: skip + items.length < totalCount }
        });

    } else if (source === 'returns') {
        const baseWhere = {
            request: { status: { in: ['in_transit', 'received'] } },
            itemCondition: null
        };

        const searchWhere = searchLower ? {
            OR: [
                { sku: { skuCode: { contains: searchLower, mode: 'insensitive' as const } } },
                { request: { requestNumber: { contains: searchLower, mode: 'insensitive' as const } } },
                { sku: { variation: { product: { name: { contains: searchLower, mode: 'insensitive' as const } } } } }
            ]
        } : {};

        const where = { ...baseWhere, ...searchWhere };

        const [totalCount, returnsPending] = await Promise.all([
            req.prisma.returnRequestLine.count({ where }),
            req.prisma.returnRequestLine.findMany({
                where,
                select: {
                    id: true,
                    skuId: true,
                    qty: true,
                    requestId: true,
                    sku: { select: skuSelect },
                    request: {
                        select: {
                            requestNumber: true,
                            reasonCategory: true,
                            customer: { select: { firstName: true } }
                        }
                    }
                },
                skip,
                take
            })
        ]);

        const items: PendingQueueItem[] = returnsPending.map(l => {
            const sku = l.sku as SkuWithRelations;
            return {
                id: l.id,
                skuId: l.skuId,
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                qty: l.qty,
                imageUrl: sku.variation.imageUrl || sku.variation.product.imageUrl || null,
                contextLabel: 'Ticket',
                contextValue: l.request.requestNumber,
                source: 'return',
                lineId: l.id,
                requestId: l.requestId,
                requestNumber: l.request.requestNumber,
                reasonCategory: l.request.reasonCategory,
                customerName: l.request.customer?.firstName || 'Unknown'
            };
        });

        res.json({
            source: 'returns',
            items,
            total: totalCount,
            pagination: { total: totalCount, limit: take, offset: skip, hasMore: skip + items.length < totalCount }
        });

    } else if (source === 'repacking') {
        const baseWhere = { status: { in: ['pending', 'inspecting'] } };

        const searchWhere = searchLower ? {
            OR: [
                { sku: { skuCode: { contains: searchLower, mode: 'insensitive' as const } } },
                { sku: { variation: { product: { name: { contains: searchLower, mode: 'insensitive' as const } } } } },
                { returnRequest: { requestNumber: { contains: searchLower, mode: 'insensitive' as const } } }
            ]
        } : {};

        const where = { ...baseWhere, ...searchWhere };

        const [totalCount, repackingPending] = await Promise.all([
            req.prisma.repackingQueueItem.count({ where }),
            req.prisma.repackingQueueItem.findMany({
                where,
                select: {
                    id: true,
                    skuId: true,
                    qty: true,
                    condition: true,
                    sku: { select: skuSelect },
                    returnRequest: { select: { requestNumber: true } }
                },
                skip,
                take
            })
        ]);

        const items: PendingQueueItem[] = repackingPending.map(r => {
            const sku = r.sku as SkuWithRelations;
            return {
                id: r.id,
                skuId: r.skuId,
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                qty: r.qty,
                imageUrl: sku.variation.imageUrl || sku.variation.product.imageUrl || null,
                contextLabel: 'Return',
                contextValue: r.returnRequest?.requestNumber || 'N/A',
                source: 'repacking',
                queueItemId: r.id,
                condition: r.condition,
                returnRequestNumber: r.returnRequest?.requestNumber
            };
        });

        res.json({
            source: 'repacking',
            items,
            total: totalCount,
            pagination: { total: totalCount, limit: take, offset: skip, hasMore: skip + items.length < totalCount }
        });

    } else {
        throw new ValidationError('Invalid source. Must be one of: rto, production, returns, repacking');
    }
}));

/**
 * POST /rto-inward-line
 * Process single RTO order line with condition marking and selective inventory inward.
 *
 * Condition Handling:
 * - 'good' OR 'unopened' → Creates inventory inward transaction
 * - 'damaged' OR 'wrong_product' → Creates write-off record (no inventory)
 *
 * Idempotency:
 * - Primary: OrderLine.rtoCondition check (prevents reprocessing)
 * - Secondary: findExistingRtoInward() checks for existing transaction (handles lost responses)
 *
 * @param {string} lineId - OrderLine ID to process
 * @param {string} condition - One of: 'good', 'unopened', 'damaged', 'wrong_product'
 * @param {string} [notes] - Optional processing notes
 * @returns {Object} Processing result with inventory balance and order progress
 *
 * Side Effects:
 * - Updates OrderLine.rtoCondition, rtoInwardedAt, rtoInwardedById
 * - If all lines processed: Sets Order.rtoReceivedAt, terminalStatus='rto_received'
 * - Creates InventoryTransaction (if good/unopened) OR WriteOffLog (if damaged/wrong)
 */
router.post('/rto-inward-line', authenticateToken, requirePermission('inventory:inward'), asyncHandler(async (req: Request, res: Response) => {
    const { lineId, condition, notes } = req.body as RtoInwardLineBody;

    if (!lineId) {
        throw new ValidationError('lineId is required');
    }

    if (!condition || !['good', 'damaged', 'wrong_product', 'unopened'].includes(condition)) {
        throw new ValidationError('Valid condition is required. Options: good, damaged, wrong_product, unopened');
    }

    // Get the order line with order info
    const orderLine = await req.prisma.orderLine.findUnique({
        where: { id: lineId },
        include: {
            order: {
                select: {
                    id: true,
                    orderNumber: true,
                    trackingStatus: true,
                    isArchived: true
                }
            },
            sku: {
                include: {
                    variation: { include: { product: true } }
                }
            }
        }
    }) as RtoOrderLine | null;

    if (!orderLine) {
        return res.status(404).json({ error: 'Order line not found' });
    }

    // Check if already processed (primary idempotency check via order line status)
    if (orderLine.rtoCondition) {
        return res.status(400).json({
            error: 'Line already processed',
            existingCondition: orderLine.rtoCondition,
            processedAt: (orderLine as unknown as { rtoInwardedAt?: Date }).rtoInwardedAt
        });
    }

    // Secondary idempotency check: Look for existing inventory transaction or write-off
    // This catches race conditions where the order line update succeeded but response was lost
    const existingTxn = await findExistingRtoInward(req.prisma, lineId);
    const existingWriteOff = await req.prisma.writeOffLog.findFirst({
        where: {
            sourceId: lineId,
            sourceType: 'rto'
        }
    });

    if (existingTxn || existingWriteOff) {
        // Return idempotent response
        const balance = await calculateInventoryBalance(req.prisma, orderLine.skuId);
        return res.json({
            success: true,
            idempotent: true,
            message: 'RTO line already processed',
            inventoryAdded: !!existingTxn,
            writtenOff: !!existingWriteOff,
            condition: orderLine.rtoCondition,
            processedAt: (orderLine as unknown as { rtoInwardedAt?: Date }).rtoInwardedAt,
            line: {
                lineId: orderLine.id,
                orderId: orderLine.orderId,
                orderNumber: orderLine.order.orderNumber,
                skuCode: orderLine.sku?.skuCode,
                qty: orderLine.qty,
                condition: orderLine.rtoCondition || condition
            },
            newBalance: balance.currentBalance
        });
    }

    // Check if order is in RTO status
    if (!['rto_in_transit', 'rto_delivered'].includes(orderLine.order.trackingStatus)) {
        return res.status(400).json({
            error: 'Order is not in RTO status',
            currentStatus: orderLine.order.trackingStatus
        });
    }

    // Start transaction to update line and create inventory if good
    // Use serializable isolation to prevent race conditions
    const result = await req.prisma.$transaction(async (tx) => {
        // Re-check inside transaction to prevent race conditions
        const currentLine = await tx.orderLine.findUnique({
            where: { id: lineId },
            select: { rtoCondition: true }
        });

        if (currentLine?.rtoCondition) {
            throw new BusinessLogicError('Line already processed (concurrent request)', 'ALREADY_PROCESSED');
        }

        // Update the order line with RTO condition
        const updatedLine = await tx.orderLine.update({
            where: { id: lineId },
            data: {
                rtoCondition: condition,
                rtoInwardedAt: new Date(),
                rtoInwardedById: req.user!.id,
                rtoNotes: notes || null
            }
        });

        // Only create inventory inward for 'good' or 'unopened' condition
        let inventoryTxn: InventoryTransaction | null = null;
        let writeOffRecord: WriteOffLog | null = null;

        if (condition === 'good' || condition === 'unopened') {
            inventoryTxn = await tx.inventoryTransaction.create({
                data: {
                    skuId: orderLine.skuId,
                    txnType: 'inward',
                    qty: orderLine.qty,
                    reason: 'rto_received',
                    referenceId: lineId,
                    notes: `RTO from order ${orderLine.order.orderNumber}${notes ? ` - ${notes}` : ''}`,
                    createdById: req.user!.id
                }
            }) as InventoryTransaction;
        } else {
            // For damaged/wrong_product - create write-off record with proper linking
            writeOffRecord = await tx.writeOffLog.create({
                data: {
                    skuId: orderLine.skuId,
                    qty: orderLine.qty,
                    reason: condition === 'damaged' ? 'defective' : 'wrong_product',
                    sourceType: 'rto',
                    sourceId: lineId,
                    notes: `RTO write-off (${condition}) - Order ${orderLine.order.orderNumber}${notes ? ': ' + notes : ''}`,
                    createdById: req.user!.id
                }
            }) as WriteOffLog;

            // Increment SKU write-off count
            await tx.sku.update({
                where: { id: orderLine.skuId },
                data: { writeOffCount: { increment: orderLine.qty } }
            });
        }

        // Check if all lines are processed
        const allLines = await tx.orderLine.findMany({
            where: { orderId: orderLine.orderId }
        });
        const pendingLines = allLines.filter(l => l.rtoCondition === null);
        const allLinesProcessed = pendingLines.length === 0;

        // If all lines processed, update order's rtoReceivedAt and terminal status
        if (allLinesProcessed) {
            const now = new Date();
            await tx.order.update({
                where: { id: orderLine.orderId },
                data: {
                    rtoReceivedAt: now,
                    terminalStatus: 'rto_received',
                    terminalAt: now,
                }
            });
        }

        return {
            updatedLine,
            inventoryTxn,
            writeOffRecord,
            allLinesProcessed,
            totalLines: allLines.length,
            processedLines: allLines.filter(l => l.rtoCondition !== null).length
        };
    });

    // Invalidate cache if inventory was added
    if (result.inventoryTxn) {
        inventoryBalanceCache.invalidate([orderLine.skuId]);
    }

    // Get updated balance
    const balance = await calculateInventoryBalance(req.prisma, orderLine.skuId);

    res.json({
        success: true,
        message: result.inventoryTxn
            ? `RTO line processed - ${orderLine.qty} units added to inventory`
            : result.writeOffRecord
                ? `RTO line written off as ${condition}`
                : `RTO line processed as ${condition} - no inventory added`,
        line: {
            lineId: orderLine.id,
            orderId: orderLine.orderId,
            orderNumber: orderLine.order.orderNumber,
            skuCode: orderLine.sku?.skuCode,
            productName: orderLine.sku?.variation.product.name,
            colorName: orderLine.sku?.variation.colorName,
            size: orderLine.sku?.size,
            qty: orderLine.qty,
            condition,
            notes: notes || null
        },
        inventoryAdded: result.inventoryTxn !== null,
        writtenOff: result.writeOffRecord !== null,
        newBalance: balance.currentBalance,
        orderProgress: {
            orderId: orderLine.orderId,
            orderNumber: orderLine.order.orderNumber,
            total: result.totalLines,
            processed: result.processedLines,
            remaining: result.totalLines - result.processedLines,
            allComplete: result.allLinesProcessed
        }
    });
}));

/**
 * GET /recent-inwards
 * Returns recent inward transactions for the activity feed
 * Optimized: Uses select instead of include for minimal payload
 */
router.get('/recent-inwards', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { limit = '50', source } = req.query as RecentInwardsQuery;

    // Map source param to reason values for filtering
    const reasonMap: Record<string, string[]> = {
        production: ['production'],
        returns: ['return_receipt'],
        rto: ['rto_received'],
        repacking: ['repack_complete'],
        adjustments: ['adjustment', 'found_stock', 'correction', 'received']
    };

    const where: Record<string, unknown> = {
        txnType: 'inward',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    };

    // Add reason filter if source specified
    if (source && reasonMap[source]) {
        where.reason = { in: reasonMap[source] };
    }

    const transactions = await req.prisma.inventoryTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        select: {
            id: true,
            skuId: true,
            qty: true,
            reason: true,
            referenceId: true,
            notes: true,
            createdAt: true,
            sku: {
                select: {
                    skuCode: true,
                    size: true,
                    variation: {
                        select: {
                            colorName: true,
                            product: { select: { name: true } }
                        }
                    }
                }
            },
            createdBy: { select: { name: true } }
        }
    }) as InventoryTransaction[];

    res.json(transactions.map(t => ({
        id: t.id,
        skuId: t.skuId,
        skuCode: t.sku?.skuCode,
        productName: t.sku?.variation?.product?.name,
        colorName: t.sku?.variation?.colorName,
        size: t.sku?.size,
        qty: t.qty,
        reason: t.reason,
        referenceId: t.referenceId,
        notes: t.notes,
        createdAt: t.createdAt,
        createdBy: t.createdBy?.name || 'System',
        source: mapReasonToSource(t.reason as TransactionReason | null),
        // For allocation dropdown - 'received' means unallocated
        isAllocated: t.reason !== 'received'
    })));
}));

/**
 * Helper: Map transaction reason to source type for display
 */
function mapReasonToSource(reason: TransactionReason | null): string {
    const mapping: Record<string, string> = {
        'production': 'production',
        'return_receipt': 'return',
        'rto_received': 'rto',
        'repack_complete': 'repacking',
        'adjustment': 'adjustment',
        'received': 'received' // Unallocated instant inward
    };
    return mapping[reason || ''] || 'adjustment';
}

/**
 * DELETE /undo-inward/:id
 * Undo an inward transaction (with 24-hour window validation)
 * Available to all authenticated users for recent transactions
 */
router.delete('/undo-inward/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const transaction = await req.prisma.inventoryTransaction.findUnique({
        where: { id },
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } }
                }
            }
        }
    }) as InventoryTransaction | null;

    if (!transaction) {
        throw new NotFoundError('Transaction not found', 'InventoryTransaction', id);
    }

    if (transaction.txnType !== 'inward') {
        throw new ValidationError('Can only undo inward transactions');
    }

    // Check if within undo window (24 hours)
    const hoursSinceCreated = (Date.now() - new Date(transaction.createdAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceCreated > 24) {
        throw new BusinessLogicError(
            `Transaction is too old to undo (${Math.round(hoursSinceCreated)} hours ago, max 24 hours)`,
            'UNDO_WINDOW_EXPIRED'
        );
    }

    // If this is a return_receipt transaction with a referenceId, revert the repacking queue item
    let revertedQueueItem: RepackingQueueItem | null = null;
    if (transaction.reason === 'return_receipt' && transaction.referenceId) {
        const queueItem = await req.prisma.repackingQueueItem.findUnique({
            where: { id: transaction.referenceId }
        }) as RepackingQueueItem | null;

        if (queueItem && queueItem.status === 'ready') {
            await req.prisma.repackingQueueItem.update({
                where: { id: transaction.referenceId },
                data: {
                    status: 'pending',
                    qcComments: null,
                    processedAt: null,
                    processedById: null
                }
            });
            revertedQueueItem = queueItem;
        }
    }

    // Delete the transaction
    await req.prisma.inventoryTransaction.delete({
        where: { id }
    });

    // Invalidate cache
    inventoryBalanceCache.invalidate([transaction.skuId]);

    // Get updated balance
    const balance = await calculateInventoryBalance(req.prisma, transaction.skuId);

    res.json({
        success: true,
        message: revertedQueueItem
            ? 'Transaction undone and item returned to QC queue'
            : 'Transaction undone',
        undone: {
            id: transaction.id,
            skuCode: transaction.sku?.skuCode,
            productName: transaction.sku?.variation?.product?.name,
            qty: transaction.qty,
            reason: transaction.reason
        },
        newBalance: balance.currentBalance,
        revertedToQueue: !!revertedQueueItem
    });
}));

export default router;
