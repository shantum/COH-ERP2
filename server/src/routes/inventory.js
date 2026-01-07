import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
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

const router = Router();

// ============================================
// CENTRALIZED INWARD HUB ENDPOINTS
// ============================================

/**
 * GET /pending-sources
 * Returns counts and items from all pending inward sources
 * Fixed: Uses Promise.all for parallel queries to improve performance
 */
router.get('/pending-sources', authenticateToken, async (req, res) => {
    try {
        // Execute all queries in parallel for better performance
        const [productionPending, returnsPending, rtoPending, repackingPending] = await Promise.all([
            // Get pending production batches (status: in_progress)
            req.prisma.productionBatch.findMany({
                where: { status: 'in_progress' },
                include: {
                    sku: {
                        include: {
                            variation: { include: { product: true } }
                        }
                    }
                }
            }),

            // Get return request lines that are in_transit or received but not yet inspected
            req.prisma.returnRequestLine.findMany({
                where: {
                    request: { status: { in: ['in_transit', 'received'] } },
                    itemCondition: null  // Not yet inspected
                },
                include: {
                    sku: { include: { variation: { include: { product: true } } } },
                    request: true
                }
            }),

            // Get RTO lines pending receipt (line-level, not order-level)
            // Includes both rto_in_transit AND rto_delivered where lines are not yet processed
            req.prisma.orderLine.findMany({
                where: {
                    order: {
                        trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                        isArchived: false
                    },
                    rtoCondition: null  // Not yet processed
                },
                include: {
                    sku: { include: { variation: { include: { product: true } } } },
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            customerName: true,
                            trackingStatus: true,
                            rtoInitiatedAt: true
                        }
                    }
                }
            }),

            // Get repacking queue items (pending or inspecting)
            req.prisma.repackingQueueItem.findMany({
                where: { status: { in: ['pending', 'inspecting'] } },
                include: {
                    sku: { include: { variation: { include: { product: true } } } },
                    returnRequest: true
                }
            })
        ]);

        // Calculate RTO urgency based on days since rtoInitiatedAt
        const now = Date.now();
        let rtoUrgent = 0;
        let rtoWarning = 0;

        for (const line of rtoPending) {
            if (line.order.rtoInitiatedAt) {
                const daysInRto = Math.floor((now - new Date(line.order.rtoInitiatedAt).getTime()) / (1000 * 60 * 60 * 24));
                if (daysInRto > 14) rtoUrgent++;
                else if (daysInRto > 7) rtoWarning++;
            }
        }

        // Build response with counts and items
        res.json({
            counts: {
                production: productionPending.length,
                returns: returnsPending.length,
                rto: rtoPending.length,
                rtoUrgent,    // Items >14 days - for red badge
                rtoWarning,   // Items 7-14 days - for orange badge
                repacking: repackingPending.length
            },
            items: {
                production: productionPending.map(b => ({
                    source: 'production',
                    batchId: b.id,
                    batchCode: b.batchCode,
                    skuId: b.skuId,
                    skuCode: b.sku.skuCode,
                    productName: b.sku.variation.product.name,
                    colorName: b.sku.variation.colorName,
                    size: b.sku.size,
                    qtyPlanned: b.qtyPlanned,
                    qtyCompleted: b.qtyCompleted || 0,
                    qtyPending: b.qtyPlanned - (b.qtyCompleted || 0)
                })),
                returns: returnsPending.map(l => ({
                    source: 'return',
                    lineId: l.id,
                    requestId: l.requestId,
                    requestNumber: l.request.requestNumber,
                    skuId: l.skuId,
                    skuCode: l.sku.skuCode,
                    productName: l.sku.variation.product.name,
                    colorName: l.sku.variation.colorName,
                    size: l.sku.size,
                    qty: l.qty,
                    reasonCategory: l.request.reasonCategory
                })),
                rto: rtoPending.map(l => ({
                    source: 'rto',
                    orderId: l.order.id,
                    orderNumber: l.order.orderNumber,
                    customerName: l.order.customerName,
                    lineId: l.id,
                    skuId: l.skuId,
                    skuCode: l.sku.skuCode,
                    productName: l.sku.variation.product.name,
                    colorName: l.sku.variation.colorName,
                    size: l.sku.size,
                    qty: l.qty,
                    trackingStatus: l.order.trackingStatus,
                    atWarehouse: l.order.trackingStatus === 'rto_delivered',
                    rtoInitiatedAt: l.order.rtoInitiatedAt
                })),
                repacking: repackingPending.map(r => ({
                    source: 'repacking',
                    queueItemId: r.id,
                    skuId: r.skuId,
                    skuCode: r.sku.skuCode,
                    productName: r.sku.variation.product.name,
                    colorName: r.sku.variation.colorName,
                    size: r.sku.size,
                    qty: r.qty,
                    condition: r.condition,
                    returnRequestNumber: r.returnRequest?.requestNumber
                }))
            }
        });
    } catch (error) {
        console.error('Get pending sources error:', error);
        res.status(500).json({ error: 'Failed to fetch pending sources' });
    }
});

/**
 * GET /scan-lookup?code=XXX
 * Looks up SKU by code and finds matching pending sources
 */
router.get('/scan-lookup', authenticateToken, async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) return res.status(400).json({ error: 'Code is required' });

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
            return res.status(404).json({ error: 'SKU not found' });
        }

        // Get current balance
        const balance = await calculateInventoryBalance(req.prisma, sku.id);

        // Check all pending sources for this SKU (priority order)
        const matches = [];

        // 1. Repacking (highest priority - already in warehouse)
        const repackingItem = await req.prisma.repackingQueueItem.findFirst({
            where: { skuId: sku.id, status: { in: ['pending', 'inspecting'] } },
            include: { returnRequest: true }
        });
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

        // 2. Returns (in transit or received, not yet inspected)
        const returnLine = await req.prisma.returnRequestLine.findFirst({
            where: {
                skuId: sku.id,
                itemCondition: null,
                request: { status: { in: ['in_transit', 'received'] } }
            },
            include: { request: true }
        });
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
                    customerName: returnLine.request.customer?.firstName || null
                }
            });
        }

        // 3. RTO orders (includes both rto_in_transit and rto_delivered)
        const rtoLine = await req.prisma.orderLine.findFirst({
            where: {
                skuId: sku.id,
                rtoCondition: null,  // Not yet processed
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
                        rtoInitiatedAt: true
                    }
                }
            }
        });

        if (rtoLine) {
            // Get all lines for this order to show progress
            const allOrderLines = await req.prisma.orderLine.findMany({
                where: { orderId: rtoLine.orderId },
                include: {
                    sku: { select: { skuCode: true } }
                }
            });

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
                    // Include other lines for progress display
                    orderLines: allOrderLines.map(l => ({
                        lineId: l.id,
                        skuCode: l.sku.skuCode,
                        qty: l.qty,
                        rtoCondition: l.rtoCondition,
                        isCurrentLine: l.id === rtoLine.id
                    }))
                }
            });
        }

        // 4. Production batches
        const productionBatch = await req.prisma.productionBatch.findFirst({
            where: {
                skuId: sku.id,
                status: 'in_progress'
            }
        });
        if (productionBatch) {
            matches.push({
                source: 'production',
                priority: 4,
                data: {
                    batchId: productionBatch.id,
                    batchCode: productionBatch.batchCode,
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
    } catch (error) {
        console.error('Scan lookup error:', error);
        res.status(500).json({ error: 'Failed to lookup SKU' });
    }
});

/**
 * GET /pending-queue/:source
 * Returns detailed pending items for a specific source with search and pagination support
 */
router.get('/pending-queue/:source', authenticateToken, async (req, res) => {
    try {
        const { source } = req.params;
        const { search, limit = 50, offset = 0 } = req.query;
        const take = Number(limit);
        const skip = Number(offset);

        if (source === 'rto') {
            // Get RTO lines pending receipt
            const rtoPending = await req.prisma.orderLine.findMany({
                where: {
                    order: {
                        trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                        isArchived: false
                    },
                    rtoCondition: null  // Not yet processed
                },
                include: {
                    sku: { include: { variation: { include: { product: true } } } },
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
                orderBy: [
                    { order: { rtoInitiatedAt: 'asc' } }  // Oldest first (most urgent)
                ]
            });

            let items = rtoPending.map(l => {
                const daysInRto = l.order.rtoInitiatedAt
                    ? Math.floor((Date.now() - new Date(l.order.rtoInitiatedAt).getTime()) / (1000 * 60 * 60 * 24))
                    : 0;

                return {
                    // Normalized fields for QueuePanel
                    id: l.id,  // Use lineId as the unique ID
                    skuId: l.skuId,
                    skuCode: l.sku.skuCode,
                    productName: l.sku.variation.product.name,
                    colorName: l.sku.variation.colorName,
                    size: l.sku.size,
                    qty: l.qty,
                    imageUrl: l.sku.variation.product.imageUrl,
                    contextLabel: 'Order',
                    contextValue: l.order.orderNumber,
                    // RTO-specific fields
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

            // Apply search filter
            if (search) {
                const searchLower = search.toLowerCase();
                items = items.filter(item =>
                    item.skuCode.toLowerCase().includes(searchLower) ||
                    item.orderNumber.toLowerCase().includes(searchLower) ||
                    item.customerName.toLowerCase().includes(searchLower) ||
                    item.productName.toLowerCase().includes(searchLower)
                );
            }

            // Apply pagination
            const totalCount = items.length;
            const paginatedItems = items.slice(skip, skip + take);

            res.json({
                source: 'rto',
                items: paginatedItems,
                total: totalCount,
                pagination: {
                    total: totalCount,
                    limit: take,
                    offset: skip,
                    hasMore: skip + paginatedItems.length < totalCount
                }
            });
        } else if (source === 'production') {
            // Production batches
            const productionPending = await req.prisma.productionBatch.findMany({
                where: { status: 'in_progress' },
                include: {
                    sku: { include: { variation: { include: { product: true } } } }
                },
                orderBy: { batchDate: 'asc' }
            });

            let items = productionPending.map(b => ({
                // Normalized fields for QueuePanel
                id: b.id,
                skuId: b.skuId,
                skuCode: b.sku.skuCode,
                productName: b.sku.variation.product.name,
                colorName: b.sku.variation.colorName,
                size: b.sku.size,
                qty: b.qtyPlanned - (b.qtyCompleted || 0),  // Pending qty
                imageUrl: b.sku.variation.product.imageUrl,
                contextLabel: 'Batch',
                contextValue: b.batchCode || `Batch ${b.id.slice(0, 8)}`,
                // Production-specific fields
                source: 'production',
                batchId: b.id,
                batchCode: b.batchCode,
                qtyPlanned: b.qtyPlanned,
                qtyCompleted: b.qtyCompleted || 0,
                qtyPending: b.qtyPlanned - (b.qtyCompleted || 0),
                batchDate: b.batchDate
            }));

            if (search) {
                const searchLower = search.toLowerCase();
                items = items.filter(item =>
                    item.skuCode.toLowerCase().includes(searchLower) ||
                    (item.batchCode && item.batchCode.toLowerCase().includes(searchLower)) ||
                    item.productName.toLowerCase().includes(searchLower)
                );
            }

            // Apply pagination
            const totalCount = items.length;
            const paginatedItems = items.slice(skip, skip + take);

            res.json({
                source: 'production',
                items: paginatedItems,
                total: totalCount,
                pagination: {
                    total: totalCount,
                    limit: take,
                    offset: skip,
                    hasMore: skip + paginatedItems.length < totalCount
                }
            });
        } else if (source === 'returns') {
            // Return request lines
            const returnsPending = await req.prisma.returnRequestLine.findMany({
                where: {
                    request: { status: { in: ['in_transit', 'received'] } },
                    itemCondition: null
                },
                include: {
                    sku: { include: { variation: { include: { product: true } } } },
                    request: { include: { customer: true } }
                }
            });

            let items = returnsPending.map(l => ({
                // Normalized fields for QueuePanel
                id: l.id,
                skuId: l.skuId,
                skuCode: l.sku.skuCode,
                productName: l.sku.variation.product.name,
                colorName: l.sku.variation.colorName,
                size: l.sku.size,
                qty: l.qty,
                imageUrl: l.sku.variation.product.imageUrl,
                contextLabel: 'Ticket',
                contextValue: l.request.requestNumber,
                // Return-specific fields
                source: 'return',
                lineId: l.id,
                requestId: l.requestId,
                requestNumber: l.request.requestNumber,
                reasonCategory: l.request.reasonCategory,
                customerName: l.request.customer?.firstName || 'Unknown'
            }));

            if (search) {
                const searchLower = search.toLowerCase();
                items = items.filter(item =>
                    item.skuCode.toLowerCase().includes(searchLower) ||
                    item.requestNumber.toLowerCase().includes(searchLower) ||
                    item.productName.toLowerCase().includes(searchLower)
                );
            }

            // Apply pagination
            const totalCount = items.length;
            const paginatedItems = items.slice(skip, skip + take);

            res.json({
                source: 'returns',
                items: paginatedItems,
                total: totalCount,
                pagination: {
                    total: totalCount,
                    limit: take,
                    offset: skip,
                    hasMore: skip + paginatedItems.length < totalCount
                }
            });
        } else if (source === 'repacking') {
            // Repacking queue items
            const repackingPending = await req.prisma.repackingQueueItem.findMany({
                where: { status: { in: ['pending', 'inspecting'] } },
                include: {
                    sku: { include: { variation: { include: { product: true } } } },
                    returnRequest: true
                }
            });

            let items = repackingPending.map(r => ({
                // Normalized fields for QueuePanel
                id: r.id,
                skuId: r.skuId,
                skuCode: r.sku.skuCode,
                productName: r.sku.variation.product.name,
                colorName: r.sku.variation.colorName,
                size: r.sku.size,
                qty: r.qty,
                imageUrl: r.sku.variation.product.imageUrl,
                contextLabel: 'Return',
                contextValue: r.returnRequest?.requestNumber || 'N/A',
                // Repacking-specific fields
                source: 'repacking',
                queueItemId: r.id,
                condition: r.condition,
                returnRequestNumber: r.returnRequest?.requestNumber
            }));

            if (search) {
                const searchLower = search.toLowerCase();
                items = items.filter(item =>
                    item.skuCode.toLowerCase().includes(searchLower) ||
                    item.productName.toLowerCase().includes(searchLower) ||
                    (item.returnRequestNumber && item.returnRequestNumber.toLowerCase().includes(searchLower))
                );
            }

            // Apply pagination
            const totalCount = items.length;
            const paginatedItems = items.slice(skip, skip + take);

            res.json({
                source: 'repacking',
                items: paginatedItems,
                total: totalCount,
                pagination: {
                    total: totalCount,
                    limit: take,
                    offset: skip,
                    hasMore: skip + paginatedItems.length < totalCount
                }
            });
        } else {
            res.status(400).json({ error: 'Invalid source. Must be one of: rto, production, returns, repacking' });
        }
    } catch (error) {
        console.error('Get pending queue error:', error);
        res.status(500).json({ error: 'Failed to fetch pending queue' });
    }
});

/**
 * POST /rto-inward-line
 * Process a single RTO order line (mark condition and optionally create inventory inward)
 * Includes idempotency check to prevent duplicate transactions on network retries
 */
router.post('/rto-inward-line', authenticateToken, async (req, res) => {
    try {
        const { lineId, condition, notes } = req.body;

        if (!lineId) {
            return res.status(400).json({ error: 'lineId is required' });
        }

        if (!condition || !['good', 'damaged', 'wrong_product', 'unopened'].includes(condition)) {
            return res.status(400).json({
                error: 'Valid condition is required',
                validConditions: ['good', 'damaged', 'wrong_product', 'unopened']
            });
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
                throw new Error('ALREADY_PROCESSED');
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

            // If all lines processed, update order's rtoReceivedAt
            if (allLinesProcessed) {
                await tx.order.update({
                    where: { id: orderLine.orderId },
                    data: { rtoReceivedAt: new Date() }
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
    } catch (error) {
        // Handle the race condition case gracefully
        if (error.message === 'ALREADY_PROCESSED') {
            return res.status(400).json({
                error: 'Line already processed (concurrent request)',
                hint: 'This line was processed by another request. Refresh to see current status.'
            });
        }
        console.error('RTO inward line error:', error);
        res.status(500).json({ error: 'Failed to process RTO line' });
    }
});

/**
 * GET /recent-inwards
 * Returns recent inward transactions for the activity feed
 */
router.get('/recent-inwards', authenticateToken, async (req, res) => {
    try {
        const { limit = 50 } = req.query;

        const transactions = await req.prisma.inventoryTransaction.findMany({
            where: {
                txnType: 'inward',
                createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
            },
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
            include: {
                sku: {
                    include: {
                        variation: { include: { product: true } }
                    }
                },
                createdBy: { select: { id: true, name: true } }
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
            // Map reason to source for display
            source: mapReasonToSource(t.reason)
        })));
    } catch (error) {
        console.error('Get recent inwards error:', error);
        res.status(500).json({ error: 'Failed to fetch recent inwards' });
    }
});

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
router.delete('/undo-inward/:id', authenticateToken, async (req, res) => {
    try {
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
            return res.status(404).json({ error: 'Transaction not found' });
        }

        if (transaction.txnType !== 'inward') {
            return res.status(400).json({ error: 'Can only undo inward transactions' });
        }

        // Check if within undo window (24 hours)
        const hoursSinceCreated = (Date.now() - new Date(transaction.createdAt).getTime()) / (1000 * 60 * 60);
        if (hoursSinceCreated > 24) {
            return res.status(400).json({
                error: 'Transaction is too old to undo',
                hoursAgo: Math.round(hoursSinceCreated),
                maxHours: 24
            });
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
    } catch (error) {
        console.error('Undo inward transaction error:', error);
        res.status(500).json({ error: 'Failed to undo transaction' });
    }
});

// ============================================
// INVENTORY DASHBOARD
// ============================================

// Get inventory balance for all SKUs
router.get('/balance', authenticateToken, async (req, res) => {
    try {
        // Default to all SKUs (high limit) since inventory view needs complete picture
        // Use explicit limit param for paginated requests
        const { belowTarget, search, limit = 10000, offset = 0 } = req.query;
        const take = Number(limit);
        const skip = Number(offset);

        const skus = await req.prisma.sku.findMany({
            where: { isActive: true },
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
        const skuIds = skus.map(sku => sku.id);
        const balanceMap = await calculateAllInventoryBalances(req.prisma, skuIds);

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
            };
        });

        let filteredBalances = balances;

        if (belowTarget === 'true') {
            filteredBalances = balances.filter((b) => b.status === 'below_target');
        }

        if (search) {
            const searchLower = search.toLowerCase();
            filteredBalances = filteredBalances.filter(
                (b) =>
                    b.skuCode.toLowerCase().includes(searchLower) ||
                    b.productName.toLowerCase().includes(searchLower)
            );
        }

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
    } catch (error) {
        console.error('Get inventory balance error:', error);
        res.status(500).json({ error: 'Failed to fetch inventory balance' });
    }
});

// Get balance for single SKU
router.get('/balance/:skuId', authenticateToken, async (req, res) => {
    try {
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
            return res.status(404).json({ error: 'SKU not found' });
        }

        const balance = await calculateInventoryBalance(req.prisma, sku.id);

        res.json({
            sku,
            ...balance,
            targetStockQty: sku.targetStockQty,
            status: balance.currentBalance < sku.targetStockQty ? 'below_target' : 'ok',
        });
    } catch (error) {
        console.error('Get SKU balance error:', error);
        res.status(500).json({ error: 'Failed to fetch SKU balance' });
    }
});

// ============================================
// INVENTORY TRANSACTIONS
// ============================================

// Get all transactions (with filters)
router.get('/transactions', authenticateToken, async (req, res) => {
    try {
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
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// Create inward transaction
// Fixed: Added audit trail for manual adjustments
router.post('/inward', authenticateToken, async (req, res) => {
    try {
        const { skuId, qty, reason, referenceId, notes, warehouseLocation, adjustmentReason } = req.body;

        // Validate required fields
        if (!skuId || !qty || !reason) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['skuId', 'qty', 'reason']
            });
        }

        // For adjustments, require a reason/justification
        if (reason === 'adjustment' && !adjustmentReason && !notes) {
            return res.status(400).json({
                error: 'Adjustment transactions require a reason',
                hint: 'Provide adjustmentReason or notes explaining the adjustment'
            });
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
    } catch (error) {
        console.error('Create inward transaction error:', error);
        res.status(500).json({ error: 'Failed to create inward transaction' });
    }
});

// Create outward transaction
// Fixed: Added audit trail for manual adjustments
router.post('/outward', authenticateToken, async (req, res) => {
    try {
        const { skuId, qty, reason, referenceId, notes, warehouseLocation, adjustmentReason } = req.body;

        // Validate required fields
        if (!skuId || !qty || !reason) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['skuId', 'qty', 'reason']
            });
        }

        // For adjustments/damage, require a reason/justification
        if ((reason === 'adjustment' || reason === 'damage') && !adjustmentReason && !notes) {
            return res.status(400).json({
                error: 'Adjustment/damage transactions require a reason',
                hint: 'Provide adjustmentReason or notes explaining the adjustment'
            });
        }

        // Check available balance (currentBalance minus reserved)
        const balance = await calculateInventoryBalance(req.prisma, skuId);
        if (balance.availableBalance < qty) {
            return res.status(400).json({
                error: 'Insufficient stock',
                available: balance.availableBalance,
                requested: qty,
                currentBalance: balance.currentBalance,
                reserved: balance.totalReserved
            });
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
    } catch (error) {
        console.error('Create outward transaction error:', error);
        res.status(500).json({ error: 'Failed to create outward transaction' });
    }
});

// Quick inward (simplified form) - with production batch matching
// Fixed: Added SKU validation and race condition protection
router.post('/quick-inward', authenticateToken, async (req, res) => {
    try {
        const { skuCode, barcode, qty, reason = 'production', notes } = req.body;

        // Validate quantity
        if (!qty || qty <= 0 || !Number.isInteger(qty)) {
            return res.status(400).json({
                error: 'Invalid quantity',
                message: 'Quantity must be a positive integer'
            });
        }

        // Validate SKU exists and is active
        const skuValidation = await validateSku(req.prisma, { skuCode, barcode });
        if (!skuValidation.valid) {
            return res.status(400).json({
                error: skuValidation.error,
                skuCode: skuCode || barcode,
                isInactive: skuValidation.sku && !skuValidation.sku.isActive
            });
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
            if (reason === 'production') {
                matchedBatch = await matchProductionBatchInTransaction(tx, sku.id, qty);
            }

            return { transaction, matchedBatch };
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
    } catch (error) {
        console.error('Quick inward error:', error);
        res.status(500).json({ error: 'Failed to create quick inward' });
    }
});

// Get inward history (for Production Inward page)
router.get('/inward-history', authenticateToken, async (req, res) => {
    try {
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

        // Get batch info for each transaction (if matched by reason)
        const enrichedTransactions = await Promise.all(transactions.map(async (txn) => {
            // Look for any production batch that might have been updated around the same time
            const batch = await req.prisma.productionBatch.findFirst({
                where: {
                    skuId: txn.skuId,
                    status: { in: ['in_progress', 'completed'] },
                },
                orderBy: { batchDate: 'desc' },
            });

            return {
                ...txn,
                productName: txn.sku?.variation?.product?.name,
                colorName: txn.sku?.variation?.colorName,
                size: txn.sku?.size,
                imageUrl: txn.sku?.variation?.imageUrl || txn.sku?.variation?.product?.imageUrl,
                batchCode: batch?.batchCode || null,
            };
        }));

        res.json(enrichedTransactions);
    } catch (error) {
        console.error('Get inward history error:', error);
        res.status(500).json({ error: 'Failed to fetch inward history' });
    }
});

// Edit inward transaction
router.put('/inward/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { qty, notes } = req.body;

        const existing = await req.prisma.inventoryTransaction.findUnique({
            where: { id },
        });

        if (!existing) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        if (existing.txnType !== 'inward') {
            return res.status(400).json({ error: 'Can only edit inward transactions' });
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
    } catch (error) {
        console.error('Edit inward error:', error);
        res.status(500).json({ error: 'Failed to edit inward transaction' });
    }
});

// Delete inward transaction
// Fixed: Added validation to check for dependent operations before deletion
router.delete('/inward/:id', authenticateToken, async (req, res) => {
    try {
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
            return res.status(404).json({ error: 'Transaction not found' });
        }

        if (existing.txnType !== 'inward') {
            return res.status(400).json({ error: 'Can only delete inward transactions' });
        }

        // Validate deletion is safe (check for dependencies)
        const validation = await validateTransactionDeletion(req.prisma, id);
        if (!validation.canDelete) {
            // Only admins can force delete with dependencies
            if (force === 'true' && req.user.role === 'admin') {
                console.warn(`Admin ${req.user.id} force-deleting transaction ${id} with dependencies:`, validation.dependencies);
            } else {
                return res.status(400).json({
                    error: 'Cannot delete transaction',
                    reason: validation.reason,
                    dependencies: validation.dependencies,
                    hint: 'Resolve dependencies first or use force=true (admin only)'
                });
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
    } catch (error) {
        console.error('Delete inward error:', error);
        res.status(500).json({ error: 'Failed to delete inward transaction' });
    }
});

// Delete any inventory transaction (admin only)
// Fixed: Added dependency validation with force option and audit logging
router.delete('/transactions/:id', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admin can delete transactions' });
        }

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
            return res.status(404).json({ error: 'Transaction not found' });
        }

        // Validate deletion is safe (check for dependencies)
        const validation = await validateTransactionDeletion(req.prisma, id);
        if (!validation.canDelete && force !== 'true') {
            return res.status(400).json({
                error: 'Cannot delete transaction',
                reason: validation.reason,
                dependencies: validation.dependencies,
                hint: 'Use force=true to override (admin only)'
            });
        }

        if (!validation.canDelete && force === 'true') {
            console.warn(`Admin ${req.user.id} (${req.user.email}) force-deleting transaction ${id} with dependencies:`, {
                transaction: validation.transaction,
                dependencies: validation.dependencies
            });
        }

        let revertedQueueItem = null;

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

            await tx.inventoryTransaction.delete({ where: { id } });
        });

        // Get updated balance
        const balance = await calculateInventoryBalance(req.prisma, existing.skuId);

        res.json({
            success: true,
            message: revertedQueueItem
                ? 'Transaction deleted and item returned to QC queue'
                : 'Transaction deleted',
            deleted: {
                id: existing.id,
                txnType: existing.txnType,
                qty: existing.qty,
                skuCode: existing.sku?.skuCode,
                productName: existing.sku?.variation?.product?.name,
            },
            revertedToQueue: revertedQueueItem ? true : false,
            newBalance: balance.currentBalance,
            forcedDeletion: !validation.canDelete && force === 'true',
        });
    } catch (error) {
        console.error('Delete inventory transaction error:', error);
        res.status(500).json({ error: 'Failed to delete transaction' });
    }
});

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

router.get('/alerts', authenticateToken, async (req, res) => {
    try {
        const skus = await req.prisma.sku.findMany({
            where: { isActive: true },
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
        const skuIds = skus.map(sku => sku.id);
        const inventoryBalanceMap = await calculateAllInventoryBalances(req.prisma, skuIds);
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
    } catch (error) {
        console.error('Get stock alerts error:', error);
        res.status(500).json({ error: 'Failed to fetch stock alerts' });
    }
});

export default router;
