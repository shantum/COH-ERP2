import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { calculateInventoryBalance, calculateAllInventoryBalances, calculateAllFabricBalances, getEffectiveFabricConsumption } from '../utils/queryPatterns.js';

const router = Router();

// ============================================
// INVENTORY DASHBOARD
// ============================================

// Get inventory balance for all SKUs
router.get('/balance', authenticateToken, async (req, res) => {
    try {
        const { belowTarget, search } = req.query;

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

        res.json(filteredBalances);
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

        // Check balance
        const balance = await calculateInventoryBalance(req.prisma, skuId);
        if (balance.currentBalance < qty) {
            return res.status(400).json({
                error: 'Insufficient stock',
                available: balance.currentBalance,
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

// Quick inward (simplified form)
router.post('/quick-inward', authenticateToken, async (req, res) => {
    try {
        const { skuCode, qty, reason = 'production', notes } = req.body;

        // Find SKU by code
        const sku = await req.prisma.sku.findUnique({ where: { skuCode } });
        if (!sku) {
            return res.status(404).json({ error: 'SKU not found' });
        }

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

        const balance = await calculateInventoryBalance(req.prisma, sku.id);

        res.status(201).json({ transaction, newBalance: balance.currentBalance });
    } catch (error) {
        console.error('Quick inward error:', error);
        res.status(500).json({ error: 'Failed to create quick inward' });
    }
});

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
