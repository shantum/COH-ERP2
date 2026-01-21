/**
 * Fabrics Query Server Functions
 *
 * TanStack Start Server Functions for querying FabricType → Fabric hierarchy.
 * Provides flat views, filters, analysis, reconciliation, and top fabrics reports.
 *
 * NOTE: This covers the legacy FabricType/Fabric model. For the new 3-tier
 * Material → Fabric → Colour hierarchy, see materials.ts.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// INPUT SCHEMAS
// ============================================

const getFabricsInputSchema = z.object({
    fabricTypeId: z.string().uuid().optional(),
    supplierId: z.string().uuid().optional(),
    isActive: z.boolean().optional(),
    search: z.string().optional(),
}).optional();

const getFabricsFlatInputSchema = z.object({
    view: z.enum(['type', 'color']).optional().default('color'),
    search: z.string().optional(),
    status: z.enum(['low', 'ok']).optional(),
    fabricTypeId: z.string().uuid().optional(),
}).optional();

const getFabricByIdInputSchema = z.object({
    id: z.string().uuid('Invalid fabric ID'),
});

const getFabricTransactionsInputSchema = z.object({
    fabricId: z.string().uuid('Invalid fabric ID'),
    limit: z.number().int().positive().optional().default(50),
    offset: z.number().int().nonnegative().optional().default(0),
});

const getAllTransactionsInputSchema = z.object({
    limit: z.number().int().positive().optional().default(500),
    days: z.number().int().positive().optional().default(30),
}).optional();

const getFabricSuppliersInputSchema = z.object({
    activeOnly: z.boolean().optional().default(true),
}).optional();

const getTopFabricsInputSchema = z.object({
    days: z.number().int().positive().optional().default(30),
    level: z.enum(['type', 'color']).optional().default('type'),
    limit: z.number().int().positive().optional().default(15),
}).optional();

const getReconciliationByIdInputSchema = z.object({
    id: z.string().uuid('Invalid reconciliation ID'),
});

const getReconciliationHistoryInputSchema = z.object({
    limit: z.number().int().positive().optional().default(10),
}).optional();

const getStockAnalysisInputSchema = z.object({}).optional();

// ============================================
// HELPER TYPES
// ============================================

type StockStatus = 'OK' | 'ORDER NOW' | 'ORDER SOON';

const statusOrder: Record<StockStatus, number> = {
    'ORDER NOW': 0,
    'ORDER SOON': 1,
    'OK': 2,
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate fabric balance from transactions
 */
async function calculateFabricBalance(
    prisma: any,
    fabricId: string
): Promise<{ currentBalance: number; totalInward: number; totalOutward: number }> {
    const [inwardSum, outwardSum] = await Promise.all([
        prisma.fabricTransaction.aggregate({
            where: { fabricId, txnType: 'inward' },
            _sum: { qty: true },
        }),
        prisma.fabricTransaction.aggregate({
            where: { fabricId, txnType: 'outward' },
            _sum: { qty: true },
        }),
    ]);

    const totalInward = Number(inwardSum._sum.qty) || 0;
    const totalOutward = Number(outwardSum._sum.qty) || 0;

    return {
        currentBalance: totalInward - totalOutward,
        totalInward,
        totalOutward,
    };
}

/**
 * Calculate average daily fabric consumption over 28 days
 */
async function calculateAvgDailyConsumption(
    prisma: any,
    fabricId: string
): Promise<number> {
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

/**
 * Process items in batches to prevent connection pool exhaustion
 */
async function chunkProcess<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    batchSize: number = 5
): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(fn));
        results.push(...batchResults);
    }
    return results;
}

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get all fabrics with balance information
 *
 * Supports filtering by fabricTypeId, supplierId, isActive, and search.
 */
export const getFabrics = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getFabricsInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const where: any = {};

            if (data?.fabricTypeId) {
                where.fabricTypeId = data.fabricTypeId;
            }
            if (data?.supplierId) {
                where.supplierId = data.supplierId;
            }
            if (data?.isActive !== undefined) {
                where.isActive = data.isActive;
            }
            if (data?.search) {
                where.OR = [
                    { name: { contains: data.search, mode: 'insensitive' } },
                    { colorName: { contains: data.search, mode: 'insensitive' } },
                ];
            }

            const fabrics = await prisma.fabric.findMany({
                where,
                include: {
                    fabricType: true,
                    supplier: true,
                },
                orderBy: { name: 'asc' },
            });

            // Calculate balances in batches
            const fabricsWithBalance = await chunkProcess(
                fabrics,
                async (fabric: any) => {
                    const balance = await calculateFabricBalance(prisma, fabric.id);
                    return { ...fabric, ...balance };
                },
                5
            );

            return {
                success: true,
                fabrics: fabricsWithBalance,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get AG-Grid optimized fabric data with dual view modes
 *
 * Type View: Aggregated FabricType rows with colorCount, stock totals, sales data
 * Color View: Individual Fabric rows with stock analysis and inheritance
 */
export const getFabricsFlat = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getFabricsFlatInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const view = data?.view ?? 'color';
            const search = data?.search;
            const status = data?.status;
            const fabricTypeId = data?.fabricTypeId;

            // Date ranges for consumption and sales calculations
            const now = new Date();
            const sevenDaysAgo = new Date(now);
            sevenDaysAgo.setDate(now.getDate() - 7);
            const thirtyDaysAgo = new Date(now);
            thirtyDaysAgo.setDate(now.getDate() - 30);

            // Type view - aggregated fabric type data
            if (view === 'type') {
                const types = await prisma.fabricType.findMany({
                    where: search
                        ? { name: { contains: search, mode: 'insensitive' } }
                        : {},
                    include: {
                        fabrics: { where: { isActive: true } },
                    },
                    orderBy: { name: 'asc' },
                });

                const items = await Promise.all(
                    types
                        .filter((t: any) => t.name !== 'Default')
                        .map(async (type: any) => {
                            const fabricIds = type.fabrics.map((f: any) => f.id);

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

                            // Calculate total stock
                            const [inwardSum, outwardSum] = await Promise.all([
                                prisma.fabricTransaction.aggregate({
                                    where: { fabricId: { in: fabricIds }, txnType: 'inward' },
                                    _sum: { qty: true },
                                }),
                                prisma.fabricTransaction.aggregate({
                                    where: { fabricId: { in: fabricIds }, txnType: 'outward' },
                                    _sum: { qty: true },
                                }),
                            ]);
                            const totalStock =
                                (Number(inwardSum._sum.qty) || 0) -
                                (Number(outwardSum._sum.qty) || 0);

                            // Count products using this fabric type
                            const productCount = await prisma.product.count({
                                where: { fabricTypeId: type.id },
                            });

                            // Calculate consumption for 7d and 30d
                            const [consumption7dResult, consumption30dResult] = await Promise.all([
                                prisma.fabricTransaction.aggregate({
                                    where: {
                                        fabricId: { in: fabricIds },
                                        txnType: 'outward',
                                        createdAt: { gte: sevenDaysAgo },
                                    },
                                    _sum: { qty: true },
                                }),
                                prisma.fabricTransaction.aggregate({
                                    where: {
                                        fabricId: { in: fabricIds },
                                        txnType: 'outward',
                                        createdAt: { gte: thirtyDaysAgo },
                                    },
                                    _sum: { qty: true },
                                }),
                            ]);

                            // Calculate sales value
                            const salesBaseWhere = {
                                sku: {
                                    variation: {
                                        product: { fabricTypeId: type.id },
                                    },
                                },
                                order: {
                                    status: { not: 'cancelled' },
                                    trackingStatus: {
                                        notIn: ['rto_initiated', 'rto_in_transit', 'rto_delivered'],
                                    },
                                },
                            };

                            const [sales7dLines, sales30dLines] = await Promise.all([
                                prisma.orderLine.findMany({
                                    where: {
                                        ...salesBaseWhere,
                                        order: {
                                            ...salesBaseWhere.order,
                                            orderDate: { gte: sevenDaysAgo },
                                        },
                                    },
                                    select: { qty: true, unitPrice: true },
                                }),
                                prisma.orderLine.findMany({
                                    where: {
                                        ...salesBaseWhere,
                                        order: {
                                            ...salesBaseWhere.order,
                                            orderDate: { gte: thirtyDaysAgo },
                                        },
                                    },
                                    select: { qty: true, unitPrice: true },
                                }),
                            ]);

                            const sales7d = sales7dLines.reduce(
                                (sum: number, line: any) =>
                                    sum + line.qty * Number(line.unitPrice),
                                0
                            );
                            const sales30d = sales30dLines.reduce(
                                (sum: number, line: any) =>
                                    sum + line.qty * Number(line.unitPrice),
                                0
                            );

                            return {
                                fabricTypeId: type.id,
                                fabricTypeName: type.name,
                                composition: type.composition,
                                unit: type.unit,
                                avgShrinkagePct: type.avgShrinkagePct,
                                defaultCostPerUnit: type.defaultCostPerUnit,
                                defaultLeadTimeDays: type.defaultLeadTimeDays,
                                defaultMinOrderQty: type.defaultMinOrderQty,
                                colorCount: type.fabrics.length,
                                totalStock: Number(totalStock.toFixed(2)),
                                productCount,
                                consumption7d: Number(
                                    (Number(consumption7dResult._sum.qty) || 0).toFixed(2)
                                ),
                                consumption30d: Number(
                                    (Number(consumption30dResult._sum.qty) || 0).toFixed(2)
                                ),
                                sales7d: Math.round(sales7d),
                                sales30d: Math.round(sales30d),
                                isTypeRow: true,
                            };
                        })
                );

                return {
                    success: true,
                    items,
                    summary: { total: items.length },
                };
            }

            // Color view - individual fabric data with stock analysis
            const where: any = { isActive: true };
            if (fabricTypeId) where.fabricTypeId = fabricTypeId;
            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { colorName: { contains: search, mode: 'insensitive' } },
                    { fabricType: { name: { contains: search, mode: 'insensitive' } } },
                ];
            }

            const fabrics = await prisma.fabric.findMany({
                where,
                include: {
                    fabricType: true,
                    supplier: true,
                },
                orderBy: [{ fabricType: { name: 'asc' } }, { colorName: 'asc' }],
            });

            const items = await chunkProcess(
                fabrics,
                async (fabric: any) => {
                    const balance = await calculateFabricBalance(prisma, fabric.id);
                    const avgDailyConsumption = await calculateAvgDailyConsumption(
                        prisma,
                        fabric.id
                    );

                    // Calculate sales by specific fabric color
                    const salesBaseWhere = {
                        sku: {
                            variation: {
                                fabricId: fabric.id,
                            },
                        },
                        order: {
                            status: { not: 'cancelled' },
                            trackingStatus: {
                                notIn: ['rto_initiated', 'rto_in_transit', 'rto_delivered'],
                            },
                        },
                    };

                    const [sales7dLines, sales30dLines] = await Promise.all([
                        prisma.orderLine.findMany({
                            where: {
                                ...salesBaseWhere,
                                order: {
                                    ...salesBaseWhere.order,
                                    orderDate: { gte: sevenDaysAgo },
                                },
                            },
                            select: { qty: true, unitPrice: true },
                        }),
                        prisma.orderLine.findMany({
                            where: {
                                ...salesBaseWhere,
                                order: {
                                    ...salesBaseWhere.order,
                                    orderDate: { gte: thirtyDaysAgo },
                                },
                            },
                            select: { qty: true, unitPrice: true },
                        }),
                    ]);

                    const sales7d = sales7dLines.reduce(
                        (sum: number, line: any) =>
                            sum + line.qty * Number(line.unitPrice),
                        0
                    );
                    const sales30d = sales30dLines.reduce(
                        (sum: number, line: any) =>
                            sum + line.qty * Number(line.unitPrice),
                        0
                    );

                    // Calculate effective values (inherit from type if null)
                    const effectiveCost =
                        fabric.costPerUnit ?? fabric.fabricType.defaultCostPerUnit ?? 0;
                    const effectiveLeadTime =
                        fabric.leadTimeDays ?? fabric.fabricType.defaultLeadTimeDays ?? 14;
                    const effectiveMinOrder =
                        fabric.minOrderQty ?? fabric.fabricType.defaultMinOrderQty ?? 10;

                    const daysOfStock =
                        avgDailyConsumption > 0
                            ? balance.currentBalance / avgDailyConsumption
                            : null;

                    const reorderPoint = avgDailyConsumption * (effectiveLeadTime + 7);

                    let stockStatus: StockStatus = 'OK';
                    if (balance.currentBalance <= reorderPoint) {
                        stockStatus = 'ORDER NOW';
                    } else if (
                        balance.currentBalance <=
                        avgDailyConsumption * (effectiveLeadTime + 14)
                    ) {
                        stockStatus = 'ORDER SOON';
                    }

                    const suggestedOrderQty = Math.max(
                        Number(effectiveMinOrder),
                        Math.ceil(
                            avgDailyConsumption * 30 -
                                balance.currentBalance +
                                avgDailyConsumption * effectiveLeadTime
                        )
                    );

                    return {
                        fabricId: fabric.id,
                        colorName: fabric.colorName,
                        colorHex: fabric.colorHex,
                        standardColor: fabric.standardColor,
                        fabricTypeId: fabric.fabricType.id,
                        fabricTypeName: fabric.fabricType.name,
                        composition: fabric.fabricType.composition,
                        unit: fabric.fabricType.unit,
                        avgShrinkagePct: fabric.fabricType.avgShrinkagePct,
                        supplierId: fabric.supplier?.id || null,
                        supplierName: fabric.supplier?.name || null,
                        costPerUnit: fabric.costPerUnit,
                        leadTimeDays: fabric.leadTimeDays,
                        minOrderQty: fabric.minOrderQty,
                        effectiveCostPerUnit: effectiveCost,
                        effectiveLeadTimeDays: effectiveLeadTime,
                        effectiveMinOrderQty: effectiveMinOrder,
                        costInherited: fabric.costPerUnit === null,
                        leadTimeInherited: fabric.leadTimeDays === null,
                        minOrderInherited: fabric.minOrderQty === null,
                        typeCostPerUnit: fabric.fabricType.defaultCostPerUnit,
                        typeLeadTimeDays: fabric.fabricType.defaultLeadTimeDays,
                        typeMinOrderQty: fabric.fabricType.defaultMinOrderQty,
                        currentBalance: Number(balance.currentBalance.toFixed(2)),
                        totalInward: Number(balance.totalInward.toFixed(2)),
                        totalOutward: Number(balance.totalOutward.toFixed(2)),
                        avgDailyConsumption: Number(avgDailyConsumption.toFixed(3)),
                        daysOfStock: daysOfStock ? Math.floor(daysOfStock) : null,
                        reorderPoint: Number(reorderPoint.toFixed(2)),
                        stockStatus,
                        suggestedOrderQty: suggestedOrderQty > 0 ? suggestedOrderQty : 0,
                        sales7d: Math.round(sales7d),
                        sales30d: Math.round(sales30d),
                        isTypeRow: false,
                    };
                },
                5
            );

            // Filter by status if provided
            let filteredItems = items;
            if (status === 'low') {
                filteredItems = items.filter((item) => item.stockStatus !== 'OK');
            } else if (status === 'ok') {
                filteredItems = items.filter((item) => item.stockStatus === 'OK');
            }

            return {
                success: true,
                items: filteredItems,
                summary: {
                    total: filteredItems.length,
                    orderNow: items.filter((i) => i.stockStatus === 'ORDER NOW').length,
                    orderSoon: items.filter((i) => i.stockStatus === 'ORDER SOON').length,
                    ok: items.filter((i) => i.stockStatus === 'OK').length,
                },
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get single fabric with details and balance
 */
export const getFabricById = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getFabricByIdInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const fabric = await prisma.fabric.findUnique({
                where: { id: data.id },
                include: {
                    fabricType: true,
                    supplier: true,
                },
            });

            if (!fabric) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_FOUND' as const,
                        message: 'Fabric not found',
                    },
                };
            }

            const balance = await calculateFabricBalance(prisma, fabric.id);

            return {
                success: true,
                fabric: { ...fabric, ...balance },
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get fabric filters (fabric types and suppliers)
 */
export const getFabricsFilters = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async () => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const [fabricTypes, suppliers] = await Promise.all([
                prisma.fabricType.findMany({
                    select: { id: true, name: true },
                    orderBy: { name: 'asc' },
                }),
                prisma.supplier.findMany({
                    where: { isActive: true },
                    select: { id: true, name: true },
                    orderBy: { name: 'asc' },
                }),
            ]);

            return {
                success: true,
                filters: {
                    fabricTypes,
                    suppliers,
                },
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get fabric types list
 */
export const getFabricTypes = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async () => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const types = await prisma.fabricType.findMany({
                include: {
                    fabrics: {
                        where: { isActive: true },
                    },
                },
                orderBy: { name: 'asc' },
            });

            return {
                success: true,
                types: types.map((t) => ({
                    id: t.id,
                    name: t.name,
                    composition: t.composition,
                    unit: t.unit,
                    avgShrinkagePct: t.avgShrinkagePct,
                    defaultCostPerUnit: t.defaultCostPerUnit,
                    defaultLeadTimeDays: t.defaultLeadTimeDays,
                    defaultMinOrderQty: t.defaultMinOrderQty,
                    colorCount: t.fabrics.length,
                })),
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get all suppliers
 */
export const getFabricSuppliers = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getFabricSuppliersInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const suppliers = await prisma.supplier.findMany({
                where: data?.activeOnly ? { isActive: true } : {},
                orderBy: { name: 'asc' },
            });

            return {
                success: true,
                suppliers,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get transactions for a fabric
 */
export const getFabricTransactions = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getFabricTransactionsInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const transactions = await prisma.fabricTransaction.findMany({
                where: { fabricId: data.fabricId },
                include: {
                    createdBy: { select: { id: true, name: true } },
                    supplier: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: data.limit,
                skip: data.offset,
            });

            return {
                success: true,
                transactions,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get all fabric transactions (batch endpoint)
 */
export const getAllFabricTransactions = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getAllTransactionsInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - (data?.days ?? 30));

            const transactions = await prisma.fabricTransaction.findMany({
                where: {
                    createdAt: { gte: startDate },
                },
                include: {
                    fabric: {
                        select: {
                            id: true,
                            name: true,
                            colorName: true,
                            fabricType: { select: { id: true, name: true } },
                        },
                    },
                    createdBy: { select: { id: true, name: true } },
                    supplier: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: data?.limit ?? 500,
            });

            return {
                success: true,
                transactions,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get top fabrics by sales value
 *
 * Configurable time period and aggregation level (type vs color)
 */
export const getTopFabrics = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getTopFabricsInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const days = data?.days ?? 30;
            const level = data?.level ?? 'type';
            const limit = data?.limit ?? 15;

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            // Get order lines from non-cancelled, non-RTO orders
            const orderLines = await prisma.orderLine.findMany({
                where: {
                    order: {
                        orderDate: { gte: startDate },
                        status: { not: 'cancelled' },
                    },
                    OR: [
                        { trackingStatus: null },
                        {
                            trackingStatus: {
                                notIn: ['rto_initiated', 'rto_in_transit', 'rto_delivered'],
                            },
                        },
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
            });

            if (level === 'color') {
                // Aggregate at specific fabric color level
                const fabricStats: Record<
                    string,
                    {
                        id: string;
                        name: string;
                        colorHex: string | null;
                        typeName: string;
                        composition: string | null;
                        units: number;
                        revenue: number;
                        orderCount: Set<string>;
                        productCount: Set<string>;
                    }
                > = {};

                for (const line of orderLines) {
                    const fabric = (line as any).sku?.variation?.fabric;
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
                    const productId = (line as any).sku?.variation?.product?.id;
                    if (productId) {
                        fabricStats[key].productCount.add(productId);
                    }
                }

                const result = Object.values(fabricStats)
                    .map((f) => ({
                        ...f,
                        orderCount: f.orderCount.size,
                        productCount: f.productCount.size,
                    }))
                    .sort((a, b) => b.revenue - a.revenue)
                    .slice(0, limit);

                return {
                    success: true,
                    level: 'color',
                    days,
                    data: result,
                };
            } else {
                // Aggregate at fabric type level
                const typeStats: Record<
                    string,
                    {
                        id: string;
                        name: string;
                        composition: string | null;
                        units: number;
                        revenue: number;
                        orderCount: Set<string>;
                        productCount: Set<string>;
                        colors: Record<string, { name: string; revenue: number }>;
                    }
                > = {};

                for (const line of orderLines) {
                    const fabricType =
                        (line as any).sku?.variation?.fabric?.fabricType ||
                        (line as any).sku?.variation?.product?.fabricType;
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
                    const productId = (line as any).sku?.variation?.product?.id;
                    if (productId) {
                        typeStats[key].productCount.add(productId);
                    }

                    // Track top colors within this type
                    const fabric = (line as any).sku?.variation?.fabric;
                    if (fabric) {
                        if (!typeStats[key].colors[fabric.id]) {
                            typeStats[key].colors[fabric.id] = {
                                name: fabric.colorName,
                                revenue: 0,
                            };
                        }
                        typeStats[key].colors[fabric.id].revenue +=
                            line.qty * Number(line.unitPrice);
                    }
                }

                const result = Object.values(typeStats)
                    .map((t) => {
                        const topColors = Object.values(t.colors)
                            .sort((a, b) => b.revenue - a.revenue)
                            .slice(0, 3)
                            .map((c) => c.name);
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
                    .slice(0, limit);

                return {
                    success: true,
                    level: 'type',
                    days,
                    data: result,
                };
            }
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get fabric stock analysis with reorder recommendations
 */
export const getFabricStockAnalysis = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getStockAnalysisInputSchema.parse(input))
    .handler(async () => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const fabrics = await prisma.fabric.findMany({
                where: { isActive: true },
                include: { fabricType: true, supplier: true },
            });

            const analysis = await chunkProcess(
                fabrics,
                async (fabric: any) => {
                    const balance = await calculateFabricBalance(prisma, fabric.id);
                    const avgDailyConsumption = await calculateAvgDailyConsumption(
                        prisma,
                        fabric.id
                    );

                    const daysOfStock =
                        avgDailyConsumption > 0
                            ? balance.currentBalance / avgDailyConsumption
                            : null;

                    const leadTimeDays = fabric.leadTimeDays ?? 14;
                    const reorderPoint = avgDailyConsumption * (leadTimeDays + 7);

                    let status: StockStatus = 'OK';
                    if (balance.currentBalance <= reorderPoint) {
                        status = 'ORDER NOW';
                    } else if (
                        balance.currentBalance <=
                        avgDailyConsumption * (leadTimeDays + 14)
                    ) {
                        status = 'ORDER SOON';
                    }

                    const suggestedOrderQty = Math.max(
                        Number(fabric.minOrderQty ?? 10),
                        avgDailyConsumption * 30 -
                            balance.currentBalance +
                            avgDailyConsumption * leadTimeDays
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
                },
                5
            );

            // Sort by status priority
            analysis.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

            return {
                success: true,
                analysis,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

// ============================================
// RECONCILIATION QUERIES
// ============================================

/**
 * Get reconciliation history
 */
export const getFabricReconciliationHistory = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getReconciliationHistoryInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const reconciliations = await prisma.fabricReconciliation.findMany({
                include: {
                    items: true,
                },
                orderBy: { createdAt: 'desc' },
                take: data?.limit ?? 10,
            });

            const history = reconciliations.map((r: any) => ({
                id: r.id,
                date: r.reconcileDate,
                status: r.status,
                itemsCount: r.items.length,
                adjustments: r.items.filter(
                    (i: any) => i.variance !== 0 && i.variance !== null
                ).length,
                createdBy: r.createdBy,
                createdAt: r.createdAt,
            }));

            return {
                success: true,
                history,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get a specific reconciliation by ID
 */
export const getFabricReconciliation = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getReconciliationByIdInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const reconciliation = await prisma.fabricReconciliation.findUnique({
                where: { id: data.id },
                include: {
                    items: {
                        include: {
                            fabric: { include: { fabricType: true } },
                        },
                    },
                },
            });

            if (!reconciliation) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_FOUND' as const,
                        message: 'Reconciliation not found',
                    },
                };
            }

            return {
                success: true,
                reconciliation: {
                    id: reconciliation.id,
                    status: reconciliation.status,
                    notes: reconciliation.notes,
                    createdAt: reconciliation.createdAt,
                    items: reconciliation.items.map((item: any) => ({
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
                },
            };
        } finally {
            await prisma.$disconnect();
        }
    });
