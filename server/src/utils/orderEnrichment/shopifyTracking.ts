/**
 * Shopify Tracking Enrichment
 * Extract tracking fields from Shopify cache
 */

import type { ShopifyCache, EnrichedShopifyCache } from './types.js';

/**
 * Extract tracking fields from Shopify cache
 */
export function extractShopifyTrackingFields(
    shopifyCache: ShopifyCache | null | undefined
): EnrichedShopifyCache | Record<string, never> {
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
