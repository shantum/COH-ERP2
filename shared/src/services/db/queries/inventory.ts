/**
 * Kysely Inventory Queries
 *
 * High-performance inventory queries using type-safe SQL.
 * Includes balance calculations using Kysely and Prisma patterns.
 */

// NOTE: kysely's `sql` is imported dynamically to prevent client bundling
import { getKysely } from '../kysely.js';
import type { PrismaInstance, PrismaTransaction } from '../prisma.js';
import type { InventorySkuRow, InventoryBalanceRow } from '../../../schemas/inventory.js';

// ============================================
// INPUT TYPES
// ============================================

export interface InventoryListParams {
    includeCustomSkus?: boolean;
    search?: string;
}

// ============================================
// OUTPUT TYPES (Extended from schemas)
// ============================================

export interface InventoryBalanceWithSkuId extends InventoryBalanceRow {
    skuId: string;
}

// ============================================
// KYSELY QUERIES
// ============================================

/**
 * List all active SKUs with variation/product/fabric metadata
 *
 * Uses Kysely for efficient JOINs across SKU → Variation → Product → Fabric.
 * Returns flattened rows ready for balance enrichment.
 */
export async function listInventorySkusKysely(
    params: InventoryListParams
): Promise<InventorySkuRow[]> {
    const { includeCustomSkus = false, search } = params;

    const db = await getKysely();

    let query = db
        .selectFrom('Sku')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('Product', 'Product.id', 'Variation.productId')
        .leftJoin('Fabric', 'Fabric.id', 'Variation.fabricId')
        .leftJoin('ShopifyInventoryCache', 'ShopifyInventoryCache.skuId', 'Sku.id')
        .select([
            'Sku.id as skuId',
            'Sku.skuCode',
            'Sku.size',
            'Sku.mrp',
            'Sku.targetStockQty',
            'Sku.isCustomSku',
            'Variation.id as variationId',
            'Variation.colorName',
            'Variation.imageUrl as variationImageUrl',
            'Product.id as productId',
            'Product.name as productName',
            'Product.productType',
            'Product.gender',
            'Product.category',
            'Product.imageUrl as productImageUrl',
            'Variation.fabricId',
            'Fabric.name as fabricName',
            'ShopifyInventoryCache.availableQty as shopifyAvailableQty',
        ])
        .where('Sku.isActive', '=', true);

    // Filter custom SKUs
    if (!includeCustomSkus) {
        query = query.where('Sku.isCustomSku', '=', false) as typeof query;
    }

    // Apply search filter
    if (search) {
        // Dynamic import to prevent kysely from being bundled into client
        const { sql } = await import('kysely');
        const searchTerm = `%${search.toLowerCase()}%`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query = query.where((eb: any) =>
            eb.or([
                sql`LOWER("Sku"."skuCode") LIKE ${searchTerm}`,
                sql`LOWER("Product"."name") LIKE ${searchTerm}`,
            ])
        ) as typeof query;
    }

    const rows = await query.execute();

    return rows.map((r) => ({
        skuId: r.skuId,
        skuCode: r.skuCode,
        size: r.size,
        mrp: r.mrp,
        targetStockQty: r.targetStockQty,
        isCustomSku: r.isCustomSku,
        variationId: r.variationId,
        colorName: r.colorName,
        variationImageUrl: r.variationImageUrl,
        productId: r.productId,
        productName: r.productName,
        productType: r.productType,
        gender: r.gender,
        category: r.category,
        productImageUrl: r.productImageUrl,
        fabricId: r.fabricId,
        fabricName: r.fabricName,
        shopifyAvailableQty: r.shopifyAvailableQty,
    }));
}

// ============================================
// PRISMA BALANCE CALCULATIONS
// ============================================

/**
 * Calculate inventory balance for a single SKU
 *
 * Uses Prisma groupBy for efficient aggregation.
 * Returns inward/outward/current balance.
 */
export async function calculateInventoryBalance(
    prisma: PrismaInstance | PrismaTransaction,
    skuId: string,
    options: { allowNegative?: boolean } = {}
): Promise<InventoryBalanceRow & { availableBalance: number; hasDataIntegrityIssue: boolean }> {
    const result = await prisma.inventoryTransaction.groupBy({
        by: ['txnType'],
        where: { skuId },
        _sum: { qty: true },
    });

    let totalInward = 0;
    let totalOutward = 0;

    result.forEach((r: { txnType: string; _sum: { qty: number | null } }) => {
        if (r.txnType === 'inward') totalInward = r._sum.qty || 0;
        else if (r.txnType === 'outward') totalOutward = r._sum.qty || 0;
    });

    const currentBalance = totalInward - totalOutward;
    const hasDataIntegrityIssue = !options.allowNegative && currentBalance < 0;

    return {
        totalInward,
        totalOutward,
        currentBalance,
        availableBalance: currentBalance,
        hasDataIntegrityIssue,
    };
}

/**
 * Calculate inventory balances for all SKUs efficiently
 *
 * Uses single aggregation query - O(1) instead of O(N).
 * Returns Map of skuId → balance for fast lookup.
 */
export async function calculateAllInventoryBalances(
    prisma: PrismaInstance | PrismaTransaction,
    skuIds: string[] | null = null
): Promise<Map<string, InventoryBalanceWithSkuId & { availableBalance: number }>> {
    const where: { skuId?: { in: string[] } } = {};

    if (skuIds) {
        where.skuId = { in: skuIds };
    }

    const result = await prisma.inventoryTransaction.groupBy({
        by: ['skuId', 'txnType'],
        where,
        _sum: { qty: true },
    });

    // Aggregate transaction totals by SKU
    const summaryMap = new Map<string, { totalInward: number; totalOutward: number }>();

    result.forEach((r: { skuId: string; txnType: string; _sum: { qty: number | null } }) => {
        if (!summaryMap.has(r.skuId)) {
            summaryMap.set(r.skuId, { totalInward: 0, totalOutward: 0 });
        }

        const summary = summaryMap.get(r.skuId)!;
        if (r.txnType === 'inward') summary.totalInward = r._sum.qty || 0;
        else if (r.txnType === 'outward') summary.totalOutward = r._sum.qty || 0;
    });

    // Calculate balances
    const balanceMap = new Map<string, InventoryBalanceWithSkuId & { availableBalance: number }>();

    for (const [skuId, summary] of summaryMap) {
        const currentBalance = summary.totalInward - summary.totalOutward;
        balanceMap.set(skuId, {
            skuId,
            totalInward: summary.totalInward,
            totalOutward: summary.totalOutward,
            currentBalance,
            availableBalance: currentBalance,
        });
    }

    return balanceMap;
}
