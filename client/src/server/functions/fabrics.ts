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

/**
 * Type alias for Prisma transaction client.
 * Used in $transaction callbacks.
 */
type PrismaTransaction = Omit<
    PrismaInstance,
    '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ============================================
// INTERNAL TYPE DEFINITIONS FOR QUERY RESULTS
// ============================================

/**
 * FabricType from Prisma with fabrics relation
 */
interface FabricTypeWithFabrics {
    id: string;
    name: string;
    composition: string | null;
    unit: string;
    avgShrinkagePct: number | null;
    defaultCostPerUnit: number | null;
    defaultLeadTimeDays: number | null;
    defaultMinOrderQty: number | null;
    fabrics: FabricRecord[];
}

/**
 * Base Fabric record from database
 */
interface FabricRecord {
    id: string;
    name: string;
    colorName: string;
    colorHex: string | null;
    standardColor: string | null;
    costPerUnit: number | null;
    leadTimeDays: number | null;
    minOrderQty: number | null;
    isActive: boolean;
    fabricTypeId: string;
    supplierId: string | null;
}

/**
 * Fabric with fabricType relation
 */
interface FabricWithType extends FabricRecord {
    fabricType: {
        id: string;
        name: string;
        composition: string | null;
        unit: string;
        avgShrinkagePct: number | null;
        defaultCostPerUnit: number | null;
        defaultLeadTimeDays: number | null;
        defaultMinOrderQty: number | null;
    };
    supplier?: {
        id: string;
        name: string;
    } | null;
}

/**
 * OrderLine with SKU/Variation/Fabric relations for top fabrics queries
 */
interface OrderLineWithSkuRelations {
    id: string;
    orderId: string;
    qty: number;
    unitPrice: number | string;
    trackingStatus: string | null;
    sku: {
        id: string;
        variation: {
            id: string;
            product: {
                id: string;
                fabricTypeId: string | null;
                fabricType: {
                    id: string;
                    name: string;
                    composition: string | null;
                } | null;
            };
            fabric: {
                id: string;
                colorName: string;
                colorHex: string | null;
                fabricType: {
                    id: string;
                    name: string;
                    composition: string | null;
                } | null;
            } | null;
        };
    } | null;
}

/**
 * Order line for sales calculation (minimal fields)
 */
interface SalesOrderLine {
    qty: number;
    unitPrice: number | string;
}

/**
 * Reconciliation item with fabric relation
 */
interface ReconciliationItemWithFabric {
    id: string;
    fabricId: string;
    systemQty: number;
    physicalQty: number | null;
    variance: number | null;
    adjustmentReason: string | null;
    notes: string | null;
    fabric: FabricWithType;
}

/**
 * Reconciliation with items relation
 */
interface ReconciliationWithItems {
    id: string;
    status: string;
    notes: string | null;
    createdAt: Date;
    createdBy: string;
    items: ReconciliationItemWithFabric[];
}

// TransactionAggregation interface removed - not needed with proper Prisma typing

/**
 * Reconciliation history record from database
 */
interface ReconciliationHistoryRecord {
    id: string;
    reconcileDate: Date | null;
    status: string;
    createdBy: string;
    createdAt: Date;
    items: {
        id: string;
        variance: number | null;
    }[];
}

/**
 * Simple fabric record for reconciliation
 */
interface SimpleFabricRecord {
    id: string;
    name: string;
    colorName: string;
    fabricType: {
        id: string;
        unit: string;
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

/** Response type for getFabrics */
interface GetFabricsResponse {
    success: true;
    fabrics: Array<FabricWithType & {
        currentBalance: number;
        totalInward: number;
        totalOutward: number;
    }>;
}

/** Type view row for getFabricsFlat */
interface FabricTypeFlatRow {
    fabricTypeId: string;
    fabricTypeName: string;
    composition: string | null;
    unit: string;
    avgShrinkagePct: number | null;
    defaultCostPerUnit: number | null;
    defaultLeadTimeDays: number | null;
    defaultMinOrderQty: number | null;
    colorCount: number;
    totalStock: number;
    productCount: number;
    consumption7d: number;
    consumption30d: number;
    sales7d: number;
    sales30d: number;
    isTypeRow: boolean;
}

/** Color view row for getFabricsFlat */
interface FabricColorFlatRow {
    fabricId: string;
    colorName: string;
    colorHex: string | null;
    standardColor: string | null;
    fabricTypeId: string;
    fabricTypeName: string;
    composition: string | null;
    unit: string;
    avgShrinkagePct: number | null;
    supplierId: string | null;
    supplierName: string | null;
    costPerUnit: number | null;
    leadTimeDays: number | null;
    minOrderQty: number | null;
    effectiveCostPerUnit: number;
    effectiveLeadTimeDays: number;
    effectiveMinOrderQty: number;
    costInherited: boolean;
    leadTimeInherited: boolean;
    minOrderInherited: boolean;
    typeCostPerUnit: number | null;
    typeLeadTimeDays: number | null;
    typeMinOrderQty: number | null;
    currentBalance: number;
    totalInward: number;
    totalOutward: number;
    avgDailyConsumption: number;
    daysOfStock: number | null;
    reorderPoint: number;
    stockStatus: StockStatus;
    suggestedOrderQty: number;
    sales7d: number;
    sales30d: number;
    isTypeRow: boolean;
}

/** Response type for getFabricsFlat */
interface GetFabricsFlatResponse {
    success: true;
    items: Array<FabricTypeFlatRow | FabricColorFlatRow>;
    summary: {
        total: number;
        orderNow?: number;
        orderSoon?: number;
        ok?: number;
    };
}

/** Response type for getFabricById */
type GetFabricByIdResponse =
    | { success: true; fabric: FabricWithType & { currentBalance: number; totalInward: number; totalOutward: number } }
    | ErrorResponse;

/** Response type for getFabricsFilters */
interface GetFabricsFiltersResponse {
    success: true;
    filters: {
        fabricTypes: Array<{ id: string; name: string }>;
        suppliers: Array<{ id: string; name: string }>;
    };
}

/** Response type for getFabricTypes */
interface GetFabricTypesResponse {
    success: true;
    types: Array<{
        id: string;
        name: string;
        composition: string | null;
        unit: string;
        avgShrinkagePct: number | null;
        defaultCostPerUnit: number | null;
        defaultLeadTimeDays: number | null;
        defaultMinOrderQty: number | null;
        colorCount: number;
    }>;
}

/** Supplier record for getFabricSuppliers response */
interface SupplierRecord {
    id: string;
    name: string;
    isActive: boolean;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    createdAt: Date;
}

/** Response type for getFabricSuppliers */
interface GetFabricSuppliersResponse {
    success: true;
    suppliers: SupplierRecord[];
}

/** Transaction record for fabric transactions */
interface FabricTransactionRecord {
    id: string;
    fabricId: string;
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

/** Response type for getFabricTransactions */
interface GetFabricTransactionsResponse {
    success: true;
    transactions: FabricTransactionRecord[];
}

/** Transaction record with fabric details for getAllFabricTransactions */
interface FabricTransactionWithFabricRecord extends FabricTransactionRecord {
    fabric: {
        id: string;
        name: string;
        colorName: string;
        colorHex: string | null;
        fabricType: { id: string; name: string };
    };
}

/** Response type for getAllFabricTransactions */
interface GetAllFabricTransactionsResponse {
    success: true;
    transactions: FabricTransactionWithFabricRecord[];
}

/** Top fabrics result item */
interface TopFabricsResultItem {
    id: string;
    name: string;
    colorHex?: string | null;
    typeName?: string;
    composition: string | null;
    units: number;
    revenue: number;
    orderCount: number;
    productCount: number;
    topColors?: string[];
}

/** Response type for getTopFabrics */
interface GetTopFabricsResponse {
    success: true;
    level: 'type' | 'color';
    days: number;
    data: TopFabricsResultItem[];
}

/** Stock analysis item */
interface StockAnalysisItem {
    fabricId: string;
    fabricName: string;
    colorName: string;
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

/** Response type for getFabricStockAnalysis */
interface GetFabricStockAnalysisResponse {
    success: true;
    analysis: StockAnalysisItem[];
}

/** Reconciliation history item */
interface ReconciliationHistoryItem {
    id: string;
    date: Date | null;
    status: string;
    itemsCount: number;
    adjustments: number;
    createdBy: string;
    createdAt: Date;
}

/** Response type for getFabricReconciliationHistory */
interface GetFabricReconciliationHistoryResponse {
    success: true;
    history: ReconciliationHistoryItem[];
}

/** Reconciliation item detail */
interface ReconciliationItemDetail {
    id: string;
    fabricId: string;
    fabricName: string;
    colorName: string;
    unit: string;
    systemQty: number;
    physicalQty: number | null;
    variance: number | null;
    adjustmentReason: string | null;
    notes: string | null;
}

/** Response type for getFabricReconciliation */
type GetFabricReconciliationResponse =
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

/** Response type for startFabricReconciliation */
type StartFabricReconciliationResponse =
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

/** Response type for updateFabricReconciliationItems */
type UpdateFabricReconciliationItemsResponse =
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

/** Response type for submitFabricReconciliation */
type SubmitFabricReconciliationResponse =
    | {
        success: true;
        data: {
            reconciliationId: string;
            status: string;
            adjustmentsMade: number;
        };
    }
    | ErrorResponse;

/** Response type for deleteFabricReconciliation */
type DeleteFabricReconciliationResponse =
    | {
        success: true;
        data: {
            reconciliationId: string;
            deleted: boolean;
        };
    }
    | ErrorResponse;

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

// Dashboard-specific schema (matching dashboard card expected format)
const getTopFabricsForDashboardInputSchema = z.object({
    days: z.number().int().positive().optional().default(30),
    level: z.enum(['type', 'color']).optional().default('type'),
    limit: z.number().int().positive().optional().default(12),
});

// Dashboard-specific output types
export interface DashboardFabricData {
    id: string;
    name: string;
    colorHex?: string | null;
    typeName?: string;
    composition?: string | null;
    units: number;
    revenue: number;
    orderCount: number;
    productCount: number;
    topColors?: string[];
}

export interface DashboardTopFabricsResponse {
    level: 'type' | 'color';
    days: number;
    data: DashboardFabricData[];
}

const getReconciliationByIdInputSchema = z.object({
    id: z.string().uuid('Invalid reconciliation ID'),
});

const getReconciliationHistoryInputSchema = z.object({
    limit: z.number().int().positive().optional().default(10),
}).optional();

// ============================================
// MUTATION INPUT SCHEMAS
// ============================================

const startFabricReconciliationInputSchema = z.object({
    notes: z.string().optional(),
}).optional();

const updateFabricReconciliationItemsInputSchema = z.object({
    reconciliationId: z.string().uuid('Invalid reconciliation ID'),
    items: z.array(
        z.object({
            id: z.string().uuid('Invalid item ID'),
            physicalQty: z.number().nullable(),
            systemQty: z.number(),
            adjustmentReason: z.string().nullable().optional(),
            notes: z.string().nullable().optional(),
        })
    ),
});

const submitFabricReconciliationInputSchema = z.object({
    reconciliationId: z.string().uuid('Invalid reconciliation ID'),
});

const deleteFabricReconciliationInputSchema = z.object({
    reconciliationId: z.string().uuid('Invalid reconciliation ID'),
});

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
    prisma: PrismaInstance,
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
    prisma: PrismaInstance,
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
    .handler(async ({ data }): Promise<GetFabricsResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const where: Prisma.FabricWhereInput = {};

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
                async (fabric) => {
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
    .handler(async ({ data }): Promise<GetFabricsFlatResponse> => {
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
                    (types as FabricTypeWithFabrics[])
                        .filter((t) => t.name !== 'Default')
                        .map(async (type) => {
                            const fabricIds = type.fabrics.map((f) => f.id);

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
                                (sum: number, line: SalesOrderLine) =>
                                    sum + line.qty * Number(line.unitPrice),
                                0
                            );
                            const sales30d = sales30dLines.reduce(
                                (sum: number, line: SalesOrderLine) =>
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
            const where: Prisma.FabricWhereInput = { isActive: true };
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
                fabrics as FabricWithType[],
                async (fabric) => {
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
                        (sum: number, line: SalesOrderLine) =>
                            sum + line.qty * Number(line.unitPrice),
                        0
                    );
                    const sales30d = sales30dLines.reduce(
                        (sum: number, line: SalesOrderLine) =>
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
    .handler(async ({ data }): Promise<GetFabricByIdResponse> => {
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
    .handler(async (): Promise<GetFabricsFiltersResponse> => {
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
    .handler(async (): Promise<GetFabricTypesResponse> => {
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
    .handler(async ({ data }): Promise<GetFabricSuppliersResponse> => {
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
    .handler(async ({ data }): Promise<GetFabricTransactionsResponse> => {
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
    .handler(async ({ data }): Promise<GetAllFabricTransactionsResponse> => {
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
                            colorHex: true,
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
    .handler(async ({ data }): Promise<GetTopFabricsResponse> => {
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

            // Cast to typed array for proper property access
            const typedOrderLines = orderLines as unknown as OrderLineWithSkuRelations[];

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

                for (const line of typedOrderLines) {
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
                    const productId = line.sku?.variation?.product?.id;
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
                    level: 'color' as const,
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

                for (const line of typedOrderLines) {
                    const fabricType =
                        line.sku?.variation?.fabric?.fabricType ||
                        line.sku?.variation?.product?.fabricType;
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
                    const productId = line.sku?.variation?.product?.id;
                    if (productId) {
                        typeStats[key].productCount.add(productId);
                    }

                    // Track top colors within this type
                    const fabric = line.sku?.variation?.fabric;
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
                    level: 'type' as const,
                    days,
                    data: result,
                };
            }
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get top fabrics for dashboard card
 *
 * Returns top fabrics in the format expected by TopFabricsCard component.
 * This is a wrapper that returns data without the success wrapper.
 */
export const getTopFabricsForDashboard = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getTopFabricsForDashboardInputSchema.parse(input))
    .handler(async ({ data }): Promise<DashboardTopFabricsResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const { days, level, limit } = data;

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

            // Cast to typed array for proper property access
            const typedOrderLines = orderLines as unknown as OrderLineWithSkuRelations[];

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

                for (const line of typedOrderLines) {
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
                    const productId = line.sku?.variation?.product?.id;
                    if (productId) {
                        fabricStats[key].productCount.add(productId);
                    }
                }

                const result: DashboardFabricData[] = Object.values(fabricStats)
                    .map((f) => ({
                        id: f.id,
                        name: f.name,
                        colorHex: f.colorHex,
                        typeName: f.typeName,
                        composition: f.composition,
                        units: f.units,
                        revenue: f.revenue,
                        orderCount: f.orderCount.size,
                        productCount: f.productCount.size,
                    }))
                    .sort((a, b) => b.revenue - a.revenue)
                    .slice(0, limit);

                return { level: 'color', days, data: result };
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

                for (const line of typedOrderLines) {
                    const fabricType =
                        line.sku?.variation?.fabric?.fabricType ||
                        line.sku?.variation?.product?.fabricType;
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
                    const productId = line.sku?.variation?.product?.id;
                    if (productId) {
                        typeStats[key].productCount.add(productId);
                    }

                    // Track top colors within this type
                    const fabric = line.sku?.variation?.fabric;
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

                const result: DashboardFabricData[] = Object.values(typeStats)
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

                return { level: 'type', days, data: result };
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
    .handler(async (): Promise<GetFabricStockAnalysisResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const fabrics = await prisma.fabric.findMany({
                where: { isActive: true },
                include: { fabricType: true, supplier: true },
            });

            const analysis = await chunkProcess(
                fabrics as FabricWithType[],
                async (fabric) => {
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
    .handler(async ({ data }): Promise<GetFabricReconciliationHistoryResponse> => {
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

            const history = (reconciliations as ReconciliationHistoryRecord[]).map((r) => ({
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
export const getFabricReconciliation = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getReconciliationByIdInputSchema.parse(input))
    .handler(async ({ data }): Promise<GetFabricReconciliationResponse> => {
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

            // Cast to typed reconciliation for proper access
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

// ============================================
// RECONCILIATION MUTATIONS
// ============================================

/**
 * Start a new fabric reconciliation with all active fabrics
 *
 * Creates a reconciliation record and items for each active fabric with
 * their current system balance from FabricTransaction.
 */
export const startFabricReconciliation = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => startFabricReconciliationInputSchema.parse(input))
    .handler(async ({ data, context }): Promise<StartFabricReconciliationResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            // Get all active fabrics
            const fabrics = await prisma.fabric.findMany({
                where: { isActive: true },
                include: { fabricType: true },
            });

            if (fabrics.length === 0) {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST' as const,
                        message: 'No active fabrics found',
                    },
                };
            }

            // Calculate balances for all fabrics in batch
            const typedFabrics = fabrics as SimpleFabricRecord[];
            const fabricIds = typedFabrics.map((f) => f.id);
            const balanceMap = await calculateAllFabricBalances(prisma, fabricIds);

            // Create reconciliation with items
            const reconciliation = await prisma.fabricReconciliation.create({
                data: {
                    createdBy: context.user.id,
                    status: 'draft',
                    notes: data?.notes || null,
                    items: {
                        create: typedFabrics.map((fabric) => ({
                            fabricId: fabric.id,
                            systemQty: balanceMap.get(fabric.id)?.currentBalance || 0,
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

            // Cast to typed reconciliation for proper access
            const typedReconciliation = reconciliation as unknown as ReconciliationWithItems;

            return {
                success: true,
                data: {
                    id: typedReconciliation.id,
                    status: typedReconciliation.status,
                    createdAt: typedReconciliation.createdAt,
                    items: typedReconciliation.items.map((item) => ({
                        id: item.id,
                        fabricId: item.fabricId,
                        fabricName: item.fabric.name,
                        colorName: item.fabric.colorName,
                        unit: item.fabric.fabricType.unit,
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
 * Helper: Calculate fabric balances in batch from FabricTransaction
 */
async function calculateAllFabricBalances(
    prisma: PrismaInstance,
    fabricIds: string[]
): Promise<Map<string, { currentBalance: number }>> {
    const aggregations = await prisma.fabricTransaction.groupBy({
        by: ['fabricId', 'txnType'],
        where: { fabricId: { in: fabricIds } },
        _sum: { qty: true },
    });

    const balanceMap = new Map<string, { currentBalance: number }>();

    // Initialize all fabrics with zero balance
    for (const fabricId of fabricIds) {
        balanceMap.set(fabricId, { currentBalance: 0 });
    }

    // Calculate balances from aggregations
    const fabricTotals = new Map<string, { inward: number; outward: number }>();
    for (const agg of aggregations) {
        if (!fabricTotals.has(agg.fabricId)) {
            fabricTotals.set(agg.fabricId, { inward: 0, outward: 0 });
        }
        const totals = fabricTotals.get(agg.fabricId)!;
        if (agg.txnType === 'inward') {
            totals.inward = Number(agg._sum.qty) || 0;
        } else if (agg.txnType === 'outward') {
            totals.outward = Number(agg._sum.qty) || 0;
        }
    }

    for (const [fabricId, totals] of fabricTotals) {
        balanceMap.set(fabricId, { currentBalance: totals.inward - totals.outward });
    }

    return balanceMap;
}

/**
 * Update reconciliation items (physical quantities, reasons, notes)
 */
export const updateFabricReconciliationItems = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateFabricReconciliationItemsInputSchema.parse(input))
    .handler(async ({ data }): Promise<UpdateFabricReconciliationItemsResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const { reconciliationId, items } = data;

            const reconciliation = await prisma.fabricReconciliation.findUnique({
                where: { id: reconciliationId },
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

            if (reconciliation.status !== 'draft') {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST' as const,
                        message: 'Cannot update submitted reconciliation',
                    },
                };
            }

            // OPTIMIZED: Update all items in parallel using Promise.all
            // Each item needs unique variance calculation, so we batch the promises
            await Promise.all(
                items.map((item) => {
                    const variance =
                        item.physicalQty !== null && item.physicalQty !== undefined
                            ? item.physicalQty - item.systemQty
                            : null;

                    return prisma.fabricReconciliationItem.update({
                        where: { id: item.id },
                        data: {
                            physicalQty: item.physicalQty,
                            variance,
                            adjustmentReason: item.adjustmentReason || null,
                            notes: item.notes || null,
                        },
                    });
                })
            );

            // Reload reconciliation with updated items
            const updated = await prisma.fabricReconciliation.findUnique({
                where: { id: reconciliationId },
                include: {
                    items: {
                        include: {
                            fabric: { include: { fabricType: true } },
                        },
                    },
                },
            });

            // Cast to typed reconciliation for proper access
            const typedUpdated = updated as unknown as ReconciliationWithItems;

            return {
                success: true,
                data: {
                    id: typedUpdated.id,
                    status: typedUpdated.status,
                    createdAt: typedUpdated.createdAt,
                    items: typedUpdated.items.map((item) => ({
                        id: item.id,
                        fabricId: item.fabricId,
                        fabricName: item.fabric.name,
                        colorName: item.fabric.colorName,
                        unit: item.fabric.fabricType.unit,
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
 * Submit reconciliation and create adjustment transactions
 *
 * Creates FabricTransaction records for each variance:
 * - Positive variance (more physical than system): inward transaction
 * - Negative variance (less physical than system): outward transaction
 */
export const submitFabricReconciliation = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => submitFabricReconciliationInputSchema.parse(input))
    .handler(async ({ data, context }): Promise<SubmitFabricReconciliationResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const { reconciliationId } = data;

            const reconciliation = await prisma.fabricReconciliation.findUnique({
                where: { id: reconciliationId },
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

            if (reconciliation.status !== 'draft') {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST' as const,
                        message: 'Reconciliation already submitted',
                    },
                };
            }

            // Cast to typed reconciliation for proper access
            const typedReconciliation = reconciliation as unknown as ReconciliationWithItems;

            // Process items with variances in a transaction
            const itemsWithVariance = typedReconciliation.items.filter(
                (item) => item.variance !== null && item.variance !== 0
            );

            let transactionsCreated = 0;

            await prisma.$transaction(async (tx: PrismaTransaction) => {
                for (const item of itemsWithVariance) {
                    const variance = Number(item.variance);
                    const txnType = variance > 0 ? 'inward' : 'outward';
                    const qty = Math.abs(variance);

                    await tx.fabricTransaction.create({
                        data: {
                            fabricId: item.fabricId,
                            txnType,
                            qty,
                            unit: item.fabric.fabricType.unit,
                            reason: `reconciliation_${item.adjustmentReason || 'adjustment'}`,
                            referenceId: reconciliationId,
                            notes: item.notes || `Reconciliation adjustment`,
                            createdById: context.user.id,
                        },
                    });
                    transactionsCreated++;
                }

                // Mark reconciliation as submitted
                await tx.fabricReconciliation.update({
                    where: { id: reconciliationId },
                    data: { status: 'submitted' },
                });
            });

            return {
                success: true,
                data: {
                    reconciliationId,
                    status: 'submitted',
                    adjustmentsMade: transactionsCreated,
                },
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Delete a draft reconciliation
 */
export const deleteFabricReconciliation = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteFabricReconciliationInputSchema.parse(input))
    .handler(async ({ data }): Promise<DeleteFabricReconciliationResponse> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const { reconciliationId } = data;

            const reconciliation = await prisma.fabricReconciliation.findUnique({
                where: { id: reconciliationId },
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

            if (reconciliation.status !== 'draft') {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST' as const,
                        message: 'Cannot delete submitted reconciliation',
                    },
                };
            }

            // Delete reconciliation (cascade deletes items)
            await prisma.fabricReconciliation.delete({
                where: { id: reconciliationId },
            });

            return {
                success: true,
                data: {
                    reconciliationId,
                    deleted: true,
                },
            };
        } finally {
            await prisma.$disconnect();
        }
    });
