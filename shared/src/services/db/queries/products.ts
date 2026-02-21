/**
 * Kysely Products Queries
 *
 * High-performance queries for products/variations/SKUs using type-safe SQL.
 * Includes 30-day sales metrics and Shopify stock aggregation.
 *
 * ⚠️  DYNAMIC IMPORTS ONLY - DO NOT USE STATIC IMPORTS ⚠️
 * Uses `await import('kysely')` for sql template tag.
 * Static imports would break client bundling. See services/index.ts for details.
 */

import { getKysely } from '../kysely.js';
import { getISTMidnightAsUTC } from '../../../utils/dateHelpers.js';

// ============================================
// OUTPUT TYPES
// ============================================

/**
 * 30-day sales metrics for a single Variation
 */
export interface VariationSalesMetrics {
    /** Revenue in last 30 days (SUM of qty × unitPrice) */
    sales30DayValue: number;
    /** Units sold in last 30 days (SUM of qty) */
    sales30DayUnits: number;
}

/**
 * 30-day sales metrics for a single SKU
 */
export interface SkuSalesMetrics {
    /** Revenue in last 30 days (SUM of qty × unitPrice) */
    sales30DayValue: number;
    /** Units sold in last 30 days (SUM of qty) */
    sales30DayUnits: number;
}

// ============================================
// VARIATION SALES METRICS QUERY
// ============================================

/**
 * Get 30-day sales metrics for all variations
 *
 * Aggregates order line data by Variation via the link chain:
 * OrderLine → Sku → Variation
 *
 * Uses orderDate (not shippedAt) to capture demand from all non-cancelled orders.
 *
 * @returns Map keyed by variationId for O(1) lookup
 */
export async function getVariationSalesMetricsKysely(): Promise<Map<string, VariationSalesMetrics>> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    // 30 days ago in IST
    const thirtyDaysAgo = getISTMidnightAsUTC(-30);

    const rows = await db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .innerJoin('Sku', 'Sku.id', 'OrderLine.skuId')
        .select([
            'Sku.variationId',
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('sales30DayValue'),
            sql<number>`SUM("OrderLine"."qty")::int`.as('sales30DayUnits'),
        ])
        .where('Order.orderDate', '>=', thirtyDaysAgo)
        .where('OrderLine.lineStatus', '!=', 'cancelled')
        .groupBy('Sku.variationId')
        .execute();

    // Build Map for O(1) lookup
    const metricsMap = new Map<string, VariationSalesMetrics>();

    for (const row of rows) {
        metricsMap.set(row.variationId, {
            sales30DayValue: Number(row.sales30DayValue ?? 0),
            sales30DayUnits: row.sales30DayUnits ?? 0,
        });
    }

    return metricsMap;
}

// ============================================
// SKU SALES METRICS QUERY
// ============================================

/**
 * Get 30-day sales metrics for all SKUs
 *
 * Aggregates order line data by SKU.
 * Uses orderDate (not shippedAt) to capture demand from all non-cancelled orders.
 *
 * @returns Map keyed by skuId for O(1) lookup
 */
export async function getSkuSalesMetricsKysely(): Promise<Map<string, SkuSalesMetrics>> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    // 30 days ago in IST
    const thirtyDaysAgo = getISTMidnightAsUTC(-30);

    const rows = await db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .select([
            'OrderLine.skuId',
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('sales30DayValue'),
            sql<number>`SUM("OrderLine"."qty")::int`.as('sales30DayUnits'),
        ])
        .where('Order.orderDate', '>=', thirtyDaysAgo)
        .where('OrderLine.lineStatus', '!=', 'cancelled')
        .groupBy('OrderLine.skuId')
        .execute();

    // Build Map for O(1) lookup
    const metricsMap = new Map<string, SkuSalesMetrics>();

    for (const row of rows) {
        metricsMap.set(row.skuId, {
            sales30DayValue: Number(row.sales30DayValue ?? 0),
            sales30DayUnits: row.sales30DayUnits ?? 0,
        });
    }

    return metricsMap;
}

// ============================================
// VARIATION SHOPIFY STOCK QUERY
// ============================================

/**
 * Get aggregated Shopify stock for all variations
 *
 * Aggregates ShopifyInventoryCache.availableQty by Variation via the link chain:
 * ShopifyInventoryCache → Sku → Variation
 *
 * @returns Map keyed by variationId for O(1) lookup
 */
export async function getVariationShopifyStockKysely(): Promise<Map<string, number>> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const rows = await db
        .selectFrom('ShopifyInventoryCache')
        .innerJoin('Sku', 'Sku.id', 'ShopifyInventoryCache.skuId')
        .select([
            'Sku.variationId',
            sql<number>`SUM("ShopifyInventoryCache"."availableQty")::int`.as('shopifyStock'),
        ])
        .groupBy('Sku.variationId')
        .execute();

    // Build Map for O(1) lookup
    const stockMap = new Map<string, number>();

    for (const row of rows) {
        stockMap.set(row.variationId, row.shopifyStock ?? 0);
    }

    return stockMap;
}

// ============================================
// SKU SHOPIFY STOCK QUERY
// ============================================

/**
 * Get Shopify stock for all SKUs
 *
 * Fetches ShopifyInventoryCache.availableQty by SKU.
 *
 * @returns Map keyed by skuId for O(1) lookup
 */
export async function getSkuShopifyStockKysely(): Promise<Map<string, number>> {
    const db = await getKysely();

    const rows = await db
        .selectFrom('ShopifyInventoryCache')
        .select([
            'ShopifyInventoryCache.skuId',
            'ShopifyInventoryCache.availableQty',
        ])
        .execute();

    // Build Map for O(1) lookup
    const stockMap = new Map<string, number>();

    for (const row of rows) {
        stockMap.set(row.skuId, row.availableQty ?? 0);
    }

    return stockMap;
}

// ============================================
// FABRIC COLOUR BALANCE QUERY
// ============================================

/**
 * Get fabric stock (currentBalance) for all fabric colours
 *
 * Fetches FabricColour.currentBalance which is maintained by DB trigger.
 *
 * @returns Map keyed by fabricColourId for O(1) lookup
 */
export async function getFabricColourBalancesKysely(): Promise<Map<string, number>> {
    const db = await getKysely();

    const rows = await db
        .selectFrom('FabricColour')
        .select([
            'FabricColour.id',
            'FabricColour.currentBalance',
        ])
        .execute();

    // Build Map for O(1) lookup
    const balanceMap = new Map<string, number>();

    for (const row of rows) {
        balanceMap.set(row.id, row.currentBalance ?? 0);
    }

    return balanceMap;
}

// ============================================
// PRODUCT SHOPIFY STATUS QUERY
// ============================================

/**
 * Get Shopify status for all products
 *
 * Fetches status from ShopifyProductCache.rawData via Product.shopifyProductId.
 *
 * @returns Map keyed by productId for O(1) lookup
 */
export async function getProductShopifyStatusesKysely(): Promise<Map<string, string>> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const rows = await db
        .selectFrom('Product')
        .innerJoin('ShopifyProductCache', 'ShopifyProductCache.id', 'Product.shopifyProductId')
        .select([
            'Product.id',
            sql<string>`("ShopifyProductCache"."rawData"::json->>'status')`.as('status'),
        ])
        .where('Product.shopifyProductId', 'is not', null)
        .execute();

    // Build Map for O(1) lookup
    const statusMap = new Map<string, string>();

    for (const row of rows) {
        if (row.status) {
            statusMap.set(row.id, row.status);
        }
    }

    return statusMap;
}

// ============================================
// VARIATION SHOPIFY STATUS QUERY
// ============================================

/**
 * Get Shopify status for all variations
 *
 * Fetches status from ShopifyProductCache.rawData via Variation.shopifySourceProductId.
 * This gives the correct status for variations that came from different Shopify products
 * than the main product (e.g., merged products).
 *
 * @returns Map keyed by variationId for O(1) lookup
 */
/**
 * Shopify pricing data for a single variant
 */
export interface SkuShopifyPricing {
    /** Shopify price (current selling price) */
    price: number;
    /** Shopify compare_at_price (original price, null if not on sale) */
    compareAtPrice: number | null;
    /** Shopify product ID */
    shopifyProductId: string;
}

// ============================================
// SKU SHOPIFY PRICING QUERY
// ============================================

/**
 * Get Shopify pricing for all SKU variants
 *
 * Fetches price and compare_at_price from ShopifyProductCache.rawData
 * by parsing variant data from each cached product.
 *
 * @returns Map keyed by Shopify variant ID (string) for O(1) lookup
 */
export async function getSkuShopifyPricingKysely(): Promise<Map<string, SkuShopifyPricing>> {
    const db = await getKysely();

    const rows = await db
        .selectFrom('ShopifyProductCache')
        .select(['ShopifyProductCache.id', 'ShopifyProductCache.rawData'])
        .execute();

    const pricingMap = new Map<string, SkuShopifyPricing>();

    for (const row of rows) {
        try {
            const data = typeof row.rawData === 'string' ? JSON.parse(row.rawData) : row.rawData;
            const variants = data?.variants;
            if (!Array.isArray(variants)) continue;

            for (const variant of variants) {
                if (!variant?.id) continue;
                pricingMap.set(variant.id.toString(), {
                    price: parseFloat(variant.price),
                    compareAtPrice: variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
                    shopifyProductId: data.id?.toString() ?? '',
                });
            }
        } catch {
            // Skip malformed rawData
        }
    }

    return pricingMap;
}

// ============================================
// VARIATION SHOPIFY STATUS QUERY
// ============================================

/**
 * Get Shopify status for all variations
 *
 * Fetches status from ShopifyProductCache.rawData via Variation.shopifySourceProductId.
 * This gives the correct status for variations that came from different Shopify products
 * than the main product (e.g., merged products).
 *
 * @returns Map keyed by variationId for O(1) lookup
 */
export async function getVariationShopifyStatusesKysely(): Promise<Map<string, string>> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const rows = await db
        .selectFrom('Variation')
        .innerJoin('ShopifyProductCache', 'ShopifyProductCache.id', 'Variation.shopifySourceProductId')
        .select([
            'Variation.id',
            sql<string>`("ShopifyProductCache"."rawData"::json->>'status')`.as('status'),
        ])
        .where('Variation.shopifySourceProductId', 'is not', null)
        .execute();

    // Build Map for O(1) lookup
    const statusMap = new Map<string, string>();

    for (const row of rows) {
        if (row.status) {
            statusMap.set(row.id, row.status);
        }
    }

    return statusMap;
}
