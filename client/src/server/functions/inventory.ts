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
import { getPrisma } from '@coh/shared/services/db';

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
    limit: z.number().int().positive().optional().default(100),
    offset: z.number().int().nonnegative().optional().default(0),
    // Filters for mobile inventory
    stockFilter: z.enum(['all', 'in_stock', 'out_of_stock', 'low_stock']).optional().default('all'),
    shopifyStatus: z.enum(['all', 'active', 'archived', 'draft']).optional().default('all'),
    discrepancy: z.enum(['all', 'has_discrepancy', 'no_discrepancy']).optional().default('all'),
    fabricFilter: z.enum(['all', 'has_fabric', 'no_fabric', 'low_fabric']).optional().default('all'),
    // Sorting
    sortBy: z.enum(['stock', 'shopify', 'fabric']).optional().default('stock'),
    sortOrder: z.enum(['desc', 'asc']).optional().default('desc'),
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
    fabricName: string | null;
    fabricUnit: string | null;
    fabricColourId: string | null;
    fabricColourName: string | null;
    fabricColourHex: string | null;
    fabricColourBalance: number | null;
    shopifyProductStatus: 'active' | 'archived' | 'draft' | null;
}

/** Top stocked product for analytics */
export interface TopStockedProduct {
    productId: string;
    productName: string;
    imageUrl: string | null;
    totalAvailable: number;
    colors: { colorName: string; available: number }[];
}

/** Aggregated stats computed from all matching SKUs (not just current page) */
export interface InventoryStats {
    totalPieces: number;
    totalSkus: number;
    inStockCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    topStockedProducts: TopStockedProduct[];
}

export interface InventoryAllResult {
    items: InventoryAllItem[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    };
    /** Aggregated stats from ALL matching SKUs (computed before pagination) */
    stats: InventoryStats;
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
                    },
                },
            },
        });

        if (!sku) {
            throw new Error('SKU not found');
        }

        // Calculate balance using query patterns
        const { calculateInventoryBalance: calcBalance } = await import('@coh/shared/services/db/queries');

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
                    // NOTE: fabric relation removed from Variation - now via BOM
                    fabric: null,
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
 * Direct balance calculation using Prisma query.
 * NOTE: Cannot import from @server/ in Server Functions (dev resolution issue).
 * Returns balance info for each requested SKU.
 */
export const getInventoryBalances = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): z.infer<typeof getInventoryBalancesSchema> =>
            getInventoryBalancesSchema.parse(input)
    )
    .handler(async ({ data }): Promise<InventoryBalanceItem[]> => {
        const { skuIds } = data;

        const prisma = await getPrisma();

        // Fetch SKUs (don't throw if some are missing - just return 0 balance)
        const skus = await prisma.sku.findMany({
            where: { id: { in: skuIds } },
            select: { id: true, skuCode: true, isActive: true },
        });

        const skuCodeMap = new Map<string, string>(skus.map((s: { id: string; skuCode: string }) => [s.id, s.skuCode]));

        // Calculate balances directly with raw query (avoiding @server/ import)
        // Only query for SKUs that exist in database
        const validSkuIds = skus.map((s: { id: string }) => s.id);

        let balanceMap = new Map<string, { totalInward: number; totalOutward: number; currentBalance: number }>();

        if (validSkuIds.length > 0) {
            const balances: Array<{
                skuId: string;
                totalInward: bigint;
                totalOutward: bigint;
                currentBalance: bigint;
            }> = await prisma.$queryRaw`
                SELECT
                    "skuId",
                    COALESCE(SUM(CASE WHEN "txnType" = 'inward' THEN qty ELSE 0 END), 0)::bigint AS "totalInward",
                    COALESCE(SUM(CASE WHEN "txnType" = 'outward' THEN qty ELSE 0 END), 0)::bigint AS "totalOutward",
                    COALESCE(SUM(CASE WHEN "txnType" = 'inward' THEN qty ELSE 0 END), 0) -
                    COALESCE(SUM(CASE WHEN "txnType" = 'outward' THEN qty ELSE 0 END), 0) AS "currentBalance"
                FROM "InventoryTransaction"
                WHERE "skuId" = ANY(${validSkuIds})
                GROUP BY "skuId"
            `;

            // Build balance lookup map
            balanceMap = new Map(
                balances.map((b) => [
                    b.skuId,
                    {
                        totalInward: Number(b.totalInward),
                        totalOutward: Number(b.totalOutward),
                        currentBalance: Number(b.currentBalance),
                    },
                ])
            );
        }

        return skuIds.map((skuId: string) => {
            const balance = balanceMap.get(skuId);

            return {
                skuId,
                skuCode: skuCodeMap.get(skuId) || '',
                totalInward: balance?.totalInward ?? 0,
                totalOutward: balance?.totalOutward ?? 0,
                totalReserved: 0, // Reserved is no longer used, kept for backwards compatibility
                currentBalance: balance?.currentBalance ?? 0,
                availableBalance: balance?.currentBalance ?? 0, // Available = current (no reservation)
                hasDataIntegrityIssue: false,
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
        const { includeCustomSkus, belowTarget, search, limit, offset, stockFilter, shopifyStatus, discrepancy, fabricFilter, sortBy, sortOrder } = data;

        const prisma = await getPrisma();

        // Use Kysely for SKU metadata fetch (JOINs SKU/Variation/Product/Fabric)
        const { listInventorySkusKysely } = await import('@coh/shared/services/db/queries');

        const skus = await listInventorySkusKysely({
            includeCustomSkus,
            search,
        });

        // Get balances from cache (already optimized with groupBy)
        const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');

        const skuIds = skus.map((sku) => sku.skuId);
        const balanceMap = await inventoryBalanceCache.get(prisma, skuIds);

        // Get unique fabricColourIds and calculate their balances (cached)
        const fabricColourIds = [...new Set(
            skus.map((sku) => sku.fabricColourId).filter((id): id is string => id !== null)
        )];

        // Calculate fabric colour balances using cache (5-min TTL, same as inventory)
        const { fabricColourBalanceCache } = await import('@coh/shared/services/inventory');
        const fcBalanceMap = await fabricColourBalanceCache.get(prisma, fabricColourIds);

        // Convert to simple number map for downstream use
        const fabricColourBalanceMap = new Map<string, number>();
        for (const [id, balance] of fcBalanceMap) {
            fabricColourBalanceMap.set(id, balance.currentBalance);
        }

        // Map SKU metadata with balances
        const balances: InventoryAllItem[] = skus.map((sku) => {
            const balance = balanceMap.get(sku.skuId) || {
                totalInward: 0,
                totalOutward: 0,
                currentBalance: 0,
                availableBalance: 0,
            };

            const imageUrl = sku.variationImageUrl || sku.productImageUrl || null;

            // Get fabric colour balance if linked
            const fabricColourBalance = sku.fabricColourId
                ? fabricColourBalanceMap.get(sku.fabricColourId) ?? null
                : null;

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
                fabricName: sku.fabricName ?? null,
                fabricUnit: sku.fabricUnit ?? null,
                fabricColourId: sku.fabricColourId ?? null,
                fabricColourName: sku.fabricColourName ?? null,
                fabricColourHex: sku.fabricColourHex ?? null,
                fabricColourBalance,
                shopifyProductStatus: sku.shopifyProductStatus ?? null,
            };
        });

        // Apply filters
        let filteredBalances = balances;

        // Legacy below-target filter
        if (belowTarget === true) {
            filteredBalances = filteredBalances.filter((b) => b.status === 'below_target');
        }

        // Stock filter
        if (stockFilter && stockFilter !== 'all') {
            filteredBalances = filteredBalances.filter((b) => {
                switch (stockFilter) {
                    case 'in_stock':
                        return b.availableBalance > 0;
                    case 'out_of_stock':
                        return b.availableBalance <= 0;
                    case 'low_stock':
                        return b.availableBalance > 0 && b.availableBalance < (b.targetStockQty || 10);
                    default:
                        return true;
                }
            });
        }

        // Shopify product status filter
        if (shopifyStatus && shopifyStatus !== 'all') {
            filteredBalances = filteredBalances.filter((b) => b.shopifyProductStatus === shopifyStatus);
        }

        // Shopify qty discrepancy filter
        if (discrepancy && discrepancy !== 'all') {
            filteredBalances = filteredBalances.filter((b) => {
                const hasDiscrepancy = b.shopifyQty !== null && b.shopifyQty !== b.availableBalance;
                return discrepancy === 'has_discrepancy' ? hasDiscrepancy : !hasDiscrepancy;
            });
        }

        // Fabric filter
        if (fabricFilter && fabricFilter !== 'all') {
            filteredBalances = filteredBalances.filter((b) => {
                switch (fabricFilter) {
                    case 'has_fabric':
                        return b.fabricColourBalance !== null && b.fabricColourBalance > 0;
                    case 'no_fabric':
                        return b.fabricColourBalance === null || b.fabricColourBalance <= 0;
                    case 'low_fabric':
                        return b.fabricColourBalance !== null && b.fabricColourBalance > 0 && b.fabricColourBalance < 10;
                    default:
                        return true;
                }
            });
        }

        // Sort by selected column and order
        filteredBalances.sort((a, b) => {
            let aVal: number;
            let bVal: number;

            switch (sortBy) {
                case 'shopify':
                    // Sort nulls to end
                    aVal = a.shopifyQty ?? (sortOrder === 'desc' ? -Infinity : Infinity);
                    bVal = b.shopifyQty ?? (sortOrder === 'desc' ? -Infinity : Infinity);
                    break;
                case 'fabric':
                    // Sort nulls to end
                    aVal = a.fabricColourBalance ?? (sortOrder === 'desc' ? -Infinity : Infinity);
                    bVal = b.fabricColourBalance ?? (sortOrder === 'desc' ? -Infinity : Infinity);
                    break;
                case 'stock':
                default:
                    aVal = a.availableBalance;
                    bVal = b.availableBalance;
                    break;
            }

            return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        });

        // ============================================
        // COMPUTE STATS FROM ALL FILTERED DATA (before pagination)
        // ============================================

        // Stock status counts
        let totalPieces = 0;
        let inStockCount = 0;
        let lowStockCount = 0;
        let outOfStockCount = 0;

        // Aggregate by product for top stocked
        const productStockMap = new Map<string, {
            productId: string;
            productName: string;
            imageUrl: string | null;
            totalAvailable: number;
            colorMap: Map<string, number>;
        }>();

        for (const item of filteredBalances) {
            totalPieces += item.availableBalance;

            if (item.availableBalance === 0) {
                outOfStockCount++;
            } else if (item.status === 'below_target') {
                lowStockCount++;
            } else {
                inStockCount++;
            }

            // Aggregate for top stocked products
            if (item.productId && item.availableBalance > 0) {
                let product = productStockMap.get(item.productId);
                if (!product) {
                    product = {
                        productId: item.productId,
                        productName: item.productName,
                        imageUrl: item.imageUrl,
                        totalAvailable: 0,
                        colorMap: new Map(),
                    };
                    productStockMap.set(item.productId, product);
                }
                product.totalAvailable += item.availableBalance;

                const colorKey = item.colorName || 'Unknown';
                product.colorMap.set(colorKey, (product.colorMap.get(colorKey) || 0) + item.availableBalance);

                if (!product.imageUrl && item.imageUrl) {
                    product.imageUrl = item.imageUrl;
                }
            }
        }

        // Build top 5 stocked products
        const topStockedProducts: TopStockedProduct[] = Array.from(productStockMap.values())
            .sort((a, b) => b.totalAvailable - a.totalAvailable)
            .slice(0, 5)
            .map(p => ({
                productId: p.productId,
                productName: p.productName,
                imageUrl: p.imageUrl,
                totalAvailable: p.totalAvailable,
                colors: Array.from(p.colorMap.entries())
                    .map(([colorName, available]) => ({ colorName, available }))
                    .sort((a, b) => b.available - a.available)
                    .slice(0, 3),
            }));

        const stats: InventoryStats = {
            totalPieces,
            totalSkus: filteredBalances.length,
            inStockCount,
            lowStockCount,
            outOfStockCount,
            topStockedProducts,
        };

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
            stats,
        };
    });

// ============================================
// GROUPED INVENTORY FOR MOBILE
// ============================================

/** Size-level stock data for mobile inventory */
export interface SizeStock {
    size: string;
    skuCode: string;
    skuId: string;
    stock: number;
    shopify: number | null;
    status: 'active' | 'archived' | 'draft' | null;
}

/** Color/variation group for mobile inventory */
export interface ColorGroup {
    variationId: string;
    colorName: string;
    imageUrl: string | null;
    sizes: SizeStock[];
    totalStock: number;
    totalShopify: number;
    hasArchived: boolean;
    archivedWithStock: SizeStock[];
    fabricName: string | null;
    fabricUnit: string | null;
    fabricColourName: string | null;
    fabricColourHex: string | null;
    fabricColourBalance: number | null;
}

/** Product group for mobile inventory */
export interface ProductGroup {
    productId: string;
    productName: string;
    imageUrl: string | null;
    colors: ColorGroup[];
    totalStock: number;
    totalShopify: number;
}

/** Result type for grouped inventory */
export interface InventoryGroupedResult {
    products: ProductGroup[];
    totalProducts: number;
    totalSkus: number;
}

const getInventoryGroupedSchema = z.object({
    search: z.string().optional(),
    stockFilter: z.enum(['all', 'in_stock', 'out_of_stock', 'low_stock']).optional().default('all'),
    shopifyStatus: z.enum(['all', 'active', 'archived', 'draft']).optional().default('all'),
    discrepancy: z.enum(['all', 'has_discrepancy', 'no_discrepancy']).optional().default('all'),
    fabricFilter: z.enum(['all', 'has_fabric', 'no_fabric', 'low_fabric']).optional().default('all'),
    sortBy: z.enum(['stock', 'shopify', 'fabric']).optional().default('stock'),
    sortOrder: z.enum(['desc', 'asc']).optional().default('desc'),
});

/**
 * Get inventory grouped by product for mobile view
 *
 * Performs server-side grouping of SKUs into Product > Variation > Size hierarchy.
 * Returns ~500 products instead of ~10,000 SKUs, significantly reducing payload size.
 */
export const getInventoryGrouped = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): z.infer<typeof getInventoryGroupedSchema> =>
            getInventoryGroupedSchema.parse(input)
    )
    .handler(async ({ data }): Promise<InventoryGroupedResult> => {
        const { search, stockFilter, shopifyStatus, discrepancy, fabricFilter, sortBy, sortOrder } = data;

        const prisma = await getPrisma();

        // Fetch all inventory using existing function logic
        const { listInventorySkusKysely } = await import('@coh/shared/services/db/queries');

        const skus = await listInventorySkusKysely({
            includeCustomSkus: false,
            search,
        });

        // Get balances from cache
        const { inventoryBalanceCache, fabricColourBalanceCache } = await import('@coh/shared/services/inventory');

        const skuIds = skus.map((sku) => sku.skuId);
        const balanceMap = await inventoryBalanceCache.get(prisma, skuIds);

        // Get fabric colour balances
        const fabricColourIds = [...new Set(
            skus.map((sku) => sku.fabricColourId).filter((id): id is string => id !== null)
        )];
        const fcBalanceMap = await fabricColourBalanceCache.get(prisma, fabricColourIds);

        const fabricColourBalanceMap = new Map<string, number>();
        for (const [id, balance] of fcBalanceMap) {
            fabricColourBalanceMap.set(id, balance.currentBalance);
        }

        // Size ordering for consistent display
        const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];

        // Group into Product > Variation > Size hierarchy
        const productMap = new Map<string, ProductGroup>();

        for (const sku of skus) {
            const balance = balanceMap.get(sku.skuId) || {
                totalInward: 0,
                totalOutward: 0,
                currentBalance: 0,
                availableBalance: 0,
            };

            const availableBalance = balance.availableBalance;
            const shopifyQty = sku.shopifyAvailableQty ?? null;
            const shopifyProductStatus = sku.shopifyProductStatus ?? null;
            const fabricColourBalance = sku.fabricColourId
                ? fabricColourBalanceMap.get(sku.fabricColourId) ?? null
                : null;

            // Apply filters before grouping
            // Stock filter
            if (stockFilter !== 'all') {
                if (stockFilter === 'in_stock' && availableBalance <= 0) continue;
                if (stockFilter === 'out_of_stock' && availableBalance > 0) continue;
                if (stockFilter === 'low_stock' && (availableBalance <= 0 || availableBalance >= (sku.targetStockQty || 10))) continue;
            }

            // Shopify status filter
            if (shopifyStatus !== 'all' && shopifyProductStatus !== shopifyStatus) continue;

            // Discrepancy filter
            if (discrepancy !== 'all') {
                const hasDiscrepancy = shopifyQty !== null && shopifyQty !== availableBalance;
                if (discrepancy === 'has_discrepancy' && !hasDiscrepancy) continue;
                if (discrepancy === 'no_discrepancy' && hasDiscrepancy) continue;
            }

            // Fabric filter
            if (fabricFilter !== 'all') {
                if (fabricFilter === 'has_fabric' && (fabricColourBalance === null || fabricColourBalance <= 0)) continue;
                if (fabricFilter === 'no_fabric' && fabricColourBalance !== null && fabricColourBalance > 0) continue;
                if (fabricFilter === 'low_fabric' && (fabricColourBalance === null || fabricColourBalance <= 0 || fabricColourBalance >= 10)) continue;
            }

            // Get or create product group
            let product = productMap.get(sku.productId);
            if (!product) {
                product = {
                    productId: sku.productId,
                    productName: sku.productName,
                    imageUrl: sku.productImageUrl || sku.variationImageUrl || null,
                    colors: [],
                    totalStock: 0,
                    totalShopify: 0,
                };
                productMap.set(sku.productId, product);
            }

            // Get or create color group
            let color = product.colors.find(c => c.variationId === sku.variationId);
            if (!color) {
                color = {
                    variationId: sku.variationId,
                    colorName: sku.colorName,
                    imageUrl: sku.variationImageUrl || sku.productImageUrl || null,
                    sizes: [],
                    totalStock: 0,
                    totalShopify: 0,
                    hasArchived: false,
                    archivedWithStock: [],
                    fabricName: sku.fabricName ?? null,
                    fabricUnit: sku.fabricUnit ?? null,
                    fabricColourName: sku.fabricColourName ?? null,
                    fabricColourHex: sku.fabricColourHex ?? null,
                    fabricColourBalance,
                };
                product.colors.push(color);
            }

            // Add size data
            const sizeData: SizeStock = {
                size: sku.size,
                skuCode: sku.skuCode,
                skuId: sku.skuId,
                stock: availableBalance,
                shopify: shopifyQty,
                status: shopifyProductStatus,
            };

            color.sizes.push(sizeData);
            color.totalStock += availableBalance;
            color.totalShopify += shopifyQty ?? 0;
            product.totalStock += availableBalance;
            product.totalShopify += shopifyQty ?? 0;

            // Track archived SKUs with Shopify stock
            if (shopifyProductStatus === 'archived') {
                color.hasArchived = true;
                if ((shopifyQty ?? 0) > 0) {
                    color.archivedWithStock.push(sizeData);
                }
            }

            // Update images if not set
            if (!product.imageUrl && (sku.variationImageUrl || sku.productImageUrl)) {
                product.imageUrl = sku.variationImageUrl || sku.productImageUrl || null;
            }
            if (!color.imageUrl && (sku.variationImageUrl || sku.productImageUrl)) {
                color.imageUrl = sku.variationImageUrl || sku.productImageUrl || null;
            }
        }

        // Sort sizes within each color
        for (const product of productMap.values()) {
            for (const color of product.colors) {
                color.sizes.sort((a, b) => {
                    const aIdx = sizeOrder.indexOf(a.size);
                    const bIdx = sizeOrder.indexOf(b.size);
                    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
                    if (aIdx !== -1) return -1;
                    if (bIdx !== -1) return 1;
                    return a.size.localeCompare(b.size);
                });
            }
        }

        // Convert to array and sort products
        let products = Array.from(productMap.values());

        // Sort by selected column and order
        products.sort((a, b) => {
            let aVal: number;
            let bVal: number;

            switch (sortBy) {
                case 'shopify':
                    aVal = a.totalShopify;
                    bVal = b.totalShopify;
                    break;
                case 'fabric':
                    // Sort by first color's fabric balance (or 0 if none)
                    aVal = a.colors[0]?.fabricColourBalance ?? 0;
                    bVal = b.colors[0]?.fabricColourBalance ?? 0;
                    break;
                case 'stock':
                default:
                    aVal = a.totalStock;
                    bVal = b.totalStock;
                    break;
            }

            return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        });

        // Count total SKUs
        const totalSkus = products.reduce((sum, p) =>
            sum + p.colors.reduce((cSum, c) => cSum + c.sizes.length, 0), 0);

        return {
            products,
            totalProducts: products.length,
            totalSkus,
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
        // NOTE: fabric relation removed from Variation - now via BOM
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
        } catch (error: unknown) {
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
    source: string | null;
    destination: string | null;
    tailorNumber: string | null;
    performedBy: string | null;
    orderNumber: string | null;
    warehouseLocation: string | null;
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
                source: true,
                destination: true,
                tailorNumber: true,
                performedBy: true,
                orderNumber: true,
                warehouseLocation: true,
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

        return transactions.map((t: typeof transactions[number]) => ({
            id: t.id,
            skuId: t.skuId,
            txnType: t.txnType as 'inward' | 'outward',
            qty: t.qty,
            reason: t.reason,
            referenceId: t.referenceId,
            notes: t.notes,
            source: t.source,
            destination: t.destination,
            tailorNumber: t.tailorNumber,
            performedBy: t.performedBy,
            orderNumber: t.orderNumber,
            warehouseLocation: t.warehouseLocation,
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

        return transactions.map((t: typeof transactions[number]) => ({
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
