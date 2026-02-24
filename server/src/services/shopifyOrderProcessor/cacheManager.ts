/**
 * Cache management for Shopify orders
 * Handles caching raw Shopify data to ShopifyOrderCache table
 *
 * @module services/shopifyOrderProcessor/cacheManager
 */

import type { PrismaClient } from '@prisma/client';
import { detectPaymentMethod } from '../../utils/shopifyHelpers.js';
import type { ExtendedShopifyOrder } from './types.js';

/**
 * Extract cache data from a Shopify order (shared logic for single and batch caching)
 */
function extractCacheData(
    order: ExtendedShopifyOrder,
    webhookTopic: string,
    existingPaymentMethod: string | null = null
) {
    const orderId = String(order.id);

    // Extract discount codes (comma-separated, empty string if none)
    const discountCodes = (order.discount_codes || [])
        .map(d => d.code).join(', ') || '';

    // Extract tracking info from fulfillments (for reference only, not source of truth)
    const fulfillment = order.fulfillments?.find(f => f.tracking_number)
        || order.fulfillments?.[0];
    const trackingNumber = fulfillment?.tracking_number || null;
    const trackingCompany = fulfillment?.tracking_company || null;
    const trackingUrl = fulfillment?.tracking_url || fulfillment?.tracking_urls?.[0] || null;
    const shippedAt = fulfillment?.created_at ? new Date(fulfillment.created_at) : null;
    const shipmentStatus = fulfillment?.shipment_status || null;
    const fulfillmentUpdatedAt = fulfillment?.updated_at ? new Date(fulfillment.updated_at) : null;

    // Check for delivered status
    const deliveredEvent = fulfillment?.line_items?.[0]?.fulfillment_status === 'fulfilled'
        && shipmentStatus === 'delivered';
    const deliveredAt = deliveredEvent && fulfillment?.updated_at
        ? new Date(fulfillment.updated_at) : null;

    // Detect payment method (preserves existing COD status)
    const paymentMethod = detectPaymentMethod(order, existingPaymentMethod);

    // Extract shipping address
    const addr = order.shipping_address;

    // Extract billing address
    const billing = order.billing_address;

    // Extract line items JSON (minimal fields needed for lookups and order details)
    const lineItemsJson = JSON.stringify(
        (order.line_items || []).map(item => ({
            id: item.id,
            sku: item.sku || null,
            title: item.title || null,
            variant_title: item.variant_title || null,
            price: item.price || null,
            quantity: item.quantity || 0,
            discount_allocations: item.discount_allocations || [],
        }))
    );

    // Extract shipping lines JSON
    const shippingLinesJson = JSON.stringify(
        (order.shipping_lines || []).map(s => ({
            title: s.title || null,
            price: s.price || null,
        }))
    );

    // Extract tax lines JSON
    const taxLinesJson = JSON.stringify(
        (order.tax_lines || []).map(t => ({
            title: t.title || null,
            price: t.price || null,
            rate: t.rate || null,
        }))
    );

    // Extract note attributes JSON
    const noteAttributesJson = JSON.stringify(order.note_attributes || []);

    return {
        id: orderId,
        rawData: JSON.stringify(order),
        orderNumber: order.name || null,
        financialStatus: order.financial_status || null,
        fulfillmentStatus: order.fulfillment_status || null,
        discountCodes,
        customerNotes: order.note || null,
        tags: order.tags || null,
        paymentMethod,
        trackingNumber,
        trackingCompany,
        trackingUrl,
        shippedAt,
        deliveredAt,
        shipmentStatus,
        fulfillmentUpdatedAt,
        shippingCity: addr?.city || null,
        shippingState: addr?.province || null,
        shippingCountry: addr?.country || null,
        // New JSON fields (eliminates rawData parsing)
        lineItemsJson,
        shippingLinesJson,
        taxLinesJson,
        noteAttributesJson,
        // Billing address fields
        billingAddress1: billing?.address1 || null,
        billingAddress2: billing?.address2 || null,
        billingCountry: billing?.country || null,
        billingCountryCode: billing?.country_code || null,
        webhookTopic,
        lastWebhookAt: new Date(),
    };
}

/**
 * Cache Shopify orders to ShopifyOrderCache table
 *
 * UNIFIED FUNCTION: Handles both single orders and batches efficiently.
 * - Single order: Checks existing cache for payment method preservation
 * - Batch: Skips existing check for speed (use for initial loads)
 *
 * @param prisma - Prisma client
 * @param orders - Single order or array of orders to cache
 * @param webhookTopic - Source: 'orders/create', 'orders/updated', 'api_sync', 'full_dump'
 * @returns Number of orders cached
 */
export async function cacheShopifyOrders(
    prisma: PrismaClient,
    orders: ExtendedShopifyOrder | ExtendedShopifyOrder[],
    webhookTopic = 'api_sync'
): Promise<number> {
    const orderArray = Array.isArray(orders) ? orders : [orders];
    if (orderArray.length === 0) return 0;

    // Single order: Check existing cache for payment method preservation
    if (orderArray.length === 1) {
        const order = orderArray[0];
        const orderId = String(order.id);

        // Check existing cache to preserve COD status
        const existingCache = await prisma.shopifyOrderCache.findUnique({
            where: { id: orderId },
            select: { paymentMethod: true }
        });

        const cacheData = extractCacheData(order, webhookTopic, existingCache?.paymentMethod);

        await prisma.shopifyOrderCache.upsert({
            where: { id: orderId },
            create: cacheData,
            update: { ...cacheData, processingError: null },
        });

        return 1;
    }

    // Batch: Use chunked transactions for speed (skip existing check)
    const records = orderArray.map(order => extractCacheData(order, webhookTopic, null));
    const chunkSize = 50;
    let cached = 0;

    for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize);
        await prisma.$transaction(
            chunk.map(record =>
                prisma.shopifyOrderCache.upsert({
                    where: { id: record.id },
                    create: record,
                    update: { ...record, processingError: null },
                })
            )
        );
        cached += chunk.length;
    }

    return cached;
}

/**
 * Mark cache entry as successfully processed
 */
export async function markCacheProcessed(prisma: PrismaClient, shopifyOrderId: string | number): Promise<void> {
    await prisma.shopifyOrderCache.update({
        where: { id: String(shopifyOrderId) },
        data: { processedAt: new Date(), processingError: null }
    });
}

/**
 * Mark cache entry as failed with error message
 */
export async function markCacheError(
    prisma: PrismaClient,
    shopifyOrderId: string | number,
    errorMessage: string
): Promise<void> {
    await prisma.shopifyOrderCache.update({
        where: { id: String(shopifyOrderId) },
        data: { processingError: errorMessage }
    });
}
