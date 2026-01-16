/**
 * Order Helper Functions
 * Fulfillment calculation, customer enrichment, Shopify accessors
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import { getCustomerStatsMap, getTierThresholds, calculateTier } from '../tierUtils.js';
import type {
    PrismaOrTransaction,
    FulfillmentStage,
    LineStatusCounts,
    OrderLineForFulfillment,
    EnrichmentOptions,
    OrderForEnrichment,
    EnrichedOrder,
    OrderWithShopifyCache,
    OrderLineWithAddress,
    ShopifyCache,
    EnrichedShopifyCache,
} from './types.js';

// Re-export tier utilities for convenience
export { getCustomerStatsMap, getTierThresholds, calculateTier };

// ============================================
// FULFILLMENT HELPERS
// ============================================

/**
 * Calculate fulfillment stage based on order line statuses
 */
export function calculateFulfillmentStage(orderLines: OrderLineForFulfillment[]): FulfillmentStage {
    if (!orderLines || orderLines.length === 0) return 'pending';

    const lineStatuses = orderLines.map((l) => l.lineStatus);

    if (lineStatuses.every((s) => s === 'packed')) {
        return 'ready_to_ship';
    }
    if (lineStatuses.some((s) => ['picked', 'packed'].includes(s as string))) {
        return 'in_progress';
    }
    if (lineStatuses.every((s) => s === 'allocated')) {
        return 'allocated';
    }
    return 'pending';
}

/**
 * Calculate line status counts for an order
 */
export function calculateLineStatusCounts(orderLines: OrderLineForFulfillment[]): LineStatusCounts {
    if (!orderLines || orderLines.length === 0) {
        return { totalLines: 0, pendingLines: 0, allocatedLines: 0, pickedLines: 0, packedLines: 0 };
    }

    const lineStatuses = orderLines.map((l) => l.lineStatus);

    return {
        totalLines: orderLines.length,
        pendingLines: lineStatuses.filter((s) => s === 'pending').length,
        allocatedLines: lineStatuses.filter((s) => s === 'allocated').length,
        pickedLines: lineStatuses.filter((s) => s === 'picked').length,
        packedLines: lineStatuses.filter((s) => s === 'packed').length,
    };
}

/**
 * Recalculate order status based on line statuses
 */
export async function recalculateOrderStatus(
    prisma: PrismaOrTransaction,
    orderId: string
): Promise<Prisma.OrderGetPayload<{ include: { orderLines: true } }> | null> {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    });

    if (!order) return null;

    // Don't modify terminal statuses
    if (['shipped', 'delivered', 'archived'].includes(order.status)) {
        return order;
    }

    const lineStatuses = order.orderLines.map((l) => l.lineStatus);
    const nonCancelledLines = lineStatuses.filter((s) => s !== 'cancelled');

    // If all lines are cancelled, order should be cancelled
    if (nonCancelledLines.length === 0 && lineStatuses.length > 0) {
        return prisma.order.update({
            where: { id: orderId },
            data: { status: 'cancelled' },
            include: { orderLines: true },
        });
    }

    // If order was cancelled but has non-cancelled lines, restore to open
    if (order.status === 'cancelled' && nonCancelledLines.length > 0) {
        return prisma.order.update({
            where: { id: orderId },
            data: { status: 'open' },
            include: { orderLines: true },
        });
    }

    return order;
}

// ============================================
// CUSTOMER ENRICHMENT
// ============================================

/**
 * Enrich orders with customer LTV, tier, and order count
 */
export async function enrichOrdersWithCustomerStats<T extends OrderForEnrichment>(
    prisma: PrismaClient,
    orders: T[],
    options: EnrichmentOptions = {}
): Promise<(T & Partial<EnrichedOrder>)[]> {
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

        const enriched: T & Partial<EnrichedOrder> = {
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

// ============================================
// SHOPIFY FIELD ACCESSORS
// ============================================

/**
 * Extract tracking fields from Shopify cache
 */
export function extractShopifyTrackingFields(shopifyCache: ShopifyCache | null | undefined): EnrichedShopifyCache | Record<string, never> {
    if (!shopifyCache) return {};

    const enrichedCache: EnrichedShopifyCache = {
        ...shopifyCache,
        trackingNumber: shopifyCache.trackingNumber || null,
        trackingCompany: shopifyCache.trackingCompany || null,
        trackingUrl: shopifyCache.trackingUrl || null,
        shippedAt: shopifyCache.shippedAt || null,
        shipmentStatus: shopifyCache.shipmentStatus || null,
        deliveredAt: shopifyCache.deliveredAt || null,
        fulfillmentUpdatedAt: shopifyCache.fulfillmentUpdatedAt || null,
        customerNotes: shopifyCache.customerNotes || null,
    };

    delete (enrichedCache as { rawData?: string }).rawData;
    return enrichedCache;
}

/**
 * Get discount codes for an order (from Shopify cache)
 */
export function getOrderDiscountCodes(order: OrderWithShopifyCache): string | null {
    return order.shopifyCache?.discountCodes || null;
}

/**
 * Get customer notes for an order (from Shopify cache)
 */
export function getOrderCustomerNotes(order: OrderWithShopifyCache): string | null {
    return order.shopifyCache?.customerNotes || null;
}

/**
 * Get Shopify fulfillment status for an order
 */
export function getShopifyFulfillmentStatus(order: OrderWithShopifyCache): string | null {
    return order.shopifyCache?.fulfillmentStatus || null;
}

/**
 * Get financial status for an order
 */
export function getOrderFinancialStatus(order: OrderWithShopifyCache): string | null {
    return order.shopifyCache?.financialStatus || null;
}

/**
 * Calculate days since a date
 */
export function calculateDaysSince(sinceDate: Date | string | null | undefined): number {
    if (!sinceDate) return 0;
    return Math.floor((Date.now() - new Date(sinceDate).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Determine tracking status for an order (fallback when not in DB)
 */
export function determineTrackingStatus(
    order: {
        trackingStatus?: string | null;
        rtoReceivedAt?: Date | null;
        rtoInitiatedAt?: Date | null;
        status?: string;
        deliveredAt?: Date | null;
    },
    daysInTransit: number
): string {
    if (order.trackingStatus) return order.trackingStatus;

    if (order.rtoReceivedAt) return 'rto_received';
    if (order.rtoInitiatedAt) return 'rto_initiated';
    if (order.status === 'delivered' || order.deliveredAt) return 'delivered';
    if (daysInTransit > 7) return 'delivery_delayed';
    return 'in_transit';
}

// ============================================
// ADDRESS RESOLUTION
// ============================================

/**
 * Resolve shipping address for an order line with fallback chain
 */
export function resolveLineShippingAddress(
    orderLine: OrderLineWithAddress,
    order: OrderWithShopifyCache
): string | null {
    // 1. Line-level address
    if (orderLine.shippingAddress) {
        return orderLine.shippingAddress;
    }

    // 2. Order-level address
    if (order.shippingAddress) {
        return order.shippingAddress;
    }

    // 3. Shopify cache fallback
    const cache = order.shopifyCache;
    if (cache?.shippingAddress1) {
        return JSON.stringify({
            address1: cache.shippingAddress1,
            address2: cache.shippingAddress2 || null,
            city: cache.shippingCity || null,
            province: cache.shippingProvince || cache.shippingState || null,
            province_code: cache.shippingProvinceCode || null,
            country: cache.shippingCountry || null,
            country_code: cache.shippingCountryCode || null,
            zip: cache.shippingZip || null,
            name: cache.shippingName || null,
            phone: cache.shippingPhone || null,
        });
    }

    return null;
}

/**
 * Enrich order lines with resolved shipping addresses
 */
export function enrichOrderLinesWithAddresses<T extends OrderWithShopifyCache & { orderLines?: OrderLineWithAddress[] }>(
    order: T
): T {
    if (!order.orderLines) return order;

    return {
        ...order,
        orderLines: order.orderLines.map(line => ({
            ...line,
            resolvedShippingAddress: resolveLineShippingAddress(line, order),
        })),
    } as T;
}
