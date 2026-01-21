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
            // Dynamic import to prevent bundling Prisma into client
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { PrismaClient } = (await import('@prisma/client')) as any;

            // Use global singleton pattern
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const globalForPrisma = globalThis as any;
            const prisma = globalForPrisma.prisma ?? new PrismaClient();
            if (process.env.NODE_ENV !== 'production') {
                globalForPrisma.prisma = prisma;
            }

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
        } catch (error) {
            console.error('[Server Function] Error in getProductsTree:', error);
            throw error;
        }
    });
