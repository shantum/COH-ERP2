/**
 * Products Tree Server Function
 *
 * Fetches products directly from database using Prisma.
 * Returns hierarchical tree ready for TanStack Table display.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import type { SkuData, VariationData, ProductData } from './types';

// Input validation schema
const productsTreeInputSchema = z.object({
    search: z.string().optional(),
});

export type ProductsTreeInput = z.infer<typeof productsTreeInputSchema>;

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
                variationShopifyStatusMap,
                shopifyPricingMap,
            ] = await Promise.all([
                getVariationSalesMetricsKysely(),
                getSkuSalesMetricsKysely(),
                getVariationShopifyStockKysely(),
                getSkuShopifyStockKysely(),
                getVariationShopifyStatusesKysely(),
                getSkuShopifyPricingKysely(),
            ]);

            // Step 1b: Pre-fetch BOM fabric details (N+1 safe - single query)
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
                    variations: {
                        where: { isActive: true },
                        orderBy: { colorName: 'asc' },
                        include: {
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
