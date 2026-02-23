/**
 * Products List Server Function
 *
 * Fetches paginated products list using Kysely.
 * Used by CreateOrderModal, ProductSearch, and AddToPlanModal.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getKysely } from '@coh/shared/services/db';
import {
    productsListResultSchema,
    type ProductsListResult,
    type ProductWithVariations,
    type VariationRow,
    type SkuRow,
} from '@coh/shared';

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
                fabricId: '',
                fabric: null,
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
