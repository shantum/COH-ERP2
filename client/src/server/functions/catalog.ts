/**
 * Catalog Server Functions
 *
 * TanStack Start Server Functions for catalog operations.
 * Provides combined product + inventory view for the catalog page.
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

const getCatalogProductsSchema = z.object({
    gender: z.string().optional(),
    category: z.string().optional(),
    productId: z.string().uuid().optional(),
    status: z.enum(['below_target', 'ok']).optional(),
    search: z.string().optional(),
    limit: z.number().int().positive().default(10000),
    offset: z.number().int().nonnegative().default(0),
});

const updateCatalogProductSchema = z.object({
    skuId: z.string().uuid('Invalid SKU ID'),
    mrp: z.number().positive().optional(),
    targetStockQty: z.number().int().nonnegative().optional(),
    fabricConsumption: z.number().positive().optional(),
    isActive: z.boolean().optional(),
});

const syncCatalogWithShopifySchema = z.object({
    limit: z.number().int().positive().default(50),
    syncAll: z.boolean().default(false),
});

// ============================================
// RESPONSE TYPES
// ============================================

/**
 * SKU inventory item in catalog response
 */
export interface CatalogSkuItem {
    // SKU identifiers
    skuId: string;
    skuCode: string;
    size: string;
    mrp: number | null;
    fabricConsumption: number | null;
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
    laborMinutes: number;
    // Costing
    fabricCostPerUnit: number;
    fabricCost: number;
    laborCost: number;
    totalCost: number;
    // GST & Pricing
    gstRate: number;
    exGstPrice: number;
    gstAmount: number;
    costMultiple: number | null;
    isActive: boolean;
    // Variation (color-level)
    variationId: string;
    colorName: string;
    hasLining: boolean;
    fabricName: string | null;
    imageUrl: string | null;
    // Product (style-level)
    productId: string;
    productName: string;
    styleCode: string | null;
    category: string | null;
    gender: string | null;
    productType: string | null;
    fabricTypeId: string | null;
    fabricTypeName: string | null;
    fabricId: string | null;
    // Shopify status
    shopifyProductId: string | null;
    shopifyStatus: string;
    // Inventory
    currentBalance: number;
    reservedBalance: number;
    availableBalance: number;
    totalInward: number;
    totalOutward: number;
    shopifyQty: number | null;
    targetStockQty: number | null;
    status: 'below_target' | 'ok';
}

/**
 * Catalog products response
 */
export interface CatalogProductsResponse {
    items: CatalogSkuItem[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    };
}

/**
 * Filter options for catalog UI
 */
export interface CatalogFiltersResponse {
    genders: string[];
    categories: string[];
    products: Array<{
        id: string;
        name: string;
        gender: string | null;
        category: string | null;
    }>;
    fabricTypes: Array<{
        id: string;
        name: string;
    }>;
    fabrics: Array<{
        id: string;
        name: string;
        colorName: string;
        fabricTypeId: string | null;
        displayName: string;
    }>;
}

// ============================================
// MUTATION RESPONSE TYPES
// ============================================

/**
 * Success response for catalog mutations
 */
export interface CatalogMutationSuccess {
    success: true;
    data: Record<string, unknown>;
}

/**
 * Error response for catalog mutations
 */
export interface CatalogMutationError {
    success: false;
    error: { message: string };
}

/**
 * Union type for catalog mutation responses
 */
export type CatalogMutationResponse = CatalogMutationSuccess | CatalogMutationError;

/**
 * Sync result data structure
 */
export interface SyncResultData {
    message: string;
    fetched: number;
    syncAll: boolean;
    results: unknown;
}

/**
 * Success response for Shopify sync
 */
export interface SyncCatalogSuccess {
    success: true;
    data: SyncResultData;
}

/**
 * Union type for sync catalog response
 */
export type SyncCatalogResponse = SyncCatalogSuccess | CatalogMutationError;

// ============================================
// HELPER TYPES FOR PRISMA QUERIES
// ============================================

interface InventoryBalance {
    totalInward: number;
    totalOutward: number;
    currentBalance: number;
    availableBalance: number;
}

interface BalanceRow {
    skuId: string;
    inward: bigint;
    outward: bigint;
}

// Size sort order for proper sorting (XS -> S -> M -> L -> XL -> 2XL -> etc)
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];

function getSizeIndex(size: string): number {
    const idx = SIZE_ORDER.indexOf(size);
    return idx === -1 ? 999 : idx;
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get catalog products with inventory and costing data
 *
 * Returns flat array of all SKUs with product hierarchy, inventory, and costing data.
 * Supports filtering by gender, category, productId, stock status, and search.
 *
 * COSTING CASCADE (null at any level = fallback to next):
 *   trimsCost: SKU -> Variation -> Product -> null
 *   liningCost: SKU -> Variation -> Product -> null (only if hasLining=true)
 *   packagingCost: SKU -> Variation -> Product -> CostConfig.defaultPackagingCost
 *   laborMinutes: SKU -> Variation -> Product.baseProductionTimeMins -> 60
 *   fabricCost: SKU.fabricConsumption * (Fabric.costPerUnit ?? FabricType.defaultCostPerUnit)
 */
export const getCatalogProducts = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getCatalogProductsSchema.parse(input ?? {}))
    .handler(async ({ data }): Promise<CatalogProductsResponse> => {
        try {
            const { PrismaClient } = await import('@prisma/client');
            const prisma = new PrismaClient();

            try {
                const { gender, category, productId, status, search, limit, offset } = data;

                // Build SKU filter using Prisma-compatible where clause
                const skuWhere: Record<string, unknown> = {
                    isActive: true,
                    isCustomSku: false,
                };

                // Add variation/product filters
                const variationWhere: Record<string, unknown> = {};
                const productWhere: Record<string, unknown> = {};

                if (gender) productWhere.gender = gender;
                if (category) productWhere.category = category;
                if (productId) variationWhere.productId = productId;

                // Search filter
                if (search) {
                    skuWhere.OR = [
                        { skuCode: { contains: search, mode: 'insensitive' } },
                        { variation: { colorName: { contains: search, mode: 'insensitive' } } },
                        { variation: { product: { name: { contains: search, mode: 'insensitive' } } } },
                    ];
                }

                // Apply nested filters
                if (Object.keys(productWhere).length > 0) {
                    variationWhere.product = productWhere;
                }
                if (Object.keys(variationWhere).length > 0) {
                    skuWhere.variation = variationWhere;
                }

                // Fetch all SKUs with full product hierarchy
                const skus = await prisma.sku.findMany({
                    where: skuWhere,
                    include: {
                        variation: {
                            include: {
                                product: {
                                    include: {
                                        fabricType: true,
                                    },
                                },
                                fabric: {
                                    include: {
                                        fabricType: true,
                                    },
                                },
                            },
                        },
                        shopifyInventoryCache: true,
                    },
                    orderBy: [
                        { variation: { product: { name: 'asc' } } },
                        { variation: { colorName: 'asc' } },
                        { size: 'asc' },
                    ],
                    take: limit,
                    skip: offset,
                });

                // Calculate all inventory balances in single batch query
                const skuIds = skus.map(sku => sku.id);
                const balances: BalanceRow[] = await prisma.$queryRaw`
                    SELECT
                        "skuId",
                        SUM(CASE WHEN qty > 0 THEN qty ELSE 0 END)::bigint AS "inward",
                        SUM(CASE WHEN qty < 0 THEN ABS(qty) ELSE 0 END)::bigint AS "outward"
                    FROM "InventoryTransaction"
                    WHERE "skuId" = ANY(${skuIds})
                    GROUP BY "skuId"
                `;

                const balanceMap = new Map<string, InventoryBalance>(
                    balances.map(b => [
                        b.skuId,
                        {
                            totalInward: Number(b.inward),
                            totalOutward: Number(b.outward),
                            currentBalance: Number(b.inward) - Number(b.outward),
                            availableBalance: Number(b.inward) - Number(b.outward),
                        },
                    ])
                );

                // Fetch global cost config
                const costConfig = await prisma.costConfig.findFirst();
                const globalPackagingCost = costConfig?.defaultPackagingCost || 50;
                const laborRatePerMin = costConfig?.laborRatePerMin || 2.5;
                const gstThreshold = costConfig?.gstThreshold || 2500;
                const gstRateAbove = costConfig?.gstRateAbove || 18;
                const gstRateBelow = costConfig?.gstRateBelow || 5;

                // Batch fetch Shopify product cache for status lookup
                const shopifyProductIds = [
                    ...new Set(
                        skus
                            .map(sku => sku.variation.product.shopifyProductId)
                            .filter((id): id is string => Boolean(id))
                    ),
                ];
                const shopifyStatusMap = new Map<string, string>();
                if (shopifyProductIds.length > 0) {
                    const shopifyCache = await prisma.shopifyProductCache.findMany({
                        where: { id: { in: shopifyProductIds } },
                        select: { id: true, rawData: true },
                    });
                    shopifyCache.forEach(cache => {
                        try {
                            const cacheData = JSON.parse(cache.rawData as string) as { status?: string };
                            shopifyStatusMap.set(cache.id, cacheData.status || 'unknown');
                        } catch {
                            shopifyStatusMap.set(cache.id, 'unknown');
                        }
                    });
                }

                // Map to flat response structure
                let items: CatalogSkuItem[] = skus.map(sku => {
                    const balance: InventoryBalance = balanceMap.get(sku.id) || {
                        totalInward: 0,
                        totalOutward: 0,
                        currentBalance: 0,
                        availableBalance: 0,
                    };

                    const product = sku.variation.product;
                    const variation = sku.variation;

                    // Cascade costs
                    const effectiveTrimsCost =
                        sku.trimsCost ?? variation.trimsCost ?? product.trimsCost ?? null;
                    const effectiveLiningCost = variation.hasLining
                        ? (sku.liningCost ?? variation.liningCost ?? product.liningCost ?? null)
                        : null;
                    const effectivePackagingCost =
                        sku.packagingCost ?? variation.packagingCost ?? product.packagingCost ?? globalPackagingCost;
                    const effectiveLaborMinutes =
                        sku.laborMinutes ?? variation.laborMinutes ?? product.baseProductionTimeMins ?? 60;

                    // Calculate fabric cost
                    const fabricCostPerUnit =
                        Number(variation.fabric?.costPerUnit ?? variation.fabric?.fabricType?.defaultCostPerUnit) || 0;
                    const fabricCost = (Number(sku.fabricConsumption) || 0) * fabricCostPerUnit;
                    const laborCost = (Number(effectiveLaborMinutes) || 0) * laborRatePerMin;
                    const totalCost =
                        (fabricCost || 0) +
                        (laborCost || 0) +
                        (effectiveTrimsCost || 0) +
                        (effectiveLiningCost || 0) +
                        (effectivePackagingCost || 0);

                    // GST calculations
                    const mrp = Number(sku.mrp) || 0;
                    const gstRate = mrp >= gstThreshold ? gstRateAbove : gstRateBelow;
                    const exGstPrice = mrp > 0 ? Math.round((mrp / (1 + gstRate / 100)) * 100) / 100 : 0;
                    const gstAmount = Math.round((mrp - exGstPrice) * 100) / 100;
                    const costMultiple = totalCost > 0 ? Math.round((mrp / totalCost) * 100) / 100 : null;

                    return {
                        skuId: sku.id,
                        skuCode: sku.skuCode,
                        size: sku.size,
                        mrp: sku.mrp ?? null,
                        fabricConsumption: sku.fabricConsumption ?? null,
                        trimsCost: effectiveTrimsCost,
                        liningCost: effectiveLiningCost,
                        packagingCost: effectivePackagingCost,
                        laborMinutes: effectiveLaborMinutes,
                        fabricCostPerUnit,
                        fabricCost: Math.round(fabricCost * 100) / 100,
                        laborCost: Math.round(laborCost * 100) / 100,
                        totalCost: Math.round(totalCost * 100) / 100,
                        gstRate,
                        exGstPrice,
                        gstAmount,
                        costMultiple,
                        isActive: sku.isActive,
                        variationId: variation.id,
                        colorName: variation.colorName,
                        hasLining: variation.hasLining || false,
                        fabricName: variation.fabric
                            ? `${variation.fabric.fabricType?.name || 'Unknown'} - ${variation.fabric.colorName}`
                            : null,
                        imageUrl: variation.imageUrl || product.imageUrl || null,
                        productId: product.id,
                        productName: product.name,
                        styleCode: product.styleCode ?? null,
                        category: product.category ?? null,
                        gender: product.gender ?? null,
                        productType: product.productType ?? null,
                        fabricTypeId: product.fabricTypeId || null,
                        fabricTypeName: product.fabricType?.name || null,
                        fabricId: variation.fabricId || null,
                        shopifyProductId: product.shopifyProductId || null,
                        shopifyStatus: product.shopifyProductId
                            ? (shopifyStatusMap.get(product.shopifyProductId) || 'not_cached')
                            : 'not_linked',
                        currentBalance: balance.currentBalance,
                        reservedBalance: 0,
                        availableBalance: balance.availableBalance,
                        totalInward: balance.totalInward,
                        totalOutward: balance.totalOutward,
                        shopifyQty: sku.shopifyInventoryCache?.availableQty ?? null,
                        targetStockQty: sku.targetStockQty ?? null,
                        status: balance.availableBalance < (sku.targetStockQty ?? 0) ? 'below_target' : 'ok',
                    };
                });

                // Filter by stock status
                if (status === 'below_target') {
                    items = items.filter(item => item.status === 'below_target');
                } else if (status === 'ok') {
                    items = items.filter(item => item.status === 'ok');
                }

                // Sort by product name, color, then size
                items.sort((a, b) => {
                    const nameCompare = a.productName.localeCompare(b.productName);
                    if (nameCompare !== 0) return nameCompare;
                    const colorCompare = a.colorName.localeCompare(b.colorName);
                    if (colorCompare !== 0) return colorCompare;
                    return getSizeIndex(a.size) - getSizeIndex(b.size);
                });

                // Get total count
                const totalCount = await prisma.sku.count({ where: skuWhere });

                return {
                    items,
                    pagination: {
                        total: totalCount,
                        limit,
                        offset,
                        hasMore: offset + items.length < totalCount,
                    },
                };
            } finally {
                await prisma.$disconnect();
            }
        } catch (error) {
            console.error('getCatalogProducts error:', error);
            throw error;
        }
    });

/**
 * Get catalog filter options
 *
 * Returns filter options for catalog page UI (genders, categories, products, fabric types, fabrics).
 * Used to populate dropdowns in filter bar.
 */
export const getCatalogCategories = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<CatalogFiltersResponse> => {
        try {
            const { PrismaClient } = await import('@prisma/client');
            const prisma = new PrismaClient();

            try {
                const [products, fabricTypes, fabrics] = await Promise.all([
                    prisma.product.findMany({
                        where: { isActive: true },
                        select: {
                            id: true,
                            name: true,
                            gender: true,
                            category: true,
                        },
                        orderBy: { name: 'asc' },
                    }),
                    prisma.fabricType.findMany({
                        select: {
                            id: true,
                            name: true,
                        },
                        orderBy: { name: 'asc' },
                    }),
                    prisma.fabric.findMany({
                        where: { isActive: true },
                        select: {
                            id: true,
                            name: true,
                            colorName: true,
                            fabricTypeId: true,
                        },
                        orderBy: [{ name: 'asc' }, { colorName: 'asc' }],
                    }),
                ]);

                // Extract unique genders and categories
                const genders = [
                    ...new Set(products.map(p => p.gender).filter((g): g is string => Boolean(g))),
                ].sort();
                const categories = [
                    ...new Set(products.map(p => p.category).filter((c): c is string => Boolean(c))),
                ].sort();

                return {
                    genders,
                    categories,
                    products: products.map(p => ({
                        id: p.id,
                        name: p.name,
                        gender: p.gender,
                        category: p.category,
                    })),
                    fabricTypes: fabricTypes.map(ft => ({
                        id: ft.id,
                        name: ft.name,
                    })),
                    fabrics: fabrics.map(f => ({
                        id: f.id,
                        name: f.name,
                        colorName: f.colorName,
                        fabricTypeId: f.fabricTypeId,
                        displayName: f.name,
                    })),
                };
            } finally {
                await prisma.$disconnect();
            }
        } catch (error) {
            console.error('getCatalogCategories error:', error);
            throw error;
        }
    });

/**
 * Update catalog product (SKU)
 *
 * Updates SKU fields like MRP, target stock quantity, fabric consumption, and active status.
 * Used for quick edits from the catalog view.
 */
export const updateCatalogProduct = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateCatalogProductSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const { PrismaClient } = await import('@prisma/client');
            const prisma = new PrismaClient();

            try {
                const updateData: Record<string, unknown> = {};
                if (data.mrp !== undefined) updateData.mrp = data.mrp;
                if (data.targetStockQty !== undefined) updateData.targetStockQty = data.targetStockQty;
                if (data.fabricConsumption !== undefined) updateData.fabricConsumption = data.fabricConsumption;
                if (data.isActive !== undefined) updateData.isActive = data.isActive;

                const sku = await prisma.sku.update({
                    where: { id: data.skuId },
                    data: updateData,
                    include: {
                        variation: {
                            include: {
                                product: true,
                                fabric: true,
                            },
                        },
                    },
                });

                return { success: true, data: sku };
            } finally {
                await prisma.$disconnect();
            }
        } catch (error: unknown) {
            console.error('updateCatalogProduct error:', error);
            const message = error instanceof Error ? error.message : 'Failed to update catalog product';
            return { success: false, error: { message } };
        }
    });

/**
 * Sync catalog with Shopify
 *
 * Triggers a product sync with Shopify to update product catalog data.
 * This imports/updates products from Shopify into the ERP.
 */
export const syncCatalogWithShopify = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => syncCatalogWithShopifySchema.parse(input ?? {}))
    .handler(async ({ data }) => {
        try {
            // Dynamic import to avoid bundling server-only code
            const { syncAllProducts } = await import('@server/services/productSyncService.js');
            const { PrismaClient } = await import('@prisma/client');
            const prisma = new PrismaClient();

            try {
                const { shopifyProducts, results } = await syncAllProducts(prisma, {
                    limit: data.limit,
                    syncAll: data.syncAll,
                });

                return {
                    success: true,
                    data: {
                        message: 'Product sync completed',
                        fetched: shopifyProducts.length,
                        syncAll: data.syncAll,
                        results,
                    },
                };
            } finally {
                await prisma.$disconnect();
            }
        } catch (error: unknown) {
            console.error('syncCatalogWithShopify error:', error);
            const message = error instanceof Error ? error.message : 'Failed to sync catalog with Shopify';
            return { success: false, error: { message } };
        }
    });
