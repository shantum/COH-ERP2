import type { ShopifyAddress, FormattedAddress, ShopifyOrder } from './types.js';

/**
 * Map Shopify order status to ERP status
 *
 * NOTE: Shopify fulfillment status is informational only.
 * ERP manages its own shipped/delivered statuses via the Ship Order action.
 * Fulfillment data is stored in shopifyFulfillmentStatus for display purposes.
 */
export function mapOrderStatus(shopifyOrder: ShopifyOrder): 'cancelled' | 'open' {
    if (shopifyOrder.cancelled_at) return 'cancelled';
    // All non-cancelled orders start as 'open' in ERP
    // shipped/delivered status is managed by ERP ship action, not Shopify fulfillment
    return 'open';
}

/**
 * Map Shopify order channel to ERP channel
 */
export function mapOrderChannel(shopifyOrder: ShopifyOrder): 'shopify_online' | 'shopify_pos' {
    const source = shopifyOrder.source_name?.toLowerCase() || '';
    if (source.includes('web') || source.includes('online')) return 'shopify_online';
    if (source.includes('pos')) return 'shopify_pos';
    return 'shopify_online';
}

/**
 * Extract address object from Shopify address
 */
export function formatAddress(shopifyAddress: ShopifyAddress | null | undefined): FormattedAddress | null {
    if (!shopifyAddress) return null;

    return {
        address1: shopifyAddress.address1 || '',
        address2: shopifyAddress.address2 || '',
        city: shopifyAddress.city || '',
        province: shopifyAddress.province || '',
        country: shopifyAddress.country || '',
        zip: shopifyAddress.zip || '',
        phone: shopifyAddress.phone || '',
    };
}
