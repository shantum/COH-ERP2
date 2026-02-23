/**
 * SKU Search Server Functions
 *
 * Lightweight SKU search for autocomplete and code resolution.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import { getKysely } from '@coh/shared/services/db';
import {
    skuAutocompleteInputSchema,
    skuAutocompleteResultSchema,
    type SkuAutocompleteResult,
    type SkuAutocompleteItem,
} from '@coh/shared';

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
