import { Router } from 'express';

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

        const result = await Promise.all(skus.map(async (sku) => {
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
        }));

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
