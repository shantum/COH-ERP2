/**
 * Kysely Products Tree Query
 *
 * High-performance replacement for Prisma's nested includes.
 * Uses CTEs and JSON aggregation for single-query data fetching.
 *
 * Shared between Express server and TanStack Start Server Functions.
 */

import { sql } from 'kysely';
import { getKysely } from '../createKysely.js';

// ============================================
// TYPES
// ============================================

/**
 * Query parameters for products tree
 */
export interface ProductsTreeParams {
    search?: string;
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
 * Full response type
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

// ============================================
// MAIN QUERY
// ============================================

/**
 * Fetch products tree using Kysely
 *
 * Uses a single optimized query with JSON aggregation instead of N+1 queries.
 * Returns hierarchical data ready for TanStack Table tree display.
 */
export async function listProductsTreeKysely(
    params: ProductsTreeParams = {}
): Promise<ProductsTreeResponse> {
    const kysely = getKysely();
    const { search } = params;

    // Build search conditions
    const searchCondition = search
        ? sql<boolean>`(
            "Product"."name" ILIKE ${`%${search}%`}
            OR "Product"."styleCode" ILIKE ${`%${search}%`}
            OR "Product"."category" ILIKE ${`%${search}%`}
            OR EXISTS (
                SELECT 1 FROM "Variation" v
                WHERE v."productId" = "Product"."id"
                AND (
                    v."colorName" ILIKE ${`%${search}%`}
                    OR EXISTS (
                        SELECT 1 FROM "Sku" s
                        WHERE s."variationId" = v."id"
                        AND s."skuCode" ILIKE ${`%${search}%`}
                    )
                )
            )
        )`
        : sql<boolean>`true`;

    // CTE: Inventory balances per SKU
    const inventoryBalancesCte = kysely
        .selectFrom('InventoryTransaction')
        .select([
            'skuId',
            sql<number>`SUM(qty)::int`.as('balance'),
        ])
        .groupBy('skuId');

    // Main query with hierarchical JSON aggregation
    const query = kysely
        .with('invBalances', () => inventoryBalancesCte)
        .selectFrom('Product')
        .leftJoin('FabricType', 'FabricType.id', 'Product.fabricTypeId')
        .select([
            'Product.id',
            'Product.name',
            'Product.styleCode',
            'Product.category',
            'Product.gender',
            'Product.productType',
            'Product.fabricTypeId',
            'Product.imageUrl',
            'Product.isActive',
            'Product.trimsCost',
            'Product.liningCost',
            'Product.packagingCost',
            'Product.baseProductionTimeMins',
            'FabricType.name as fabricTypeName',
            // Aggregate variations with SKUs
            sql<string>`(
                SELECT COALESCE(json_agg(
                    json_build_object(
                        'id', v.id,
                        'type', 'variation',
                        'name', v."colorName",
                        'isActive', v."isActive",
                        'productId', v."productId",
                        'colorName', v."colorName",
                        'colorHex', v."colorHex",
                        'fabricId', v."fabricId",
                        'fabricName', f.name,
                        'imageUrl', v."imageUrl",
                        'hasLining', v."hasLining",
                        'trimsCost', v."trimsCost",
                        'liningCost', v."liningCost",
                        'packagingCost', v."packagingCost",
                        'laborMinutes', v."laborMinutes",
                        'children', COALESCE((
                            SELECT json_agg(
                                json_build_object(
                                    'id', s.id,
                                    'type', 'sku',
                                    'name', s.size,
                                    'isActive', s."isActive",
                                    'variationId', s."variationId",
                                    'skuCode', s."skuCode",
                                    'barcode', s."skuCode",
                                    'size', s.size,
                                    'mrp', s.mrp,
                                    'fabricConsumption', s."fabricConsumption",
                                    'currentBalance', COALESCE(ib.balance, 0),
                                    'availableBalance', COALESCE(ib.balance, 0),
                                    'targetStockQty', s."targetStockQty",
                                    'trimsCost', s."trimsCost",
                                    'liningCost', s."liningCost",
                                    'packagingCost', s."packagingCost",
                                    'laborMinutes', s."laborMinutes"
                                ) ORDER BY s.size
                            )
                            FROM "Sku" s
                            LEFT JOIN "invBalances" ib ON ib."skuId" = s.id
                            WHERE s."variationId" = v.id AND s."isActive" = true
                        ), '[]'::json)
                    ) ORDER BY v."colorName"
                ), '[]'::json)
                FROM "Variation" v
                LEFT JOIN "Fabric" f ON f.id = v."fabricId"
                WHERE v."productId" = "Product".id AND v."isActive" = true
            )`.as('variations'),
        ])
        .where('Product.isActive', '=', true)
        .where(searchCondition)
        .orderBy('Product.name', 'asc');

    const products = await query.execute();

    // Transform to typed response
    let totalProducts = 0;
    let totalVariations = 0;
    let totalSkus = 0;
    let totalStock = 0;

    const items: ProductNode[] = products.map((product) => {
        totalProducts++;

        // Parse variations JSON
        let variations: VariationNode[] = [];
        if (product.variations) {
            const parsed =
                typeof product.variations === 'string'
                    ? JSON.parse(product.variations)
                    : product.variations;
            variations = Array.isArray(parsed) ? parsed : [];
        }

        let productStock = 0;
        let productSkuCount = 0;
        let allMrps: number[] = [];
        let hasLining = false;

        // Process variations
        const processedVariations: VariationNode[] = variations.map((v) => {
            totalVariations++;
            let variationStock = 0;
            const variationMrps: number[] = [];

            // Process SKUs
            const children = (v.children || []).map((sku: SkuNode) => {
                totalSkus++;
                productSkuCount++;
                const balance = sku.currentBalance || 0;
                variationStock += balance;
                totalStock += balance;
                if (sku.mrp > 0) {
                    variationMrps.push(sku.mrp);
                    allMrps.push(sku.mrp);
                }
                return sku;
            });

            productStock += variationStock;
            if (v.hasLining) hasLining = true;

            // Calculate variation average MRP
            const avgMrp =
                variationMrps.length > 0
                    ? variationMrps.reduce((a, b) => a + b, 0) / variationMrps.length
                    : null;

            return {
                ...v,
                productName: product.name,
                totalStock: variationStock,
                avgMrp,
                children,
            };
        });

        // Calculate product average MRP
        const avgMrp =
            allMrps.length > 0
                ? allMrps.reduce((a, b) => a + b, 0) / allMrps.length
                : null;

        return {
            id: product.id,
            type: 'product' as const,
            name: product.name,
            isActive: product.isActive || false,
            styleCode: product.styleCode || undefined,
            category: product.category || '',
            gender: product.gender || undefined,
            productType: product.productType || undefined,
            fabricTypeId: product.fabricTypeId || undefined,
            fabricTypeName: product.fabricTypeName || undefined,
            imageUrl: product.imageUrl || undefined,
            hasLining,
            variationCount: processedVariations.length,
            skuCount: productSkuCount,
            totalStock: productStock,
            avgMrp,
            trimsCost: product.trimsCost ? Number(product.trimsCost) : null,
            liningCost: product.liningCost ? Number(product.liningCost) : null,
            packagingCost: product.packagingCost ? Number(product.packagingCost) : null,
            laborMinutes: product.baseProductionTimeMins
                ? Number(product.baseProductionTimeMins)
                : null,
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
}
