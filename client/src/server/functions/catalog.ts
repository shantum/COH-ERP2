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
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';

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
    bomCost: number;
    // Costing
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

/** JSON-safe value type for serializable server function data */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Success response for catalog mutations
 */
export interface CatalogMutationSuccess {
    success: true;
    data: Record<string, JsonValue>;
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
    results: JsonValue;
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

// Type for SKU query with nested includes
// NOTE: fabricType, fabric removed from Variation as part of fabric consolidation
// Fabric info is now derived from VariationBomLine.fabricColourId
type SkuWithRelations = Prisma.SkuGetPayload<{
    include: {
        variation: {
            include: {
                product: true;
            };
        };
        shopifyInventoryCache: true;
    };
}>;

// Type for ShopifyProductCache query result
type ShopifyProductCacheRow = {
    id: string;
    rawData: Prisma.JsonValue;
};

// Type for Product query result in getCatalogCategories
type ProductQueryResult = {
    id: string;
    name: string;
    gender: string | null;
    category: string | null;
};

import { getSizeIndex as _getSizeIndex } from '@coh/shared/config/product';

function getSizeIndex(size: string): number {
    const idx = _getSizeIndex(size);
    return idx === -1 ? 999 : idx;
}

// ============================================
// EXPRESS API HELPER
// ============================================

/**
 * Helper to call Express API endpoints from Server Functions.
 * Handles auth token forwarding and environment-aware URL construction.
 *
 * See CLAUDE.md gotcha #27 for production URL handling.
 */
async function callExpressApi<T>(
    path: string,
    options: RequestInit = {}
): Promise<T> {
    const port = process.env.PORT || '3001';
    const apiUrl =
        process.env.NODE_ENV === 'production'
            ? `http://127.0.0.1:${port}` // Same server in production
            : 'http://localhost:3001'; // Separate dev server

    const authToken = getCookie('auth_token');

    const response = await fetch(`${apiUrl}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Cookie: `auth_token=${authToken}` } : {}),
            ...options.headers,
        },
    });

    if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage: string;
        try {
            const errorJson = JSON.parse(errorBody) as { error?: string; message?: string };
            errorMessage = errorJson.error || errorJson.message || `API call failed: ${response.status}`;
        } catch {
            errorMessage = `API call failed: ${response.status} - ${errorBody}`;
        }
        throw new Error(errorMessage);
    }

    return response.json() as Promise<T>;
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
 * COSTING: totalCost = bomCost
 *   bomCost: Pre-computed on SKU from BOM (fabric + trims + services + packaging + labor)
 */
export const getCatalogProducts = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getCatalogProductsSchema.parse(input ?? {}))
    .handler(async ({ data }): Promise<CatalogProductsResponse> => {
        try {
            const prisma = await getPrisma();
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
                // NOTE: fabric/fabricType removed - fabric info now comes from BOM
                const skus = await prisma.sku.findMany({
                    where: skuWhere,
                    include: {
                        variation: {
                            include: {
                                product: true,
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
                const skuIds = skus.map((sku: SkuWithRelations) => sku.id);
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

                // Fetch global cost config (for GST thresholds)
                const costConfig = await prisma.costConfig.findFirst();
                const gstThreshold = costConfig?.gstThreshold || 2500;
                const gstRateAbove = costConfig?.gstRateAbove || 18;
                const gstRateBelow = costConfig?.gstRateBelow || 5;

                // Batch fetch Shopify product cache for status lookup
                const shopifyProductIds = [
                    ...new Set(
                        skus
                            .map((sku: SkuWithRelations) => sku.variation.product.shopifyProductId)
                            .filter((id: string | null): id is string => Boolean(id))
                    ),
                ];
                const shopifyStatusMap = new Map<string, string>();
                if (shopifyProductIds.length > 0) {
                    const shopifyCache = await prisma.shopifyProductCache.findMany({
                        where: { id: { in: shopifyProductIds } },
                        select: { id: true, rawData: true },
                    });
                    shopifyCache.forEach((cache: ShopifyProductCacheRow) => {
                        try {
                            const cacheData = JSON.parse(cache.rawData as string) as { status?: string };
                            shopifyStatusMap.set(cache.id, cacheData.status || 'unknown');
                        } catch {
                            shopifyStatusMap.set(cache.id, 'unknown');
                        }
                    });
                }

                // Map to flat response structure
                let items: CatalogSkuItem[] = skus.map((sku: SkuWithRelations) => {
                    const balance: InventoryBalance = balanceMap.get(sku.id) || {
                        totalInward: 0,
                        totalOutward: 0,
                        currentBalance: 0,
                        availableBalance: 0,
                    };

                    const product = sku.variation.product;
                    const variation = sku.variation;

                    // BOM-based costing: bomCost covers everything (fabric + trims + services + packaging + labor)
                    const totalCost = Number(sku.bomCost) || 0;

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
                        bomCost: totalCost,
                        totalCost: Math.round(totalCost * 100) / 100,
                        gstRate,
                        exGstPrice,
                        gstAmount,
                        costMultiple,
                        isActive: sku.isActive,
                        variationId: variation.id,
                        colorName: variation.colorName,
                        hasLining: variation.hasLining || false,
                        // NOTE: fabricName now derived from BOM, not variation.fabric
                        fabricName: null, // TODO: Get from VariationBomLine
                        imageUrl: variation.imageUrl || product.imageUrl || null,
                        productId: product.id,
                        productName: product.name,
                        styleCode: product.styleCode ?? null,
                        category: product.category ?? null,
                        gender: product.gender ?? null,
                        productType: product.productType ?? null,
                        // NOTE: fabricTypeId removed - fabric info now from BOM
                        fabricTypeId: null,
                        fabricTypeName: null,
                        fabricId: null,
                        shopifyProductId: product.shopifyProductId || null,
                        shopifyStatus: product.shopifyProductId
                            ? (shopifyStatusMap.get(product.shopifyProductId) || 'not_cached')
                            : 'not_linked',
                        currentBalance: balance.currentBalance,
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
        } catch (error: unknown) {
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
            const prisma = await getPrisma();
                // NOTE: fabricTypes and fabrics removed - fabric is now via BOM
                const products = await prisma.product.findMany({
                    where: { isActive: true },
                    select: {
                        id: true,
                        name: true,
                        gender: true,
                        category: true,
                    },
                    orderBy: { name: 'asc' },
                });

                // Extract unique genders and categories
                const genders: string[] = [
                    ...new Set<string>(products.map((p: ProductQueryResult) => p.gender).filter((g: string | null): g is string => Boolean(g))),
                ].sort();
                const categories: string[] = [
                    ...new Set<string>(products.map((p: ProductQueryResult) => p.category).filter((c: string | null): c is string => Boolean(c))),
                ].sort();

                return {
                    genders,
                    categories,
                    products: products.map((p: ProductQueryResult) => ({
                        id: p.id,
                        name: p.name,
                        gender: p.gender,
                        category: p.category,
                    })),
                    // NOTE: fabricTypes and fabrics removed - fabric is now via BOM
                    fabricTypes: [],
                    fabrics: [],
                };
        } catch (error: unknown) {
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
    .handler(async ({ data }): Promise<CatalogMutationResponse> => {
        try {
            const prisma = await getPrisma();
                const updateData: Record<string, unknown> = {};
                if (data.mrp !== undefined) updateData.mrp = data.mrp;
                if (data.targetStockQty !== undefined) updateData.targetStockQty = data.targetStockQty;
                if (data.isActive !== undefined) updateData.isActive = data.isActive;

                const sku = await prisma.sku.update({
                    where: { id: data.skuId },
                    data: updateData,
                    include: {
                        variation: {
                            include: {
                                product: true,
                            },
                        },
                    },
                });

                // Prisma result is serialized to JSON by TanStack Start
                return { success: true, data: sku as unknown as Record<string, JsonValue> };
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
 *
 * Calls: POST /api/shopify/sync/products
 */
export const syncCatalogWithShopify = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => syncCatalogWithShopifySchema.parse(input ?? {}))
    .handler(async ({ data }): Promise<SyncCatalogResponse> => {
        try {
            const response = await callExpressApi<SyncResultData>(
                '/api/shopify/sync/products',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        limit: data.limit,
                        syncAll: data.syncAll,
                    }),
                }
            );

            return {
                success: true,
                data: response,
            };
        } catch (error: unknown) {
            console.error('syncCatalogWithShopify error:', error);
            const message = error instanceof Error ? error.message : 'Failed to sync catalog with Shopify';
            return { success: false, error: { message } };
        }
    });
