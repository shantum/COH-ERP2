/**
 * Order Helper Functions
 * Order status management, Shopify field accessors
 *
 * NOTE: Enrichment functions have been moved to ../orderEnrichment/
 * This file re-exports them for backwards compatibility.
 */

import type { Prisma } from '@prisma/client';
import type {
    PrismaOrTransaction,
    OrderWithShopifyCache,
} from './types.js';

// Re-export enrichment functions from orderEnrichment module for backwards compatibility
export {
    calculateFulfillmentStage,
    calculateLineStatusCounts,
    enrichOrdersWithCustomerStats,
    getCustomerStatsMap,
    getTierThresholds,
    calculateTier,
    calculateDaysSince,
    determineTrackingStatus,
    extractShopifyTrackingFields,
    resolveLineShippingAddress,
    enrichOrderLinesWithAddresses,
    calculateRtoStatus,
} from '../orderEnrichment/index.js';

// Re-export types for backwards compatibility
export type {
    FulfillmentStage,
    LineStatusCounts,
    EnrichmentOptions,
    ShopifyCache,
    EnrichedShopifyCache,
} from '../orderEnrichment/index.js';

// ============================================
// ORDER STATUS MANAGEMENT
// ============================================

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
// SHOPIFY FIELD ACCESSORS
// ============================================

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
