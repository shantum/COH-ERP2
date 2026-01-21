/**
 * Fabric Color CRUD Operations
 * Handles fabric color management, listing, and analysis endpoints
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { calculateFabricBalance } from '../../utils/queryPatterns.js';
import { chunkProcess } from '../../utils/asyncUtils.js';
import { NotFoundError, BusinessLogicError } from '../../utils/errors.js';
import type {
    FabricBalance,
    FabricWithRelations,
    FabricTypeWithFabrics,
    TypeViewRow,
    ColorViewRow,
    OrderLine,
    StockStatus,
    OrderLineWithRelations,
    FabricStats,
    TypeStats,
    FabricWithCounts,
    FabricTypeWithCount,
} from './types.js';
import { statusOrder } from './types.js';

const router: Router = Router();

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate average daily fabric consumption over 28 days.
 * Used for reorder point calculations and stock analysis.
 *
 * @param prisma - Prisma client
 * @param fabricId - Fabric ID
 * @returns Average daily consumption (units/day)
 */
async function calculateAvgDailyConsumption(prisma: Request['prisma'], fabricId: string): Promise<number> {
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
router.get('/flat', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const fabricTypeId = req.query.fabricTypeId as string | undefined;
    const view = req.query.view as string | undefined;

    // Date ranges for consumption and sales calculations (shared by both views)
    const now = new Date();
    const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(now.getDate() - 7);
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30);

    // If viewing by type, return fabric types with aggregated data
    if (view === 'type') {
        const types = await req.prisma.fabricType.findMany({
            where: search ? { name: { contains: search, mode: 'insensitive' } } : {},
            include: {
                fabrics: { where: { isActive: true } },
            },
            orderBy: { name: 'asc' },
        }) as FabricTypeWithFabrics[];

            // Build items with aggregated data
            const items: TypeViewRow[] = await Promise.all(
                types
                    .filter(t => t.name !== 'Default')
                    .map(async (type): Promise<TypeViewRow> => {
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
                                sales7d: 0,
                                sales30d: 0,
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
                            where: { fabricTypeId: type.id },
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

                        // Calculate sales value (qty * unitPrice) for products with this fabric type
                        // Excludes cancelled orders and RTO orders
                        // Using raw query for multiplication since Prisma aggregate doesn't support computed fields
                        const salesBaseWhere = {
                            sku: {
                                variation: {
                                    product: { fabricTypeId: type.id },
                                },
                            },
                            order: {
                                status: { not: 'cancelled' },
                                trackingStatus: { notIn: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] },
                            },
                        };

                        const [sales7dLines, sales30dLines] = await Promise.all([
                            req.prisma.orderLine.findMany({
                                where: {
                                    ...salesBaseWhere,
                                    order: {
                                        ...salesBaseWhere.order,
                                        orderDate: { gte: sevenDaysAgo },
                                    },
                                },
                                select: { qty: true, unitPrice: true },
                            }),
                            req.prisma.orderLine.findMany({
                                where: {
                                    ...salesBaseWhere,
                                    order: {
                                        ...salesBaseWhere.order,
                                        orderDate: { gte: thirtyDaysAgo },
                                    },
                                },
                                select: { qty: true, unitPrice: true },
                            }),
                        ]) as [OrderLine[], OrderLine[]];

                        // Calculate total sales value
                        const sales7d = sales7dLines.reduce((sum, line) => sum + (line.qty * Number(line.unitPrice)), 0);
                        const sales30d = sales30dLines.reduce((sum, line) => sum + (line.qty * Number(line.unitPrice)), 0);

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
                            sales7d: Math.round(sales7d),
                            sales30d: Math.round(sales30d),

                            // Flag to identify type-level rows
                            isTypeRow: true,
                        };
                    })
            );

            return res.json({ items, summary: { total: items.length } });
        }

        // Build where clause for color view
        const where: Record<string, unknown> = { isActive: true };
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
        }) as FabricWithRelations[];

        // Calculate balances and analysis for all fabrics (batched to prevent connection pool exhaustion)
        const items: ColorViewRow[] = await chunkProcess(fabrics, async (fabric: FabricWithRelations): Promise<ColorViewRow> => {
            const balance = await calculateFabricBalance(req.prisma, fabric.id) as FabricBalance;
            const avgDailyConsumption = await calculateAvgDailyConsumption(req.prisma, fabric.id);

            // Calculate sales by specific fabric color (Variation.fabricId links to Fabric)
            const salesBaseWhere = {
                sku: {
                    variation: {
                        fabricId: fabric.id, // Specific fabric color
                    },
                },
                order: {
                    status: { not: 'cancelled' },
                    trackingStatus: { notIn: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] },
                },
            };

            const [sales7dLines, sales30dLines] = await Promise.all([
                req.prisma.orderLine.findMany({
                    where: {
                        ...salesBaseWhere,
                        order: {
                            ...salesBaseWhere.order,
                            orderDate: { gte: sevenDaysAgo },
                        },
                    },
                    select: { qty: true, unitPrice: true },
                }),
                req.prisma.orderLine.findMany({
                    where: {
                        ...salesBaseWhere,
                        order: {
                            ...salesBaseWhere.order,
                            orderDate: { gte: thirtyDaysAgo },
                        },
                    },
                    select: { qty: true, unitPrice: true },
                }),
            ]) as [OrderLine[], OrderLine[]];

            const sales7d = sales7dLines.reduce((sum, line) => sum + (line.qty * Number(line.unitPrice)), 0);
            const sales30d = sales30dLines.reduce((sum, line) => sum + (line.qty * Number(line.unitPrice)), 0);

            // Calculate effective values (inherit from type if null)
            const effectiveCost = fabric.costPerUnit ?? fabric.fabricType.defaultCostPerUnit ?? 0;
            const effectiveLeadTime = fabric.leadTimeDays ?? fabric.fabricType.defaultLeadTimeDays ?? 14;
            const effectiveMinOrder = fabric.minOrderQty ?? fabric.fabricType.defaultMinOrderQty ?? 10;

            const daysOfStock = avgDailyConsumption > 0
                ? balance.currentBalance / avgDailyConsumption
                : null;

            const reorderPoint = avgDailyConsumption * (effectiveLeadTime + 7);

            let stockStatus: StockStatus = 'OK';
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

                // Sales info (based on fabric type)
                sales7d: Math.round(sales7d),
                sales30d: Math.round(sales30d),

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
router.get('/filters', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
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
router.get('/', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const fabricTypeId = req.query.fabricTypeId as string | undefined;
    const supplierId = req.query.supplierId as string | undefined;
    const isActive = req.query.isActive as string | undefined;
    const search = req.query.search as string | undefined;

    const where: Record<string, unknown> = {};
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
    }) as FabricWithRelations[];

    // Calculate balances (batched to prevent connection pool exhaustion)
    const fabricsWithBalance = await chunkProcess(fabrics, async (fabric: FabricWithRelations) => {
        const balance = await calculateFabricBalance(req.prisma, fabric.id) as FabricBalance;
        return { ...fabric, ...balance };
    }, 5);

    res.json(fabricsWithBalance);
}));

// ============================================
// TOP FABRICS REPORT (must be before /:id route)
// ============================================

// Top fabrics by sales value - configurable time period and aggregation level
router.get('/top-fabrics', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const days = req.query.days as string | undefined ?? '30';
    const level = req.query.level as string | undefined ?? 'type';
    const limit = req.query.limit as string | undefined ?? '15';

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    // Get order lines from non-cancelled, non-RTO orders within the time period
    // Note: trackingStatus is now on OrderLine, not Order
    const orderLines = await req.prisma.orderLine.findMany({
        where: {
            order: {
                orderDate: { gte: startDate },
                status: { not: 'cancelled' },
            },
            // Exclude RTO lines (trackingStatus is now on OrderLine)
            OR: [
                { trackingStatus: null },
                { trackingStatus: { notIn: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] } },
            ],
        },
        include: {
            sku: {
                include: {
                    variation: {
                        include: {
                            product: {
                                include: { fabricType: true },
                            },
                            fabric: {
                                include: { fabricType: true },
                            },
                        },
                    },
                },
            },
        },
    }) as unknown as OrderLineWithRelations[];

    if (level === 'color') {
        // Aggregate at specific fabric color level
        const fabricStats: Record<string, FabricStats> = {};
        for (const line of orderLines) {
            const fabric = line.sku?.variation?.fabric;
            if (!fabric) continue;

            const key = fabric.id;
            if (!fabricStats[key]) {
                fabricStats[key] = {
                    id: fabric.id,
                    name: fabric.colorName,
                    colorHex: fabric.colorHex || null,
                    typeName: fabric.fabricType?.name || 'Unknown',
                    composition: fabric.fabricType?.composition || null,
                    units: 0,
                    revenue: 0,
                    orderCount: new Set(),
                    productCount: new Set(),
                };
            }
            fabricStats[key].units += line.qty;
            fabricStats[key].revenue += line.qty * Number(line.unitPrice);
            fabricStats[key].orderCount.add(line.orderId);
            if (line.sku?.variation?.product?.id) {
                fabricStats[key].productCount.add(line.sku.variation.product.id);
            }
        }

        const result = Object.values(fabricStats)
            .map(f => ({
                ...f,
                orderCount: f.orderCount.size,
                productCount: f.productCount.size,
            }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, Number(limit));

        return res.json({ level: 'color', days: Number(days), data: result });
    } else {
        // Aggregate at fabric type level
        const typeStats: Record<string, TypeStats> = {};
        for (const line of orderLines) {
            // Try to get fabric type from variation's fabric, fallback to product's fabricType
            const fabricType = line.sku?.variation?.fabric?.fabricType
                || line.sku?.variation?.product?.fabricType;
            if (!fabricType) continue;

            const key = fabricType.id;
            if (!typeStats[key]) {
                typeStats[key] = {
                    id: fabricType.id,
                    name: fabricType.name,
                    composition: fabricType.composition,
                    units: 0,
                    revenue: 0,
                    orderCount: new Set(),
                    productCount: new Set(),
                    colors: {},
                };
            }
            typeStats[key].units += line.qty;
            typeStats[key].revenue += line.qty * Number(line.unitPrice);
            typeStats[key].orderCount.add(line.orderId);
            if (line.sku?.variation?.product?.id) {
                typeStats[key].productCount.add(line.sku.variation.product.id);
            }

            // Track top colors within this type
            const fabric = line.sku?.variation?.fabric;
            if (fabric) {
                if (!typeStats[key].colors[fabric.id]) {
                    typeStats[key].colors[fabric.id] = { name: fabric.colorName, revenue: 0 };
                }
                typeStats[key].colors[fabric.id].revenue += line.qty * Number(line.unitPrice);
            }
        }

        const result = Object.values(typeStats)
            .map(t => {
                const topColors = Object.values(t.colors)
                    .sort((a, b) => b.revenue - a.revenue)
                    .slice(0, 3)
                    .map(c => c.name);
                return {
                    id: t.id,
                    name: t.name,
                    composition: t.composition,
                    units: t.units,
                    revenue: t.revenue,
                    orderCount: t.orderCount.size,
                    productCount: t.productCount.size,
                    topColors,
                };
            })
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, Number(limit));

        return res.json({ level: 'type', days: Number(days), data: result });
    }
}));

// Get single fabric with details
router.get('/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const fabric = await req.prisma.fabric.findUnique({
        where: { id },
        include: {
            fabricType: true,
            supplier: true,
        },
    });

    if (!fabric) {
        throw new NotFoundError('Fabric not found', 'Fabric', id);
    }

    const balance = await calculateFabricBalance(req.prisma, fabric.id) as FabricBalance;
    res.json({ ...fabric, ...balance });
}));

// Create fabric
router.post('/', authenticateToken, requirePermission('fabrics:edit'), asyncHandler(async (req: Request, res: Response) => {
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
router.put('/:id', authenticateToken, requirePermission('fabrics:edit'), asyncHandler(async (req: Request, res: Response) => {
    const { name, colorName, standardColor, colorHex, costPerUnit, supplierId, leadTimeDays, minOrderQty, isActive, inheritCost, inheritLeadTime, inheritMinOrder } = req.body;
    const id = req.params.id as string;

    // Build update data - allow setting to null for inheritance
    const updateData: Record<string, unknown> = {
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
        where: { id },
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
router.delete('/:id', authenticateToken, requirePermission('fabrics:delete'), asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    // Permission check replaces old admin role check

    const fabric = await req.prisma.fabric.findUnique({
        where: { id },
        include: {
            _count: {
                select: {
                    transactions: true,
                    variations: true,
                },
            },
        },
    }) as FabricWithCounts | null;

    if (!fabric) {
        throw new NotFoundError('Fabric not found', 'Fabric', id);
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
            where: { fabricId: id },
            data: { fabricId: defaultFabric.id },
        });
        variationsReassigned = result.count;
    }

    // Soft delete - set isActive to false
    await req.prisma.fabric.update({
        where: { id },
        data: { isActive: false },
    });

    // Check if fabric type has any remaining active fabrics
    // If not, delete the fabric type (except Default)
    let fabricTypeDeleted = false;
    const fabricTypeRecord = await req.prisma.fabricType.findUnique({
        where: { id: fabric.fabricTypeId },
        include: {
            _count: {
                select: {
                    fabrics: { where: { isActive: true } },
                },
            },
        },
    }) as FabricTypeWithCount | null;

    if (fabricTypeRecord && fabricTypeRecord.name !== 'Default' && fabricTypeRecord._count.fabrics === 0) {
        await req.prisma.fabricType.delete({
            where: { id: fabric.fabricTypeId },
        });
        fabricTypeDeleted = true;
    }

    res.json({
        message: 'Fabric deleted',
        id,
        hadTransactions: fabric._count.transactions > 0,
        variationsReassigned,
        fabricTypeDeleted,
    });
}));

export default router;
