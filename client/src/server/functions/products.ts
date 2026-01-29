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
    fabricConsumption: number | null;
    targetStockQty: number | null;
    isActive: boolean;
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
    laborMinutes: number | null;
}

interface VariationData {
    id: string;
    productId: string;
    colorName: string;
    colorHex: string | null;
    fabricId: string;
    fabricColourId: string | null;
    imageUrl: string | null;
    isActive: boolean;
    hasLining: boolean;
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
    laborMinutes: number | null;
    fabric: {
        id: string;
        name: string;
        material?: {
            id: string;
            name: string;
        } | null;
    } | null;
    fabricColour: {
        id: string;
        colourName: string;
        colourHex: string | null;
        fabric: {
            id: string;
            name: string;
            material?: {
                id: string;
                name: string;
            } | null;
        };
    } | null;
    skus: SkuData[];
}

interface ProductData {
    id: string;
    name: string;
    styleCode: string | null;
    category: string;
    gender: string;
    productType: string;
    fabricTypeId: string | null;
    imageUrl: string | null;
    isActive: boolean;
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
    baseProductionTimeMins: number;
    fabricType: {
        id: string;
        name: string;
    } | null;
    variations: VariationData[];
}

/**
 * Server Function: Get products tree
 *
 * Fetches products directly from database using Prisma.
 * Returns hierarchical tree ready for TanStack Table display.
 */
export const getProductsTree = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => productsTreeInputSchema.parse(input))
    .handler(async ({ data }): Promise<ProductsTreeResponse> => {
        console.log('[Server Function] getProductsTree called with:', data);

        try {
            const prisma = await getPrisma();

            const { search } = data;

            // Step 1: Get inventory balances by SKU
            const balances: BalanceRow[] = await prisma.$queryRaw`
                SELECT
                    "skuId",
                    SUM(qty)::bigint AS "balance"
                FROM "InventoryTransaction"
                GROUP BY "skuId"
            `;

            // Create balance lookup map for O(1) access
            const balanceMap = new Map<string, number>(
                balances.map((b: BalanceRow) => [b.skuId, Number(b.balance)])
            );

            // Step 2: Build search filter
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let searchFilter: Record<string, any> = {};
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
            const products: ProductData[] = await prisma.product.findMany({
                where: {
                    isActive: true,
                    ...searchFilter,
                },
                include: {
                    fabricType: true,
                    variations: {
                        where: { isActive: true },
                        orderBy: { colorName: 'asc' },
                        include: {
                            fabric: true,
                            fabricColour: {
                                include: {
                                    fabric: {
                                        include: {
                                            material: true,
                                        },
                                    },
                                },
                            },
                            skus: {
                                where: { isActive: true },
                                orderBy: { size: 'asc' },
                            },
                        },
                    },
                },
                orderBy: { name: 'asc' },
            });

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

                        // Process SKUs
                        const children: SkuNode[] = variation.skus.map((sku: SkuData) => {
                            totalSkus++;
                            productSkuCount++;
                            const balance = balanceMap.get(sku.id) || 0;
                            variationStock += balance;
                            totalStock += balance;
                            if (sku.mrp > 0) {
                                variationMrps.push(sku.mrp);
                                allMrps.push(sku.mrp);
                            }

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
                                fabricConsumption: sku.fabricConsumption ?? undefined,
                                currentBalance: balance,
                                availableBalance: balance,
                                targetStockQty: sku.targetStockQty ?? undefined,
                                trimsCost: sku.trimsCost,
                                liningCost: sku.liningCost,
                                packagingCost: sku.packagingCost,
                                laborMinutes: sku.laborMinutes,
                            };
                        });

                        productStock += variationStock;
                        if (variation.hasLining) hasLining = true;

                        // Calculate variation average MRP
                        const avgMrp =
                            variationMrps.length > 0
                                ? variationMrps.reduce((a, b) => a + b, 0) / variationMrps.length
                                : null;

                        return {
                            id: variation.id,
                            type: 'variation' as const,
                            name: variation.colorName,
                            isActive: variation.isActive,
                            productId: variation.productId,
                            productName: product.name,
                            colorName: variation.colorName,
                            colorHex: variation.colorHex ?? undefined,
                            fabricId: variation.fabricId ?? undefined,
                            fabricName: variation.fabric?.name ?? undefined,
                            imageUrl: variation.imageUrl ?? undefined,
                            hasLining: variation.hasLining,
                            totalStock: variationStock,
                            avgMrp,
                            trimsCost: variation.trimsCost,
                            liningCost: variation.liningCost,
                            packagingCost: variation.packagingCost,
                            laborMinutes: variation.laborMinutes,
                            children,
                        };
                    }
                );

                // Calculate product average MRP
                const avgMrp =
                    allMrps.length > 0
                        ? allMrps.reduce((a, b) => a + b, 0) / allMrps.length
                        : null;

                return {
                    id: product.id,
                    type: 'product' as const,
                    name: product.name,
                    isActive: product.isActive,
                    styleCode: product.styleCode ?? undefined,
                    category: product.category || '',
                    gender: product.gender ?? undefined,
                    productType: product.productType ?? undefined,
                    fabricTypeId: product.fabricTypeId ?? undefined,
                    fabricTypeName: product.fabricType?.name ?? undefined,
                    imageUrl: product.imageUrl ?? undefined,
                    hasLining,
                    variationCount: processedVariations.length,
                    skuCount: productSkuCount,
                    totalStock: productStock,
                    avgMrp,
                    trimsCost: product.trimsCost,
                    liningCost: product.liningCost,
                    packagingCost: product.packagingCost,
                    laborMinutes: product.baseProductionTimeMins,
                    children: processedVariations,
                };
            });

            console.log(
                '[Server Function] Query returned',
                totalProducts,
                'products,',
                totalSkus,
                'skus'
            );

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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            countQuery = countQuery.where((eb: any) =>
                eb.or([sql`LOWER("Product"."name") LIKE ${searchTerm}`])
            ) as typeof countQuery;
        }

        // Get total count
        const countResult = await countQuery.executeTakeFirst();
        const total = countResult?.count ?? 0;

        // Build main query for products
        const productsRaw = await db
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .$call((qb: any) => {
                let q = qb;
                if (category) {
                    q = q.where('Product.category', '=', category) as typeof q;
                }
                if (isActive !== undefined) {
                    q = q.where('Product.isActive', '=', isActive) as typeof q;
                }
                if (search) {
                    const searchTerm = `%${search.toLowerCase()}%`;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const productIds = productsRaw.map((p: any) => p.id);

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

        // Fetch variations with fabrics for these products
        const variationsRaw = await db
            .selectFrom('Variation')
            .leftJoin('Fabric', 'Fabric.id', 'Variation.fabricId')
            .select([
                'Variation.id',
                'Variation.productId',
                'Variation.colorName',
                'Variation.standardColor',
                'Variation.colorHex',
                'Variation.imageUrl',
                'Variation.isActive',
                'Variation.fabricId',
                'Fabric.id as fabric_id',
                'Fabric.name as fabric_name',
                'Fabric.colorName as fabric_colorName',
            ])
            .where('Variation.productId', 'in', productIds)
            .execute();

        // Get variation IDs for fetching SKUs
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const variationIds = variationsRaw.map((v: any) => v.id);

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
                fabricConsumption: sku.fabricConsumption ?? 0,
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
                fabricId: v.fabricId ?? '',
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const products: ProductWithVariations[] = productsRaw.map((p: any) => ({
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
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
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
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
    laborMinutes: number | null;
    isActive: boolean;
    imageUrl: string | null;
    skus: SkuDetailResponse[];
}

export interface SkuDetailResponse {
    id: string;
    skuCode: string;
    variationId: string;
    size: string;
    fabricConsumption: number | null;
    mrp: number | null;
    targetStockQty: number | null;
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
    laborMinutes: number | null;
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
                    WHERE v."productId" = ${data.id}::uuid
                )
                GROUP BY "skuId"
            `;

            const balanceMap = new Map<string, number>(
                balances.map((b: BalanceRow) => [b.skuId, Number(b.balance)])
            );

            // Fetch product with full hierarchy
            const product = await prisma.product.findUnique({
                where: { id: data.id },
                include: {
                    fabricType: true,
                    variations: {
                        orderBy: { colorName: 'asc' },
                        include: {
                            fabric: {
                                include: {
                                    material: true,
                                },
                            },
                            fabricColour: {
                                include: {
                                    fabric: {
                                        include: {
                                            material: true,
                                        },
                                    },
                                },
                            },
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
            return {
                id: product.id,
                name: product.name,
                styleCode: product.styleCode,
                category: product.category,
                productType: product.productType,
                gender: product.gender,
                fabricTypeId: product.fabricTypeId,
                fabricTypeName: product.fabricType?.name ?? null,
                baseProductionTimeMins: product.baseProductionTimeMins,
                defaultFabricConsumption: product.defaultFabricConsumption,
                trimsCost: product.trimsCost,
                liningCost: product.liningCost,
                packagingCost: product.packagingCost,
                isActive: product.isActive,
                imageUrl: product.imageUrl,
                variations: product.variations.map((v: VariationData & { skus: SkuData[] }) => ({
                    id: v.id,
                    productId: v.productId,
                    colorName: v.colorName,
                    colorHex: v.colorHex,
                    fabricId: v.fabricId,
                    fabricName: v.fabric?.name ?? null,
                    fabricColourId: v.fabricColourId ?? null,
                    fabricColourName: v.fabricColour?.colourName ?? null,
                    materialName: v.fabricColour?.fabric?.material?.name ?? v.fabric?.material?.name ?? null,
                    hasLining: v.hasLining,
                    trimsCost: v.trimsCost,
                    liningCost: v.liningCost,
                    packagingCost: v.packagingCost,
                    laborMinutes: v.laborMinutes,
                    isActive: v.isActive,
                    imageUrl: v.imageUrl,
                    skus: v.skus.map((s: SkuData) => ({
                        id: s.id,
                        skuCode: s.skuCode,
                        variationId: s.variationId,
                        size: s.size,
                        fabricConsumption: s.fabricConsumption,
                        mrp: s.mrp,
                        targetStockQty: s.targetStockQty,
                        trimsCost: s.trimsCost,
                        liningCost: s.liningCost,
                        packagingCost: s.packagingCost,
                        laborMinutes: s.laborMinutes,
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
 */
export interface CatalogFiltersResponse {
    fabricTypes: { id: string; name: string }[];
    fabrics: {
        id: string;
        name: string;
        fabricTypeId: string;
        colorName: string | null;
        colorHex: string | null;
        costPerUnit: number | null;
    }[];
    fabricColours: {
        id: string;
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

            // Fetch fabric types (FabricType doesn't have isActive field)
            const fabricTypes = await prisma.fabricType.findMany({
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            });

            // Fetch fabrics (legacy - for backward compatibility)
            const fabrics = await prisma.fabric.findMany({
                where: { isActive: true },
                select: {
                    id: true,
                    name: true,
                    fabricTypeId: true,
                    colorName: true,
                    colorHex: true,
                    costPerUnit: true,
                },
                orderBy: { name: 'asc' },
            });

            // Fetch fabric colours (NEW - 3-tier hierarchy)
            const fabricColoursRaw = await prisma.fabricColour.findMany({
                where: { isActive: true },
                include: {
                    fabric: {
                        include: {
                            material: true,
                        },
                    },
                    // Include linked variations to get product images
                    variations: {
                        where: { isActive: true },
                        take: 4, // Limit to 4 product images
                        select: {
                            id: true,
                            imageUrl: true,
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    imageUrl: true,
                                },
                            },
                        },
                    },
                },
                orderBy: [
                    { fabric: { material: { name: 'asc' } } },
                    { fabric: { name: 'asc' } },
                    { colourName: 'asc' },
                ],
            });

            // Transform fabricColours to expected format
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fabricColours = fabricColoursRaw.map((fc: any) => {
                // Get unique product images (prefer variation image, fallback to product image)
                const productImages: string[] = [];
                const seenProductIds = new Set<string>();
                for (const variation of fc.variations || []) {
                    const productId = variation.product?.id;
                    if (productId && !seenProductIds.has(productId)) {
                        seenProductIds.add(productId);
                        const imageUrl = variation.imageUrl || variation.product?.imageUrl;
                        if (imageUrl) {
                            productImages.push(imageUrl);
                        }
                    }
                }

                return {
                    id: fc.id,
                    name: fc.colourName,
                    hex: fc.colourHex,
                    fabricId: fc.fabricId,
                    fabricName: fc.fabric?.name ?? '',
                    materialId: fc.fabric?.materialId ?? '',
                    materialName: fc.fabric?.material?.name ?? '',
                    costPerUnit: fc.costPerUnit ?? fc.fabric?.costPerUnit ?? null,
                    productImages: productImages.slice(0, 3), // Max 3 images
                };
            });

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
