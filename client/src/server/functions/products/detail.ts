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
                                    targetStockQty: true,
                                    bomCost: true,
                                    isActive: true,
                                    currentBalance: true,
                                },
                            },
                        },
                    },
                },
            });

            if (!product) {
                throw new Error('Product not found');
            }

            // Transform to response type
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
                variations: product.variations.map((v) => ({
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
                    skus: v.skus.map((s) => ({
                        id: s.id,
                        skuCode: s.skuCode,
                        variationId: s.variationId,
                        size: s.size,
                        mrp: s.mrp,
                        targetStockQty: s.targetStockQty,
                        bomCost: s.bomCost,
                        isActive: s.isActive,
                        currentBalance: s.currentBalance ?? 0,
                    })),
                })),
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getProductById:', error);
            throw error;
        }
    });
