/**
 * Products Server Functions
 *
 * TanStack Start Server Functions for products data fetching.
 * Uses Prisma for database queries.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
// NOTE: kysely's `sql` is imported dynamically inside functions to prevent client bundling
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import {
    productsListResultSchema,
    type ProductsListResult,
    type ProductWithVariations,
    type VariationRow,
    type SkuRow,
    skuAutocompleteInputSchema,
    skuAutocompleteResultSchema,
    type SkuAutocompleteResult,
    type SkuAutocompleteItem,
} from '@coh/shared';

// Input validation schema
const productsTreeInputSchema = z.object({
    search: z.string().optional(),
});

export type ProductsTreeInput = z.infer<typeof productsTreeInputSchema>;

// ============================================
// DATABASE IMPORTS
// ============================================

import { getKysely } from '@coh/shared/services/db';

/**
 * Response type matching useProductsTree expectations
 */
export interface ProductsTreeResponse {
    items: ProductNode[];
    summary: {
        products: number;
        variations: number;
        skus: number;
        totalStock: number;
    };
}

/**
 * Product node in the tree
 */
export interface ProductNode {
    id: string;
    type: 'product';
    name: string;
    isActive: boolean;
    styleCode?: string;
    category: string;
    gender?: string;
    productType?: string;
    fabricTypeId?: string;
    fabricTypeName?: string;
    imageUrl?: string;
    hasLining: boolean;
    variationCount: number;
    skuCount: number;
    totalStock: number;
    avgMrp: number | null;
    // Shopify status (inherited by variations)
    shopifyStatus?: ShopifyStatus;
    children: VariationNode[];
}

/**
 * Shopify product/variation status
 */
export type ShopifyStatus = 'active' | 'archived' | 'draft' | 'not_linked' | 'not_cached' | 'unknown';

/**
 * Variation node in the tree
 */
export interface VariationNode {
    id: string;
    type: 'variation';
    name: string;
    isActive: boolean;
    productId: string;
    productName: string;
    colorName: string;
    colorHex?: string;
    fabricId?: string;
    fabricName?: string;
    // New 3-tier fabric hierarchy fields
    fabricColourId?: string;
    fabricColourCode?: string;
    fabricColourName?: string;
    fabricColourHex?: string;
    materialId?: string;
    materialName?: string;
    hasBomFabricLine: boolean;
    imageUrl?: string;
    hasLining: boolean;
    totalStock: number;
    avgMrp: number | null;
    // Shopify & Sales fields
    shopifyStatus?: ShopifyStatus;
    shopifyStock?: number;
    fabricStock?: number;
    sales30DayUnits?: number;
    sales30DayValue?: number;
    bomCost?: number;              // Pre-computed average BOM cost
    shopifySourceProductId?: string; // Variation's Shopify product ID
    children: SkuNode[];
}

/**
 * SKU node in the tree
 */
export interface SkuNode {
    id: string;
    type: 'sku';
    name: string;
    isActive: boolean;
    variationId: string;
    skuCode: string;
    barcode: string;
    size: string;
    mrp: number;
    sellingPrice?: number;         // ERP selling price (null = same as MRP, i.e. not discounted)
    currentBalance: number;
    availableBalance: number;
    targetStockQty?: number;
    // Shopify & Sales fields
    shopifyVariantId?: string;
    shopifyProductId?: string;
    shopifyPrice?: number;         // Shopify compare_at_price (original) or price if no compare_at
    shopifySalePrice?: number;     // Shopify price when on sale (compare_at_price exists)
    shopifySalePercent?: number;   // Discount percentage
    shopifyStock?: number;
    sales30DayUnits?: number;
    sales30DayValue?: number;
    bomCost?: number;              // Pre-computed total BOM cost
}

// Internal types for Prisma query results
interface BalanceRow {
    skuId: string;
    balance: bigint;
}

interface SkuData {
    id: string;
    skuCode: string;
    variationId: string;
    size: string;
    mrp: number;
    sellingPrice: number | null;
    targetStockQty: number | null;
    currentBalance: number;
    isActive: boolean;
    bomCost: number | null;
    shopifyVariantId: string | null;
}

interface VariationData {
    id: string;
    productId: string;
    colorName: string;
    colorHex: string | null;
    // NOTE: fabricId, fabricColourId, fabric, and fabricColour relations removed from Variation
    // Fabric assignment is now via BOM (VariationBomLine.fabricColourId)
    imageUrl: string | null;
    isActive: boolean;
    hasLining: boolean;
    bomCost: number | null;
    shopifySourceProductId: string | null;
    skus: SkuData[];
}

interface ProductData {
    id: string;
    name: string;
    styleCode: string | null;
    category: string;
    gender: string;
    productType: string;
    // NOTE: fabricTypeId removed from schema - fabric type now derived from BOM materials
    shopifyProductId: string | null;
    imageUrl: string | null;
    isActive: boolean;
    baseProductionTimeMins: number;
    // NOTE: fabricType relation removed - now derived from BOM materials
    variations: VariationData[];
}

/**
 * Server Function: Get products tree
 *
 * Fetches products directly from database using Prisma.
 * Returns hierarchical tree ready for TanStack Table display.
 */
export const getProductsTree = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => productsTreeInputSchema.parse(input))
    .handler(async ({ data }): Promise<ProductsTreeResponse> => {
        try {
            const prisma = await getPrisma();

            const { search } = data;

            // NOTE: SKU balances are now read directly from Sku.currentBalance
            // (maintained by DB trigger). No need to aggregate from InventoryTransaction.

            // Step 1: Pre-fetch all metrics data in parallel (N+1 safe)
            // NOTE: getFabricColourBalancesKysely removed - fabric assignment now via BOM
            const {
                getVariationSalesMetricsKysely,
                getSkuSalesMetricsKysely,
                getVariationShopifyStockKysely,
                getSkuShopifyStockKysely,
                getVariationShopifyStatusesKysely,
                getSkuShopifyPricingKysely,
            } = await import('@coh/shared/services/db/queries');

            const [
                variationSalesMap,
                skuSalesMap,
                variationShopifyStockMap,
                skuShopifyStockMap,
                // fabricColourBalanceMap removed - fabric assignment now via BOM
                variationShopifyStatusMap,
                shopifyPricingMap,
            ] = await Promise.all([
                getVariationSalesMetricsKysely(),
                getSkuSalesMetricsKysely(),
                getVariationShopifyStockKysely(),
                getSkuShopifyStockKysely(),
                // Uses variation-level shopifySourceProductId for accurate status
                getVariationShopifyStatusesKysely(),
                getSkuShopifyPricingKysely(),
            ]);

            // Step 1b: Pre-fetch BOM fabric details (N+1 safe - single query)
            // Find all variations that have at least one VariationBomLine with:
            // - A ComponentRole whose ComponentType.code = 'FABRIC'
            // - fabricColourId is not null
            // Include full fabric hierarchy for display
            const variationsWithBomFabric = await prisma.variationBomLine.findMany({
                where: {
                    fabricColourId: { not: null },
                    role: {
                        type: { code: 'FABRIC' },
                    },
                },
                select: {
                    variationId: true,
                    fabricColourId: true,
                    fabricColour: {
                        select: {
                            id: true,
                            code: true,
                            colourName: true,
                            colourHex: true,
                            currentBalance: true,
                            fabric: {
                                select: {
                                    id: true,
                                    name: true,
                                    unit: true,
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
                },
            });
            // Build map of variationId -> fabric details
            const bomFabricMap = new Map<string, {
                fabricColourId: string;
                fabricColourCode: string | null;
                fabricColourName: string;
                fabricColourHex: string | null;
                fabricId: string;
                fabricName: string;
                fabricUnit: string | null;
                materialId: string;
                materialName: string;
                fabricStock: number;
            }>();
            for (const v of variationsWithBomFabric) {
                if (v.fabricColour) {
                    bomFabricMap.set(v.variationId, {
                        fabricColourId: v.fabricColour.id,
                        fabricColourCode: v.fabricColour.code ?? null,
                        fabricColourName: v.fabricColour.colourName,
                        fabricColourHex: v.fabricColour.colourHex,
                        fabricId: v.fabricColour.fabric?.id ?? '',
                        fabricName: v.fabricColour.fabric?.name ?? '',
                        fabricUnit: v.fabricColour.fabric?.unit ?? null,
                        materialId: v.fabricColour.fabric?.material?.id ?? '',
                        materialName: v.fabricColour.fabric?.material?.name ?? '',
                        fabricStock: v.fabricColour.currentBalance ?? 0,
                    });
                }
            }
            const bomFabricVariationIds = new Set(variationsWithBomFabric.map(v => v.variationId));

            // Step 2: Build search filter
            let searchFilter: Record<string, unknown> = {};
            if (search) {
                searchFilter = {
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { styleCode: { contains: search, mode: 'insensitive' } },
                        { category: { contains: search, mode: 'insensitive' } },
                        {
                            variations: {
                                some: {
                                    OR: [
                                        { colorName: { contains: search, mode: 'insensitive' } },
                                        {
                                            skus: {
                                                some: {
                                                    skuCode: { contains: search, mode: 'insensitive' },
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                };
            }

            // Step 3: Fetch products with nested variations and SKUs
            const productsRaw = await prisma.product.findMany({
                where: {
                    isActive: true,
                    ...searchFilter,
                },
                include: {
                    // NOTE: fabricType removed from schema
                    variations: {
                        where: { isActive: true },
                        orderBy: { colorName: 'asc' },
                        include: {
                            // NOTE: fabric and fabricColour relations removed from Variation
                            // Fabric assignment now via BOM (VariationBomLine.fabricColourId)
                            skus: {
                                where: { isActive: true },
                                orderBy: { size: 'asc' },
                            },
                        },
                    },
                },
                orderBy: { name: 'asc' },
            });

            // Cast to ProductData with variations included
            const products: ProductData[] = productsRaw as unknown as ProductData[];

            // Step 4: Transform to tree structure with computed fields
            let totalProducts = 0;
            let totalVariations = 0;
            let totalSkus = 0;
            let totalStock = 0;

            const items: ProductNode[] = products.map((product: ProductData) => {
                totalProducts++;

                let productStock = 0;
                let productSkuCount = 0;
                const allMrps: number[] = [];
                let hasLining = false;

                // Process variations
                const processedVariations: VariationNode[] = product.variations.map(
                    (variation: VariationData) => {
                        totalVariations++;
                        let variationStock = 0;
                        const variationMrps: number[] = [];

                        // Process SKUs - use materialized currentBalance (O(1) from trigger)
                        const children: SkuNode[] = variation.skus.map((sku: SkuData) => {
                            totalSkus++;
                            productSkuCount++;
                            const balance = sku.currentBalance ?? 0;
                            variationStock += balance;
                            totalStock += balance;
                            if (sku.mrp > 0) {
                                variationMrps.push(sku.mrp);
                                allMrps.push(sku.mrp);
                            }

                            // Get SKU-level metrics
                            const skuSales = skuSalesMap.get(sku.id);
                            const skuShopifyStock = skuShopifyStockMap.get(sku.id);

                            // Get Shopify pricing by variant ID
                            const shopifyPricing = sku.shopifyVariantId ? shopifyPricingMap.get(sku.shopifyVariantId) : undefined;
                            const shopifyPrice = shopifyPricing?.compareAtPrice ?? shopifyPricing?.price;
                            const shopifySalePrice = shopifyPricing?.compareAtPrice ? shopifyPricing.price : undefined;
                            const shopifySalePercent = shopifyPrice && shopifySalePrice ? Math.round((1 - shopifySalePrice / shopifyPrice) * 100) : undefined;

                            return {
                                id: sku.id,
                                type: 'sku' as const,
                                name: sku.size,
                                isActive: sku.isActive,
                                variationId: sku.variationId,
                                skuCode: sku.skuCode,
                                barcode: sku.skuCode,
                                size: sku.size,
                                mrp: sku.mrp,
                                sellingPrice: sku.sellingPrice ?? undefined,
                                currentBalance: balance,
                                availableBalance: balance,
                                targetStockQty: sku.targetStockQty ?? undefined,
                                // Shopify & Sales fields
                                shopifyVariantId: sku.shopifyVariantId ?? undefined,
                                shopifyProductId: variation.shopifySourceProductId ?? shopifyPricing?.shopifyProductId ?? undefined,
                                shopifyPrice,
                                shopifySalePrice,
                                shopifySalePercent,
                                shopifyStock: skuShopifyStock,
                                sales30DayUnits: skuSales?.sales30DayUnits,
                                sales30DayValue: skuSales?.sales30DayValue,
                                bomCost: sku.bomCost ?? undefined,
                            };
                        });

                        productStock += variationStock;
                        if (variation.hasLining) hasLining = true;

                        // Calculate variation average MRP
                        const avgMrp =
                            variationMrps.length > 0
                                ? variationMrps.reduce((a, b) => a + b, 0) / variationMrps.length
                                : null;

                        // Get variation-level metrics
                        const variationSales = variationSalesMap.get(variation.id);
                        const variationShopifyStock = variationShopifyStockMap.get(variation.id);

                        // Get Shopify status from variation level (via Variation.shopifySourceProductId)
                        const shopifyStatus = variationShopifyStatusMap.get(variation.id) as ShopifyStatus | undefined;

                        // Get fabric details from BOM
                        const bomFabric = bomFabricMap.get(variation.id);
                        const fabricStock = bomFabric?.fabricStock;

                        return {
                            id: variation.id,
                            type: 'variation' as const,
                            name: variation.colorName,
                            isActive: variation.isActive,
                            productId: variation.productId,
                            productName: product.name,
                            colorName: variation.colorName,
                            colorHex: variation.colorHex ?? undefined,
                            // Fabric details from BOM (VariationBomLine.fabricColourId)
                            fabricId: bomFabric?.fabricId,
                            fabricName: bomFabric?.fabricName,
                            fabricColourId: bomFabric?.fabricColourId,
                            fabricColourCode: bomFabric?.fabricColourCode ?? undefined,
                            fabricColourName: bomFabric?.fabricColourName,
                            fabricColourHex: bomFabric?.fabricColourHex ?? undefined,
                            materialId: bomFabric?.materialId,
                            materialName: bomFabric?.materialName,
                            hasBomFabricLine: bomFabricVariationIds.has(variation.id),
                            imageUrl: variation.imageUrl ?? undefined,
                            hasLining: variation.hasLining,
                            totalStock: variationStock,
                            avgMrp,
                            // Shopify & Sales fields
                            shopifyStatus: shopifyStatus ?? (variation.shopifySourceProductId ? 'not_cached' : 'not_linked'),
                            shopifyStock: variationShopifyStock,
                            fabricStock,
                            fabricUnit: bomFabric?.fabricUnit ?? undefined,
                            sales30DayUnits: variationSales?.sales30DayUnits,
                            sales30DayValue: variationSales?.sales30DayValue,
                            bomCost: variation.bomCost ?? undefined,
                            shopifySourceProductId: variation.shopifySourceProductId ?? undefined,
                            children,
                        };
                    }
                );

                // Calculate product average MRP
                const avgMrp =
                    allMrps.length > 0
                        ? allMrps.reduce((a, b) => a + b, 0) / allMrps.length
                        : null;

                // Compute most common material name from variations
                const materialCounts = new Map<string, number>();
                for (const v of processedVariations) {
                    if (v.materialName) {
                        materialCounts.set(v.materialName, (materialCounts.get(v.materialName) || 0) + 1);
                    }
                }
                let productMaterialName: string | undefined;
                if (materialCounts.size === 1) {
                    productMaterialName = materialCounts.keys().next().value;
                } else if (materialCounts.size > 1) {
                    // Find most common, or "Mixed" if tie
                    let maxCount = 0;
                    let maxMaterial: string | undefined;
                    for (const [material, count] of materialCounts) {
                        if (count > maxCount) {
                            maxCount = count;
                            maxMaterial = material;
                        }
                    }
                    productMaterialName = maxMaterial;
                }

                // Derive product-level Shopify status from variations
                // Priority: archived > draft > active > not_cached > not_linked
                const statusPriority: Record<string, number> = {
                    'archived': 5,
                    'draft': 4,
                    'active': 3,
                    'not_cached': 2,
                    'not_linked': 1,
                    'unknown': 0,
                };
                let productShopifyStatus: ShopifyStatus = 'not_linked';
                for (const v of processedVariations) {
                    if (v.shopifyStatus && (statusPriority[v.shopifyStatus] ?? 0) > (statusPriority[productShopifyStatus] ?? 0)) {
                        productShopifyStatus = v.shopifyStatus;
                    }
                }

                return {
                    id: product.id,
                    type: 'product' as const,
                    name: product.name,
                    isActive: product.isActive,
                    styleCode: product.styleCode ?? undefined,
                    category: product.category || '',
                    gender: product.gender ?? undefined,
                    productType: product.productType ?? undefined,
                    // NOTE: fabricTypeId/fabricTypeName removed - now derived from BOM materials
                    fabricTypeId: undefined,
                    fabricTypeName: undefined,
                    materialName: productMaterialName,
                    imageUrl: product.imageUrl ?? undefined,
                    hasLining,
                    variationCount: processedVariations.length,
                    skuCount: productSkuCount,
                    totalStock: productStock,
                    avgMrp,
                    shopifyStatus: productShopifyStatus,
                    children: processedVariations,
                };
            });

            return {
                items,
                summary: {
                    products: totalProducts,
                    variations: totalVariations,
                    skus: totalSkus,
                    totalStock,
                },
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getProductsTree:', error);
            throw error;
        }
    });

// Input validation schema for getProductsList
const getProductsListInputSchema = z.object({
    search: z.string().optional(),
    category: z.string().optional(),
    isActive: z.boolean().optional(),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(1000).default(50),
});

export type GetProductsListInput = z.infer<typeof getProductsListInputSchema>;

/**
 * Server Function: Get products list
 *
 * Fetches products list using Kysely query (inline implementation).
 * Used by CreateOrderModal, ProductSearch, and AddToPlanModal.
 *
 * NOTE: Cannot import from @server/ path alias in Server Functions (dev resolution issue).
 * Query implemented inline using local Kysely singleton.
 */
export const getProductsList = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getProductsListInputSchema.parse(input ?? {}))
    .handler(async ({ data: input }): Promise<ProductsListResult> => {
        // Dynamic import to prevent kysely from being bundled into client
        const { sql } = await import('kysely');
        const db = await getKysely();
        const { search, category, isActive, page = 1, limit = 50 } = input;
        const offset = (page - 1) * limit;

        // Build base query for counting
        let countQuery = db.selectFrom('Product').select(sql<number>`count(*)::int`.as('count'));

        // Apply filters to count query
        if (category) {
            countQuery = countQuery.where('Product.category', '=', category);
        }
        if (isActive !== undefined) {
            countQuery = countQuery.where('Product.isActive', '=', isActive);
        }
        if (search) {
            const searchTerm = `%${search.toLowerCase()}%`;
            countQuery = countQuery.where((eb) =>
                eb.or([sql`LOWER("Product"."name") LIKE ${searchTerm}`])
            ) as typeof countQuery;
        }

        // Get total count
        const countResult = await countQuery.executeTakeFirst();
        const total = countResult?.count ?? 0;

        // Build main query for products
        // NOTE: FabricType table removed - fabric type now derived from BOM materials
        const productsRaw = await db
            .selectFrom('Product')
            .select([
                'Product.id',
                'Product.name',
                'Product.styleCode',
                'Product.category',
                'Product.productType',
                'Product.gender',
                'Product.imageUrl',
                'Product.isActive',
                'Product.createdAt',
            ])
            .$call((qb) => {
                let q = qb;
                if (category) {
                    q = q.where('Product.category', '=', category) as typeof q;
                }
                if (isActive !== undefined) {
                    q = q.where('Product.isActive', '=', isActive) as typeof q;
                }
                if (search) {
                    const searchTerm = `%${search.toLowerCase()}%`;
                    q = q.where((eb) =>
                        eb.or([sql`LOWER("Product"."name") LIKE ${searchTerm}`])
                    ) as typeof q;
                }
                return q;
            })
            .orderBy('Product.createdAt', 'desc')
            .limit(limit)
            .offset(offset)
            .execute();

        // Get product IDs for fetching variations
        const productIds = productsRaw.map((p) => p.id);

        if (productIds.length === 0) {
            return {
                products: [],
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            };
        }

        // Fetch variations for these products
        // NOTE: Variation.fabricId removed - fabric now via BOM (VariationBomLine.fabricColourId)
        const variationsRaw = await db
            .selectFrom('Variation')
            .select([
                'Variation.id',
                'Variation.productId',
                'Variation.colorName',
                'Variation.standardColor',
                'Variation.colorHex',
                'Variation.imageUrl',
                'Variation.isActive',
            ])
            .where('Variation.productId', 'in', productIds)
            .execute();

        // Get variation IDs for fetching SKUs
        const variationIds = variationsRaw.map((v) => v.id);

        // Fetch SKUs for these variations
        const skusRaw =
            variationIds.length > 0
                ? await db
                      .selectFrom('Sku')
                      .select([
                          'Sku.id',
                          'Sku.variationId',
                          'Sku.skuCode',
                          'Sku.size',
                          'Sku.mrp',
                          'Sku.isActive',
                          'Sku.targetStockQty',
                      ])
                      .where('Sku.variationId', 'in', variationIds)
                      .execute()
                : [];

        // Build lookup maps
        const skusByVariation = new Map<string, SkuRow[]>();
        for (const sku of skusRaw) {
            const list = skusByVariation.get(sku.variationId) || [];
            list.push({
                id: sku.id,
                skuCode: sku.skuCode,
                size: sku.size,
                mrp: sku.mrp,
                isActive: sku.isActive,
                targetStockQty: sku.targetStockQty ?? 0,
            });
            skusByVariation.set(sku.variationId, list);
        }

        const variationsByProduct = new Map<string, VariationRow[]>();
        for (const v of variationsRaw) {
            const list = variationsByProduct.get(v.productId) || [];
            list.push({
                id: v.id,
                colorName: v.colorName,
                standardColor: v.standardColor,
                colorHex: v.colorHex,
                imageUrl: v.imageUrl,
                isActive: v.isActive,
                // NOTE: fabricId removed - now via BOM
                fabricId: '',
                fabric: null, // TODO: Get from BOM via VariationBomLine if needed
                skus: skusByVariation.get(v.id) || [],
            });
            variationsByProduct.set(v.productId, list);
        }

        // Assemble final products
        const products: ProductWithVariations[] = productsRaw.map((p) => ({
            id: p.id,
            name: p.name,
            styleCode: p.styleCode,
            category: p.category,
            productType: p.productType,
            gender: p.gender,
            imageUrl: p.imageUrl,
            isActive: p.isActive,
            createdAt: p.createdAt,
            // NOTE: FabricType removed from schema - always null
            fabricType: null,
            variations: variationsByProduct.get(p.id) || [],
        }));

        const result = {
            products,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };

        // Validate output against Zod schema
        return productsListResultSchema.parse(result);
    });

// ============================================
// PRODUCT DETAIL
// ============================================

const getProductByIdInputSchema = z.object({
    id: z.string().uuid('Invalid product ID'),
});

/**
 * Product detail response type for unified edit modal
 */
export interface ProductDetailResponse {
    id: string;
    name: string;
    styleCode: string | null;
    category: string;
    productType: string;
    gender: string;
    fabricTypeId: string | null;
    fabricTypeName: string | null;
    baseProductionTimeMins: number;
    defaultFabricConsumption: number | null;
    isActive: boolean;
    imageUrl: string | null;
    variations: VariationDetailResponse[];
}

export interface VariationDetailResponse {
    id: string;
    productId: string;
    colorName: string;
    colorHex: string | null;
    fabricId: string | null;
    fabricName: string | null;
    fabricColourId: string | null;
    fabricColourName: string | null;
    materialName: string | null;
    hasLining: boolean;
    bomCost: number | null;
    isActive: boolean;
    imageUrl: string | null;
    skus: SkuDetailResponse[];
}

export interface SkuDetailResponse {
    id: string;
    skuCode: string;
    variationId: string;
    size: string;
    mrp: number | null;
    targetStockQty: number | null;
    bomCost: number | null;
    isActive: boolean;
    currentBalance: number;
}

/**
 * Server Function: Get product by ID
 *
 * Fetches a single product with full nested hierarchy (variations, SKUs).
 * Used by UnifiedProductEditModal for editing.
 */
export const getProductById = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getProductByIdInputSchema.parse(input))
    .handler(async ({ data }): Promise<ProductDetailResponse> => {
        try {
            const prisma = await getPrisma();

            // Get inventory balances for SKUs
            const balances: BalanceRow[] = await prisma.$queryRaw`
                SELECT
                    "skuId",
                    SUM(qty)::bigint AS "balance"
                FROM "InventoryTransaction"
                WHERE "skuId" IN (
                    SELECT s.id FROM "Sku" s
                    JOIN "Variation" v ON s."variationId" = v.id
                    WHERE v."productId"::text = ${data.id}
                )
                GROUP BY "skuId"
            `;

            const balanceMap = new Map<string, number>(
                balances.map((b: BalanceRow) => [b.skuId, Number(b.balance)])
            );

            // Fetch product with full hierarchy
            // NOTE: fabricType, fabric, and fabricColour removed - fabric assignment now via BOM
            const product = await prisma.product.findUnique({
                where: { id: data.id },
                include: {
                    variations: {
                        orderBy: { colorName: 'asc' },
                        include: {
                            skus: {
                                orderBy: { size: 'asc' },
                            },
                        },
                    },
                },
            });

            if (!product) {
                throw new Error('Product not found');
            }

            // Transform to response type
            // NOTE: fabricTypeId, fabricTypeName, fabricId, fabricName, fabricColourId,
            // fabricColourName, materialName removed - fabric assignment now via BOM
            return {
                id: product.id,
                name: product.name,
                styleCode: product.styleCode,
                category: product.category,
                productType: product.productType,
                gender: product.gender,
                fabricTypeId: null,
                fabricTypeName: null,
                baseProductionTimeMins: product.baseProductionTimeMins,
                defaultFabricConsumption: product.defaultFabricConsumption,
                isActive: product.isActive,
                imageUrl: product.imageUrl,
                variations: product.variations.map((v: VariationData & { skus: SkuData[] }) => ({
                    id: v.id,
                    productId: v.productId,
                    colorName: v.colorName,
                    colorHex: v.colorHex,
                    fabricId: null,
                    fabricName: null,
                    fabricColourId: null,
                    fabricColourName: null,
                    materialName: null,
                    hasLining: v.hasLining,
                    bomCost: v.bomCost,
                    isActive: v.isActive,
                    imageUrl: v.imageUrl,
                    skus: v.skus.map((s: SkuData) => ({
                        id: s.id,
                        skuCode: s.skuCode,
                        variationId: s.variationId,
                        size: s.size,
                        mrp: s.mrp,
                        targetStockQty: s.targetStockQty,
                        bomCost: s.bomCost,
                        isActive: s.isActive,
                        currentBalance: balanceMap.get(s.id) ?? 0,
                    })),
                })),
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getProductById:', error);
            throw error;
        }
    });

// ============================================
// CATALOG FILTERS
// ============================================

/**
 * Catalog filters response for dropdowns
 * NOTE: fabricTypes removed, fabrics simplified - fabric assignment now via BOM
 */
export interface CatalogFiltersResponse {
    fabricTypes: { id: string; name: string }[];  // Empty array for backward compatibility
    fabrics: {
        id: string;
        name: string;
        fabricTypeId: string;  // materialId for backward compatibility
        colorName: string | null;
        colorHex: string | null;
        costPerUnit: number | null;
    }[];
    fabricColours: {
        id: string;
        code: string | null;
        name: string;
        hex: string | null;
        fabricId: string;
        fabricName: string;
        materialId: string;
        materialName: string;
        costPerUnit: number | null;
    }[];
    categories: string[];
    genders: string[];
}

/**
 * Server Function: Get catalog filters
 *
 * Fetches filter data for product forms (fabric types, fabrics, fabricColours, categories, genders).
 * Used by UnifiedProductEditModal for dropdown options.
 */
export const getCatalogFilters = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<CatalogFiltersResponse> => {
        try {
            const prisma = await getPrisma();

            // FabricType removed - return empty array for backward compatibility
            const fabricTypes: { id: string; name: string }[] = [];

            // Fetch fabric colours (3-tier hierarchy: Material > Fabric > FabricColour)
            // NOTE: "fabrics" now comes from FabricColour for backward compatibility
            const fabricColoursRaw = await prisma.fabricColour.findMany({
                where: { isActive: true },
                include: {
                    fabric: {
                        include: {
                            material: true,
                        },
                    },
                },
                orderBy: [
                    { fabric: { material: { name: 'asc' } } },
                    { fabric: { name: 'asc' } },
                    { colourName: 'asc' },
                ],
            });

            // Transform fabricColours for the "fabrics" response (backward compatibility)
            // Uses materialId as fabricTypeId for older code
            const fabrics = fabricColoursRaw.map((fc) => ({
                id: fc.id,
                name: `${fc.fabric?.name ?? ''} - ${fc.colourName}`,
                fabricTypeId: fc.fabric?.materialId ?? '',  // materialId for backward compat
                colorName: fc.colourName,
                colorHex: fc.colourHex,
                costPerUnit: fc.costPerUnit ?? fc.fabric?.costPerUnit ?? null,
            }));

            // Transform fabricColours to expected format
            const fabricColours = fabricColoursRaw.map((fc) => ({
                id: fc.id,
                code: fc.code ?? null,
                name: fc.colourName,
                hex: fc.colourHex,
                fabricId: fc.fabricId,
                fabricName: fc.fabric?.name ?? '',
                materialId: fc.fabric?.materialId ?? '',
                materialName: fc.fabric?.material?.name ?? '',
                costPerUnit: fc.costPerUnit ?? fc.fabric?.costPerUnit ?? null,
            }));

            // Get distinct categories from products
            const categoriesResult = await prisma.product.findMany({
                where: { isActive: true },
                select: { category: true },
                distinct: ['category'],
                orderBy: { category: 'asc' },
            });
            const categories = categoriesResult.map((c: { category: string }) => c.category).filter(Boolean);

            // Static gender options
            const genders = ['Men', 'Women', 'Unisex', 'Kids'];

            return {
                fabricTypes,
                fabrics,
                fabricColours,
                categories,
                genders,
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getCatalogFilters:', error);
            throw error;
        }
    });

// ============================================
// STYLE CODES
// ============================================

/**
 * Response type for getStyleCodes
 */
export interface StyleCodesResponse {
    items: {
        id: string;
        name: string;
        category: string;
        productType: string;
        styleCode: string | null;
        variationCount: number;
        skuCount: number;
        isActive: boolean;
    }[];
}

/**
 * Server Function: Get all products with style codes
 *
 * Returns a flat list of products with their style codes for quick viewing/editing.
 * Includes variation and SKU counts for context.
 */
export const getStyleCodes = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((_input: unknown) => ({}))
    .handler(async (): Promise<StyleCodesResponse> => {
        try {
            const db = await getKysely();
            const { sql } = await import('kysely');

            // Query products with counts
            const products = await db
                .selectFrom('Product')
                .leftJoin('Variation', 'Variation.productId', 'Product.id')
                .leftJoin('Sku', 'Sku.variationId', 'Variation.id')
                .select([
                    'Product.id',
                    'Product.name',
                    'Product.category',
                    'Product.productType',
                    'Product.styleCode',
                    'Product.isActive',
                ])
                .select(sql<number>`COUNT(DISTINCT "Variation"."id")`.as('variationCount'))
                .select(sql<number>`COUNT(DISTINCT "Sku"."id")`.as('skuCount'))
                .groupBy([
                    'Product.id',
                    'Product.name',
                    'Product.category',
                    'Product.productType',
                    'Product.styleCode',
                    'Product.isActive',
                ])
                .orderBy('Product.name', 'asc')
                .execute();

            return {
                items: products.map(p => ({
                    id: p.id,
                    name: p.name,
                    category: p.category,
                    productType: p.productType,
                    styleCode: p.styleCode,
                    variationCount: Number(p.variationCount) || 0,
                    skuCount: Number(p.skuCount) || 0,
                    isActive: p.isActive,
                })),
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getStyleCodes:', error);
            throw error;
        }
    });

// ============================================
// SKU AUTOCOMPLETE SEARCH
// ============================================

/**
 * Server Function: Search SKUs for autocomplete
 *
 * Lightweight SKU search optimized for product selection dropdowns.
 * Returns only essential fields needed for display and selection.
 *
 * Search behavior:
 * - Empty query: Returns top 30 SKUs sorted by product name
 * - With query (min 2 chars): Searches skuCode, productName, colorName (case-insensitive)
 *
 * Uses Kysely for performance with dynamic imports to prevent client bundling.
 * Balance comes from materialized Sku.currentBalance column (O(1) lookup).
 */
export const searchSkusForAutocomplete = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => skuAutocompleteInputSchema.parse(input ?? {}))
    .handler(async ({ data }): Promise<SkuAutocompleteResult> => {
        const { query, limit } = data;

        // Dynamic imports to prevent client bundling
        const { sql } = await import('kysely');
        const db = await getKysely();

        // Build base query - only active SKUs, exclude custom SKUs
        let kyselyQuery = db
            .selectFrom('Sku')
            .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
            .innerJoin('Product', 'Product.id', 'Variation.productId')
            .select([
                'Sku.id as skuId',
                'Sku.skuCode',
                'Sku.size',
                'Sku.mrp',
                'Sku.currentBalance',
                'Product.name as productName',
                'Variation.colorName',
                'Variation.imageUrl as variationImageUrl',
                'Product.imageUrl as productImageUrl',
            ])
            .where('Sku.isActive', '=', true)
            .where('Sku.isCustomSku', '=', false);

        // Apply search filter if query provided (min 2 chars for search)
        if (query && query.trim().length >= 2) {
            const searchTerm = `%${query.toLowerCase().trim()}%`;

            kyselyQuery = kyselyQuery.where((eb) =>
                eb.or([
                    sql`LOWER("Sku"."skuCode") LIKE ${searchTerm}`,
                    sql`LOWER("Product"."name") LIKE ${searchTerm}`,
                    sql`LOWER("Variation"."colorName") LIKE ${searchTerm}`,
                ])
            );
        }

        // Order by product name, then color, then size
        // Fetch one extra to detect hasMore
        const rows = await kyselyQuery
            .orderBy('Product.name', 'asc')
            .orderBy('Variation.colorName', 'asc')
            .orderBy('Sku.size', 'asc')
            .limit(limit + 1)
            .execute();

        const hasMore = rows.length > limit;
        const items: SkuAutocompleteItem[] = rows.slice(0, limit).map((row) => ({
            skuId: row.skuId,
            skuCode: row.skuCode,
            size: row.size,
            productName: row.productName,
            colorName: row.colorName,
            imageUrl: row.variationImageUrl || row.productImageUrl || null,
            currentBalance: row.currentBalance,
            mrp: row.mrp,
        }));

        return skuAutocompleteResultSchema.parse({ items, hasMore });
    });

// ============================================
// RESOLVE SKU CODES → IDs (for Quick Order form)
// ============================================

/**
 * Takes an array of SKU codes and returns matching { skuCode, skuId, productName, mrp }.
 * Used by the Quick Order form where users type SKU codes directly.
 */
export const resolveSkuCodes = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => {
        const schema = z.object({
            skuCodes: z.array(z.string().min(1)).min(1).max(100),
        });
        return schema.parse(input);
    })
    .handler(async ({ data }) => {
        const prisma = await getPrisma();

        const skus = await prisma.sku.findMany({
            where: {
                skuCode: { in: data.skuCodes },
                isActive: true,
            },
            select: {
                id: true,
                skuCode: true,
                size: true,
                mrp: true,
                variation: {
                    select: {
                        colorName: true,
                        product: { select: { name: true } },
                    },
                },
            },
        });

        return skus.map((s) => ({
            skuId: s.id,
            skuCode: s.skuCode,
            productName: s.variation?.product?.name || 'Unknown',
            colorName: s.variation?.colorName || '',
            size: s.size || '',
            mrp: s.mrp,
        }));
    });
