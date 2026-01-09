import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { calculateFabricBalance } from '../utils/queryPatterns.js';

const router = Router();

// ============================================
// FABRIC TYPES
// ============================================

// Get all fabric types (only those with active fabrics)
router.get('/types', authenticateToken, async (req, res) => {
    try {
        const types = await req.prisma.fabricType.findMany({
            where: {
                fabrics: {
                    some: { isActive: true },
                },
            },
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
        const { name, composition, unit, avgShrinkagePct, defaultCostPerUnit, defaultLeadTimeDays, defaultMinOrderQty } = req.body;

        const fabricType = await req.prisma.fabricType.create({
            data: {
                name,
                composition,
                unit,
                avgShrinkagePct: avgShrinkagePct || 0,
                defaultCostPerUnit: defaultCostPerUnit || null,
                defaultLeadTimeDays: defaultLeadTimeDays || null,
                defaultMinOrderQty: defaultMinOrderQty || null,
            },
        });

        res.status(201).json(fabricType);
    } catch (error) {
        console.error('Create fabric type error:', error);
        res.status(500).json({ error: 'Failed to create fabric type' });
    }
});

// Update fabric type
router.put('/types/:id', authenticateToken, async (req, res) => {
    try {
        const { name, composition, unit, avgShrinkagePct, defaultCostPerUnit, defaultLeadTimeDays, defaultMinOrderQty } = req.body;

        // Don't allow renaming the Default fabric type
        const existing = await req.prisma.fabricType.findUnique({ where: { id: req.params.id } });
        if (existing?.name === 'Default' && name && name !== 'Default') {
            return res.status(400).json({ error: 'Cannot rename the Default fabric type' });
        }

        const fabricType = await req.prisma.fabricType.update({
            where: { id: req.params.id },
            data: {
                name,
                composition,
                unit,
                avgShrinkagePct,
                defaultCostPerUnit,
                defaultLeadTimeDays,
                defaultMinOrderQty,
            },
        });

        res.json(fabricType);
    } catch (error) {
        console.error('Update fabric type error:', error);
        res.status(500).json({ error: 'Failed to update fabric type' });
    }
});

// ============================================
// FABRICS
// ============================================

// Get all fabrics in flat format (for AG-Grid table)
router.get('/flat', authenticateToken, async (req, res) => {
    try {
        const { search, status, fabricTypeId, view } = req.query;

        // If viewing by type, return fabric types with aggregated data
        if (view === 'type') {
            const types = await req.prisma.fabricType.findMany({
                where: search ? { name: { contains: search, mode: 'insensitive' } } : {},
                include: {
                    fabrics: { where: { isActive: true } },
                },
                orderBy: { name: 'asc' },
            });

            const items = types
                .filter(t => t.name !== 'Default')
                .map(type => ({
                    // Type identifiers
                    fabricTypeId: type.id,
                    fabricTypeName: type.name,
                    composition: type.composition,
                    unit: type.unit,
                    avgShrinkagePct: type.avgShrinkagePct,

                    // Default values (editable at type level)
                    defaultCostPerUnit: type.defaultCostPerUnit,
                    defaultLeadTimeDays: type.defaultLeadTimeDays,
                    defaultMinOrderQty: type.defaultMinOrderQty,

                    // Aggregated info
                    colorCount: type.fabrics.length,

                    // Flag to identify type-level rows
                    isTypeRow: true,
                }));

            return res.json({ items, summary: { total: items.length } });
        }

        // Build where clause for color view
        const where = { isActive: true };
        if (fabricTypeId) where.fabricTypeId = fabricTypeId;
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { colorName: { contains: search, mode: 'insensitive' } },
                { fabricType: { name: { contains: search, mode: 'insensitive' } } },
            ];
        }

        const fabrics = await req.prisma.fabric.findMany({
            where,
            include: {
                fabricType: true,
                supplier: true,
            },
            orderBy: [
                { fabricType: { name: 'asc' } },
                { colorName: 'asc' },
            ],
        });

        // Calculate balances and analysis for all fabrics
        const items = await Promise.all(
            fabrics.map(async (fabric) => {
                const balance = await calculateFabricBalance(req.prisma, fabric.id);
                const avgDailyConsumption = await calculateAvgDailyConsumption(req.prisma, fabric.id);

                // Calculate effective values (inherit from type if null)
                const effectiveCost = fabric.costPerUnit ?? fabric.fabricType.defaultCostPerUnit ?? 0;
                const effectiveLeadTime = fabric.leadTimeDays ?? fabric.fabricType.defaultLeadTimeDays ?? 14;
                const effectiveMinOrder = fabric.minOrderQty ?? fabric.fabricType.defaultMinOrderQty ?? 10;

                const daysOfStock = avgDailyConsumption > 0
                    ? balance.currentBalance / avgDailyConsumption
                    : null;

                const reorderPoint = avgDailyConsumption * (effectiveLeadTime + 7);

                let stockStatus = 'OK';
                if (balance.currentBalance <= reorderPoint) {
                    stockStatus = 'ORDER NOW';
                } else if (balance.currentBalance <= avgDailyConsumption * (effectiveLeadTime + 14)) {
                    stockStatus = 'ORDER SOON';
                }

                const suggestedOrderQty = Math.max(
                    Number(effectiveMinOrder),
                    Math.ceil((avgDailyConsumption * 30) - balance.currentBalance + (avgDailyConsumption * effectiveLeadTime))
                );

                return {
                    // Fabric identifiers
                    fabricId: fabric.id,
                    colorName: fabric.colorName,
                    colorHex: fabric.colorHex,
                    standardColor: fabric.standardColor,

                    // Fabric Type info
                    fabricTypeId: fabric.fabricType.id,
                    fabricTypeName: fabric.fabricType.name,
                    composition: fabric.fabricType.composition,
                    unit: fabric.fabricType.unit,
                    avgShrinkagePct: fabric.fabricType.avgShrinkagePct,

                    // Supplier info
                    supplierId: fabric.supplier?.id || null,
                    supplierName: fabric.supplier?.name || null,

                    // Pricing & Lead time - raw values (null = inherited)
                    costPerUnit: fabric.costPerUnit,
                    leadTimeDays: fabric.leadTimeDays,
                    minOrderQty: fabric.minOrderQty,

                    // Effective values (with inheritance applied)
                    effectiveCostPerUnit: effectiveCost,
                    effectiveLeadTimeDays: effectiveLeadTime,
                    effectiveMinOrderQty: effectiveMinOrder,

                    // Inheritance flags
                    costInherited: fabric.costPerUnit === null,
                    leadTimeInherited: fabric.leadTimeDays === null,
                    minOrderInherited: fabric.minOrderQty === null,

                    // Type defaults (for UI reference)
                    typeCostPerUnit: fabric.fabricType.defaultCostPerUnit,
                    typeLeadTimeDays: fabric.fabricType.defaultLeadTimeDays,
                    typeMinOrderQty: fabric.fabricType.defaultMinOrderQty,

                    // Stock info
                    currentBalance: Number(balance.currentBalance.toFixed(2)),
                    totalInward: Number(balance.totalInward.toFixed(2)),
                    totalOutward: Number(balance.totalOutward.toFixed(2)),
                    avgDailyConsumption: Number(avgDailyConsumption.toFixed(3)),
                    daysOfStock: daysOfStock ? Math.floor(daysOfStock) : null,
                    reorderPoint: Number(reorderPoint.toFixed(2)),
                    stockStatus,
                    suggestedOrderQty: suggestedOrderQty > 0 ? suggestedOrderQty : 0,

                    // Flag to identify color-level rows
                    isTypeRow: false,
                };
            })
        );

        // Filter by status if provided
        let filteredItems = items;
        if (status === 'low') {
            filteredItems = items.filter(item => item.stockStatus !== 'OK');
        } else if (status === 'ok') {
            filteredItems = items.filter(item => item.stockStatus === 'OK');
        }

        res.json({
            items: filteredItems,
            summary: {
                total: filteredItems.length,
                orderNow: items.filter(i => i.stockStatus === 'ORDER NOW').length,
                orderSoon: items.filter(i => i.stockStatus === 'ORDER SOON').length,
                ok: items.filter(i => i.stockStatus === 'OK').length,
            },
        });
    } catch (error) {
        console.error('Get flat fabrics error:', error);
        res.status(500).json({ error: 'Failed to fetch fabrics' });
    }
});

// Get filter options for fabrics
router.get('/filters', authenticateToken, async (req, res) => {
    try {
        // Return all fabric types (including those without fabrics yet)
        const fabricTypes = await req.prisma.fabricType.findMany({
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });

        const suppliers = await req.prisma.supplier.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });

        res.json({ fabricTypes, suppliers });
    } catch (error) {
        console.error('Get fabric filters error:', error);
        res.status(500).json({ error: 'Failed to fetch filter options' });
    }
});

// Get all fabrics with balance
router.get('/', authenticateToken, async (req, res) => {
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
router.get('/:id', authenticateToken, async (req, res) => {
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

        // Prevent adding colors to the Default fabric type
        const fabricType = await req.prisma.fabricType.findUnique({
            where: { id: fabricTypeId },
        });
        if (fabricType?.name === 'Default') {
            return res.status(400).json({ error: 'Cannot add colors to the Default fabric type' });
        }

        // Create fabric with null for inherited values (will inherit from fabric type)
        // If values are explicitly provided, use them; otherwise use null for inheritance
        const fabric = await req.prisma.fabric.create({
            data: {
                fabricTypeId,
                name,
                colorName,
                standardColor: standardColor || null,
                colorHex,
                // Use null for inheritance if not explicitly provided
                costPerUnit: costPerUnit !== undefined && costPerUnit !== '' ? costPerUnit : null,
                supplierId: supplierId || null,
                leadTimeDays: leadTimeDays !== undefined && leadTimeDays !== '' ? leadTimeDays : null,
                minOrderQty: minOrderQty !== undefined && minOrderQty !== '' ? minOrderQty : null,
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
        const { name, colorName, standardColor, colorHex, costPerUnit, supplierId, leadTimeDays, minOrderQty, isActive, inheritCost, inheritLeadTime, inheritMinOrder } = req.body;

        // Build update data - allow setting to null for inheritance
        const updateData = {
            name,
            colorName,
            standardColor: standardColor || null,
            colorHex,
            supplierId: supplierId || null,
            isActive,
        };

        // Handle cost inheritance: if inheritCost is true or costPerUnit is empty string, set to null
        if (inheritCost === true || costPerUnit === '' || costPerUnit === null) {
            updateData.costPerUnit = null;
        } else if (costPerUnit !== undefined) {
            updateData.costPerUnit = costPerUnit;
        }

        // Handle lead time inheritance
        if (inheritLeadTime === true || leadTimeDays === '' || leadTimeDays === null) {
            updateData.leadTimeDays = null;
        } else if (leadTimeDays !== undefined) {
            updateData.leadTimeDays = leadTimeDays;
        }

        // Handle min order inheritance
        if (inheritMinOrder === true || minOrderQty === '' || minOrderQty === null) {
            updateData.minOrderQty = null;
        } else if (minOrderQty !== undefined) {
            updateData.minOrderQty = minOrderQty;
        }

        const fabric = await req.prisma.fabric.update({
            where: { id: req.params.id },
            data: updateData,
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

// Delete fabric (soft delete - sets isActive to false)
// Automatically reassigns any product variations to the default fabric
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admin can delete fabrics' });
        }

        const fabric = await req.prisma.fabric.findUnique({
            where: { id: req.params.id },
            include: {
                _count: {
                    select: {
                        transactions: true,
                        variations: true,
                    },
                },
            },
        });

        if (!fabric) {
            return res.status(404).json({ error: 'Fabric not found' });
        }

        // Find the default fabric to reassign variations
        const defaultFabric = await req.prisma.fabric.findFirst({
            where: {
                fabricType: { name: 'Default' },
                isActive: true,
            },
        });

        if (!defaultFabric) {
            return res.status(500).json({ error: 'Default fabric not found. Cannot delete.' });
        }

        // Prevent deleting the default fabric itself
        if (fabric.id === defaultFabric.id) {
            return res.status(400).json({ error: 'Cannot delete the default fabric' });
        }

        let variationsReassigned = 0;

        // Reassign any variations using this fabric to the default fabric
        if (fabric._count.variations > 0) {
            const result = await req.prisma.variation.updateMany({
                where: { fabricId: req.params.id },
                data: { fabricId: defaultFabric.id },
            });
            variationsReassigned = result.count;
        }

        // Soft delete - set isActive to false
        await req.prisma.fabric.update({
            where: { id: req.params.id },
            data: { isActive: false },
        });

        // Check if fabric type has any remaining active fabrics
        // If not, delete the fabric type (except Default)
        let fabricTypeDeleted = false;
        const fabricType = await req.prisma.fabricType.findUnique({
            where: { id: fabric.fabricTypeId },
            include: {
                _count: {
                    select: {
                        fabrics: { where: { isActive: true } },
                    },
                },
            },
        });

        if (fabricType && fabricType.name !== 'Default' && fabricType._count.fabrics === 0) {
            await req.prisma.fabricType.delete({
                where: { id: fabric.fabricTypeId },
            });
            fabricTypeDeleted = true;
        }

        res.json({
            message: 'Fabric deleted',
            id: req.params.id,
            hadTransactions: fabric._count.transactions > 0,
            variationsReassigned,
            fabricTypeDeleted,
        });
    } catch (error) {
        console.error('Delete fabric error:', error);
        res.status(500).json({ error: 'Failed to delete fabric' });
    }
});

// ============================================
// FABRIC TRANSACTIONS
// ============================================

// Get all fabric transactions (batch endpoint for Ledgers page)
router.get('/transactions/all', authenticateToken, async (req, res) => {
    try {
        const { limit = 500, days = 30 } = req.query;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - Number(days));

        const transactions = await req.prisma.fabricTransaction.findMany({
            where: {
                createdAt: { gte: startDate }
            },
            include: {
                fabric: {
                    select: {
                        id: true,
                        name: true,
                        colorName: true,
                        fabricType: { select: { id: true, name: true } }
                    }
                },
                createdBy: { select: { id: true, name: true } },
                supplier: { select: { id: true, name: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
        });

        res.json(transactions);
    } catch (error) {
        console.error('Get all fabric transactions error:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// Get transactions for a fabric
router.get('/:id/transactions', authenticateToken, async (req, res) => {
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

// Delete fabric transaction (admin only)
router.delete('/transactions/:txnId', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admin can delete transactions' });
        }

        const transaction = await req.prisma.fabricTransaction.findUnique({
            where: { id: req.params.txnId },
        });

        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        await req.prisma.fabricTransaction.delete({
            where: { id: req.params.txnId },
        });

        res.json({ message: 'Transaction deleted', id: req.params.txnId });
    } catch (error) {
        console.error('Delete fabric transaction error:', error);
        res.status(500).json({ error: 'Failed to delete transaction' });
    }
});

// ============================================
// FABRIC BALANCE DASHBOARD
// ============================================

// Get fabric stock analysis (with reorder recommendations)
router.get('/dashboard/stock-analysis', authenticateToken, async (req, res) => {
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

router.get('/suppliers/all', authenticateToken, async (req, res) => {
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

router.get('/orders/all', authenticateToken, async (req, res) => {
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
// FABRIC RECONCILIATION
// ============================================

// Get reconciliation history
router.get('/reconciliation/history', authenticateToken, async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const reconciliations = await req.prisma.fabricReconciliation.findMany({
            include: {
                items: true,
            },
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
        });

        const history = reconciliations.map(r => ({
            id: r.id,
            date: r.reconcileDate,
            status: r.status,
            itemsCount: r.items.length,
            adjustments: r.items.filter(i => i.variance !== 0 && i.variance !== null).length,
            createdBy: r.createdBy,
            createdAt: r.createdAt,
        }));

        res.json(history);
    } catch (error) {
        console.error('Get reconciliation history error:', error);
        res.status(500).json({ error: 'Failed to fetch reconciliation history' });
    }
});

// Start a new reconciliation
router.post('/reconciliation/start', authenticateToken, async (req, res) => {
    try {
        // Get all active fabrics with their current balances
        const fabrics = await req.prisma.fabric.findMany({
            where: { isActive: true },
            include: { fabricType: true },
            orderBy: { name: 'asc' },
        });

        // Calculate current balances
        const fabricsWithBalance = await Promise.all(
            fabrics.map(async (fabric) => {
                const balance = await calculateFabricBalance(req.prisma, fabric.id);
                return {
                    fabricId: fabric.id,
                    fabricName: fabric.name,
                    colorName: fabric.colorName,
                    unit: fabric.fabricType.unit,
                    systemQty: balance.currentBalance,
                };
            })
        );

        // Create reconciliation record
        const reconciliation = await req.prisma.fabricReconciliation.create({
            data: {
                createdBy: req.user?.id || null,
                items: {
                    create: fabricsWithBalance.map(f => ({
                        fabricId: f.fabricId,
                        systemQty: f.systemQty,
                    })),
                },
            },
            include: {
                items: {
                    include: {
                        fabric: { include: { fabricType: true } },
                    },
                },
            },
        });

        // Format response
        const response = {
            id: reconciliation.id,
            status: reconciliation.status,
            createdAt: reconciliation.createdAt,
            items: reconciliation.items.map(item => ({
                id: item.id,
                fabricId: item.fabricId,
                fabricName: item.fabric.name,
                colorName: item.fabric.colorName,
                unit: item.fabric.fabricType.unit,
                systemQty: item.systemQty,
                physicalQty: item.physicalQty,
                variance: item.variance,
                adjustmentReason: item.adjustmentReason,
                notes: item.notes,
            })),
        };

        res.status(201).json(response);
    } catch (error) {
        console.error('Start reconciliation error:', error);
        res.status(500).json({ error: 'Failed to start reconciliation' });
    }
});

// Get a specific reconciliation
router.get('/reconciliation/:id', authenticateToken, async (req, res) => {
    try {
        const reconciliation = await req.prisma.fabricReconciliation.findUnique({
            where: { id: req.params.id },
            include: {
                items: {
                    include: {
                        fabric: { include: { fabricType: true } },
                    },
                },
            },
        });

        if (!reconciliation) {
            return res.status(404).json({ error: 'Reconciliation not found' });
        }

        const response = {
            id: reconciliation.id,
            status: reconciliation.status,
            notes: reconciliation.notes,
            createdAt: reconciliation.createdAt,
            items: reconciliation.items.map(item => ({
                id: item.id,
                fabricId: item.fabricId,
                fabricName: item.fabric.name,
                colorName: item.fabric.colorName,
                unit: item.fabric.fabricType.unit,
                systemQty: item.systemQty,
                physicalQty: item.physicalQty,
                variance: item.variance,
                adjustmentReason: item.adjustmentReason,
                notes: item.notes,
            })),
        };

        res.json(response);
    } catch (error) {
        console.error('Get reconciliation error:', error);
        res.status(500).json({ error: 'Failed to fetch reconciliation' });
    }
});

// Update reconciliation items (physical quantities)
router.put('/reconciliation/:id', authenticateToken, async (req, res) => {
    try {
        const { items } = req.body;

        const reconciliation = await req.prisma.fabricReconciliation.findUnique({
            where: { id: req.params.id },
        });

        if (!reconciliation) {
            return res.status(404).json({ error: 'Reconciliation not found' });
        }

        if (reconciliation.status !== 'draft') {
            return res.status(400).json({ error: 'Cannot update submitted reconciliation' });
        }

        // Update each item
        for (const item of items) {
            const variance = item.physicalQty !== null && item.physicalQty !== undefined
                ? item.physicalQty - item.systemQty
                : null;

            await req.prisma.fabricReconciliationItem.update({
                where: { id: item.id },
                data: {
                    physicalQty: item.physicalQty,
                    variance,
                    adjustmentReason: item.adjustmentReason || null,
                    notes: item.notes || null,
                },
            });
        }

        // Return updated reconciliation
        const updated = await req.prisma.fabricReconciliation.findUnique({
            where: { id: req.params.id },
            include: {
                items: {
                    include: {
                        fabric: { include: { fabricType: true } },
                    },
                },
            },
        });

        res.json({
            id: updated.id,
            status: updated.status,
            items: updated.items.map(item => ({
                id: item.id,
                fabricId: item.fabricId,
                fabricName: item.fabric.name,
                colorName: item.fabric.colorName,
                unit: item.fabric.fabricType.unit,
                systemQty: item.systemQty,
                physicalQty: item.physicalQty,
                variance: item.variance,
                adjustmentReason: item.adjustmentReason,
                notes: item.notes,
            })),
        });
    } catch (error) {
        console.error('Update reconciliation error:', error);
        res.status(500).json({ error: 'Failed to update reconciliation' });
    }
});

// Submit reconciliation (creates adjustment transactions)
router.post('/reconciliation/:id/submit', authenticateToken, async (req, res) => {
    try {
        const reconciliation = await req.prisma.fabricReconciliation.findUnique({
            where: { id: req.params.id },
            include: {
                items: {
                    include: {
                        fabric: { include: { fabricType: true } },
                    },
                },
            },
        });

        if (!reconciliation) {
            return res.status(404).json({ error: 'Reconciliation not found' });
        }

        if (reconciliation.status !== 'draft') {
            return res.status(400).json({ error: 'Reconciliation already submitted' });
        }

        const transactions = [];

        // Create adjustment transactions for variances
        for (const item of reconciliation.items) {
            if (item.variance === null || item.variance === 0) continue;

            if (item.physicalQty === null) {
                return res.status(400).json({
                    error: `Physical quantity not entered for ${item.fabric.name}`,
                });
            }

            if (!item.adjustmentReason && item.variance !== 0) {
                return res.status(400).json({
                    error: `Adjustment reason required for ${item.fabric.name} (variance: ${item.variance})`,
                });
            }

            const txnType = item.variance > 0 ? 'inward' : 'outward';
            const qty = Math.abs(item.variance);
            const reason = `reconciliation_${item.adjustmentReason}`;

            const txn = await req.prisma.fabricTransaction.create({
                data: {
                    fabricId: item.fabricId,
                    txnType,
                    qty,
                    unit: item.fabric.fabricType.unit,
                    reason,
                    referenceId: reconciliation.id,
                    notes: item.notes || `Reconciliation adjustment: ${item.adjustmentReason}`,
                    createdById: req.user.id,
                },
            });

            transactions.push({
                fabricId: item.fabricId,
                fabricName: item.fabric.name,
                txnType,
                qty,
                reason: item.adjustmentReason,
            });

            // Link transaction to item
            await req.prisma.fabricReconciliationItem.update({
                where: { id: item.id },
                data: { txnId: txn.id },
            });
        }

        // Mark reconciliation as submitted
        await req.prisma.fabricReconciliation.update({
            where: { id: req.params.id },
            data: { status: 'submitted' },
        });

        res.json({
            id: reconciliation.id,
            status: 'submitted',
            adjustmentsMade: transactions.length,
            transactions,
        });
    } catch (error) {
        console.error('Submit reconciliation error:', error);
        res.status(500).json({ error: 'Failed to submit reconciliation' });
    }
});

// Delete a draft reconciliation
router.delete('/reconciliation/:id', authenticateToken, async (req, res) => {
    try {
        const reconciliation = await req.prisma.fabricReconciliation.findUnique({
            where: { id: req.params.id },
        });

        if (!reconciliation) {
            return res.status(404).json({ error: 'Reconciliation not found' });
        }

        if (reconciliation.status !== 'draft') {
            return res.status(400).json({ error: 'Cannot delete submitted reconciliation' });
        }

        await req.prisma.fabricReconciliation.delete({
            where: { id: req.params.id },
        });

        res.json({ message: 'Reconciliation deleted' });
    } catch (error) {
        console.error('Delete reconciliation error:', error);
        res.status(500).json({ error: 'Failed to delete reconciliation' });
    }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

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
