/**
 * Product Detail Server Function
 *
 * Fetches a single product with full nested hierarchy (variations, SKUs).
 * Used by UnifiedProductEditModal for editing.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import { getProductVariationsFabrics } from '@coh/shared/services/bom';

const getProductByIdInputSchema = z.object({
    id: z.string().uuid('Invalid product ID'),
});

/**
 * Shopify product data parsed from ShopifyProductCache
 */
export interface ShopifyProductData {
    shopifyId: string;
    status: string;
    handle: string | null;
    tags: string[];
    productType: string | null;
    vendor: string | null;
    publishedAt: string | null;
    bodyHtml: string | null;
    images: Array<{ src: string; alt: string | null }>;
    /** Storefront URL */
    storefrontUrl: string | null;
    /** Admin URL */
    adminUrl: string;
}

/**
 * Measurements data from StyleMeasurement table
 */
export interface SizeEquivalent {
    uk: number | string;
    us: number | string;
    eu: number | string;
}

export interface MeasurementData {
    unit: string;
    measurements: Record<string, Record<string, number>>;
    fitComments: string[];
    sampleSize: string | null;
    isFullyGraded: boolean;
    sizeEquivalents: Record<string, SizeEquivalent> | null;
}

/**
 * Product detail response type for product detail page
 */
export interface ProductDetailResponse {
    id: string;
    name: string;
    styleCode: string | null;
    category: string;
    garmentGroup: string;
    productType: string;
    gender: string;
    googleProductCategoryId: number | null;
    fabricTypeId: string | null;
    fabricTypeName: string | null;
    baseProductionTimeMins: number;
    defaultFabricConsumption: number | null;
    isActive: boolean;
    imageUrl: string | null;
    // New display fields
    attributes: Record<string, string | number> | null;
    description: string | null;
    erpDescription: string | null;
    hsnCode: string | null;
    status: string;
    isReturnable: boolean;
    exchangeCount: number;
    returnCount: number;
    writeOffCount: number;
    measurements: MeasurementData | null;
    shopify: ShopifyProductData | null;
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
    shopifySourceProductId: string | null;
    skus: SkuDetailResponse[];
}

export interface SkuDetailResponse {
    id: string;
    skuCode: string;
    variationId: string;
    size: string;
    mrp: number | null;
    sellingPrice: number | null;
    targetStockQty: number | null;
    bomCost: number | null;
    isActive: boolean;
    currentBalance: number;
    shopifyVariantId: string | null;
}

/**
 * Server Function: Get product by ID
 *
 * Fetches a single product with full nested hierarchy (variations, SKUs).
 * Uses materialized Sku.currentBalance (maintained by DB trigger) — consistent with tree view.
 */
export const getProductById = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getProductByIdInputSchema.parse(input))
    .handler(async ({ data }): Promise<ProductDetailResponse> => {
        try {
            const prisma = await getPrisma();

            // Fetch product with full hierarchy
            // Uses materialized Sku.currentBalance (maintained by DB trigger) — consistent with tree view
            const product = await prisma.product.findUnique({
                where: { id: data.id },
                include: {
                    variations: {
                        orderBy: { colorName: 'asc' },
                        include: {
                            skus: {
                                orderBy: { size: 'asc' },
                                select: {
                                    id: true,
                                    skuCode: true,
                                    variationId: true,
                                    size: true,
                                    mrp: true,
                                    sellingPrice: true,
                                    targetStockQty: true,
                                    bomCost: true,
                                    isActive: true,
                                    currentBalance: true,
                                    shopifyVariantId: true,
                                },
                            },
                        },
                    },
                },
            });

            if (!product) {
                throw new Error('Product not found');
            }

            // Batch-fetch BOM fabric info for all variations (single query)
            const fabricMap = await getProductVariationsFabrics(prisma, product.id);

            // Derive product-level fabric type from first variation with fabric
            const firstFabric = [...fabricMap.values()].find((f) => f !== null);

            // Fetch measurements from StyleMeasurement if styleCode exists
            let measurements: MeasurementData | null = null;
            if (product.styleCode) {
                const sm = await prisma.styleMeasurement.findUnique({
                    where: { styleCode: product.styleCode },
                });
                if (sm) {
                    measurements = {
                        unit: sm.unit,
                        measurements: sm.measurements as Record<string, Record<string, number>>,
                        fitComments: sm.fitComments as string[],
                        sampleSize: sm.sampleSize,
                        isFullyGraded: sm.isFullyGraded,
                        sizeEquivalents: (sm.sizeEquivalents ?? null) as Record<string, SizeEquivalent> | null,
                    };
                }
            }

            // Fetch Shopify data from cache if linked
            let shopify: ShopifyProductData | null = null;
            // Collect all unique Shopify product IDs (product-level + variation-level)
            const shopifyIds = new Set<string>();
            if (product.shopifyProductId) shopifyIds.add(product.shopifyProductId);
            for (const v of product.variations) {
                if (v.shopifySourceProductId) shopifyIds.add(v.shopifySourceProductId);
            }
            if (shopifyIds.size > 0) {
                // Use primary product ID, fall back to first variation's
                const primaryId = product.shopifyProductId ?? [...shopifyIds][0];
                const cache = await prisma.shopifyProductCache.findUnique({
                    where: { id: primaryId },
                    select: { rawData: true },
                });
                if (cache) {
                    try {
                        const raw = JSON.parse(cache.rawData) as {
                            id: number; title?: string; handle?: string; body_html?: string;
                            vendor?: string; product_type?: string; status?: string;
                            tags?: string; published_at?: string;
                            images?: Array<{ src: string; alt?: string | null }>;
                        };
                        const handle = raw.handle ?? null;
                        shopify = {
                            shopifyId: primaryId,
                            status: raw.status ?? 'unknown',
                            handle,
                            tags: raw.tags ? raw.tags.split(', ').map(t => t.trim()).filter(Boolean) : [],
                            productType: raw.product_type ?? null,
                            vendor: raw.vendor ?? null,
                            publishedAt: raw.published_at ?? null,
                            bodyHtml: raw.body_html ?? null,
                            images: (raw.images ?? []).map(img => ({ src: img.src, alt: img.alt ?? null })),
                            storefrontUrl: handle ? `https://www.creaturesofhabit.in/products/${handle}` : null,
                            adminUrl: `https://admin.shopify.com/store/creatures-of-habit-india/products/${primaryId}`,
                        };
                    } catch {
                        // Skip corrupt cache
                    }
                }
            }

            // Transform to response type
            return {
                id: product.id,
                name: product.name,
                styleCode: product.styleCode,
                category: product.category,
                garmentGroup: product.garmentGroup,
                productType: product.productType,
                gender: product.gender,
                googleProductCategoryId: product.googleProductCategoryId,
                fabricTypeId: firstFabric?.materialId ?? null,
                fabricTypeName: firstFabric?.materialName ?? null,
                baseProductionTimeMins: product.baseProductionTimeMins,
                defaultFabricConsumption: product.defaultFabricConsumption,
                isActive: product.isActive,
                imageUrl: product.imageUrl,
                attributes: (product.attributes ?? null) as Record<string, string | number> | null,
                description: product.description,
                erpDescription: product.erpDescription ?? null,
                hsnCode: product.hsnCode,
                status: product.status,
                isReturnable: product.isReturnable,
                exchangeCount: product.exchangeCount,
                returnCount: product.returnCount,
                writeOffCount: product.writeOffCount,
                measurements,
                shopify,
                variations: product.variations.map((v) => {
                    const fabric = fabricMap.get(v.id) ?? null;
                    return {
                        id: v.id,
                        productId: v.productId,
                        colorName: v.colorName,
                        colorHex: v.colorHex,
                        fabricId: fabric?.fabricId ?? null,
                        fabricName: fabric?.fabricName ?? null,
                        fabricColourId: fabric?.fabricColourId ?? null,
                        fabricColourName: fabric?.fabricColourName ?? null,
                        materialName: fabric?.materialName ?? null,
                        hasLining: v.hasLining,
                        bomCost: v.bomCost,
                        isActive: v.isActive,
                        imageUrl: v.imageUrl,
                        shopifySourceProductId: v.shopifySourceProductId,
                        skus: v.skus.map((s) => ({
                            id: s.id,
                            skuCode: s.skuCode,
                            variationId: s.variationId,
                            size: s.size,
                            mrp: s.mrp,
                            sellingPrice: s.sellingPrice,
                            targetStockQty: s.targetStockQty,
                            bomCost: s.bomCost,
                            isActive: s.isActive,
                            currentBalance: s.currentBalance ?? 0,
                            shopifyVariantId: s.shopifyVariantId,
                        })),
                    };
                }),
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getProductById:', error);
            throw error;
        }
    });
