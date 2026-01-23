/**
 * Fabric Colour Query Server Functions
 *
 * TanStack Start Server Functions for querying Material → Fabric → FabricColour hierarchy.
 * Provides transactions, stock analysis, reconciliation, and top materials reports.
 *
 * This is the NEW system replacing FabricTransaction/FabricReconciliation.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { PrismaClient, Prisma } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

// ============================================
// PRISMA TYPE ALIAS
// ============================================

/**
 * Type alias for PrismaClient instance.
 * Used for helper functions that need prisma parameter.
 */
type PrismaInstance = InstanceType<typeof PrismaClient>;


// ============================================
// INTERNAL TYPE DEFINITIONS FOR QUERY RESULTS
// ============================================

/**
 * FabricColour with relations
 */
interface FabricColourWithRelations {
    id: string;
    fabricId: string;
    colourName: string;
    standardColour: string | null;
    colourHex: string | null;
    costPerUnit: number | null;
    supplierId: string | null;
    leadTimeDays: number | null;
    minOrderQty: number | null;
    isActive: boolean;
    fabric: {
        id: string;
        name: string;
        materialId: string | null;
        costPerUnit: number | null;
        leadTimeDays: number | null;
        minOrderQty: number | null;
        unit: string | null;
        material: {
            id: string;
            name: string;
        } | null;
    };
    supplier?: {
        id: string;
        name: string;
    } | null;
}

/**
 * Transaction record for fabric colour transactions
 */
interface FabricColourTransactionRecord {
    id: string;
    fabricColourId: string;
    txnType: string;
    qty: number;
    unit: string;
    reason: string;
    costPerUnit: number | null;
    referenceId: string | null;
    notes: string | null;
    supplierId: string | null;
    createdById: string;
    createdAt: Date;
    createdBy: { id: string; name: string } | null;
    supplier: { id: string; name: string } | null;
}

/**
 * Transaction with fabric colour details for getAllFabricColourTransactions
 */
interface FabricColourTransactionWithDetails extends FabricColourTransactionRecord {
    fabricColour: {
        id: string;
        colourName: string;
        colourHex: string | null;
        fabric: {
            id: string;
            name: string;
            material: { id: string; name: string } | null;
        };
    };
}

/**
 * Reconciliation item with fabric colour relation
 */
interface ReconciliationItemWithFabricColour {
    id: string;
    fabricColourId: string;
    systemQty: number;
    physicalQty: number | null;
    variance: number | null;
    adjustmentReason: string | null;
    notes: string | null;
    fabricColour: FabricColourWithRelations;
}

/**
 * Reconciliation with items relation
 */
interface ReconciliationWithItems {
    id: string;
    status: string;
    notes: string | null;
    createdAt: Date;
    items: ReconciliationItemWithFabricColour[];
}

/**
 * Simple fabric colour record for reconciliation
 */
interface SimpleFabricColourRecord {
    id: string;
    colourName: string;
    fabric: {
        id: string;
        name: string;
        unit: string | null;
    };
}

// ============================================
// RESPONSE TYPES FOR HANDLERS
// ============================================

/** Standard error response structure */
interface ErrorResponse {
    success: false;
    error: {
        code: 'NOT_FOUND' | 'BAD_REQUEST';
        message: string;
    };
}

/** Response type for getFabricColourTransactions */
interface GetFabricColourTransactionsResponse {
    success: true;
    transactions: FabricColourTransactionRecord[];
}

/** Response type for getAllFabricColourTransactions */
interface GetAllFabricColourTransactionsResponse {
    success: true;
    transactions: FabricColourTransactionWithDetails[];
    total: number;
    page: number;
    pageSize: number;
}

/** Stock analysis item */
interface StockAnalysisItem {
    fabricColourId: string;
    materialName: string;
    fabricName: string;
    colourName: string;
    unit: string;
    currentBalance: string;
    avgDailyConsumption: string;
    daysOfStock: number | null;
    reorderPoint: string;
    status: StockStatus;
    suggestedOrderQty: number;
    leadTimeDays: number | null;
    costPerUnit: number | null;
    supplier: string;
}

/** Response type for getFabricColourStockAnalysis */
interface GetFabricColourStockAnalysisResponse {
    success: true;
    analysis: StockAnalysisItem[];
}

/** Top materials result item */
interface TopMaterialsResultItem {
    id: string;
    name: string;
    level: 'material' | 'fabric' | 'colour';
    colorHex?: string | null;
    fabricName?: string;
    units: number;
    revenue: number;
    orderCount: number;
    productCount: number;
    topColours?: string[];
}

/** Response type for getTopMaterials */
interface GetTopMaterialsResponse {
    success: true;
    level: 'material' | 'fabric' | 'colour';
    days: number;
    data: TopMaterialsResultItem[];
}

/** Reconciliation history item */
interface ReconciliationHistoryItem {
    id: string;
    date: Date | null;
    status: string;
    itemsCount: number;
    adjustments: number;
    createdBy: string | null;
    createdAt: Date;
}

/** Response type for getFabricColourReconciliations */
interface GetFabricColourReconciliationsResponse {
    success: true;
    history: ReconciliationHistoryItem[];
}

/** Reconciliation item detail */
interface ReconciliationItemDetail {
    id: string;
    fabricColourId: string;
    materialName: string;
    fabricName: string;
    colourName: string;
    unit: string;
    systemQty: number;
    physicalQty: number | null;
    variance: number | null;
    adjustmentReason: string | null;
    notes: string | null;
}

/** Response type for getFabricColourReconciliation */
type GetFabricColourReconciliationResponse =
    | {
        success: true;
        reconciliation: {
            id: string;
            status: string;
            notes: string | null;
            createdAt: Date;
            items: ReconciliationItemDetail[];
        };
    }
    | ErrorResponse;

/** Response type for startFabricColourReconciliation */
type StartFabricColourReconciliationResponse =
    | {
        success: true;
        data: {
            id: string;
            status: string;
            createdAt: Date;
            items: ReconciliationItemDetail[];
        };
    }
    | ErrorResponse;

// ============================================
// INPUT SCHEMAS
// ============================================

const getFabricColourTransactionsInputSchema = z.object({
    fabricColourId: z.string().uuid('Invalid fabric colour ID'),
    limit: z.number().int().positive().optional().default(50),
    offset: z.number().int().nonnegative().optional().default(0),
});

const getAllTransactionsInputSchema = z.object({
    limit: z.number().int().positive().optional().default(500),
    offset: z.number().int().nonnegative().optional().default(0),
    materialId: z.string().uuid().optional(),
    fabricId: z.string().uuid().optional(),
    fabricColourId: z.string().uuid().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
}).optional();

const getStockAnalysisInputSchema = z.object({
    materialId: z.string().uuid().optional(),
    fabricId: z.string().uuid().optional(),
    fabricColourId: z.string().uuid().optional(),
    status: z.enum(['low', 'ok']).optional(),
}).optional();

const getTopMaterialsInputSchema = z.object({
    days: z.number().int().positive().optional().default(30),
    level: z.enum(['material', 'fabric', 'colour']).optional().default('material'),
    limit: z.number().int().positive().optional().default(15),
}).optional();

const getReconciliationByIdInputSchema = z.object({
    id: z.string().uuid('Invalid reconciliation ID'),
});

const getReconciliationHistoryInputSchema = z.object({
    limit: z.number().int().positive().optional().default(10),
}).optional();

const startFabricColourReconciliationInputSchema = z.object({
    notes: z.string().optional(),
}).optional();

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
 * Calculate fabric colour balance from transactions
 */
async function calculateFabricColourBalance(
    prisma: PrismaInstance,
    fabricColourId: string
): Promise<{ currentBalance: number; totalInward: number; totalOutward: number }> {
    const [inwardSum, outwardSum] = await Promise.all([
        prisma.fabricColourTransaction.aggregate({
            where: { fabricColourId, txnType: 'inward' },
            _sum: { qty: true },
        }),
        prisma.fabricColourTransaction.aggregate({
            where: { fabricColourId, txnType: 'outward' },
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
 * Calculate average daily fabric colour consumption over 28 days
 */
async function calculateAvgDailyConsumption(
    prisma: PrismaInstance,
    fabricColourId: string
): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 28);

    const result = await prisma.fabricColourTransaction.aggregate({
        where: {
            fabricColourId,
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
 * Get transactions for a specific fabric colour
 */
export const getFabricColourTransactions = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getFabricColourTransactionsInputSchema.parse(input))
    .handler(async ({ data }): Promise<GetFabricColourTransactionsResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const transactions = await prisma.fabricColourTransaction.findMany({
                where: { fabricColourId: data.fabricColourId },
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
 * Get all fabric colour transactions with pagination and filters
 *
 * For Ledgers page - supports filtering by material/fabric/colour and date range.
 */
export const getAllFabricColourTransactions = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getAllTransactionsInputSchema.parse(input))
    .handler(async ({ data }): Promise<GetAllFabricColourTransactionsResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const limit = data?.limit ?? 500;
            const offset = data?.offset ?? 0;

            // Build where clause
            const where: Prisma.FabricColourTransactionWhereInput = {};

            // Date range filter
            if (data?.startDate || data?.endDate) {
                where.createdAt = {};
                if (data.startDate) {
                    where.createdAt.gte = new Date(data.startDate);
                }
                if (data.endDate) {
                    const endDate = new Date(data.endDate);
                    endDate.setHours(23, 59, 59, 999);
                    where.createdAt.lte = endDate;
                }
            }

            // Hierarchy filters
            if (data?.fabricColourId) {
                where.fabricColourId = data.fabricColourId;
            } else if (data?.fabricId) {
                where.fabricColour = {
                    fabricId: data.fabricId,
                };
            } else if (data?.materialId) {
                where.fabricColour = {
                    fabric: {
                        materialId: data.materialId,
                    },
                };
            }

            const [transactions, total] = await Promise.all([
                prisma.fabricColourTransaction.findMany({
                    where,
                    include: {
                        fabricColour: {
                            select: {
                                id: true,
                                colourName: true,
                                colourHex: true,
                                fabric: {
                                    select: {
                                        id: true,
                                        name: true,
                                        material: {
                                            select: {
                                                id: true,
                                                name: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        createdBy: { select: { id: true, name: true } },
                        supplier: { select: { id: true, name: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                    take: limit,
                    skip: offset,
                }),
                prisma.fabricColourTransaction.count({ where }),
            ]);

            return {
                success: true,
                transactions,
                total,
                page: Math.floor(offset / limit) + 1,
                pageSize: limit,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get fabric colour stock analysis with reorder recommendations
 *
 * Aggregates stock levels by Material → Fabric → Colour hierarchy.
 */
export const getFabricColourStockAnalysis = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getStockAnalysisInputSchema.parse(input))
    .handler(async ({ data }): Promise<GetFabricColourStockAnalysisResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const where: Prisma.FabricColourWhereInput = { isActive: true };

            if (data?.fabricColourId) {
                where.id = data.fabricColourId;
            } else if (data?.fabricId) {
                where.fabricId = data.fabricId;
            } else if (data?.materialId) {
                where.fabric = {
                    materialId: data.materialId,
                };
            }

            const fabricColours = await prisma.fabricColour.findMany({
                where,
                include: {
                    fabric: {
                        include: {
                            material: true,
                        },
                    },
                    supplier: true,
                },
            });

            const analysis = await chunkProcess(
                fabricColours as FabricColourWithRelations[],
                async (colour) => {
                    const balance = await calculateFabricColourBalance(prisma, colour.id);
                    const avgDailyConsumption = await calculateAvgDailyConsumption(
                        prisma,
                        colour.id
                    );

                    // Calculate effective values (inherit from fabric if null)
                    const effectiveCost =
                        colour.costPerUnit ?? colour.fabric.costPerUnit ?? 0;
                    const effectiveLeadTime =
                        colour.leadTimeDays ?? colour.fabric.leadTimeDays ?? 14;
                    const effectiveMinOrder =
                        colour.minOrderQty ?? colour.fabric.minOrderQty ?? 10;

                    const daysOfStock =
                        avgDailyConsumption > 0
                            ? balance.currentBalance / avgDailyConsumption
                            : null;

                    const reorderPoint = avgDailyConsumption * (effectiveLeadTime + 7);

                    let status: StockStatus = 'OK';
                    if (balance.currentBalance <= reorderPoint) {
                        status = 'ORDER NOW';
                    } else if (
                        balance.currentBalance <=
                        avgDailyConsumption * (effectiveLeadTime + 14)
                    ) {
                        status = 'ORDER SOON';
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
                        fabricColourId: colour.id,
                        materialName: colour.fabric.material?.name || 'Unknown',
                        fabricName: colour.fabric.name,
                        colourName: colour.colourName,
                        unit: colour.fabric.unit || 'meter',
                        currentBalance: balance.currentBalance.toFixed(2),
                        avgDailyConsumption: avgDailyConsumption.toFixed(3),
                        daysOfStock: daysOfStock ? Math.floor(daysOfStock) : null,
                        reorderPoint: reorderPoint.toFixed(2),
                        status,
                        suggestedOrderQty: suggestedOrderQty > 0 ? suggestedOrderQty : 0,
                        leadTimeDays: effectiveLeadTime,
                        costPerUnit: effectiveCost,
                        supplier: colour.supplier?.name || 'No supplier',
                    };
                },
                5
            );

            // Sort by status priority
            analysis.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

            // Filter by status if provided
            let filteredAnalysis = analysis;
            if (data?.status === 'low') {
                filteredAnalysis = analysis.filter((item) => item.status !== 'OK');
            } else if (data?.status === 'ok') {
                filteredAnalysis = analysis.filter((item) => item.status === 'OK');
            }

            return {
                success: true,
                analysis: filteredAnalysis,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get top materials by sales value
 *
 * Replaces getTopFabrics - aggregates by material/fabric/colour levels.
 * Configurable time period and aggregation level.
 */
export const getTopMaterials = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getTopMaterialsInputSchema.parse(input))
    .handler(async ({ data }): Promise<GetTopMaterialsResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const days = data?.days ?? 30;
            const level = data?.level ?? 'material';
            const limit = data?.limit ?? 15;

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            // Get SKUs with fabricColour to calculate top materials
            // Note: Using SKU table to get all sales data
            const skus = await prisma.sku.findMany({
                where: {
                    variation: {
                        fabricColourId: { not: null },
                    },
                },
                include: {
                    variation: {
                        include: {
                            fabricColour: {
                                include: {
                                    fabric: {
                                        include: { material: true },
                                    },
                                },
                            },
                            product: true,
                        },
                    },
                    orderLines: {
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
                        select: {
                            id: true,
                            orderId: true,
                            qty: true,
                            unitPrice: true,
                        },
                    },
                },
            });

            if (level === 'colour') {
                // Aggregate at specific colour level
                const colourStats: Record<
                    string,
                    {
                        id: string;
                        name: string;
                        colorHex: string | null;
                        fabricName: string;
                        materialName: string;
                        units: number;
                        revenue: number;
                        orderCount: Set<string>;
                        productCount: Set<string>;
                    }
                > = {};

                for (const sku of skus) {
                    const fabricColour = sku.variation?.fabricColour;
                    if (!fabricColour || !sku.orderLines || sku.orderLines.length === 0) continue;

                    const key = fabricColour.id;
                    if (!colourStats[key]) {
                        colourStats[key] = {
                            id: fabricColour.id,
                            name: fabricColour.colourName,
                            colorHex: fabricColour.colourHex || null,
                            fabricName: fabricColour.fabric.name,
                            materialName: fabricColour.fabric.material?.name || 'Unknown',
                            units: 0,
                            revenue: 0,
                            orderCount: new Set(),
                            productCount: new Set(),
                        };
                    }

                    for (const line of sku.orderLines) {
                        colourStats[key].units += line.qty;
                        colourStats[key].revenue += line.qty * Number(line.unitPrice);
                        colourStats[key].orderCount.add(line.orderId);
                    }

                    const productId = sku.variation?.product?.id;
                    if (productId) {
                        colourStats[key].productCount.add(productId);
                    }
                }

                const result = Object.values(colourStats)
                    .map((c) => ({
                        id: c.id,
                        name: c.name,
                        level: 'colour' as const,
                        colorHex: c.colorHex,
                        fabricName: c.fabricName,
                        units: c.units,
                        revenue: c.revenue,
                        orderCount: c.orderCount.size,
                        productCount: c.productCount.size,
                    }))
                    .sort((a, b) => b.revenue - a.revenue)
                    .slice(0, limit);

                return {
                    success: true,
                    level: 'colour' as const,
                    days,
                    data: result,
                };
            } else if (level === 'fabric') {
                // Aggregate at fabric level
                const fabricStats: Record<
                    string,
                    {
                        id: string;
                        name: string;
                        materialName: string;
                        units: number;
                        revenue: number;
                        orderCount: Set<string>;
                        productCount: Set<string>;
                        colours: Record<string, { name: string; revenue: number }>;
                    }
                > = {};

                for (const sku of skus) {
                    const fabricColour = sku.variation?.fabricColour;
                    if (!fabricColour || !sku.orderLines || sku.orderLines.length === 0) continue;

                    const fabric = fabricColour.fabric;
                    const key = fabric.id;
                    if (!fabricStats[key]) {
                        fabricStats[key] = {
                            id: fabric.id,
                            name: fabric.name,
                            materialName: fabric.material?.name || 'Unknown',
                            units: 0,
                            revenue: 0,
                            orderCount: new Set(),
                            productCount: new Set(),
                            colours: {},
                        };
                    }

                    for (const line of sku.orderLines) {
                        fabricStats[key].units += line.qty;
                        fabricStats[key].revenue += line.qty * Number(line.unitPrice);
                        fabricStats[key].orderCount.add(line.orderId);
                    }

                    const productId = sku.variation?.product?.id;
                    if (productId) {
                        fabricStats[key].productCount.add(productId);
                    }

                    // Track top colours within this fabric
                    if (!fabricStats[key].colours[fabricColour.id]) {
                        fabricStats[key].colours[fabricColour.id] = {
                            name: fabricColour.colourName,
                            revenue: 0,
                        };
                    }

                    for (const line of sku.orderLines) {
                        fabricStats[key].colours[fabricColour.id].revenue +=
                            line.qty * Number(line.unitPrice);
                    }
                }

                const result = Object.values(fabricStats)
                    .map((f) => {
                        const topColours = Object.values(f.colours)
                            .sort((a, b) => b.revenue - a.revenue)
                            .slice(0, 3)
                            .map((c) => c.name);
                        return {
                            id: f.id,
                            name: f.name,
                            level: 'fabric' as const,
                            units: f.units,
                            revenue: f.revenue,
                            orderCount: f.orderCount.size,
                            productCount: f.productCount.size,
                            topColours,
                        };
                    })
                    .sort((a, b) => b.revenue - a.revenue)
                    .slice(0, limit);

                return {
                    success: true,
                    level: 'fabric' as const,
                    days,
                    data: result,
                };
            } else {
                // Aggregate at material level
                const materialStats: Record<
                    string,
                    {
                        id: string;
                        name: string;
                        units: number;
                        revenue: number;
                        orderCount: Set<string>;
                        productCount: Set<string>;
                        colours: Record<string, { name: string; revenue: number }>;
                    }
                > = {};

                for (const sku of skus) {
                    const fabricColour = sku.variation?.fabricColour;
                    if (!fabricColour?.fabric.material || !sku.orderLines || sku.orderLines.length === 0) continue;

                    const material = fabricColour.fabric.material;
                    const key = material.id;
                    if (!materialStats[key]) {
                        materialStats[key] = {
                            id: material.id,
                            name: material.name,
                            units: 0,
                            revenue: 0,
                            orderCount: new Set(),
                            productCount: new Set(),
                            colours: {},
                        };
                    }

                    for (const line of sku.orderLines) {
                        materialStats[key].units += line.qty;
                        materialStats[key].revenue += line.qty * Number(line.unitPrice);
                        materialStats[key].orderCount.add(line.orderId);
                    }

                    const productId = sku.variation?.product?.id;
                    if (productId) {
                        materialStats[key].productCount.add(productId);
                    }

                    // Track top colours across all fabrics in this material
                    if (!materialStats[key].colours[fabricColour.id]) {
                        materialStats[key].colours[fabricColour.id] = {
                            name: fabricColour.colourName,
                            revenue: 0,
                        };
                    }

                    for (const line of sku.orderLines) {
                        materialStats[key].colours[fabricColour.id].revenue +=
                            line.qty * Number(line.unitPrice);
                    }
                }

                const result = Object.values(materialStats)
                    .map((m) => {
                        const topColours = Object.values(m.colours)
                            .sort((a, b) => b.revenue - a.revenue)
                            .slice(0, 3)
                            .map((c) => c.name);
                        return {
                            id: m.id,
                            name: m.name,
                            level: 'material' as const,
                            units: m.units,
                            revenue: m.revenue,
                            orderCount: m.orderCount.size,
                            productCount: m.productCount.size,
                            topColours,
                        };
                    })
                    .sort((a, b) => b.revenue - a.revenue)
                    .slice(0, limit);

                return {
                    success: true,
                    level: 'material' as const,
                    days,
                    data: result,
                };
            }
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
export const getFabricColourReconciliations = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getReconciliationHistoryInputSchema.parse(input))
    .handler(async ({ data }): Promise<GetFabricColourReconciliationsResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const reconciliations = await prisma.fabricColourReconciliation.findMany({
                include: {
                    items: true,
                },
                orderBy: { createdAt: 'desc' },
                take: data?.limit ?? 10,
            });

            const history = reconciliations.map((r) => ({
                id: r.id,
                date: r.reconcileDate,
                status: r.status,
                itemsCount: r.items.length,
                adjustments: r.items.filter(
                    (i) => i.variance !== 0 && i.variance !== null
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
export const getFabricColourReconciliation = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getReconciliationByIdInputSchema.parse(input))
    .handler(async ({ data }): Promise<GetFabricColourReconciliationResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const reconciliation = await prisma.fabricColourReconciliation.findUnique({
                where: { id: data.id },
                include: {
                    items: {
                        include: {
                            fabricColour: {
                                include: {
                                    fabric: {
                                        include: { material: true },
                                    },
                                },
                            },
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

            const typedReconciliation = reconciliation as unknown as ReconciliationWithItems;

            return {
                success: true,
                reconciliation: {
                    id: typedReconciliation.id,
                    status: typedReconciliation.status,
                    notes: typedReconciliation.notes,
                    createdAt: typedReconciliation.createdAt,
                    items: typedReconciliation.items.map((item) => ({
                        id: item.id,
                        fabricColourId: item.fabricColourId,
                        materialName: item.fabricColour.fabric.material?.name || 'Unknown',
                        fabricName: item.fabricColour.fabric.name,
                        colourName: item.fabricColour.colourName,
                        unit: item.fabricColour.fabric.unit || 'meter',
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

/**
 * Start a new fabric colour reconciliation with all active colours
 *
 * Creates a reconciliation record and items for each active colour with
 * their current system balance from FabricColourTransaction.
 */
export const startFabricColourReconciliation = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => startFabricColourReconciliationInputSchema.parse(input))
    .handler(async ({ data, context }): Promise<StartFabricColourReconciliationResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            // Get all active fabric colours
            const fabricColours = await prisma.fabricColour.findMany({
                where: { isActive: true },
                include: {
                    fabric: {
                        include: { material: true },
                    },
                },
            });

            if (fabricColours.length === 0) {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST' as const,
                        message: 'No active fabric colours found',
                    },
                };
            }

            // Calculate balances for all colours in batch
            const typedFabricColours = fabricColours as SimpleFabricColourRecord[];
            const colourIds = typedFabricColours.map((c) => c.id);
            const balanceMap = await calculateAllFabricColourBalances(prisma, colourIds);

            // Create reconciliation with items
            const reconciliation = await prisma.fabricColourReconciliation.create({
                data: {
                    createdBy: context.user.id,
                    status: 'draft',
                    notes: data?.notes || null,
                    items: {
                        create: typedFabricColours.map((colour) => ({
                            fabricColourId: colour.id,
                            systemQty: balanceMap.get(colour.id)?.currentBalance || 0,
                        })),
                    },
                },
                include: {
                    items: {
                        include: {
                            fabricColour: {
                                include: {
                                    fabric: {
                                        include: { material: true },
                                    },
                                },
                            },
                        },
                    },
                },
            });

            const typedReconciliation = reconciliation as unknown as ReconciliationWithItems;

            return {
                success: true,
                data: {
                    id: typedReconciliation.id,
                    status: typedReconciliation.status,
                    createdAt: typedReconciliation.createdAt,
                    items: typedReconciliation.items.map((item) => ({
                        id: item.id,
                        fabricColourId: item.fabricColourId,
                        materialName: item.fabricColour.fabric.material?.name || 'Unknown',
                        fabricName: item.fabricColour.fabric.name,
                        colourName: item.fabricColour.colourName,
                        unit: item.fabricColour.fabric.unit || 'meter',
                        systemQty: Number(item.systemQty),
                        physicalQty: item.physicalQty !== null ? Number(item.physicalQty) : null,
                        variance: item.variance !== null ? Number(item.variance) : null,
                        adjustmentReason: item.adjustmentReason,
                        notes: item.notes,
                    })),
                },
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Helper: Calculate fabric colour balances in batch from FabricColourTransaction
 */
async function calculateAllFabricColourBalances(
    prisma: PrismaInstance,
    fabricColourIds: string[]
): Promise<Map<string, { currentBalance: number }>> {
    const aggregations = await prisma.fabricColourTransaction.groupBy({
        by: ['fabricColourId', 'txnType'],
        where: { fabricColourId: { in: fabricColourIds } },
        _sum: { qty: true },
    });

    const balanceMap = new Map<string, { currentBalance: number }>();

    // Initialize all colours with zero balance
    for (const colourId of fabricColourIds) {
        balanceMap.set(colourId, { currentBalance: 0 });
    }

    // Calculate balances from aggregations
    const colourTotals = new Map<string, { inward: number; outward: number }>();
    for (const agg of aggregations) {
        if (!colourTotals.has(agg.fabricColourId)) {
            colourTotals.set(agg.fabricColourId, { inward: 0, outward: 0 });
        }
        const totals = colourTotals.get(agg.fabricColourId)!;
        if (agg.txnType === 'inward') {
            totals.inward = Number(agg._sum.qty) || 0;
        } else if (agg.txnType === 'outward') {
            totals.outward = Number(agg._sum.qty) || 0;
        }
    }

    for (const [colourId, totals] of colourTotals) {
        balanceMap.set(colourId, { currentBalance: totals.inward - totals.outward });
    }

    return balanceMap;
}
