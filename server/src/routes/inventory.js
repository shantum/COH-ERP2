import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { calculateInventoryBalance, calculateAllInventoryBalances, calculateAllFabricBalances, getEffectiveFabricConsumption, TXN_REASON } from '../utils/queryPatterns.js';

const router = Router();

// ============================================
// CENTRALIZED INWARD HUB ENDPOINTS
// ============================================

/**
 * GET /pending-sources
 * Returns counts and items from all pending inward sources
 */
router.get('/pending-sources', authenticateToken, async (req, res) => {
    try {
        // Get pending production batches (status: in_progress)
        const productionPending = await req.prisma.productionBatch.findMany({
            where: { status: 'in_progress' },
            include: {
                sku: {
                    include: {
                        variation: { include: { product: true } }
                    }
                }
            }
        });

        // Get return request lines that are in_transit or received but not yet inspected
        const returnsPending = await req.prisma.returnRequestLine.findMany({
            where: {
                request: { status: { in: ['in_transit', 'received'] } },
                itemCondition: null  // Not yet inspected
            },
            include: {
                sku: { include: { variation: { include: { product: true } } } },
                request: true
            }
        });

        // Get RTO orders pending receipt
        const rtoPending = await req.prisma.order.findMany({
            where: {
                trackingStatus: 'rto_in_transit',
                rtoReceivedAt: null,
                isArchived: false
            },
            include: {
                orderLines: {
                    include: {
                        sku: { include: { variation: { include: { product: true } } } }
                    }
                }
            }
        });

        // Get repacking queue items (pending or inspecting)
        const repackingPending = await req.prisma.repackingQueueItem.findMany({
            where: { status: { in: ['pending', 'inspecting'] } },
            include: {
                sku: { include: { variation: { include: { product: true } } } },
                returnRequest: true
            }
        });

        // Build response with counts and items
        res.json({
            counts: {
                production: productionPending.length,
                returns: returnsPending.length,
                rto: rtoPending.reduce((sum, o) => sum + o.orderLines.length, 0),
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
                rto: rtoPending.flatMap(o => o.orderLines.map(l => ({
                    source: 'rto',
                    orderId: o.id,
                    orderNumber: o.orderNumber,
                    lineId: l.id,
                    skuId: l.skuId,
                    skuCode: l.sku.skuCode,
                    productName: l.sku.variation.product.name,
                    colorName: l.sku.variation.colorName,
                    size: l.sku.size,
                    qty: l.qty
                }))),
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

        // 3. RTO orders
        const rtoLine = await req.prisma.orderLine.findFirst({
            where: {
                skuId: sku.id,
                order: {
                    trackingStatus: 'rto_in_transit',
                    rtoReceivedAt: null,
                    isArchived: false
                }
            },
            include: { order: true }
        });
        if (rtoLine) {
            matches.push({
                source: 'rto',
                priority: 3,
                data: {
                    orderId: rtoLine.orderId,
                    orderNumber: rtoLine.order.orderNumber,
                    lineId: rtoLine.id,
                    qty: rtoLine.qty,
                    customerName: rtoLine.order.customerName
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
router.post('/inward', authenticateToken, async (req, res) => {
    try {
        const { skuId, qty, reason, referenceId, notes, warehouseLocation } = req.body;

        const transaction = await req.prisma.inventoryTransaction.create({
            data: {
                skuId,
                txnType: 'inward',
                qty,
                reason,
                referenceId,
                notes,
                warehouseLocation,
                createdById: req.user.id,
            },
            include: {
                sku: true,
                createdBy: { select: { id: true, name: true } },
            },
        });

        res.status(201).json(transaction);
    } catch (error) {
        console.error('Create inward transaction error:', error);
        res.status(500).json({ error: 'Failed to create inward transaction' });
    }
});

// Create outward transaction
router.post('/outward', authenticateToken, async (req, res) => {
    try {
        const { skuId, qty, reason, referenceId, notes, warehouseLocation } = req.body;

        // Check available balance (currentBalance minus reserved)
        const balance = await calculateInventoryBalance(req.prisma, skuId);
        if (balance.availableBalance < qty) {
            return res.status(400).json({
                error: 'Insufficient stock',
                available: balance.availableBalance,
                requested: qty
            });
        }

        const transaction = await req.prisma.inventoryTransaction.create({
            data: {
                skuId,
                txnType: 'outward',
                qty,
                reason,
                referenceId,
                notes,
                warehouseLocation,
                createdById: req.user.id,
            },
            include: {
                sku: true,
                createdBy: { select: { id: true, name: true } },
            },
        });

        res.status(201).json(transaction);
    } catch (error) {
        console.error('Create outward transaction error:', error);
        res.status(500).json({ error: 'Failed to create outward transaction' });
    }
});

// Quick inward (simplified form) - with production batch matching
router.post('/quick-inward', authenticateToken, async (req, res) => {
    try {
        const { skuCode, barcode, qty, reason = 'production', notes } = req.body;

        // Find SKU by code or barcode
        let sku;
        if (barcode) {
            sku = await req.prisma.sku.findFirst({ where: { barcode } });
        }
        if (!sku && skuCode) {
            sku = await req.prisma.sku.findUnique({ where: { skuCode } });
        }
        if (!sku) {
            return res.status(404).json({ error: 'SKU not found' });
        }

        // Create inward transaction
        const transaction = await req.prisma.inventoryTransaction.create({
            data: {
                skuId: sku.id,
                txnType: 'inward',
                qty,
                reason,
                notes,
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

        // Try to match to pending production batch
        let matchedBatch = null;
        if (reason === 'production') {
            matchedBatch = await matchProductionBatch(req.prisma, sku.id, qty);
        }

        const balance = await calculateInventoryBalance(req.prisma, sku.id);

        res.status(201).json({
            transaction,
            newBalance: balance.currentBalance,
            matchedBatch: matchedBatch ? {
                id: matchedBatch.id,
                batchCode: matchedBatch.batchCode,
                qtyCompleted: matchedBatch.qtyCompleted,
                qtyPlanned: matchedBatch.qtyPlanned,
                status: matchedBatch.status,
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
router.delete('/inward/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await req.prisma.inventoryTransaction.findUnique({
            where: { id },
        });

        if (!existing) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        if (existing.txnType !== 'inward') {
            return res.status(400).json({ error: 'Can only delete inward transactions' });
        }

        await req.prisma.inventoryTransaction.delete({ where: { id } });

        res.json({ success: true, message: 'Transaction deleted' });
    } catch (error) {
        console.error('Delete inward error:', error);
        res.status(500).json({ error: 'Failed to delete inward transaction' });
    }
});

// Delete any inventory transaction (admin only)
router.delete('/transactions/:id', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admin can delete transactions' });
        }

        const { id } = req.params;

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

        let revertedQueueItem = null;

        // If this is a return_receipt transaction with a referenceId, revert the repacking queue item
        if (existing.reason === 'return_receipt' && existing.referenceId) {
            const queueItem = await req.prisma.repackingQueueItem.findUnique({
                where: { id: existing.referenceId },
            });

            if (queueItem && queueItem.status === 'ready') {
                // Revert the queue item back to pending
                await req.prisma.repackingQueueItem.update({
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

        await req.prisma.inventoryTransaction.delete({ where: { id } });

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
        });
    } catch (error) {
        console.error('Delete inventory transaction error:', error);
        res.status(500).json({ error: 'Failed to delete transaction' });
    }
});

// Helper: Match production batch for inward
async function matchProductionBatch(prisma, skuId, quantity) {
    // Find oldest pending/in_progress batch for this SKU that isn't fully completed
    const batch = await prisma.productionBatch.findFirst({
        where: {
            skuId,
            status: { in: ['planned', 'in_progress'] },
        },
        orderBy: { batchDate: 'asc' },
    });

    if (batch && batch.qtyCompleted < batch.qtyPlanned) {
        const newCompleted = Math.min(batch.qtyCompleted + quantity, batch.qtyPlanned);
        const isComplete = newCompleted >= batch.qtyPlanned;

        const updated = await prisma.productionBatch.update({
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
