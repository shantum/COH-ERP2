/**
 * Products Server Functions
 *
 * TanStack Start Server Functions for products data fetching.
 * Bypasses tRPC/Express, calls Kysely directly from the server.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

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
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
    laborMinutes: number | null;
    children: VariationNode[];
}

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
    imageUrl?: string;
    hasLining: boolean;
    totalStock: number;
    avgMrp: number | null;
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
    laborMinutes: number | null;
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
    fabricConsumption?: number;
    currentBalance: number;
    availableBalance: number;
    targetStockQty?: number;
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
    laborMinutes: number | null;
}

/**
 * Server Function: Get products tree
 *
 * Fetches products directly from database using Kysely.
 * Returns hierarchical tree ready for TanStack Table display.
 */
export const getProductsTree = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => productsTreeInputSchema.parse(input))
    .handler(async ({ data }): Promise<ProductsTreeResponse> => {
        console.log('[Server Function] getProductsTree called with:', data);

        try {
            // Dynamic imports - only loaded on server, not bundled into client
            // This prevents Node.js-only modules (pg, Buffer) from breaking the browser
            const { createKysely } = await import('@coh/shared/database');
            const { listProductsTreeKysely } = await import(
                '@coh/shared/database/queries/productsTreeKysely'
            );

            // Initialize Kysely singleton (safe to call multiple times)
            createKysely(process.env.DATABASE_URL);

            // Call Kysely query directly
            const result = await listProductsTreeKysely({
                search: data.search,
            });

            console.log(
                '[Server Function] Query returned',
                result.summary.products,
                'products,',
                result.summary.skus,
                'skus'
            );

            return result;
        } catch (error) {
            console.error('[Server Function] Error in getProductsTree:', error);
            throw error;
        }
    });
