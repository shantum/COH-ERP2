/**
 * Order Enrichment Pipeline
 *
 * Modular enrichment system for orders.
 * Each enrichment is declarative - views specify which enrichments they need.
 */

import type { PrismaClient } from '@prisma/client';
import type {
    EnrichmentType,
    OrderWithRelations,
    EnrichedOrder,
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
 */
export async function enrichOrdersForView<T extends OrderWithRelations>(
    prisma: PrismaClient,
    orders: T[],
    enrichments: EnrichmentType[] = []
): Promise<EnrichedOrder[]> {
    if (!orders || orders.length === 0) return [];

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
        const shopifyTotal = (order.shopifyCache as any)?.totalPrice;
        if (linesTotal === 0 && shopifyTotal != null) {
            return { ...order, totalAmount: Number(shopifyTotal) || null } as EnrichedOrder;
        }

        return { ...order, totalAmount: linesTotal > 0 ? linesTotal : null } as EnrichedOrder;
    });

    // Customer stats (common to most views)
    if (enrichments.includes('customerStats')) {
        const options = {
            includeFulfillmentStage: enrichments.includes('fulfillmentStage'),
            includeLineStatusCounts: enrichments.includes('lineStatusCounts'),
        };
        // Cast to expected type - enriched orders have customerId from DB query
        const ordersForStats = enriched.map((o) => ({
            ...o,
            customerId: o.customerId ?? null,
            orderLines: o.orderLines?.map((line) => ({
                ...line,
                lineStatus: (line.lineStatus ?? 'pending') as string,
            })),
        }));
        enriched = (await enrichOrdersWithCustomerStats(prisma, ordersForStats, options)) as EnrichedOrder[];
    }

    // Fulfillment stage (for open orders) - handled in customerStats if both present
    if (enrichments.includes('fulfillmentStage') && !enrichments.includes('customerStats')) {
        enriched = enriched.map((order) => ({
            ...order,
            fulfillmentStage: calculateFulfillmentStage(
                (order.orderLines || []) as { lineStatus: string }[]
            ),
        }));
    }

    // Line status counts (for open orders) - handled in customerStats if both present
    if (enrichments.includes('lineStatusCounts') && !enrichments.includes('customerStats')) {
        enriched = enriched.map((order) => ({
            ...order,
            ...calculateLineStatusCounts((order.orderLines || []) as { lineStatus: string }[]),
        }));
    }

    // Days in transit (for shipped/rto)
    if (enrichments.includes('daysInTransit')) {
        enriched = enriched.map((order) => ({
            ...order,
            daysInTransit: calculateDaysSince(order.shippedAt),
        }));
    }

    // Tracking status (for shipped)
    if (enrichments.includes('trackingStatus')) {
        enriched = enriched.map((order) => {
            const daysInTransit = order.daysInTransit ?? calculateDaysSince(order.shippedAt);
            return {
                ...order,
                trackingStatus: determineTrackingStatus(
                    {
                        trackingStatus: order.trackingStatus as string | null | undefined,
                        rtoReceivedAt: order.rtoReceivedAt as Date | null | undefined,
                        rtoInitiatedAt: order.rtoInitiatedAt as Date | null | undefined,
                        status: order.status as string | undefined,
                        deliveredAt: order.deliveredAt as Date | null | undefined,
                    },
                    daysInTransit
                ),
            };
        });
    }

    // Shopify tracking extraction (for shipped)
    if (enrichments.includes('shopifyTracking')) {
        enriched = enriched.map((order) => ({
            ...order,
            shopifyCache: extractShopifyTrackingFields(order.shopifyCache as ShopifyCache | null | undefined),
        }));
    }

    // Days since delivery (for COD pending)
    if (enrichments.includes('daysSinceDelivery')) {
        enriched = enriched.map((order) => ({
            ...order,
            daysSinceDelivery: calculateDaysSince(order.deliveredAt),
        }));
    }

    // RTO status (for RTO view)
    if (enrichments.includes('rtoStatus')) {
        enriched = enriched.map((order) => {
            const rtoResult = calculateRtoStatus(
                order.trackingStatus,
                order.rtoInitiatedAt,
                order.rtoReceivedAt
            );
            return {
                ...order,
                rtoStatus: rtoResult.rtoStatus,
                daysInRto: rtoResult.daysInRto,
            };
        });
    }

    // Address resolution (fallback to shopifyCache for old orders)
    if (enrichments.includes('addressResolution')) {
        enriched = enriched.map((order) =>
            enrichOrderLinesWithAddresses(order) as EnrichedOrder
        );
    }

    return enriched;
}
