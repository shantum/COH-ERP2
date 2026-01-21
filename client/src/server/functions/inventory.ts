/**
 * Inventory Query Server Functions
 *
 * TanStack Start Server Functions for inventory balance queries.
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

const getInventoryBalanceSchema = z.object({
    skuId: z.string().min(1, 'SKU ID is required'),
});

const getInventoryBalancesSchema = z.object({
    skuIds: z.array(z.string().min(1)).min(1, 'At least one SKU ID is required'),
});

const getInventoryAllSchema = z.object({
    includeCustomSkus: z.boolean().optional().default(false),
    belowTarget: z.boolean().optional(),
    search: z.string().optional(),
    limit: z.number().int().positive().optional().default(10000),
    offset: z.number().int().nonnegative().optional().default(0),
});

// Legacy schema kept for backwards compatibility
const inventoryListInputSchema = z.object({
    includeCustomSkus: z.boolean().optional().default(false),
    search: z.string().optional(),
    stockFilter: z.enum(['all', 'in_stock', 'low_stock', 'out_of_stock']).optional().default('all'),
    limit: z.number().int().positive().max(10000).optional().default(10000),
    offset: z.number().int().nonnegative().optional().default(0),
});

export type InventoryListInput = z.infer<typeof inventoryListInputSchema>;

// ============================================
// OUTPUT TYPES
// ============================================

/** Balance info for a single SKU with full details */
export interface InventoryBalanceResult {
    sku: {
        id: string;
        skuCode: string;
        size: string;
        isActive: boolean;
        targetStockQty: number | null;
        variation: {
            id: string;
            colorName: string;
            product: {
                id: string;
                name: string;
            };
            fabric: {
                id: string;
                name: string;
            } | null;
        };
    };
    totalInward: number;
    totalOutward: number;
    currentBalance: number;
    availableBalance: number;
    hasDataIntegrityIssue: boolean;
    targetStockQty: number | null;
    status: 'below_target' | 'ok';
}

/** Balance info for batch lookup */
export interface InventoryBalanceItem {
    skuId: string;
    skuCode: string;
    totalInward: number;
    totalOutward: number;
    totalReserved: number;
    currentBalance: number;
    availableBalance: number;
    hasDataIntegrityIssue: boolean;
}

/** Enriched SKU balance for inventory list */
export interface InventoryAllItem {
    skuId: string;
    skuCode: string;
    productId: string;
    productName: string;
    productType: string | null;
    gender: string | null;
    colorName: string;
    variationId: string;
    size: string;
    category: string | null;
    imageUrl: string | null;
    currentBalance: number;
    reservedBalance: number;
    availableBalance: number;
    totalInward: number;
    totalOutward: number;
    targetStockQty: number | null;
    status: 'below_target' | 'ok';
    mrp: number | null;
    shopifyQty: number | null;
    isCustomSku: boolean;
}

export interface InventoryAllResult {
    items: InventoryAllItem[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    };
}

// Legacy types kept for backwards compatibility
export interface InventoryItem {
    skuId: string;
    skuCode: string;
    productId: string;
    productName: string;
    productType: string;
    gender: string;
    colorName: string;
    variationId: string;
    size: string;
    category: string;
    imageUrl: string | null;
    currentBalance: number;
    reservedBalance: number;
    availableBalance: number;
    totalInward: number;
    totalOutward: number;
    targetStockQty: number;
    status: 'ok' | 'below_target';
    mrp: number;
    shopifyQty: number | null;
    isCustomSku: boolean;
}

export interface InventoryListResponse {
    items: InventoryItem[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    };
}

// ============================================
// HELPER: LAZY DATABASE IMPORTS
// ============================================

/**
 * Lazy import Prisma client to prevent bundling server code into client
 */
async function getPrisma() {
    const { PrismaClient } = await import('@prisma/client');
    const globalForPrisma = globalThis as unknown as {
        prisma: InstanceType<typeof PrismaClient> | undefined;
    };
    const prisma = globalForPrisma.prisma ?? new PrismaClient();
    if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.prisma = prisma;
    }
    return prisma;
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get balance for a single SKU
 *
 * Returns SKU details with inventory balance and status indicator.
 * Used for detailed SKU inventory view.
 */
export const getInventoryBalance = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): z.infer<typeof getInventoryBalanceSchema> =>
            getInventoryBalanceSchema.parse(input)
    )
    .handler(async ({ data }): Promise<InventoryBalanceResult> => {
        const { skuId } = data;

        const prisma = await getPrisma();

        // Fetch SKU with related data
        const sku = await prisma.sku.findUnique({
            where: { id: skuId },
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
            throw new Error('SKU not found');
        }

        // Calculate balance using query patterns
        const { calculateInventoryBalance: calcBalance } = await import(
            '../../../../server/src/utils/queryPatterns.js'
        );

        const balance = await calcBalance(prisma, skuId, {
            allowNegative: true,
        });

        return {
            sku: {
                id: sku.id,
                skuCode: sku.skuCode,
                size: sku.size,
                isActive: sku.isActive,
                targetStockQty: sku.targetStockQty,
                variation: {
                    id: sku.variation.id,
                    colorName: sku.variation.colorName,
                    product: {
                        id: sku.variation.product.id,
                        name: sku.variation.product.name,
                    },
                    fabric: sku.variation.fabric
                        ? {
                              id: sku.variation.fabric.id,
                              name: sku.variation.fabric.name,
                          }
                        : null,
                },
            },
            ...balance,
            targetStockQty: sku.targetStockQty,
            status: balance.currentBalance < (sku.targetStockQty || 0) ? 'below_target' : 'ok',
        };
    });

/**
 * Get balances for multiple SKUs
 *
 * Efficient batch lookup using inventoryBalanceCache.
 * Returns balance info for each requested SKU.
 */
export const getInventoryBalances = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): z.infer<typeof getInventoryBalancesSchema> =>
            getInventoryBalancesSchema.parse(input)
    )
    .handler(async ({ data }): Promise<InventoryBalanceItem[]> => {
        const { skuIds } = data;

        const prisma = await getPrisma();

        // Fetch SKUs to validate they exist
        const skus = await prisma.sku.findMany({
            where: { id: { in: skuIds } },
            select: { id: true, skuCode: true, isActive: true },
        });

        const foundSkuIds = new Set(skus.map((s) => s.id));
        const missingSkuIds = skuIds.filter((id) => !foundSkuIds.has(id));

        if (missingSkuIds.length > 0) {
            throw new Error(`SKUs not found: ${missingSkuIds.join(', ')}`);
        }

        // Get balances from cache
        const { inventoryBalanceCache } = await import(
            '../../../../server/src/services/inventoryBalanceCache.js'
        );

        const balanceMap = await inventoryBalanceCache.get(prisma, skuIds);
        const skuCodeMap = new Map(skus.map((s) => [s.id, s.skuCode]));

        return skuIds.map((skuId) => {
            const balance = balanceMap.get(skuId);

            return {
                skuId,
                skuCode: skuCodeMap.get(skuId) || '',
                totalInward: balance?.totalInward ?? 0,
                totalOutward: balance?.totalOutward ?? 0,
                totalReserved: 0, // Reserved is no longer used, kept for backwards compatibility
                currentBalance: balance?.currentBalance ?? 0,
                availableBalance: balance?.availableBalance ?? 0,
                hasDataIntegrityIssue: balance?.hasDataIntegrityIssue ?? false,
            };
        });
    });

/**
 * Get all inventory balances (main inventory page query)
 *
 * Uses Kysely for high-performance SKU metadata fetch, combined with
 * inventoryBalanceCache for efficient balance calculation.
 *
 * Features:
 * - Optional filtering by custom SKUs, below-target status, and search
 * - Server-side pagination
 * - Sorted by status (below_target first) then by SKU code
 */
export const getInventoryAll = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): z.infer<typeof getInventoryAllSchema> =>
            getInventoryAllSchema.parse(input)
    )
    .handler(async ({ data }): Promise<InventoryAllResult> => {
        const { includeCustomSkus, belowTarget, search, limit, offset } = data;

        const prisma = await getPrisma();

        // Use Kysely for SKU metadata fetch (JOINs SKU/Variation/Product/Fabric)
        const { listInventorySkusKysely } = await import(
            '../../../../server/src/db/queries/index.js'
        );

        const skus = await listInventorySkusKysely({
            includeCustomSkus,
            search,
        });

        // Get balances from cache (already optimized with groupBy)
        const { inventoryBalanceCache } = await import(
            '../../../../server/src/services/inventoryBalanceCache.js'
        );

        const skuIds = skus.map((sku) => sku.skuId);
        const balanceMap = await inventoryBalanceCache.get(prisma, skuIds);

        // Map SKU metadata with balances
        const balances: InventoryAllItem[] = skus.map((sku) => {
            const balance = balanceMap.get(sku.skuId) || {
                totalInward: 0,
                totalOutward: 0,
                currentBalance: 0,
                availableBalance: 0,
            };

            const imageUrl = sku.variationImageUrl || sku.productImageUrl || null;

            return {
                skuId: sku.skuId,
                skuCode: sku.skuCode,
                productId: sku.productId,
                productName: sku.productName,
                productType: sku.productType,
                gender: sku.gender,
                colorName: sku.colorName,
                variationId: sku.variationId,
                size: sku.size,
                category: sku.category,
                imageUrl,
                currentBalance: balance.currentBalance,
                reservedBalance: 0,
                availableBalance: balance.availableBalance,
                totalInward: balance.totalInward,
                totalOutward: balance.totalOutward,
                targetStockQty: sku.targetStockQty,
                status:
                    balance.availableBalance < (sku.targetStockQty || 0)
                        ? 'below_target'
                        : 'ok',
                mrp: sku.mrp,
                shopifyQty: sku.shopifyAvailableQty ?? null,
                isCustomSku: sku.isCustomSku || false,
            };
        });

        // Filter by below-target status if requested
        let filteredBalances = balances;
        if (belowTarget === true) {
            filteredBalances = balances.filter((b) => b.status === 'below_target');
        }

        // Sort: below_target first, then by SKU code
        filteredBalances.sort((a, b) => {
            if (a.status === 'below_target' && b.status !== 'below_target') return -1;
            if (a.status !== 'below_target' && b.status === 'below_target') return 1;
            return a.skuCode.localeCompare(b.skuCode);
        });

        // Apply pagination
        const totalCount = filteredBalances.length;
        const paginatedBalances = filteredBalances.slice(offset, offset + limit);

        return {
            items: paginatedBalances,
            pagination: {
                total: totalCount,
                limit,
                offset,
                hasMore: offset + paginatedBalances.length < totalCount,
            },
        };
    });

// ============================================
// LEGACY SERVER FUNCTION (Backwards Compatibility)
// ============================================

// Internal types for Prisma query results
interface BalanceRow {
    skuId: string;
    totalInward: bigint;
    totalOutward: bigint;
    currentBalance: bigint;
}

interface SkuWithRelations {
    id: string;
    skuCode: string;
    size: string;
    mrp: number;
    targetStockQty: number;
    isCustomSku: boolean;
    variation: {
        id: string;
        colorName: string;
        imageUrl: string | null;
        product: {
            id: string;
            name: string;
            productType: string | null;
            gender: string | null;
            category: string | null;
            imageUrl: string | null;
        };
        fabric: {
            name: string;
        } | null;
    };
    shopifyInventoryCache: {
        availableQty: number;
    } | null;
}

interface BalanceData {
    totalInward: number;
    totalOutward: number;
    currentBalance: number;
}

interface SkuWithBalance {
    sku: SkuWithRelations;
    balance: BalanceData;
}

/**
 * Legacy Server Function: Get inventory list
 *
 * Fetches inventory directly from database using Prisma.
 * Returns paginated items with balance calculations.
 *
 * @deprecated Use getInventoryAll instead for new code
 */
export const getInventoryList = createServerFn({ method: 'GET' })
    .inputValidator(
        (input: unknown): z.infer<typeof inventoryListInputSchema> =>
            inventoryListInputSchema.parse(input)
    )
    .handler(async ({ data }): Promise<InventoryListResponse> => {
        console.log('[Server Function] getInventoryList called with:', data);

        try {
            const prisma = await getPrisma();

            const { includeCustomSkus, search, stockFilter, limit, offset } = data;

            // Step 1: Get inventory balances by SKU using raw SQL for aggregation
            const balances: BalanceRow[] = await prisma.$queryRaw`
                SELECT
                    "skuId",
                    COALESCE(SUM(CASE WHEN "txnType" = 'inward' THEN "qty" ELSE 0 END), 0)::bigint AS "totalInward",
                    COALESCE(SUM(CASE WHEN "txnType" = 'outward' THEN "qty" ELSE 0 END), 0)::bigint AS "totalOutward",
                    COALESCE(SUM(CASE WHEN "txnType" = 'inward' THEN "qty" ELSE 0 END), 0) -
                    COALESCE(SUM(CASE WHEN "txnType" = 'outward' THEN "qty" ELSE 0 END), 0) AS "currentBalance"
                FROM "InventoryTransaction"
                GROUP BY "skuId"
            `;

            // Create balance lookup map for O(1) access
            const balanceMap = new Map<string, BalanceData>(
                balances.map((b: BalanceRow) => [
                    b.skuId,
                    {
                        totalInward: Number(b.totalInward),
                        totalOutward: Number(b.totalOutward),
                        currentBalance: Number(b.currentBalance),
                    },
                ])
            );

            // Step 2: Build base where clause for SKUs
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const skuWhere: Record<string, any> = {
                isActive: true,
                ...(includeCustomSkus ? {} : { isCustomSku: false }),
            };

            // Add search filter
            if (search) {
                const searchLower = search.toLowerCase();
                skuWhere.OR = [
                    { skuCode: { contains: searchLower, mode: 'insensitive' } },
                    { variation: { colorName: { contains: searchLower, mode: 'insensitive' } } },
                    { variation: { product: { name: { contains: searchLower, mode: 'insensitive' } } } },
                ];
            }

            // Step 3: Fetch all matching SKUs with related data
            const allSkus: SkuWithRelations[] = await prisma.sku.findMany({
                where: skuWhere,
                include: {
                    variation: {
                        include: {
                            product: true,
                            fabric: true,
                        },
                    },
                    shopifyInventoryCache: true,
                },
                orderBy: { skuCode: 'asc' },
            });

            // Step 4: Apply stock filter in memory (since balance is computed)
            let filteredSkus: SkuWithBalance[] = allSkus.map((sku: SkuWithRelations) => {
                const balance = balanceMap.get(sku.id) || {
                    totalInward: 0,
                    totalOutward: 0,
                    currentBalance: 0,
                };
                return { sku, balance };
            });

            // Apply stock filter
            if (stockFilter === 'in_stock') {
                filteredSkus = filteredSkus.filter((item: SkuWithBalance) => item.balance.currentBalance > 0);
            } else if (stockFilter === 'out_of_stock') {
                filteredSkus = filteredSkus.filter((item: SkuWithBalance) => item.balance.currentBalance <= 0);
            } else if (stockFilter === 'low_stock') {
                filteredSkus = filteredSkus.filter((item: SkuWithBalance) => {
                    const targetQty = item.sku.targetStockQty || 10;
                    return item.balance.currentBalance > 0 && item.balance.currentBalance < targetQty;
                });
            }

            // Step 5: Get total count and apply pagination
            const totalCount = filteredSkus.length;
            const paginatedSkus = filteredSkus.slice(offset, offset + limit);

            // Step 6: Transform to response format
            const items: InventoryItem[] = paginatedSkus.map(({ sku, balance }: SkuWithBalance) => {
                const { currentBalance, totalInward, totalOutward } = balance;
                const targetStockQty = sku.targetStockQty || 0;
                const imageUrl = sku.variation.imageUrl || sku.variation.product.imageUrl || null;

                return {
                    skuId: sku.id,
                    skuCode: sku.skuCode,
                    productId: sku.variation.product.id,
                    productName: sku.variation.product.name,
                    productType: sku.variation.product.productType || '',
                    gender: sku.variation.product.gender || '',
                    colorName: sku.variation.colorName,
                    variationId: sku.variation.id,
                    size: sku.size,
                    category: sku.variation.product.category || '',
                    imageUrl,
                    currentBalance,
                    reservedBalance: 0,
                    availableBalance: currentBalance,
                    totalInward,
                    totalOutward,
                    targetStockQty,
                    status: currentBalance < targetStockQty ? 'below_target' : 'ok',
                    mrp: Number(sku.mrp) || 0,
                    shopifyQty: sku.shopifyInventoryCache?.availableQty ?? null,
                    isCustomSku: sku.isCustomSku || false,
                };
            });

            console.log(
                '[Server Function] Query returned',
                items.length,
                'items, total:',
                totalCount
            );

            return {
                items,
                pagination: {
                    total: totalCount,
                    limit,
                    offset,
                    hasMore: offset + items.length < totalCount,
                },
            };
        } catch (error) {
            console.error('[Server Function] Error in getInventoryList:', error);
            throw error;
        }
    });

// ============================================
// INVENTORY TRANSACTIONS SERVER FUNCTION
// ============================================

const getInventoryTransactionsSchema = z.object({
    skuId: z.string().uuid().optional(),
    txnType: z.enum(['inward', 'outward']).optional(),
    reason: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional().default(500),
    offset: z.number().int().nonnegative().optional().default(0),
    days: z.number().int().positive().optional(),
}).optional();

export type GetInventoryTransactionsInput = z.infer<typeof getInventoryTransactionsSchema>;

/** Inventory transaction item */
export interface InventoryTransactionItem {
    id: string;
    skuId: string;
    txnType: 'inward' | 'outward';
    qty: number;
    reason: string | null;
    referenceId: string | null;
    notes: string | null;
    createdAt: string;
    createdBy: { id: string; name: string } | null;
    sku: {
        skuCode: string;
        size: string;
        isCustomSku: boolean;
        variation: {
            colorName: string;
            product: { name: string };
        };
    } | null;
}

/**
 * Get inventory transactions
 *
 * Returns inventory transactions with optional filtering by SKU, type, reason.
 * Used by Ledgers page for SKU transaction history.
 */
export const getInventoryTransactions = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): z.infer<typeof getInventoryTransactionsSchema> =>
            getInventoryTransactionsSchema.parse(input)
    )
    .handler(async ({ data }): Promise<InventoryTransactionItem[]> => {
        const prisma = await getPrisma();

        const { skuId, txnType, reason, limit, offset, days } = data ?? {};

        // Build where clause
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: Record<string, any> = {};

        if (skuId) {
            where.skuId = skuId;
        }
        if (txnType) {
            where.txnType = txnType;
        }
        if (reason) {
            where.reason = reason;
        }
        if (days) {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            where.createdAt = { gte: startDate };
        }

        const transactions = await prisma.inventoryTransaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit ?? 500,
            skip: offset ?? 0,
            select: {
                id: true,
                skuId: true,
                txnType: true,
                qty: true,
                reason: true,
                referenceId: true,
                notes: true,
                createdAt: true,
                sku: {
                    select: {
                        skuCode: true,
                        size: true,
                        isCustomSku: true,
                        variation: {
                            select: {
                                colorName: true,
                                product: { select: { name: true } },
                            },
                        },
                    },
                },
                createdBy: { select: { id: true, name: true } },
            },
        });

        return transactions.map((t) => ({
            id: t.id,
            skuId: t.skuId,
            txnType: t.txnType as 'inward' | 'outward',
            qty: t.qty,
            reason: t.reason,
            referenceId: t.referenceId,
            notes: t.notes,
            createdAt: t.createdAt.toISOString(),
            createdBy: t.createdBy,
            sku: t.sku,
        }));
    });

// ============================================
// RECENT INWARDS SERVER FUNCTION
// ============================================

const recentInwardsSchema = z.object({
    limit: z.number().int().positive().max(200).optional().default(50),
    source: z.enum(['all', 'production', 'returns', 'rto', 'repacking', 'adjustments', 'received', 'adjustment']).optional(),
});

export type RecentInwardsInput = z.infer<typeof recentInwardsSchema>;

/** Recent inward item for activity feed */
export interface RecentInwardItem {
    id: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    reason: string;
    source: string;
    notes: string | null;
    createdAt: string;
    createdBy: string;
    isAllocated: boolean;
}

/**
 * Get recent inward transactions for activity feed
 *
 * Returns inward transactions from the last 24 hours, optionally filtered by source.
 * Used by InwardHub for the recent activity display.
 */
export const getRecentInwards = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): z.infer<typeof recentInwardsSchema> =>
            recentInwardsSchema.parse(input)
    )
    .handler(async ({ data }): Promise<RecentInwardItem[]> => {
        const { limit, source } = data;

        const prisma = await getPrisma();

        // Map source param to reason values for filtering
        const reasonMap: Record<string, string[]> = {
            production: ['production'],
            returns: ['return_receipt'],
            rto: ['rto_received'],
            repacking: ['repack_complete'],
            adjustments: ['adjustment', 'found_stock', 'correction', 'received'],
            // Additional mappings for page compatibility
            received: ['received'],
            adjustment: ['adjustment', 'found_stock', 'correction'],
        };

        // Build where clause
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: Record<string, any> = {
            txnType: 'inward',
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        };

        // Add reason filter if source specified (skip 'all' or undefined)
        if (source && source !== 'all' && reasonMap[source]) {
            where.reason = { in: reasonMap[source] };
        }

        const transactions = await prisma.inventoryTransaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
                id: true,
                skuId: true,
                qty: true,
                reason: true,
                referenceId: true,
                notes: true,
                createdAt: true,
                sku: {
                    select: {
                        skuCode: true,
                        size: true,
                        variation: {
                            select: {
                                colorName: true,
                                product: { select: { name: true } },
                            },
                        },
                    },
                },
                createdBy: { select: { name: true } },
            },
        });

        // Helper to map reason to source
        const mapReasonToSource = (reason: string | null): string => {
            const mapping: Record<string, string> = {
                production: 'production',
                return_receipt: 'return',
                rto_received: 'rto',
                repack_complete: 'repacking',
                adjustment: 'adjustment',
                received: 'received',
            };
            return mapping[reason || ''] || 'adjustment';
        };

        return transactions.map((t) => ({
            id: t.id,
            skuId: t.skuId,
            skuCode: t.sku?.skuCode || '',
            productName: t.sku?.variation?.product?.name || '',
            colorName: t.sku?.variation?.colorName || '',
            size: t.sku?.size || '',
            qty: t.qty,
            reason: t.reason || '',
            source: mapReasonToSource(t.reason),
            notes: t.notes,
            createdAt: t.createdAt.toISOString(),
            createdBy: t.createdBy?.name || 'System',
            isAllocated: t.reason !== 'received',
        }));
    });
