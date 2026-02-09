/**
 * Order Enrichment Pipeline
 *
 * Modular enrichment system for orders.
 * Each enrichment is declarative - views specify which enrichments they need.
 *
 * PERFORMANCE OPTIMIZATION:
 * - CPU-only enrichments combined into single map pass
 * - DB queries (customerStats) run in parallel while preparing CPU enrichments
 * - Reduces N map iterations to 1 for better cache locality
 */

import type { PrismaClient } from '@prisma/client';
import type {
    EnrichmentType,
    OrderWithRelations,
    EnrichedOrder,
    CustomerStatsResult,
    ShopifyCache,
} from './types.js';

// Import enrichment functions
import { calculateFulfillmentStage } from './fulfillmentStage.js';
import { calculateLineStatusCounts } from './lineStatusCounts.js';
import { enrichOrdersWithCustomerStats } from './customerStats.js';
import { calculateDaysSince, determineTrackingStatus } from './trackingStatus.js';
import { extractShopifyTrackingFields } from './shopifyTracking.js';
import { enrichOrderLinesWithAddresses } from './addressResolution.js';
import { calculateRtoStatus } from './rtoStatus.js';

// Re-export types
export * from './types.js';

// Re-export enrichment functions for direct use
export { calculateFulfillmentStage } from './fulfillmentStage.js';
export { calculateLineStatusCounts } from './lineStatusCounts.js';
export { enrichOrdersWithCustomerStats, getCustomerStatsMap, getTierThresholds, calculateTier } from './customerStats.js';
export { calculateDaysSince, determineTrackingStatus } from './trackingStatus.js';
export { extractShopifyTrackingFields } from './shopifyTracking.js';
export { resolveLineShippingAddress, enrichOrderLinesWithAddresses } from './addressResolution.js';
export { calculateRtoStatus } from './rtoStatus.js';

/**
 * Apply enrichments to orders based on view configuration
 * Optimized to run CPU enrichments in a single pass and DB queries in parallel
 */
export async function enrichOrdersForView<T extends OrderWithRelations>(
    prisma: PrismaClient,
    orders: T[],
    enrichments: EnrichmentType[] = []
): Promise<EnrichedOrder[]> {
    if (!orders || orders.length === 0) return [];

    // Convert enrichment array to Set for O(1) lookup
    const enrichmentSet = new Set(enrichments);

    // Always calculate totalAmount from orderLines if null (fallback for unmigrated data)
    let enriched: EnrichedOrder[] = orders.map((order) => {
        if (order.totalAmount != null) return order as EnrichedOrder;

        // Calculate from orderLines
        const linesTotal =
            order.orderLines?.reduce((sum, line) => {
                const unitPrice = (line as { unitPrice?: number }).unitPrice || 0;
                const qty = (line as { qty?: number }).qty || 1;
                const lineTotal = unitPrice * qty;
                return sum + lineTotal;
            }, 0) || 0;

        // Fallback to shopifyCache totalPrice if no line prices
        const shopifyTotal = order.shopifyCache?.totalPrice;
        if (linesTotal === 0 && shopifyTotal != null) {
            return { ...order, totalAmount: Number(shopifyTotal) || null } as EnrichedOrder;
        }

        return { ...order, totalAmount: linesTotal > 0 ? linesTotal : null } as EnrichedOrder;
    });

    // Determine which enrichments to run
    const needsCustomerStats = enrichmentSet.has('customerStats');
    const needsFulfillmentStage = enrichmentSet.has('fulfillmentStage') && !needsCustomerStats;
    const needsLineStatusCounts = enrichmentSet.has('lineStatusCounts') && !needsCustomerStats;
    const needsDaysInTransit = enrichmentSet.has('daysInTransit');
    const needsTrackingStatus = enrichmentSet.has('trackingStatus');
    const needsShopifyTracking = enrichmentSet.has('shopifyTracking');
    const needsDaysSinceDelivery = enrichmentSet.has('daysSinceDelivery');
    const needsRtoStatus = enrichmentSet.has('rtoStatus');
    const needsAddressResolution = enrichmentSet.has('addressResolution');

    // Check if any CPU enrichments are needed (excluding customerStats which is DB-based)
    const needsCpuEnrichments = needsFulfillmentStage || needsLineStatusCounts ||
        needsDaysInTransit || needsTrackingStatus || needsShopifyTracking ||
        needsDaysSinceDelivery || needsRtoStatus || needsAddressResolution;

    // Start customer stats query in parallel (it's the only DB query)
    const customerStatsPromise = needsCustomerStats
        ? enrichOrdersWithCustomerStats(prisma, enriched.map((o) => ({
            ...o,
            customerId: o.customerId ?? null,
            orderLines: o.orderLines?.map((line) => ({
                ...line,
                lineStatus: (line.lineStatus ?? 'pending') as string,
            })),
        })), {
            includeFulfillmentStage: enrichmentSet.has('fulfillmentStage'),
            includeLineStatusCounts: enrichmentSet.has('lineStatusCounts'),
        })
        : Promise.resolve(enriched);

    // If we need CPU enrichments, run them in a single pass for better cache locality
    // This is much faster than running 7 separate .map() operations
    if (needsCpuEnrichments) {
        enriched = enriched.map((order) => {
            const result = { ...order };

            // Fulfillment stage (for open orders) - only if customerStats not handling it
            if (needsFulfillmentStage) {
                result.fulfillmentStage = calculateFulfillmentStage(
                    (order.orderLines || []) as { lineStatus: string }[]
                );
            }

            // Line status counts (for open orders) - only if customerStats not handling it
            if (needsLineStatusCounts) {
                Object.assign(result, calculateLineStatusCounts(
                    (order.orderLines || []) as { lineStatus: string }[]
                ));
            }

            // Days in transit (for shipped/rto)
            if (needsDaysInTransit) {
                result.daysInTransit = calculateDaysSince(order.shippedAt);
            }

            // Tracking status (for shipped)
            if (needsTrackingStatus) {
                const daysInTransit = result.daysInTransit ?? calculateDaysSince(order.shippedAt);
                result.trackingStatus = determineTrackingStatus(
                    {
                        trackingStatus: order.trackingStatus as string | null | undefined,
                        rtoReceivedAt: order.rtoReceivedAt as Date | null | undefined,
                        rtoInitiatedAt: order.rtoInitiatedAt as Date | null | undefined,
                        status: order.status as string | undefined,
                        deliveredAt: order.deliveredAt as Date | null | undefined,
                    },
                    daysInTransit
                );
            }

            // Shopify tracking extraction (for shipped)
            if (needsShopifyTracking) {
                result.shopifyCache = extractShopifyTrackingFields(
                    order.shopifyCache as ShopifyCache | null | undefined
                );
            }

            // Days since delivery (for COD pending)
            if (needsDaysSinceDelivery) {
                result.daysSinceDelivery = calculateDaysSince(order.deliveredAt);
            }

            // RTO status (for RTO view)
            if (needsRtoStatus) {
                const rtoResult = calculateRtoStatus(
                    order.trackingStatus,
                    order.rtoInitiatedAt,
                    order.rtoReceivedAt
                );
                result.rtoStatus = rtoResult.rtoStatus;
                result.daysInRto = rtoResult.daysInRto;
            }

            // Address resolution (fallback to shopifyCache for old orders)
            if (needsAddressResolution) {
                return enrichOrderLinesWithAddresses(result) as EnrichedOrder;
            }

            return result as EnrichedOrder;
        });
    }

    // Wait for customer stats if it was running
    if (needsCustomerStats) {
        const statsEnriched = await customerStatsPromise;
        // If we didn't do CPU enrichments, use stats result directly
        // Otherwise, we need to merge stats into our CPU-enriched result
        if (!needsCpuEnrichments) {
            enriched = statsEnriched as EnrichedOrder[];
        } else {
            // Merge customer stats into CPU-enriched orders
            const statsMap = new Map<string, CustomerStatsResult>(
                statsEnriched.map((o) => [o.id as string, o as CustomerStatsResult])
            );
            enriched = enriched.map((order) => {
                const statsOrder = statsMap.get(order.id as string);
                if (statsOrder) {
                    return {
                        ...order,
                        customerLtv: statsOrder.customerLtv ?? undefined,
                        customerOrderCount: statsOrder.customerOrderCount ?? undefined,
                        customerTier: statsOrder.customerTier ?? undefined,
                        fulfillmentStage: statsOrder.fulfillmentStage ?? order.fulfillmentStage,
                        pendingCount: statsOrder.pendingCount ?? order.pendingCount,
                        allocatedCount: statsOrder.allocatedCount ?? order.allocatedCount,
                        pickedCount: statsOrder.pickedCount ?? order.pickedCount,
                        packedCount: statsOrder.packedCount ?? order.packedCount,
                        shippedCount: statsOrder.shippedCount ?? order.shippedCount,
                        cancelledCount: statsOrder.cancelledCount ?? order.cancelledCount,
                    };
                }
                return order;
            });
        }
    }

    return enriched;
}
