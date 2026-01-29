/**
 * Kysely Products List Query
 *
 * High-performance replacement for Prisma's nested includes.
 * Uses JOINs and JSON aggregation for single-query data fetching.
 *
 * Follows the three directives:
 * - D1: Types from DB, no manual interfaces
 * - D2: All JOINs use indexed FKs (verified in schema)
 * - D3: Lean payload - only fields used by frontend
 *
 * All public exports are validated against Zod schemas to catch schema drift.
 */

import { sql } from 'kysely';
import { kysely } from '../index.js';
import {
    productsListResultSchema,
    type ProductsListResult,
    type ProductWithVariations,
    type VariationRow,
    type SkuRow,
} from '@coh/shared';

// Re-export output types from schemas
export type { ProductsListResult, ProductWithVariations, VariationRow, SkuRow };

// ============================================
// INPUT TYPES (not validated - internal use)
// ============================================

export interface ProductsListParams {
    search?: string;
    category?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
}

// ============================================
// MAIN QUERY
// ============================================

export async function listProductsKysely(
    params: ProductsListParams
): Promise<ProductsListResult> {
    const { search, category, isActive, page = 1, limit = 50 } = params;
    const offset = (page - 1) * limit;

    // Build base query for counting
    let countQuery = kysely.selectFrom('Product').select(sql<number>`count(*)::int`.as('count'));

    // Apply filters to count query
    if (category) {
        countQuery = countQuery.where('Product.category', '=', category);
    }
    if (isActive !== undefined) {
        countQuery = countQuery.where('Product.isActive', '=', isActive);
    }
    if (search) {
        const searchTerm = `%${search.toLowerCase()}%`;
        countQuery = countQuery.where((eb: any) =>
            eb.or([sql`LOWER("Product"."name") LIKE ${searchTerm}`])
        ) as typeof countQuery;
    }

    // Get total count
    const countResult = await countQuery.executeTakeFirst();
    const total = countResult?.count ?? 0;

    // Build main query with JSON aggregation for variations and SKUs
    // Using a subquery approach to avoid complex CTEs
    const productsRaw = await kysely
        .selectFrom('Product')
        .leftJoin('FabricType', 'FabricType.id', 'Product.fabricTypeId')
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
            'Product.fabricTypeId',
            'FabricType.name as fabricTypeName',
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
                q = q.where((eb: any) =>
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

    // Fetch variations with fabrics from BOM (source of truth)
    const variationsRaw = await kysely
        .selectFrom('Variation')
        .leftJoin('VariationBomLine', (join) =>
            join
                .onRef('VariationBomLine.variationId', '=', 'Variation.id')
                .on('VariationBomLine.fabricColourId', 'is not', null)
        )
        .leftJoin('FabricColour', 'FabricColour.id', 'VariationBomLine.fabricColourId')
        .leftJoin('Fabric', 'Fabric.id', 'FabricColour.fabricId')
        .select([
            'Variation.id',
            'Variation.productId',
            'Variation.colorName',
            'Variation.standardColor',
            'Variation.colorHex',
            'Variation.imageUrl',
            'Variation.isActive',
            'FabricColour.fabricId',
            'Fabric.id as fabric_id',
            'Fabric.name as fabric_name',
            'FabricColour.colourName as fabric_colorName',
        ])
        .where('Variation.productId', 'in', productIds)
        .execute();

    // Get variation IDs for fetching SKUs
    const variationIds = variationsRaw.map((v) => v.id);

    // Fetch SKUs for these variations
    const skusRaw =
        variationIds.length > 0
            ? await kysely
                  .selectFrom('Sku')
                  .select([
                      'Sku.id',
                      'Sku.variationId',
                      'Sku.skuCode',
                      'Sku.size',
                      'Sku.mrp',
                      'Sku.isActive',
                      'Sku.fabricConsumption',
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
            fabricConsumption: sku.fabricConsumption,
            targetStockQty: sku.targetStockQty,
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
            fabricId: v.fabricId,
            fabric: v.fabric_id
                ? {
                      id: v.fabric_id,
                      name: v.fabric_name ?? '',
                      colorName: v.fabric_colorName ?? '',
                  }
                : null,
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
        fabricType: p.fabricTypeId
            ? {
                  id: p.fabricTypeId,
                  name: p.fabricTypeName ?? '',
              }
            : null,
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
}
