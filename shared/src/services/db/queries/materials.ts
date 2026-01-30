/**
 * Kysely Materials Queries
 *
 * High-performance queries for materials/fabrics/colours using type-safe SQL.
 * Includes 30-day sales and consumption metrics for fabric colours.
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
 * 30-day sales metrics for a single FabricColour
 */
export interface FabricSalesMetrics {
    /** Revenue in last 30 days (SUM of qty × unitPrice) */
    sales30DayValue: number;
    /** Units sold in last 30 days (SUM of qty) */
    sales30DayUnits: number;
    /** Fabric consumed in last 30 days (SUM of qty × fabricConsumption) */
    consumption30Day: number;
}

// ============================================
// FABRIC SALES METRICS QUERY
// ============================================

/**
 * Get 30-day sales and consumption metrics for all fabric colours
 *
 * Aggregates order line data by FabricColour via the link chain:
 * OrderLine → Sku → Variation → FabricColour
 *
 * Uses orderDate (not shippedAt) to capture demand from all non-cancelled orders.
 *
 * @returns Map keyed by fabricColourId for O(1) lookup
 */
export async function getFabricSalesMetricsKysely(): Promise<Map<string, FabricSalesMetrics>> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    // 30 days ago in IST
    const thirtyDaysAgo = getISTMidnightAsUTC(-30);

    // Join through VariationBomLine to get fabric (Variation.fabricColourId was removed)
    const rows = await db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .innerJoin('Sku', 'Sku.id', 'OrderLine.skuId')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('VariationBomLine', (join) =>
            join
                .onRef('VariationBomLine.variationId', '=', 'Variation.id')
                .on('VariationBomLine.fabricColourId', 'is not', null)
        )
        .innerJoin('FabricColour', 'FabricColour.id', 'VariationBomLine.fabricColourId')
        .select([
            'FabricColour.id as fabricColourId',
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('sales30DayValue'),
            sql<number>`SUM("OrderLine"."qty")::int`.as('sales30DayUnits'),
            sql<number>`SUM("OrderLine"."qty" * "Sku"."fabricConsumption")::numeric`.as('consumption30Day'),
        ])
        .where('Order.orderDate', '>=', thirtyDaysAgo)
        .where('OrderLine.lineStatus', '!=', 'cancelled')
        .groupBy('FabricColour.id')
        .execute();

    // Build Map for O(1) lookup
    const metricsMap = new Map<string, FabricSalesMetrics>();

    for (const row of rows) {
        metricsMap.set(row.fabricColourId, {
            sales30DayValue: Number(row.sales30DayValue ?? 0),
            sales30DayUnits: row.sales30DayUnits ?? 0,
            consumption30Day: Number(row.consumption30Day ?? 0),
        });
    }

    return metricsMap;
}
