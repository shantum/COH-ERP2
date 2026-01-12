import { Router } from 'express';
import { chunkProcess } from '../utils/asyncUtils.js';

const router = Router();

// Sales velocity report
router.get('/sales-velocity', async (req, res) => {
    try {
        const { days = 28 } = req.query;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - Number(days));

        const transactions = await req.prisma.inventoryTransaction.findMany({
            where: { txnType: 'outward', reason: 'sale', createdAt: { gte: startDate } },
            include: { sku: { include: { variation: { include: { product: true } } } } },
        });

        const skuVelocity = {};
        transactions.forEach((t) => {
            if (!skuVelocity[t.skuId]) {
                skuVelocity[t.skuId] = {
                    skuCode: t.sku.skuCode,
                    productName: t.sku.variation.product.name,
                    colorName: t.sku.variation.colorName,
                    size: t.sku.size,
                    totalSold: 0,
                };
            }
            skuVelocity[t.skuId].totalSold += t.qty;
        });

        const result = Object.values(skuVelocity).map((v) => ({ ...v, avgDailySales: (v.totalSold / Number(days)).toFixed(2) }));
        res.json(result.sort((a, b) => b.totalSold - a.totalSold));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch sales velocity' });
    }
});

// Inventory turnover
router.get('/inventory-turnover', async (req, res) => {
    try {
        const skus = await req.prisma.sku.findMany({ where: { isActive: true }, include: { variation: { include: { product: true } } } });

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Batch SKU processing to prevent connection pool exhaustion
        const result = await chunkProcess(skus, async (sku) => {
            const balance = await req.prisma.inventoryTransaction.groupBy({ by: ['txnType'], where: { skuId: sku.id }, _sum: { qty: true } });
            let inward = 0, outward = 0;
            balance.forEach((b) => { if (b.txnType === 'inward') inward = b._sum.qty || 0; else outward = b._sum.qty || 0; });
            const current = inward - outward;

            const recentSales = await req.prisma.inventoryTransaction.aggregate({ where: { skuId: sku.id, txnType: 'outward', reason: 'sale', createdAt: { gte: thirtyDaysAgo } }, _sum: { qty: true } });
            const avgDailySales = (recentSales._sum.qty || 0) / 30;
            const daysOnHand = avgDailySales > 0 ? current / avgDailySales : null;

            return {
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                currentStock: current,
                avgDailySales: avgDailySales.toFixed(2),
                daysOnHand: daysOnHand ? Math.floor(daysOnHand) : 'N/A',
                status: daysOnHand > 90 ? 'slow_mover' : daysOnHand > 60 ? 'moderate' : 'fast_mover',
            };
        }, 5);

        res.json(result.sort((a, b) => (b.daysOnHand === 'N/A' ? -1 : a.daysOnHand === 'N/A' ? 1 : b.daysOnHand - a.daysOnHand)));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch inventory turnover' });
    }
});

// COGS summary by category
router.get('/cogs-summary', async (req, res) => {
    try {
        const costConfig = await req.prisma.costConfig.findFirst();
        const laborRate = costConfig?.laborRatePerMin || 2.5;
        const defaultPkg = costConfig?.defaultPackagingCost || 50;

        const skus = await req.prisma.sku.findMany({ where: { isActive: true }, include: { variation: { include: { product: true, fabric: true } }, skuCosting: true } });

        const categoryStats = {};
        skus.forEach((sku) => {
            const cat = sku.variation.product.category;
            const fabricCost = Number(sku.fabricConsumption) * Number(sku.variation.fabric.costPerUnit);
            const laborCost = sku.variation.product.baseProductionTimeMins * Number(laborRate);
            const totalCogs = fabricCost + laborCost + Number(defaultPkg);
            const margin = Number(sku.mrp) - totalCogs;
            const marginPct = Number(sku.mrp) > 0 ? (margin / Number(sku.mrp)) * 100 : 0;

            if (!categoryStats[cat]) categoryStats[cat] = { category: cat, skuCount: 0, avgCogs: 0, avgMrp: 0, avgMarginPct: 0, lowMarginCount: 0 };
            categoryStats[cat].skuCount++;
            categoryStats[cat].avgCogs += totalCogs;
            categoryStats[cat].avgMrp += Number(sku.mrp);
            categoryStats[cat].avgMarginPct += marginPct;
            if (marginPct < 50) categoryStats[cat].lowMarginCount++;
        });

        const result = Object.values(categoryStats).map((c) => ({
            ...c,
            avgCogs: (c.avgCogs / c.skuCount).toFixed(2),
            avgMrp: (c.avgMrp / c.skuCount).toFixed(2),
            avgMarginPct: (c.avgMarginPct / c.skuCount).toFixed(1),
        }));

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch COGS summary' });
    }
});

// Top products report - configurable time period and aggregation level
router.get('/top-products', async (req, res) => {
    try {
        const { days = 30, level = 'product', limit = 20 } = req.query;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - Number(days));

        // Get order lines from shipped/delivered orders within the time period
        const orderLines = await req.prisma.orderLine.findMany({
            where: {
                order: {
                    orderDate: { gte: startDate },
                    status: { not: 'cancelled' },
                    trackingStatus: { notIn: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] },
                },
            },
            include: {
                sku: {
                    include: {
                        variation: {
                            include: {
                                product: true,
                                fabric: true,
                            },
                        },
                    },
                },
            },
        });

        if (level === 'variation') {
            // Aggregate at variation level (product + color)
            const variationStats = {};
            for (const line of orderLines) {
                const variation = line.sku?.variation;
                if (!variation) continue;

                const key = variation.id;
                if (!variationStats[key]) {
                    variationStats[key] = {
                        id: variation.id,
                        name: variation.product?.name || 'Unknown',
                        colorName: variation.colorName || 'Unknown',
                        fabricName: variation.fabric?.colorName || null,
                        imageUrl: variation.imageUrl || variation.product?.imageUrl || null,
                        units: 0,
                        revenue: 0,
                        orderCount: new Set(),
                    };
                }
                variationStats[key].units += line.qty;
                variationStats[key].revenue += line.qty * Number(line.unitPrice);
                variationStats[key].orderCount.add(line.orderId);
            }

            const result = Object.values(variationStats)
                .map(v => ({ ...v, orderCount: v.orderCount.size }))
                .sort((a, b) => b.units - a.units)
                .slice(0, Number(limit));

            return res.json({ level: 'variation', days: Number(days), data: result });
        } else {
            // Aggregate at product level
            const productStats = {};
            for (const line of orderLines) {
                const product = line.sku?.variation?.product;
                if (!product) continue;

                const key = product.id;
                if (!productStats[key]) {
                    productStats[key] = {
                        id: product.id,
                        name: product.name,
                        category: product.category,
                        imageUrl: product.imageUrl || null,
                        units: 0,
                        revenue: 0,
                        orderCount: new Set(),
                        variations: {},
                    };
                }
                productStats[key].units += line.qty;
                productStats[key].revenue += line.qty * Number(line.unitPrice);
                productStats[key].orderCount.add(line.orderId);

                // Track variation breakdown
                const variationId = line.sku?.variation?.id;
                const colorName = line.sku?.variation?.colorName || 'Unknown';
                if (variationId) {
                    if (!productStats[key].variations[variationId]) {
                        productStats[key].variations[variationId] = { colorName, units: 0 };
                    }
                    productStats[key].variations[variationId].units += line.qty;
                }
            }

            const result = Object.values(productStats)
                .map(p => ({
                    ...p,
                    orderCount: p.orderCount.size,
                    variations: Object.values(p.variations)
                        .sort((a, b) => b.units - a.units)
                        .slice(0, 5),
                }))
                .sort((a, b) => b.units - a.units)
                .slice(0, Number(limit));

            return res.json({ level: 'product', days: Number(days), data: result });
        }
    } catch (error) {
        console.error('Top products error:', error);
        res.status(500).json({ error: 'Failed to fetch top products' });
    }
});

// Top customers report - configurable time period with top products breakdown
router.get('/top-customers', async (req, res) => {
    try {
        const { period = '3months', limit = 15 } = req.query;

        // Calculate start date based on period
        const now = new Date();
        let startDate = new Date();

        switch (period) {
            case 'thisMonth':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'lastMonth':
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
                // For last month, we need to also set end date
                break;
            case '3months':
                startDate.setMonth(now.getMonth() - 3);
                break;
            case '6months':
                startDate.setMonth(now.getMonth() - 6);
                break;
            case '1year':
                startDate.setFullYear(now.getFullYear() - 1);
                break;
            default:
                startDate.setMonth(now.getMonth() - 3);
        }

        // Build date filter
        let dateFilter = { gte: startDate };
        if (period === 'lastMonth') {
            const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
            dateFilter = { gte: startOfLastMonth, lte: endOfLastMonth };
        }

        // Get order lines with customer data
        const orderLines = await req.prisma.orderLine.findMany({
            where: {
                order: {
                    orderDate: dateFilter,
                    status: { not: 'cancelled' },
                    trackingStatus: { notIn: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] },
                },
            },
            include: {
                order: {
                    select: {
                        id: true,
                        customerId: true,
                        customerName: true,
                        customerEmail: true,
                        customerPhone: true,
                        customerTier: true,
                    },
                },
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
        });

        // Aggregate by customer
        const customerStats = {};
        for (const line of orderLines) {
            const customerId = line.order?.customerId;
            if (!customerId) continue;

            if (!customerStats[customerId]) {
                customerStats[customerId] = {
                    id: customerId,
                    name: line.order.customerName || 'Unknown',
                    email: line.order.customerEmail,
                    phone: line.order.customerPhone,
                    tier: line.order.customerTier,
                    units: 0,
                    revenue: 0,
                    orderCount: new Set(),
                    products: {},
                };
            }

            customerStats[customerId].units += line.qty;
            customerStats[customerId].revenue += line.qty * Number(line.unitPrice);
            customerStats[customerId].orderCount.add(line.orderId);

            // Track product purchases for this customer
            const productName = line.sku?.variation?.product?.name;
            if (productName) {
                if (!customerStats[customerId].products[productName]) {
                    customerStats[customerId].products[productName] = { name: productName, units: 0, revenue: 0 };
                }
                customerStats[customerId].products[productName].units += line.qty;
                customerStats[customerId].products[productName].revenue += line.qty * Number(line.unitPrice);
            }
        }

        const result = Object.values(customerStats)
            .map(c => ({
                ...c,
                orderCount: c.orderCount.size,
                topProducts: Object.values(c.products)
                    .sort((a, b) => b.revenue - a.revenue)
                    .slice(0, 3)
                    .map(p => ({ name: p.name, units: p.units })),
            }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, Number(limit));

        // Remove the products object from response
        result.forEach(r => delete r.products);

        return res.json({ period, data: result });
    } catch (error) {
        console.error('Top customers error:', error);
        res.status(500).json({ error: 'Failed to fetch top customers' });
    }
});

// Dashboard summary
router.get('/dashboard', async (req, res) => {
    try {
        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);

        const [openOrders, pendingReturns, lowStockSkus, recentSales] = await Promise.all([
            req.prisma.order.count({ where: { status: 'open' } }),
            req.prisma.returnRequest.count({ where: { status: { notIn: ['resolved', 'cancelled'] } } }),
            req.prisma.sku.count({ where: { isActive: true } }), // Will calculate below
            req.prisma.inventoryTransaction.aggregate({ where: { txnType: 'outward', reason: 'sale', createdAt: { gte: thirtyDaysAgo } }, _sum: { qty: true } }),
        ]);

        res.json({
            openOrders,
            pendingReturns,
            totalSalesLast30Days: recentSales._sum.qty || 0,
            lowStockAlerts: 0, // Placeholder
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch dashboard' });
    }
});

export default router;
