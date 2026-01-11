import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import {
    calculateInventoryBalance,
    calculateAllInventoryBalances,
    calculateAllFabricBalances,
    getEffectiveFabricConsumption,
    TXN_REASON,
    TXN_TYPE,
    TXN_REFERENCE_TYPE,
    findExistingRtoInward,
    validateTransactionDeletion,
    validateSku
} from '../utils/queryPatterns.js';
import {
    NotFoundError,
    ValidationError,
    BusinessLogicError,
    ForbiddenError,
} from '../utils/errors.js';

const router = Router();

// ============================================
// CENTRALIZED INWARD HUB ENDPOINTS
// ============================================

/**
 * GET /pending-sources
 * Returns ONLY counts from all pending inward sources (fast endpoint for dashboard)
 * Uses count() queries instead of loading all items
 */
router.get('/pending-sources', authenticateToken, asyncHandler(async (req, res) => {
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
router.get('/scan-lookup', authenticateToken, asyncHandler(async (req, res) => {
    const { code } = req.query;
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
    });

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
        }),

        // 2. Returns (in transit or received, not yet inspected)
        req.prisma.returnRequestLine.findFirst({
            where: {
                skuId: sku.id,
                itemCondition: null,
                request: { status: { in: ['in_transit', 'received'] } }
            },
            include: { request: { select: { id: true, requestNumber: true, reasonCategory: true } } }
        }),

        // 3. RTO orders (includes both rto_in_transit and rto_delivered)
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
                        // Include order line count for progress (aggregated)
                        _count: { select: { orderLines: true } }
                    }
                }
            }
        }),

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
        })
    ]);

    // Build matches array from parallel query results
    const matches = [];

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
        // Get processed line count for progress (single query instead of fetching all lines)
        const processedCount = await req.prisma.orderLine.count({
            where: { orderId: rtoLine.orderId, rtoCondition: { not: null } }
        });
        const totalLines = rtoLine.order._count.orderLines;

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
 * GET /pending-queue/:source
 * Returns detailed pending items for a specific source with search and pagination support
 * Optimized: Uses database-level pagination when no search, minimal field selection
 */
router.get('/pending-queue/:source', authenticateToken, asyncHandler(async (req, res) => {
    const { source } = req.params;
    const { search, limit = 50, offset = 0 } = req.query;
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
                { sku: { skuCode: { contains: searchLower, mode: 'insensitive' } } },
                { order: { orderNumber: { contains: searchLower, mode: 'insensitive' } } },
                { order: { customerName: { contains: searchLower, mode: 'insensitive' } } },
                { sku: { variation: { product: { name: { contains: searchLower, mode: 'insensitive' } } } } }
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

        const items = rtoPending.map(l => {
            const daysInRto = l.order.rtoInitiatedAt
                ? Math.floor((Date.now() - new Date(l.order.rtoInitiatedAt).getTime()) / (1000 * 60 * 60 * 24))
                : 0;

            return {
                id: l.id,
                skuId: l.skuId,
                skuCode: l.sku.skuCode,
                productName: l.sku.variation.product.name,
                colorName: l.sku.variation.colorName,
                size: l.sku.size,
                qty: l.qty,
                imageUrl: l.sku.variation.imageUrl || l.sku.variation.product.imageUrl,
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
                { sku: { skuCode: { contains: searchLower, mode: 'insensitive' } } },
                { batchCode: { contains: searchLower, mode: 'insensitive' } },
                { sku: { variation: { product: { name: { contains: searchLower, mode: 'insensitive' } } } } }
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

        const items = productionPending.map(b => ({
            id: b.id,
            skuId: b.skuId,
            skuCode: b.sku.skuCode,
            productName: b.sku.variation.product.name,
            colorName: b.sku.variation.colorName,
            size: b.sku.size,
            qty: b.qtyPlanned - (b.qtyCompleted || 0),
            imageUrl: b.sku.variation.imageUrl || b.sku.variation.product.imageUrl,
            contextLabel: 'Batch',
            contextValue: b.batchCode || `Batch ${b.id.slice(0, 8)}`,
            source: 'production',
            batchId: b.id,
            batchCode: b.batchCode,
            qtyPlanned: b.qtyPlanned,
            qtyCompleted: b.qtyCompleted || 0,
            qtyPending: b.qtyPlanned - (b.qtyCompleted || 0),
            batchDate: b.batchDate
        }));

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
                { sku: { skuCode: { contains: searchLower, mode: 'insensitive' } } },
                { request: { requestNumber: { contains: searchLower, mode: 'insensitive' } } },
                { sku: { variation: { product: { name: { contains: searchLower, mode: 'insensitive' } } } } }
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

        const items = returnsPending.map(l => ({
            id: l.id,
            skuId: l.skuId,
            skuCode: l.sku.skuCode,
            productName: l.sku.variation.product.name,
            colorName: l.sku.variation.colorName,
            size: l.sku.size,
            qty: l.qty,
            imageUrl: l.sku.variation.imageUrl || l.sku.variation.product.imageUrl,
            contextLabel: 'Ticket',
            contextValue: l.request.requestNumber,
            source: 'return',
            lineId: l.id,
            requestId: l.requestId,
            requestNumber: l.request.requestNumber,
            reasonCategory: l.request.reasonCategory,
            customerName: l.request.customer?.firstName || 'Unknown'
        }));

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
                { sku: { skuCode: { contains: searchLower, mode: 'insensitive' } } },
                { sku: { variation: { product: { name: { contains: searchLower, mode: 'insensitive' } } } } },
                { returnRequest: { requestNumber: { contains: searchLower, mode: 'insensitive' } } }
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

        const items = repackingPending.map(r => ({
            id: r.id,
            skuId: r.skuId,
            skuCode: r.sku.skuCode,
            productName: r.sku.variation.product.name,
            colorName: r.sku.variation.colorName,
            size: r.sku.size,
            qty: r.qty,
            imageUrl: r.sku.variation.imageUrl || r.sku.variation.product.imageUrl,
            contextLabel: 'Return',
            contextValue: r.returnRequest?.requestNumber || 'N/A',
            source: 'repacking',
            queueItemId: r.id,
            condition: r.condition,
            returnRequestNumber: r.returnRequest?.requestNumber
        }));

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
 * Process a single RTO order line (mark condition and optionally create inventory inward)
 * Includes idempotency check to prevent duplicate transactions on network retries
 */
router.post('/rto-inward-line', authenticateToken, requirePermission('inventory:inward'), asyncHandler(async (req, res) => {
    const { lineId, condition, notes } = req.body;

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
    });

    if (!orderLine) {
        return res.status(404).json({ error: 'Order line not found' });
    }

    // Check if already processed (primary idempotency check via order line status)
    if (orderLine.rtoCondition) {
        return res.status(400).json({
            error: 'Line already processed',
            existingCondition: orderLine.rtoCondition,
            processedAt: orderLine.rtoInwardedAt
        });
    }

    // Secondary idempotency check: Look for existing inventory transaction
    // This catches race conditions where the order line update succeeded but response was lost
    const existingTxn = await findExistingRtoInward(req.prisma, lineId);
    if (existingTxn) {
        // Transaction already exists - return success without creating duplicate
        const balance = await calculateInventoryBalance(req.prisma, orderLine.skuId);
        return res.json({
            success: true,
            message: 'RTO line already processed (idempotent response)',
            idempotent: true,
            existingTransactionId: existingTxn.id,
            line: {
                lineId: orderLine.id,
                orderId: orderLine.orderId,
                orderNumber: orderLine.order.orderNumber,
                skuCode: orderLine.sku.skuCode,
                qty: orderLine.qty,
                condition: orderLine.rtoCondition || condition
            },
            inventoryAdded: true,
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
                rtoInwardedById: req.user.id,
                rtoNotes: notes || null
            }
        });

        // Only create inventory inward for 'good' or 'unopened' condition
        let inventoryTxn = null;
        let writeOffRecord = null;

        if (condition === 'good' || condition === 'unopened') {
            inventoryTxn = await tx.inventoryTransaction.create({
                data: {
                    skuId: orderLine.skuId,
                    txnType: 'inward',
                    qty: orderLine.qty,
                    reason: 'rto_received',
                    referenceId: lineId,
                    notes: `RTO from order ${orderLine.order.orderNumber}${notes ? ` - ${notes}` : ''}`,
                    createdById: req.user.id
                }
            });
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
                    createdById: req.user.id
                }
            });

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
            skuCode: orderLine.sku.skuCode,
            productName: orderLine.sku.variation.product.name,
            colorName: orderLine.sku.variation.colorName,
            size: orderLine.sku.size,
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
router.get('/recent-inwards', authenticateToken, asyncHandler(async (req, res) => {
    const { limit = 50 } = req.query;

    const transactions = await req.prisma.inventoryTransaction.findMany({
        where: {
            txnType: 'inward',
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        select: {
            id: true,
            skuId: true,
            qty: true,
            reason: true,
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
    });

    res.json(transactions.map(t => ({
        id: t.id,
        skuId: t.skuId,
        skuCode: t.sku.skuCode,
        productName: t.sku.variation.product.name,
        colorName: t.sku.variation.colorName,
        size: t.sku.size,
        qty: t.qty,
        reason: t.reason,
        notes: t.notes,
        createdAt: t.createdAt,
        createdBy: t.createdBy?.name || 'System',
        source: mapReasonToSource(t.reason)
    })));
}));

/**
 * Helper: Map transaction reason to source type for display
 */
function mapReasonToSource(reason) {
    const mapping = {
        'production': 'production',
        'return_receipt': 'return',
        'rto_received': 'rto',
        'repack_complete': 'repacking',
        'adjustment': 'adjustment'
    };
    return mapping[reason] || 'adjustment';
}

/**
 * DELETE /undo-inward/:id
 * Undo an inward transaction (with 24-hour window validation)
 * Available to all authenticated users for recent transactions
 */
router.delete('/undo-inward/:id', authenticateToken, asyncHandler(async (req, res) => {
    const { id } = req.params;

    const transaction = await req.prisma.inventoryTransaction.findUnique({
        where: { id },
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } }
                }
            }
        }
    });

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
    let revertedQueueItem = null;
    if (transaction.reason === 'return_receipt' && transaction.referenceId) {
        const queueItem = await req.prisma.repackingQueueItem.findUnique({
            where: { id: transaction.referenceId }
        });

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

// ============================================
// INVENTORY DASHBOARD
// ============================================

// Get inventory balance for all SKUs
// By default excludes custom SKUs from standard inventory view
// Pass includeCustomSkus=true to include them (e.g., for admin views)
router.get('/balance', authenticateToken, asyncHandler(async (req, res) => {
    // Default to all SKUs (high limit) since inventory view needs complete picture
    // Use explicit limit param for paginated requests
    const { belowTarget, search, limit = 10000, offset = 0, includeCustomSkus = 'false' } = req.query;
    const take = Number(limit);
    const skip = Number(offset);
    const shouldIncludeCustomSkus = includeCustomSkus === 'true';

    // Build SKU filter - by default exclude custom SKUs from standard inventory view
    // Move search filtering to database level for better performance
    const skuWhere = {
        isActive: true,
        ...(shouldIncludeCustomSkus ? {} : { isCustomSku: false }),
        // Server-side search on SKU code and product name
        ...(search && {
            OR: [
                { skuCode: { contains: search, mode: 'insensitive' } },
                { variation: { product: { name: { contains: search, mode: 'insensitive' } } } }
            ]
        })
    };

    const skus = await req.prisma.sku.findMany({
        where: skuWhere,
        include: {
            variation: {
                include: {
                    product: true,
                    fabric: true,
                },
            },
            shopifyInventoryCache: true,
        },
    });

    // Calculate all balances in a single query (fixes N+1)
    // Use excludeCustomSkus option to match SKU filtering
    const skuIds = skus.map(sku => sku.id);
    const balanceMap = await calculateAllInventoryBalances(req.prisma, skuIds, {
        excludeCustomSkus: !shouldIncludeCustomSkus
    });

    const balances = skus.map((sku) => {
        const balance = balanceMap.get(sku.id) || { totalInward: 0, totalOutward: 0, totalReserved: 0, currentBalance: 0, availableBalance: 0 };

        // Get image URL from variation or product
        const imageUrl = sku.variation.imageUrl || sku.variation.product.imageUrl || null;

        return {
            skuId: sku.id,
            skuCode: sku.skuCode,
            productId: sku.variation.product.id,
            productName: sku.variation.product.name,
            productType: sku.variation.product.productType,
            gender: sku.variation.product.gender,
            colorName: sku.variation.colorName,
            variationId: sku.variation.id,
            size: sku.size,
            category: sku.variation.product.category,
            imageUrl,
            currentBalance: balance.currentBalance,
            reservedBalance: balance.totalReserved,
            availableBalance: balance.availableBalance,
            totalInward: balance.totalInward,
            totalOutward: balance.totalOutward,
            targetStockQty: sku.targetStockQty,
            status: balance.availableBalance < sku.targetStockQty ? 'below_target' : 'ok',
            mrp: sku.mrp,
            shopifyQty: sku.shopifyInventoryCache?.availableQty ?? null,
            // Custom SKU fields (only present when includeCustomSkus=true)
            isCustomSku: sku.isCustomSku || false,
        };
    });

    let filteredBalances = balances;

    // Filter by below target status (done in memory since it requires calculated balance)
    if (belowTarget === 'true') {
        filteredBalances = balances.filter((b) => b.status === 'below_target');
    }

    // Note: search filtering is now done at database level (see skuWhere above)

    // Sort by status (below_target first)
    filteredBalances.sort((a, b) => {
        if (a.status === 'below_target' && b.status !== 'below_target') return -1;
        if (a.status !== 'below_target' && b.status === 'below_target') return 1;
        return a.skuCode.localeCompare(b.skuCode);
    });

    // Apply pagination after filtering and sorting
    const totalCount = filteredBalances.length;
    const paginatedBalances = filteredBalances.slice(skip, skip + take);

    res.json({
        items: paginatedBalances,
        pagination: {
            total: totalCount,
            limit: take,
            offset: skip,
            hasMore: skip + paginatedBalances.length < totalCount,
        }
    });
}));

// Get balance for single SKU
router.get('/balance/:skuId', authenticateToken, asyncHandler(async (req, res) => {
    const sku = await req.prisma.sku.findUnique({
        where: { id: req.params.skuId },
        include: {
            variation: {
                include: {
                    product: true,
                    fabric: true,
                },
            },
        },
    });

    if (!sku) {
        throw new NotFoundError('SKU not found', 'SKU', req.params.skuId);
    }

    const balance = await calculateInventoryBalance(req.prisma, sku.id);

    res.json({
        sku,
        ...balance,
        targetStockQty: sku.targetStockQty,
        status: balance.currentBalance < sku.targetStockQty ? 'below_target' : 'ok',
    });
}));

// ============================================
// INVENTORY TRANSACTIONS
// ============================================

// Get all transactions (with filters)
router.get('/transactions', authenticateToken, asyncHandler(async (req, res) => {
    const { skuId, txnType, reason, startDate, endDate, limit = 100, offset = 0 } = req.query;

    const where = {};
    if (skuId) where.skuId = skuId;
    if (txnType) where.txnType = txnType;
    if (reason) where.reason = reason;
    if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) where.createdAt.lte = new Date(endDate);
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

// Create inward transaction
// Fixed: Added audit trail for manual adjustments
router.post('/inward', authenticateToken, requirePermission('inventory:inward'), asyncHandler(async (req, res) => {
    const { skuId, qty, reason, referenceId, notes, warehouseLocation, adjustmentReason } = req.body;

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
        auditNotes = `[MANUAL ADJUSTMENT by ${req.user.name || req.user.email} at ${timestamp}] ${adjustmentReason || ''} ${notes ? '| ' + notes : ''}`.trim();
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
            createdById: req.user.id,
        },
        include: {
            sku: true,
            createdBy: { select: { id: true, name: true } },
        },
    });

    // Get updated balance
    const balance = await calculateInventoryBalance(req.prisma, skuId);

    res.status(201).json({
        ...transaction,
        newBalance: balance.currentBalance,
        availableBalance: balance.availableBalance
    });
}));

// Create outward transaction
// Fixed: Added audit trail for manual adjustments
router.post('/outward', authenticateToken, requirePermission('inventory:outward'), asyncHandler(async (req, res) => {
    const { skuId, qty, reason, referenceId, notes, warehouseLocation, adjustmentReason } = req.body;

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
        auditNotes = `[MANUAL ${reason.toUpperCase()} by ${req.user.name || req.user.email} at ${timestamp}] ${adjustmentReason || ''} ${notes ? '| ' + notes : ''}`.trim();
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
            createdById: req.user.id,
        },
        include: {
            sku: true,
            createdBy: { select: { id: true, name: true } },
        },
    });

    // Get updated balance
    const newBalance = await calculateInventoryBalance(req.prisma, skuId);

    res.status(201).json({
        ...transaction,
        newBalance: newBalance.currentBalance,
        availableBalance: newBalance.availableBalance
    });
}));

// Quick inward (simplified form) - with production batch matching
// Fixed: Added SKU validation and race condition protection
router.post('/quick-inward', authenticateToken, requirePermission('inventory:inward'), asyncHandler(async (req, res) => {
    const { skuCode, barcode, qty, reason = 'production', notes } = req.body;

    // Validate quantity
    if (!qty || qty <= 0 || !Number.isInteger(qty)) {
        throw new ValidationError('Quantity must be a positive integer');
    }

    // Validate SKU exists and is active
    const skuValidation = await validateSku(req.prisma, { skuCode, barcode });
    if (!skuValidation.valid) {
        throw new ValidationError(skuValidation.error);
    }

    const sku = skuValidation.sku;

    // Use transaction for atomic operation to prevent race conditions
    const result = await req.prisma.$transaction(async (tx) => {
        // Create inward transaction
        const transaction = await tx.inventoryTransaction.create({
            data: {
                skuId: sku.id,
                txnType: 'inward',
                qty,
                reason,
                notes: notes || null,
                createdById: req.user.id,
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
        let matchedBatch = null;
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

        return { transaction: updatedTransaction, matchedBatch };
    });

    const balance = await calculateInventoryBalance(req.prisma, sku.id);

    res.status(201).json({
        transaction: result.transaction,
        newBalance: balance.currentBalance,
        matchedBatch: result.matchedBatch ? {
            id: result.matchedBatch.id,
            batchCode: result.matchedBatch.batchCode,
            qtyCompleted: result.matchedBatch.qtyCompleted,
            qtyPlanned: result.matchedBatch.qtyPlanned,
            status: result.matchedBatch.status,
        } : null,
    });
}));

// Get inward history (for Production Inward page)
router.get('/inward-history', authenticateToken, asyncHandler(async (req, res) => {
    const { date, limit = 50 } = req.query;

    // Default to today
    let startDate, endDate;
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
    });

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
    const batchMap = new Map();
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

// Edit inward transaction
router.put('/inward/:id', authenticateToken, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { qty, notes } = req.body;

    const existing = await req.prisma.inventoryTransaction.findUnique({
        where: { id },
    });

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

    res.json(updated);
}));

// Delete inward transaction
// Fixed: Added validation to check for dependent operations before deletion
router.delete('/inward/:id', authenticateToken, requirePermission('inventory:delete:inward'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { force = false } = req.query; // Allow force delete for admins

    const existing = await req.prisma.inventoryTransaction.findUnique({
        where: { id },
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
        },
    });

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
        if (force === 'true' && req.user.role === 'admin') {
            console.warn(`Admin ${req.user.id} force-deleting transaction ${id} with dependencies:`, validation.dependencies);
        } else {
            throw new BusinessLogicError(
                `Cannot delete transaction: ${validation.reason}`,
                'HAS_DEPENDENCIES'
            );
        }
    }

    await req.prisma.inventoryTransaction.delete({ where: { id } });

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

// Delete any inventory transaction (admin only)
// Fixed: Added dependency validation with force option and audit logging
router.delete('/transactions/:id', authenticateToken, requireAnyPermission('inventory:delete:inward', 'inventory:delete:outward'), asyncHandler(async (req, res) => {
    // Note: Full admin check by permissions, old role check deprecated

    const { id } = req.params;
    const { force = false } = req.query;

    const existing = await req.prisma.inventoryTransaction.findUnique({
        where: { id },
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
        },
    });

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
        console.warn(`Admin ${req.user.id} (${req.user.email}) force-deleting transaction ${id} with dependencies:`, {
            transaction: validation.transaction,
            dependencies: validation.dependencies
        });
    }

    let revertedQueueItem = null;
    let revertedProductionBatch = null;
    let deletedFabricTxn = null;
    let revertedAllocation = null;

    // Use transaction for atomic operation
    await req.prisma.$transaction(async (tx) => {
        // If this is a return_receipt transaction with a referenceId, revert the repacking queue item
        if (existing.reason === 'return_receipt' && existing.referenceId) {
            const queueItem = await tx.repackingQueueItem.findUnique({
                where: { id: existing.referenceId },
            });

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
            });

            // Handle both 'completed' and 'in_progress' batches
            if (productionBatch && (productionBatch.status === 'completed' || productionBatch.status === 'in_progress')) {
                // Check if this is a custom SKU batch that was auto-allocated
                const isCustomSkuBatch = productionBatch.sku.isCustomSku && productionBatch.sourceOrderLineId;

                // If custom SKU with completed batch, check if order line has progressed beyond allocation
                if (isCustomSkuBatch && productionBatch.status === 'completed') {
                    const orderLine = await tx.orderLine.findUnique({
                        where: { id: productionBatch.sourceOrderLineId }
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
                        where: { id: productionBatch.sourceOrderLineId },
                        data: {
                            lineStatus: 'pending',
                            allocatedAt: null
                        }
                    });

                    revertedAllocation = productionBatch.sourceOrderLineId;
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

// Helper: Match production batch for inward (outside transaction - deprecated)
async function matchProductionBatch(prisma, skuId, quantity) {
    return matchProductionBatchInTransaction(prisma, skuId, quantity);
}

// Helper: Match production batch for inward (transaction-safe version)
// Uses the passed transaction client to ensure atomicity
async function matchProductionBatchInTransaction(tx, skuId, quantity) {
    // Find oldest pending/in_progress batch for this SKU that isn't fully completed
    const batch = await tx.productionBatch.findFirst({
        where: {
            skuId,
            status: { in: ['planned', 'in_progress'] },
        },
        orderBy: { batchDate: 'asc' },
    });

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
        });

        return updated;
    }

    return null;
}

// ============================================
// STOCK ALERTS
// ============================================

// Stock alerts exclude custom SKUs since they're made-to-order
// and don't need stock replenishment alerts
router.get('/alerts', authenticateToken, asyncHandler(async (req, res) => {
    // Exclude custom SKUs from alerts - they don't need stock replenishment
    const skus = await req.prisma.sku.findMany({
        where: {
            isActive: true,
            isCustomSku: false
        },
        include: {
            variation: {
                include: {
                    product: true,
                    fabric: true,
                },
            },
        },
    });

    // Calculate all balances in single queries (fixes N+1)
    // excludeCustomSkus=true ensures we don't get balances for custom SKUs
    const skuIds = skus.map(sku => sku.id);
    const inventoryBalanceMap = await calculateAllInventoryBalances(req.prisma, skuIds, {
        excludeCustomSkus: true
    });
    const fabricBalanceMap = await calculateAllFabricBalances(req.prisma);

    const alerts = [];

    for (const sku of skus) {
        const balance = inventoryBalanceMap.get(sku.id) || { currentBalance: 0 };

        if (balance.currentBalance < sku.targetStockQty) {
            const shortage = sku.targetStockQty - balance.currentBalance;

            // Get effective fabric consumption (SKU or Product-level fallback)
            const consumptionPerUnit = getEffectiveFabricConsumption(sku);
            const fabricNeeded = shortage * consumptionPerUnit;

            // Get fabric availability from pre-calculated map
            const fabricBalance = fabricBalanceMap.get(sku.variation.fabricId) || { currentBalance: 0 };
            const fabricAvailable = fabricBalance.currentBalance;

            const canProduce = Math.floor(fabricAvailable / consumptionPerUnit);

            alerts.push({
                skuId: sku.id,
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                currentBalance: balance.currentBalance,
                targetStockQty: sku.targetStockQty,
                shortage,
                fabricNeeded: fabricNeeded.toFixed(2),
                fabricAvailable: fabricAvailable.toFixed(2),
                canProduce,
                consumptionPerUnit: consumptionPerUnit.toFixed(2),
                status: canProduce >= shortage ? 'can_produce' : 'fabric_needed',
            });
        }
    }

    // Sort by severity (larger shortage first)
    alerts.sort((a, b) => b.shortage - a.shortage);

    res.json(alerts);
}));

export default router;
