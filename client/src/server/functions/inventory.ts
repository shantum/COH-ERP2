/**
 * Inventory Server Functions
 *
 * TanStack Start Server Functions for inventory data fetching.
 * Uses Prisma for database queries.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

// Input validation schema
const inventoryListInputSchema = z.object({
    includeCustomSkus: z.boolean().optional().default(false),
    search: z.string().optional(),
    stockFilter: z.enum(['all', 'in_stock', 'low_stock', 'out_of_stock']).optional().default('all'),
    limit: z.number().int().positive().max(10000).optional().default(10000),
    offset: z.number().int().nonnegative().optional().default(0),
});

export type InventoryListInput = z.infer<typeof inventoryListInputSchema>;

/**
 * Inventory item returned by the Server Function
 */
export interface InventoryItem {
    skuId: string;
    skuCode: string;
    productId: string;
    productName: string;
    productType: string;
    gender: string;
    colorName: string;
    variationId: string;
    size: string;
    category: string;
    imageUrl: string | null;
    currentBalance: number;
    reservedBalance: number;
    availableBalance: number;
    totalInward: number;
    totalOutward: number;
    targetStockQty: number;
    status: 'ok' | 'below_target';
    mrp: number;
    shopifyQty: number | null;
    isCustomSku: boolean;
}

/**
 * Response type matching the frontend hook expectations
 */
export interface InventoryListResponse {
    items: InventoryItem[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    };
}

// Internal types for Prisma query results (avoiding @prisma/client import)
interface BalanceRow {
    skuId: string;
    totalInward: bigint;
    totalOutward: bigint;
    currentBalance: bigint;
}

interface SkuWithRelations {
    id: string;
    skuCode: string;
    size: string;
    mrp: number;
    targetStockQty: number;
    isCustomSku: boolean;
    variation: {
        id: string;
        colorName: string;
        imageUrl: string | null;
        product: {
            id: string;
            name: string;
            productType: string | null;
            gender: string | null;
            category: string | null;
            imageUrl: string | null;
        };
        fabric: {
            name: string;
        } | null;
    };
    shopifyInventoryCache: {
        availableQty: number;
    } | null;
}

interface BalanceData {
    totalInward: number;
    totalOutward: number;
    currentBalance: number;
}

interface SkuWithBalance {
    sku: SkuWithRelations;
    balance: BalanceData;
}

/**
 * Server Function: Get inventory list
 *
 * Fetches inventory directly from database using Prisma.
 * Returns paginated items with balance calculations.
 */
export const getInventoryList = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => inventoryListInputSchema.parse(input))
    .handler(async ({ data }): Promise<InventoryListResponse> => {
        console.log('[Server Function] getInventoryList called with:', data);

        try {
            // Dynamic import to prevent bundling Prisma into client
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { PrismaClient } = await import('@prisma/client') as any;

            // Use global singleton pattern
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const globalForPrisma = globalThis as any;
            const prisma = globalForPrisma.prisma ?? new PrismaClient();
            if (process.env.NODE_ENV !== 'production') {
                globalForPrisma.prisma = prisma;
            }

            const { includeCustomSkus, search, stockFilter, limit, offset } = data;

            // Step 1: Get inventory balances by SKU using raw SQL for aggregation
            // This calculates totalInward, totalOutward, and currentBalance per SKU
            const balances: BalanceRow[] = await prisma.$queryRaw`
                SELECT
                    "skuId",
                    COALESCE(SUM(CASE WHEN "txnType" = 'inward' THEN "qty" ELSE 0 END), 0)::bigint AS "totalInward",
                    COALESCE(SUM(CASE WHEN "txnType" = 'outward' THEN "qty" ELSE 0 END), 0)::bigint AS "totalOutward",
                    COALESCE(SUM(CASE WHEN "txnType" = 'inward' THEN "qty" ELSE 0 END), 0) -
                    COALESCE(SUM(CASE WHEN "txnType" = 'outward' THEN "qty" ELSE 0 END), 0) AS "currentBalance"
                FROM "InventoryTransaction"
                GROUP BY "skuId"
            `;

            // Create balance lookup map for O(1) access
            const balanceMap = new Map<string, BalanceData>(
                balances.map((b: BalanceRow) => [
                    b.skuId,
                    {
                        totalInward: Number(b.totalInward),
                        totalOutward: Number(b.totalOutward),
                        currentBalance: Number(b.currentBalance),
                    },
                ])
            );

            // Step 2: Build base where clause for SKUs
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const skuWhere: Record<string, any> = {
                isActive: true,
                ...(includeCustomSkus ? {} : { isCustomSku: false }),
            };

            // Add search filter
            if (search) {
                const searchLower = search.toLowerCase();
                skuWhere.OR = [
                    { skuCode: { contains: searchLower, mode: 'insensitive' } },
                    { variation: { colorName: { contains: searchLower, mode: 'insensitive' } } },
                    { variation: { product: { name: { contains: searchLower, mode: 'insensitive' } } } },
                ];
            }

            // Step 3: Fetch all matching SKUs with related data
            const allSkus: SkuWithRelations[] = await prisma.sku.findMany({
                where: skuWhere,
                include: {
                    variation: {
                        include: {
                            product: true,
                            fabric: true,
                        },
                    },
                    shopifyInventoryCache: true,
                },
                orderBy: { skuCode: 'asc' },
            });

            // Step 4: Apply stock filter in memory (since balance is computed)
            let filteredSkus: SkuWithBalance[] = allSkus.map((sku: SkuWithRelations) => {
                const balance = balanceMap.get(sku.id) || {
                    totalInward: 0,
                    totalOutward: 0,
                    currentBalance: 0,
                };
                return { sku, balance };
            });

            // Apply stock filter
            if (stockFilter === 'in_stock') {
                filteredSkus = filteredSkus.filter((item: SkuWithBalance) => item.balance.currentBalance > 0);
            } else if (stockFilter === 'out_of_stock') {
                filteredSkus = filteredSkus.filter((item: SkuWithBalance) => item.balance.currentBalance <= 0);
            } else if (stockFilter === 'low_stock') {
                filteredSkus = filteredSkus.filter((item: SkuWithBalance) => {
                    const targetQty = item.sku.targetStockQty || 10;
                    return item.balance.currentBalance > 0 && item.balance.currentBalance < targetQty;
                });
            }

            // Step 5: Get total count and apply pagination
            const totalCount = filteredSkus.length;
            const paginatedSkus = filteredSkus.slice(offset, offset + limit);

            // Step 6: Transform to response format
            const items: InventoryItem[] = paginatedSkus.map(({ sku, balance }: SkuWithBalance) => {
                const { currentBalance, totalInward, totalOutward } = balance;
                const targetStockQty = sku.targetStockQty || 0;
                const imageUrl = sku.variation.imageUrl || sku.variation.product.imageUrl || null;

                return {
                    skuId: sku.id,
                    skuCode: sku.skuCode,
                    productId: sku.variation.product.id,
                    productName: sku.variation.product.name,
                    productType: sku.variation.product.productType || '',
                    gender: sku.variation.product.gender || '',
                    colorName: sku.variation.colorName,
                    variationId: sku.variation.id,
                    size: sku.size,
                    category: sku.variation.product.category || '',
                    imageUrl,
                    currentBalance,
                    reservedBalance: 0, // TODO: Calculate reserved from pending orders
                    availableBalance: currentBalance,
                    totalInward,
                    totalOutward,
                    targetStockQty,
                    status: currentBalance < targetStockQty ? 'below_target' : 'ok',
                    mrp: Number(sku.mrp) || 0,
                    shopifyQty: sku.shopifyInventoryCache?.availableQty ?? null,
                    isCustomSku: sku.isCustomSku || false,
                };
            });

            console.log(
                '[Server Function] Query returned',
                items.length,
                'items, total:',
                totalCount
            );

            return {
                items,
                pagination: {
                    total: totalCount,
                    limit,
                    offset,
                    hasMore: offset + items.length < totalCount,
                },
            };
        } catch (error) {
            console.error('[Server Function] Error in getInventoryList:', error);
            throw error;
        }
    });
