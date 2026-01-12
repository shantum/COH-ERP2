/**
 * @fileoverview Fabric Inventory Routes - Ledger-based fabric tracking and procurement
 *
 * Fabric Hierarchy:
 * - FabricType: Material category (e.g., "Cotton", "Silk") with default costs
 * - Fabric: Specific color (e.g., "Red Cotton") with optional cost overrides
 *
 * Balance Calculation:
 * - Balance = SUM(inward) - SUM(outward)
 * - Inward: Supplier receipts, reconciliation adjustments
 * - Outward: Production consumption, reconciliation adjustments
 *
 * Cost Cascade (Fabric → FabricType):
 * - Fabric.costPerUnit ?? FabricType.defaultCostPerUnit
 * - Null at Fabric level = inherit from FabricType
 * - Same pattern for leadTimeDays and minOrderQty
 *
 * Key Endpoints:
 * - /flat: AG-Grid optimized endpoint with view='type'|'color'
 * - /reconciliation/*: Physical count workflow with variance tracking
 * - /dashboard/stock-analysis: Reorder point calculations
 *
 * Gotchas:
 * - Default fabric type is protected (cannot rename or add colors)
 * - Deleting fabric reassigns variations to Default fabric
 * - /flat endpoint uses chunkProcess (batch size 5) to prevent connection pool exhaustion
 * - Reconciliation creates adjustment transactions (inward for +ve variance, outward for -ve)
 */

import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { calculateFabricBalance } from '../utils/queryPatterns.js';
import { chunkProcess } from '../utils/asyncUtils.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError, ValidationError, BusinessLogicError } from '../utils/errors.js';

const router = Router();

// ============================================
// FABRIC TYPES
// ============================================

// Get all fabric types (only those with active fabrics)
router.get('/types', authenticateToken, asyncHandler(async (req, res) => {
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
}));

// Create fabric type
router.post('/types', authenticateToken, requirePermission('fabrics:edit:type'), asyncHandler(async (req, res) => {
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
}));

// Update fabric type
router.put('/types/:id', authenticateToken, requirePermission('fabrics:edit:type'), asyncHandler(async (req, res) => {
    const { name, composition, unit, avgShrinkagePct, defaultCostPerUnit, defaultLeadTimeDays, defaultMinOrderQty } = req.body;

    // Don't allow renaming the Default fabric type
    const existing = await req.prisma.fabricType.findUnique({ where: { id: req.params.id } });
    if (existing?.name === 'Default' && name && name !== 'Default') {
        throw new BusinessLogicError('Cannot rename the Default fabric type', 'protected_resource');
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
}));

// ============================================
// FABRICS
// ============================================

/**
 * GET /flat
 * AG-Grid optimized endpoint with dual view modes (type vs color).
 *
 * @param {string} [view='color'] - 'type' for aggregated FabricType rows, 'color' for Fabric rows
 * @param {string} [search] - Search fabric/type name (database-level)
 * @param {string} [status] - Filter by stock status: 'low' (ORDER NOW/SOON) or 'ok'
 * @param {string} [fabricTypeId] - Filter colors by fabric type (color view only)
 * @returns {Object} {items: Array, summary: Object}
 *
 * Type View:
 * - Returns aggregated FabricType data (excludes Default type)
 * - Includes colorCount, default costs
 * - Flag: isTypeRow=true
 *
 * Color View:
 * - Returns Fabric-level data with inheritance applied
 * - Calculates stock status (ORDER NOW/SOON/OK) based on reorder points
 * - Includes effective values (inherited from type) and raw values
 * - Flag: isTypeRow=false
 *
 * Performance: Uses chunkProcess (batch=5) to prevent connection pool exhaustion
 */
router.get('/flat', authenticateToken, asyncHandler(async (req, res) => {
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

            // Date ranges for consumption calculations
            const now = new Date();
            const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(now.getDate() - 7);
            const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30);

            // Build items with aggregated data
            const items = await Promise.all(
                types
                    .filter(t => t.name !== 'Default')
                    .map(async (type) => {
                        const fabricIds = type.fabrics.map(f => f.id);

                        // Skip calculations if no fabrics
                        if (fabricIds.length === 0) {
                            return {
                                fabricTypeId: type.id,
                                fabricTypeName: type.name,
                                composition: type.composition,
                                unit: type.unit,
                                avgShrinkagePct: type.avgShrinkagePct,
                                defaultCostPerUnit: type.defaultCostPerUnit,
                                defaultLeadTimeDays: type.defaultLeadTimeDays,
                                defaultMinOrderQty: type.defaultMinOrderQty,
                                colorCount: 0,
                                totalStock: 0,
                                productCount: 0,
                                consumption7d: 0,
                                consumption30d: 0,
                                isTypeRow: true,
                            };
                        }

                        // Calculate total stock (sum of all fabric balances)
                        const [inwardSum, outwardSum] = await Promise.all([
                            req.prisma.fabricTransaction.aggregate({
                                where: { fabricId: { in: fabricIds }, txnType: 'inward' },
                                _sum: { qty: true },
                            }),
                            req.prisma.fabricTransaction.aggregate({
                                where: { fabricId: { in: fabricIds }, txnType: 'outward' },
                                _sum: { qty: true },
                            }),
                        ]);
                        const totalStock = (Number(inwardSum._sum.qty) || 0) - (Number(outwardSum._sum.qty) || 0);

                        // Count products using this fabric type
                        const productCount = await req.prisma.product.count({
                            where: { fabricId: { in: fabricIds } },
                        });

                        // Calculate consumption (outward transactions) for 7d and 30d
                        const [consumption7dResult, consumption30dResult] = await Promise.all([
                            req.prisma.fabricTransaction.aggregate({
                                where: {
                                    fabricId: { in: fabricIds },
                                    txnType: 'outward',
                                    createdAt: { gte: sevenDaysAgo },
                                },
                                _sum: { qty: true },
                            }),
                            req.prisma.fabricTransaction.aggregate({
                                where: {
                                    fabricId: { in: fabricIds },
                                    txnType: 'outward',
                                    createdAt: { gte: thirtyDaysAgo },
                                },
                                _sum: { qty: true },
                            }),
                        ]);

                        return {
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
                            totalStock: Number(totalStock.toFixed(2)),
                            productCount,
                            consumption7d: Number((Number(consumption7dResult._sum.qty) || 0).toFixed(2)),
                            consumption30d: Number((Number(consumption30dResult._sum.qty) || 0).toFixed(2)),

                            // Flag to identify type-level rows
                            isTypeRow: true,
                        };
                    })
            );

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

        // Calculate balances and analysis for all fabrics (batched to prevent connection pool exhaustion)
        const items = await chunkProcess(fabrics, async (fabric) => {
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
        }, 5); // Process 5 at a time to prevent connection pool exhaustion

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
}));

// Get filter options for fabrics
router.get('/filters', authenticateToken, asyncHandler(async (req, res) => {
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
}));

// Get all fabrics with balance
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
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

    // Calculate balances (batched to prevent connection pool exhaustion)
    const fabricsWithBalance = await chunkProcess(fabrics, async (fabric) => {
        const balance = await calculateFabricBalance(req.prisma, fabric.id);
        return { ...fabric, ...balance };
    }, 5);

    res.json(fabricsWithBalance);
}));

// Get single fabric with details
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
    const fabric = await req.prisma.fabric.findUnique({
        where: { id: req.params.id },
        include: {
            fabricType: true,
            supplier: true,
        },
    });

    if (!fabric) {
        throw new NotFoundError('Fabric not found', 'Fabric', req.params.id);
    }

    const balance = await calculateFabricBalance(req.prisma, fabric.id);
    res.json({ ...fabric, ...balance });
}));

// Create fabric
router.post('/', authenticateToken, requirePermission('fabrics:edit'), asyncHandler(async (req, res) => {
    const { fabricTypeId, name, colorName, standardColor, colorHex, costPerUnit, supplierId, leadTimeDays, minOrderQty } = req.body;

    // Prevent adding colors to the Default fabric type
    const fabricType = await req.prisma.fabricType.findUnique({
        where: { id: fabricTypeId },
    });
    if (fabricType?.name === 'Default') {
        throw new BusinessLogicError('Cannot add colors to the Default fabric type', 'protected_resource');
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
}));

// Update fabric
router.put('/:id', authenticateToken, requirePermission('fabrics:edit'), asyncHandler(async (req, res) => {
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
}));

// Delete fabric (soft delete - sets isActive to false)
// Automatically reassigns any product variations to the default fabric
router.delete('/:id', authenticateToken, requirePermission('fabrics:delete'), asyncHandler(async (req, res) => {
    // Permission check replaces old admin role check

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
        throw new NotFoundError('Fabric not found', 'Fabric', req.params.id);
    }

    // Find the default fabric to reassign variations
    const defaultFabric = await req.prisma.fabric.findFirst({
        where: {
            fabricType: { name: 'Default' },
            isActive: true,
        },
    });

    if (!defaultFabric) {
        throw new BusinessLogicError('Default fabric not found. Cannot delete.', 'missing_default');
    }

    // Prevent deleting the default fabric itself
    if (fabric.id === defaultFabric.id) {
        throw new BusinessLogicError('Cannot delete the default fabric', 'protected_resource');
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
}));

// ============================================
// FABRIC TRANSACTIONS
// ============================================

// Get all fabric transactions (batch endpoint for Ledgers page)
router.get('/transactions/all', authenticateToken, asyncHandler(async (req, res) => {
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
}));

// Get transactions for a fabric
router.get('/:id/transactions', authenticateToken, asyncHandler(async (req, res) => {
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
}));

// Create fabric transaction (inward/outward)
router.post('/:id/transactions', authenticateToken, requireAnyPermission('fabrics:inward', 'fabrics:outward'), asyncHandler(async (req, res) => {
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
}));

// Delete fabric transaction (requires fabrics:delete:transaction permission)
router.delete('/transactions/:txnId', authenticateToken, requirePermission('fabrics:delete:transaction'), asyncHandler(async (req, res) => {
    // Permission check replaces old admin role check

    const transaction = await req.prisma.fabricTransaction.findUnique({
        where: { id: req.params.txnId },
    });

    if (!transaction) {
        throw new NotFoundError('Transaction not found', 'FabricTransaction', req.params.txnId);
    }

    await req.prisma.fabricTransaction.delete({
        where: { id: req.params.txnId },
    });

    res.json({ message: 'Transaction deleted', id: req.params.txnId });
}));

// ============================================
// FABRIC BALANCE DASHBOARD
// ============================================

// Get fabric stock analysis (with reorder recommendations)
router.get('/dashboard/stock-analysis', authenticateToken, asyncHandler(async (req, res) => {
    const fabrics = await req.prisma.fabric.findMany({
        where: { isActive: true },
        include: { fabricType: true, supplier: true },
    });

    const analysis = await chunkProcess(fabrics, async (fabric) => {
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
    }, 5);

    // Sort by status priority
    const statusOrder = { 'ORDER NOW': 0, 'ORDER SOON': 1, 'OK': 2 };
    analysis.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    res.json(analysis);
}));

// ============================================
// SUPPLIERS
// ============================================

router.get('/suppliers/all', authenticateToken, asyncHandler(async (req, res) => {
    const suppliers = await req.prisma.supplier.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
    });
    res.json(suppliers);
}));

router.post('/suppliers', authenticateToken, asyncHandler(async (req, res) => {
    const { name, contactName, email, phone, address } = req.body;

    const supplier = await req.prisma.supplier.create({
        data: { name, contactName, email, phone, address },
    });

    res.status(201).json(supplier);
}));

// ============================================
// FABRIC ORDERS
// ============================================

router.get('/orders/all', authenticateToken, asyncHandler(async (req, res) => {
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
}));

router.post('/orders', authenticateToken, asyncHandler(async (req, res) => {
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
}));

// Mark fabric order received (creates inward transaction)
router.post('/orders/:id/receive', authenticateToken, asyncHandler(async (req, res) => {
    const { qtyReceived, notes } = req.body;

    const order = await req.prisma.fabricOrder.findUnique({
        where: { id: req.params.id },
        include: { fabric: { include: { fabricType: true } } },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'FabricOrder', req.params.id);
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
}));

// ============================================
// FABRIC RECONCILIATION
// ============================================

// Get reconciliation history
router.get('/reconciliation/history', authenticateToken, asyncHandler(async (req, res) => {
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
}));

/**
 * POST /reconciliation/start
 * Initialize fabric reconciliation session with current system balances.
 *
 * @returns {Object} Reconciliation record with items (fabricId, systemQty)
 *
 * Creates draft reconciliation with pre-filled system quantities.
 * User enters physicalQty for each item, system calculates variance.
 */
router.post('/reconciliation/start', authenticateToken, asyncHandler(async (req, res) => {
    // Get all active fabrics with their current balances
    const fabrics = await req.prisma.fabric.findMany({
        where: { isActive: true },
        include: { fabricType: true },
        orderBy: { name: 'asc' },
    });

    // Calculate current balances (batched to prevent connection pool exhaustion)
    const fabricsWithBalance = await chunkProcess(fabrics, async (fabric) => {
        const balance = await calculateFabricBalance(req.prisma, fabric.id);
        return {
            fabricId: fabric.id,
            fabricName: fabric.name,
            colorName: fabric.colorName,
            unit: fabric.fabricType.unit,
            systemQty: balance.currentBalance,
        };
    }, 5);

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
}));

// Get a specific reconciliation
router.get('/reconciliation/:id', authenticateToken, asyncHandler(async (req, res) => {
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
        throw new NotFoundError('Reconciliation not found', 'FabricReconciliation', req.params.id);
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
}));

/**
 * PUT /reconciliation/:id
 * Update reconciliation items with physical count data.
 *
 * @param {Array<Object>} items - Array of {id, physicalQty, adjustmentReason, notes}
 * @returns {Object} Updated reconciliation with calculated variances
 *
 * Variance Calculation: variance = physicalQty - systemQty
 * Only editable in 'draft' status
 */
router.put('/reconciliation/:id', authenticateToken, asyncHandler(async (req, res) => {
    const { items } = req.body;

    const reconciliation = await req.prisma.fabricReconciliation.findUnique({
        where: { id: req.params.id },
    });

    if (!reconciliation) {
        throw new NotFoundError('Reconciliation not found', 'FabricReconciliation', req.params.id);
    }

    if (reconciliation.status !== 'draft') {
        throw new BusinessLogicError('Cannot update submitted reconciliation', 'invalid_status');
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
}));

/**
 * POST /reconciliation/:id/submit
 * Finalize reconciliation and create fabric adjustment transactions.
 *
 * @returns {Object} {status: 'submitted', adjustmentsMade: number, transactions: Array}
 *
 * Transaction Logic:
 * - variance > 0: Creates 'inward' transaction (found more than expected)
 * - variance < 0: Creates 'outward' transaction (found less than expected)
 * - variance = 0: No transaction created
 *
 * Validation:
 * - All items must have physicalQty entered
 * - Variances require adjustmentReason
 * - Only 'draft' reconciliations can be submitted
 */
router.post('/reconciliation/:id/submit', authenticateToken, asyncHandler(async (req, res) => {
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
        throw new NotFoundError('Reconciliation not found', 'FabricReconciliation', req.params.id);
    }

    if (reconciliation.status !== 'draft') {
        throw new BusinessLogicError('Reconciliation already submitted', 'invalid_status');
    }

    const transactions = [];

    // Create adjustment transactions for variances
    for (const item of reconciliation.items) {
        if (item.variance === null || item.variance === 0) continue;

        if (item.physicalQty === null) {
            throw new ValidationError(`Physical quantity not entered for ${item.fabric.name}`);
        }

        if (!item.adjustmentReason && item.variance !== 0) {
            throw new ValidationError(`Adjustment reason required for ${item.fabric.name} (variance: ${item.variance})`);
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
}));

// Delete a draft reconciliation
router.delete('/reconciliation/:id', authenticateToken, asyncHandler(async (req, res) => {
    const reconciliation = await req.prisma.fabricReconciliation.findUnique({
        where: { id: req.params.id },
    });

    if (!reconciliation) {
        throw new NotFoundError('Reconciliation not found', 'FabricReconciliation', req.params.id);
    }

    if (reconciliation.status !== 'draft') {
        throw new BusinessLogicError('Cannot delete submitted reconciliation', 'invalid_status');
    }

    await req.prisma.fabricReconciliation.delete({
        where: { id: req.params.id },
    });

    res.json({ message: 'Reconciliation deleted' });
}));

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate average daily fabric consumption over 28 days.
 * Used for reorder point calculations and stock analysis.
 *
 * @param {Object} prisma - Prisma client
 * @param {string} fabricId - Fabric ID
 * @returns {number} Average daily consumption (units/day)
 */
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
