/**
 * Address Resolution Enrichment
 * Resolve shipping addresses with fallback chain
 */

import type { OrderWithShopifyCache, OrderLineWithAddress } from '../patterns/types.js';

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
