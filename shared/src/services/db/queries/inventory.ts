/**
 * Kysely Inventory Queries
 *
 * High-performance inventory queries using type-safe SQL.
 * Includes balance calculations using Kysely and Prisma patterns.
 *
 * ⚠️  DYNAMIC IMPORTS ONLY - DO NOT USE STATIC IMPORTS ⚠️
 * Uses `await import('kysely')` for sql template tag.
 * Static imports would break client bundling. See services/index.ts for details.
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
    const { sql } = await import('kysely');

    let query = db
        .selectFrom('Sku')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('Product', 'Product.id', 'Variation.productId')
        .leftJoin('Fabric', 'Fabric.id', 'Variation.fabricId')
        .leftJoin('FabricColour', 'FabricColour.id', 'Variation.fabricColourId')
        .leftJoin('ShopifyInventoryCache', 'ShopifyInventoryCache.skuId', 'Sku.id')
        // Use Variation.shopifySourceProductId for status lookup (more accurate for multi-color products)
        // Falls back to Product.shopifyProductId if variation source is not set
        .leftJoin('ShopifyProductCache', (join) =>
            join.onRef('ShopifyProductCache.id', '=', sql`COALESCE("Variation"."shopifySourceProductId", "Product"."shopifyProductId")`)
        )
        .select([
            'Sku.id as skuId',
            'Sku.skuCode',
            'Sku.size',
            'Sku.mrp',
            'Sku.currentBalance',
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
            'Fabric.unit as fabricUnit',
            'Variation.fabricColourId',
            'FabricColour.colourName as fabricColourName',
            'FabricColour.colourHex as fabricColourHex',
            'ShopifyInventoryCache.availableQty as shopifyAvailableQty',
            // Extract status from ShopifyProductCache.rawData JSON
            sql<string | null>`"ShopifyProductCache"."rawData"::json->>'status'`.as('shopifyProductStatus'),
        ])
        .where('Sku.isActive', '=', true);

    // Filter custom SKUs
    if (!includeCustomSkus) {
        query = query.where('Sku.isCustomSku', '=', false) as typeof query;
    }

    // Apply search filter
    if (search) {
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
        currentBalance: r.currentBalance,
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
        fabricUnit: r.fabricUnit,
        fabricColourId: r.fabricColourId,
        fabricColourName: r.fabricColourName,
        fabricColourHex: r.fabricColourHex,
        shopifyAvailableQty: r.shopifyAvailableQty,
        shopifyProductStatus: r.shopifyProductStatus as 'active' | 'archived' | 'draft' | null,
    }));
}

// ============================================
// PRISMA BALANCE CALCULATIONS
// ============================================

/**
 * Get inventory balance for a single SKU
 *
 * Reads directly from Sku.currentBalance column (maintained by DB trigger).
 * O(1) lookup - no aggregation needed.
 */
export async function calculateInventoryBalance(
    prisma: PrismaInstance | PrismaTransaction,
    skuId: string,
    options: { allowNegative?: boolean } = {}
): Promise<InventoryBalanceRow & { availableBalance: number; hasDataIntegrityIssue: boolean }> {
    // Fast path: read materialized balance from Sku table
    const sku = await prisma.sku.findUnique({
        where: { id: skuId },
        select: { currentBalance: true },
    });

    const currentBalance = sku?.currentBalance ?? 0;
    const hasDataIntegrityIssue = !options.allowNegative && currentBalance < 0;

    // Note: totalInward/totalOutward are not tracked in materialized column
    // If needed, use calculateInventoryBalanceWithTotals() instead
    return {
        totalInward: 0, // Not tracked - use calculateInventoryBalanceWithTotals if needed
        totalOutward: 0, // Not tracked - use calculateInventoryBalanceWithTotals if needed
        currentBalance,
        availableBalance: currentBalance,
        hasDataIntegrityIssue,
    };
}

/**
 * Calculate inventory balance with inward/outward totals
 *
 * Uses Prisma groupBy for full aggregation.
 * Use this when you need to display totalInward/totalOutward.
 * For just currentBalance, use calculateInventoryBalance() instead (faster).
 */
export async function calculateInventoryBalanceWithTotals(
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
 * Get inventory balances for multiple SKUs efficiently
 *
 * Reads directly from Sku.currentBalance column (maintained by DB trigger).
 * Single query, O(1) per SKU.
 */
export async function calculateAllInventoryBalances(
    prisma: PrismaInstance | PrismaTransaction,
    skuIds: string[] | null = null
): Promise<Map<string, InventoryBalanceWithSkuId & { availableBalance: number }>> {
    // Fast path: read materialized balances from Sku table
    const skus = await prisma.sku.findMany({
        where: skuIds ? { id: { in: skuIds } } : undefined,
        select: { id: true, currentBalance: true },
    });

    const balanceMap = new Map<string, InventoryBalanceWithSkuId & { availableBalance: number }>();

    for (const sku of skus) {
        balanceMap.set(sku.id, {
            skuId: sku.id,
            totalInward: 0, // Not tracked - use calculateAllInventoryBalancesWithTotals if needed
            totalOutward: 0, // Not tracked - use calculateAllInventoryBalancesWithTotals if needed
            currentBalance: sku.currentBalance,
            availableBalance: sku.currentBalance,
        });
    }

    return balanceMap;
}

/**
 * Calculate inventory balances with inward/outward totals for multiple SKUs
 *
 * Uses aggregation query for full totals.
 * Use this when you need to display totalInward/totalOutward.
 * For just currentBalance, use calculateAllInventoryBalances() instead (faster).
 */
export async function calculateAllInventoryBalancesWithTotals(
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
