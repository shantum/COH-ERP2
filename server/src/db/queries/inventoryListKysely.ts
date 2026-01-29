/**
 * Kysely Inventory List Query
 *
 * High-performance replacement for Prisma's nested includes.
 * Uses JOINs for SKU → Variation → Product hierarchy.
 *
 * NOTE: Balance calculation still uses inventoryBalanceCache which
 * already does optimized groupBy aggregations. This query focuses
 * on optimizing the SKU metadata fetch.
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
    inventorySkuRowArraySchema,
    type InventorySkuRow,
    type InventoryBalanceRow,
} from '@coh/shared';

// Re-export output types from schemas
export type { InventorySkuRow, InventoryBalanceRow };

// ============================================
// INPUT TYPES (not validated - internal use)
// ============================================

export interface InventoryListParams {
    includeCustomSkus?: boolean;
    search?: string;
}

// ============================================
// MAIN QUERY
// ============================================

/**
 * List all active SKUs with variation/product/fabric metadata
 * Returns flattened rows ready for balance enrichment
 */
export async function listInventorySkusKysely(
    params: InventoryListParams
): Promise<InventorySkuRow[]> {
    const { includeCustomSkus = false, search } = params;

    // Join to BOM system for fabric info (source of truth)
    let query = kysely
        .selectFrom('Sku')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('Product', 'Product.id', 'Variation.productId')
        .leftJoin('VariationBomLine', (join) =>
            join
                .onRef('VariationBomLine.variationId', '=', 'Variation.id')
                .on('VariationBomLine.fabricColourId', 'is not', null)
        )
        .leftJoin('FabricColour', 'FabricColour.id', 'VariationBomLine.fabricColourId')
        .leftJoin('Fabric', 'Fabric.id', 'FabricColour.fabricId')
        .leftJoin('ShopifyInventoryCache', 'ShopifyInventoryCache.skuId', 'Sku.id')
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
            'FabricColour.fabricId',
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
        const searchTerm = `%${search.toLowerCase()}%`;
        query = query.where((eb: any) =>
            eb.or([
                sql`LOWER("Sku"."skuCode") LIKE ${searchTerm}`,
                sql`LOWER("Product"."name") LIKE ${searchTerm}`,
            ])
        ) as typeof query;
    }

    const rows = await query.execute();

    const result = rows.map((r) => ({
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
        shopifyAvailableQty: r.shopifyAvailableQty,
    }));

    // Validate output against Zod schema
    return inventorySkuRowArraySchema.parse(result);
}

// ============================================
// BALANCE CALCULATION (Kysely version)
// ============================================

/**
 * Get inventory balances for given SKU IDs from materialized column
 * Fast O(1) lookup - reads directly from Sku.currentBalance
 */
export async function calculateBalancesKysely(
    skuIds: string[]
): Promise<Map<string, InventoryBalanceRow>> {
    if (skuIds.length === 0) {
        return new Map();
    }

    // Fast path: read materialized balances from Sku table
    const results = await kysely
        .selectFrom('Sku')
        .select(['Sku.id as skuId', 'Sku.currentBalance'])
        .where('Sku.id', 'in', skuIds)
        .execute();

    const balanceMap = new Map<string, InventoryBalanceRow>();

    for (const row of results) {
        balanceMap.set(row.skuId, {
            totalInward: 0, // Not tracked - use calculateBalancesWithTotalsKysely if needed
            totalOutward: 0, // Not tracked - use calculateBalancesWithTotalsKysely if needed
            currentBalance: row.currentBalance,
        });
    }

    // Fill in zeros for SKUs not found
    for (const skuId of skuIds) {
        if (!balanceMap.has(skuId)) {
            balanceMap.set(skuId, { totalInward: 0, totalOutward: 0, currentBalance: 0 });
        }
    }

    return balanceMap;
}

/**
 * Calculate inventory balances with inward/outward totals using Kysely
 * Use this when you need to display totalInward/totalOutward.
 * For just currentBalance, use calculateBalancesKysely() instead (faster).
 */
export async function calculateBalancesWithTotalsKysely(
    skuIds: string[]
): Promise<Map<string, InventoryBalanceRow>> {
    if (skuIds.length === 0) {
        return new Map();
    }

    // Use groupBy with SUM aggregation for full totals
    const results = await kysely
        .selectFrom('InventoryTransaction')
        .select([
            'InventoryTransaction.skuId',
            'InventoryTransaction.txnType',
            sql<number>`COALESCE(SUM("InventoryTransaction"."qty"), 0)::int`.as('totalQty'),
        ])
        .where('InventoryTransaction.skuId', 'in', skuIds)
        .groupBy(['InventoryTransaction.skuId', 'InventoryTransaction.txnType'])
        .execute();

    // Build balance map
    const balanceMap = new Map<string, InventoryBalanceRow>();

    for (const row of results) {
        if (!balanceMap.has(row.skuId)) {
            balanceMap.set(row.skuId, { totalInward: 0, totalOutward: 0, currentBalance: 0 });
        }
        const balance = balanceMap.get(row.skuId)!;
        if (row.txnType === 'inward') {
            balance.totalInward = row.totalQty;
        } else if (row.txnType === 'outward') {
            balance.totalOutward = row.totalQty;
        }
    }

    // Calculate currentBalance for each
    for (const balance of balanceMap.values()) {
        balance.currentBalance = balance.totalInward - balance.totalOutward;
    }

    // Fill in zeros for SKUs with no transactions
    for (const skuId of skuIds) {
        if (!balanceMap.has(skuId)) {
            balanceMap.set(skuId, { totalInward: 0, totalOutward: 0, currentBalance: 0 });
        }
    }

    return balanceMap;
}
