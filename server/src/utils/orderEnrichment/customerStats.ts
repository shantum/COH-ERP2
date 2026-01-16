/**
 * Customer Stats Enrichment
 * Enrich orders with customer LTV, tier, and order counts
 */

import type { PrismaClient } from '@prisma/client';
import { getCustomerStatsMap, getTierThresholds, calculateTier } from '../tierUtils.js';
import type { EnrichmentOptions, OrderForEnrichment, EnrichedOrder as PatternEnrichedOrder } from '../patterns/types.js';
import { calculateFulfillmentStage } from './fulfillmentStage.js';
import { calculateLineStatusCounts } from './lineStatusCounts.js';

// Re-export tier utilities for convenience
export { getCustomerStatsMap, getTierThresholds, calculateTier };

/**
 * Enrich orders with customer LTV, tier, and order count
 */
export async function enrichOrdersWithCustomerStats<T extends OrderForEnrichment>(
    prisma: PrismaClient,
    orders: T[],
    options: EnrichmentOptions = {}
): Promise<(T & Partial<PatternEnrichedOrder>)[]> {
    if (!orders || orders.length === 0) return [];

    const { includeFulfillmentStage = false, includeLineStatusCounts = false } = options;

    // Get unique customer IDs
    const customerIds = [...new Set(orders.map((o) => o.customerId).filter((id): id is string => Boolean(id)))];

    // Fetch customer stats and tier thresholds in parallel
    const [customerStatsMap, thresholds] = await Promise.all([
        getCustomerStatsMap(prisma, customerIds),
        getTierThresholds(prisma),
    ]);

    // Enrich each order
    return orders.map((order) => {
        const customerStats = customerStatsMap[order.customerId || ''] || { ltv: 0, orderCount: 0, rtoCount: 0 };

        const enriched: T & Partial<PatternEnrichedOrder> = {
            ...order,
            customerLtv: customerStats.ltv,
            customerOrderCount: customerStats.orderCount,
            customerRtoCount: customerStats.rtoCount,
            customerTier: calculateTier(customerStats.ltv, thresholds),
        };

        // Optionally add fulfillment stage
        if (includeFulfillmentStage && order.orderLines) {
            enriched.fulfillmentStage = calculateFulfillmentStage(order.orderLines);
        }

        // Optionally add line status counts
        if (includeLineStatusCounts && order.orderLines) {
            Object.assign(enriched, calculateLineStatusCounts(order.orderLines));
        }

        return enriched;
    });
}
