/**
 * Style Codes Server Function
 *
 * Returns a flat list of products with their style codes for quick viewing/editing.
 */

import { createServerFn } from '@tanstack/react-start';
import { authMiddleware } from '../../middleware/auth';
import { getKysely } from '@coh/shared/services/db';
import { serverLog } from '../serverLog';

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
    .inputValidator(() => ({}))
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
            serverLog.error({ domain: 'products', fn: 'getStyleCodes' }, 'Failed to get style codes', error);
            throw error;
        }
    });
