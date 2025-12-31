import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// ============================================
// FABRIC TYPES
// ============================================

// Get all fabric types
router.get('/types', async (req, res) => {
    try {
        const types = await req.prisma.fabricType.findMany({
            include: {
                fabrics: { where: { isActive: true } },
            },
            orderBy: { name: 'asc' },
        });
        res.json(types);
    } catch (error) {
        console.error('Get fabric types error:', error);
        res.status(500).json({ error: 'Failed to fetch fabric types' });
    }
});

// Create fabric type
router.post('/types', authenticateToken, async (req, res) => {
    try {
        const { name, composition, unit, avgShrinkagePct } = req.body;

        const fabricType = await req.prisma.fabricType.create({
            data: { name, composition, unit, avgShrinkagePct: avgShrinkagePct || 0 },
        });

        res.status(201).json(fabricType);
    } catch (error) {
        console.error('Create fabric type error:', error);
        res.status(500).json({ error: 'Failed to create fabric type' });
    }
});

// ============================================
// FABRICS
// ============================================

// Get all fabrics with balance
router.get('/', async (req, res) => {
    try {
        const { fabricTypeId, supplierId, isActive, search } = req.query;

        const where = {};
        if (fabricTypeId) where.fabricTypeId = fabricTypeId;
        if (supplierId) where.supplierId = supplierId;
        if (isActive !== undefined) where.isActive = isActive === 'true';
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { colorName: { contains: search, mode: 'insensitive' } },
            ];
        }

        const fabrics = await req.prisma.fabric.findMany({
            where,
            include: {
                fabricType: true,
                supplier: true,
            },
            orderBy: { name: 'asc' },
        });

        // Calculate balances
        const fabricsWithBalance = await Promise.all(
            fabrics.map(async (fabric) => {
                const balance = await calculateFabricBalance(req.prisma, fabric.id);
                return { ...fabric, ...balance };
            })
        );

        res.json(fabricsWithBalance);
    } catch (error) {
        console.error('Get fabrics error:', error);
        res.status(500).json({ error: 'Failed to fetch fabrics' });
    }
});

// Get single fabric with details
router.get('/:id', async (req, res) => {
    try {
        const fabric = await req.prisma.fabric.findUnique({
            where: { id: req.params.id },
            include: {
                fabricType: true,
                supplier: true,
            },
        });

        if (!fabric) {
            return res.status(404).json({ error: 'Fabric not found' });
        }

        const balance = await calculateFabricBalance(req.prisma, fabric.id);
        res.json({ ...fabric, ...balance });
    } catch (error) {
        console.error('Get fabric error:', error);
        res.status(500).json({ error: 'Failed to fetch fabric' });
    }
});

// Create fabric
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { fabricTypeId, name, colorName, standardColor, colorHex, costPerUnit, supplierId, leadTimeDays, minOrderQty } = req.body;

        const fabric = await req.prisma.fabric.create({
            data: {
                fabricTypeId,
                name,
                colorName,
                standardColor: standardColor || null,
                colorHex,
                costPerUnit,
                supplierId,
                leadTimeDays: leadTimeDays || 14,
                minOrderQty: minOrderQty || 10,
            },
            include: {
                fabricType: true,
                supplier: true,
            },
        });

        res.status(201).json(fabric);
    } catch (error) {
        console.error('Create fabric error:', error);
        res.status(500).json({ error: 'Failed to create fabric' });
    }
});

// Update fabric
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { name, colorName, standardColor, colorHex, costPerUnit, supplierId, leadTimeDays, minOrderQty, isActive } = req.body;

        const fabric = await req.prisma.fabric.update({
            where: { id: req.params.id },
            data: { name, colorName, standardColor: standardColor || null, colorHex, costPerUnit, supplierId, leadTimeDays, minOrderQty, isActive },
            include: {
                fabricType: true,
                supplier: true,
            },
        });

        res.json(fabric);
    } catch (error) {
        console.error('Update fabric error:', error);
        res.status(500).json({ error: 'Failed to update fabric' });
    }
});

// ============================================
// FABRIC TRANSACTIONS
// ============================================

// Get transactions for a fabric
router.get('/:id/transactions', async (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;

        const transactions = await req.prisma.fabricTransaction.findMany({
            where: { fabricId: req.params.id },
            include: {
                createdBy: { select: { id: true, name: true } },
                supplier: { select: { id: true, name: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
            skip: Number(offset),
        });

        res.json(transactions);
    } catch (error) {
        console.error('Get fabric transactions error:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// Create fabric transaction (inward/outward)
router.post('/:id/transactions', authenticateToken, async (req, res) => {
    try {
        const { txnType, qty, unit, reason, referenceId, notes, costPerUnit, supplierId } = req.body;

        const transaction = await req.prisma.fabricTransaction.create({
            data: {
                fabricId: req.params.id,
                txnType,
                qty,
                unit,
                reason,
                referenceId,
                notes,
                costPerUnit: costPerUnit || null,
                supplierId: supplierId || null,
                createdById: req.user.id,
            },
            include: {
                createdBy: { select: { id: true, name: true } },
                supplier: { select: { id: true, name: true } },
            },
        });

        res.status(201).json(transaction);
    } catch (error) {
        console.error('Create fabric transaction error:', error);
        res.status(500).json({ error: 'Failed to create transaction' });
    }
});

// ============================================
// FABRIC BALANCE DASHBOARD
// ============================================

// Get fabric stock analysis (with reorder recommendations)
router.get('/dashboard/stock-analysis', async (req, res) => {
    try {
        const fabrics = await req.prisma.fabric.findMany({
            where: { isActive: true },
            include: { fabricType: true, supplier: true },
        });

        const analysis = await Promise.all(
            fabrics.map(async (fabric) => {
                const balance = await calculateFabricBalance(req.prisma, fabric.id);
                const avgDailyConsumption = await calculateAvgDailyConsumption(req.prisma, fabric.id);

                const daysOfStock = avgDailyConsumption > 0
                    ? balance.currentBalance / avgDailyConsumption
                    : null;

                const reorderPoint = avgDailyConsumption * (fabric.leadTimeDays + 7);

                let status = 'OK';
                if (balance.currentBalance <= reorderPoint) {
                    status = 'ORDER NOW';
                } else if (balance.currentBalance <= avgDailyConsumption * (fabric.leadTimeDays + 14)) {
                    status = 'ORDER SOON';
                }

                const suggestedOrderQty = Math.max(
                    Number(fabric.minOrderQty),
                    (avgDailyConsumption * 30) - balance.currentBalance + (avgDailyConsumption * fabric.leadTimeDays)
                );

                return {
                    fabricId: fabric.id,
                    fabricName: fabric.name,
                    colorName: fabric.colorName,
                    unit: fabric.fabricType.unit,
                    currentBalance: balance.currentBalance.toFixed(2),
                    avgDailyConsumption: avgDailyConsumption.toFixed(3),
                    daysOfStock: daysOfStock ? Math.floor(daysOfStock) : null,
                    reorderPoint: reorderPoint.toFixed(2),
                    status,
                    suggestedOrderQty: Math.ceil(suggestedOrderQty),
                    leadTimeDays: fabric.leadTimeDays,
                    costPerUnit: fabric.costPerUnit,
                    supplier: fabric.supplier?.name || 'No supplier',
                };
            })
        );

        // Sort by status priority
        const statusOrder = { 'ORDER NOW': 0, 'ORDER SOON': 1, 'OK': 2 };
        analysis.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

        res.json(analysis);
    } catch (error) {
        console.error('Get stock analysis error:', error);
        res.status(500).json({ error: 'Failed to fetch stock analysis' });
    }
});

// ============================================
// SUPPLIERS
// ============================================

router.get('/suppliers/all', async (req, res) => {
    try {
        const suppliers = await req.prisma.supplier.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
        });
        res.json(suppliers);
    } catch (error) {
        console.error('Get suppliers error:', error);
        res.status(500).json({ error: 'Failed to fetch suppliers' });
    }
});

router.post('/suppliers', authenticateToken, async (req, res) => {
    try {
        const { name, contactName, email, phone, address } = req.body;

        const supplier = await req.prisma.supplier.create({
            data: { name, contactName, email, phone, address },
        });

        res.status(201).json(supplier);
    } catch (error) {
        console.error('Create supplier error:', error);
        res.status(500).json({ error: 'Failed to create supplier' });
    }
});

// ============================================
// FABRIC ORDERS
// ============================================

router.get('/orders/all', async (req, res) => {
    try {
        const { status } = req.query;
        const where = status ? { status } : {};

        const orders = await req.prisma.fabricOrder.findMany({
            where,
            include: {
                fabric: { include: { fabricType: true } },
                supplier: true,
            },
            orderBy: { orderDate: 'desc' },
        });

        res.json(orders);
    } catch (error) {
        console.error('Get fabric orders error:', error);
        res.status(500).json({ error: 'Failed to fetch fabric orders' });
    }
});

router.post('/orders', authenticateToken, async (req, res) => {
    try {
        const { fabricId, supplierId, qtyOrdered, unit, costPerUnit, expectedDate, notes } = req.body;

        const totalCost = Number(qtyOrdered) * Number(costPerUnit);

        const order = await req.prisma.fabricOrder.create({
            data: {
                fabricId,
                supplierId,
                qtyOrdered,
                unit,
                costPerUnit,
                totalCost,
                expectedDate: expectedDate ? new Date(expectedDate) : null,
                notes,
            },
            include: {
                fabric: true,
                supplier: true,
            },
        });

        res.status(201).json(order);
    } catch (error) {
        console.error('Create fabric order error:', error);
        res.status(500).json({ error: 'Failed to create fabric order' });
    }
});

// Mark fabric order received (creates inward transaction)
router.post('/orders/:id/receive', authenticateToken, async (req, res) => {
    try {
        const { qtyReceived, notes } = req.body;

        const order = await req.prisma.fabricOrder.findUnique({
            where: { id: req.params.id },
            include: { fabric: { include: { fabricType: true } } },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Update order
        const updatedOrder = await req.prisma.fabricOrder.update({
            where: { id: req.params.id },
            data: {
                qtyReceived,
                receivedDate: new Date(),
                status: Number(qtyReceived) >= Number(order.qtyOrdered) ? 'received' : 'partial',
                notes: notes || order.notes,
            },
        });

        // Create inward transaction
        await req.prisma.fabricTransaction.create({
            data: {
                fabricId: order.fabricId,
                txnType: 'inward',
                qty: qtyReceived,
                unit: order.unit,
                reason: 'supplier_receipt',
                referenceId: order.id,
                notes: `Received against PO ${order.id}`,
                createdById: req.user.id,
            },
        });

        res.json(updatedOrder);
    } catch (error) {
        console.error('Receive fabric order error:', error);
        res.status(500).json({ error: 'Failed to receive order' });
    }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

async function calculateFabricBalance(prisma, fabricId) {
    const result = await prisma.fabricTransaction.groupBy({
        by: ['txnType'],
        where: { fabricId },
        _sum: { qty: true },
    });

    let totalInward = 0;
    let totalOutward = 0;

    result.forEach((r) => {
        if (r.txnType === 'inward') {
            totalInward = Number(r._sum.qty) || 0;
        } else {
            totalOutward = Number(r._sum.qty) || 0;
        }
    });

    return {
        totalInward,
        totalOutward,
        currentBalance: totalInward - totalOutward,
    };
}

async function calculateAvgDailyConsumption(prisma, fabricId) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 28);

    const result = await prisma.fabricTransaction.aggregate({
        where: {
            fabricId,
            txnType: 'outward',
            createdAt: { gte: thirtyDaysAgo },
        },
        _sum: { qty: true },
    });

    const totalConsumption = Number(result._sum.qty) || 0;
    return totalConsumption / 28;
}

export default router;
