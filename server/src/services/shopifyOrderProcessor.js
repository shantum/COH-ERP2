/**
 * Shopify Order Processor - Single source of truth for order processing
 *
 * This module consolidates order processing logic that was previously
 * duplicated in webhooks.js, shopify.js, and syncWorker.js
 *
 * Key features:
 * - Cache-first approach: always caches raw Shopify data before processing
 * - Idempotent processing: can safely re-process cached orders
 * - Race condition protection: uses in-memory lock for single-instance
 */

import shopifyClient from './shopify.js';
import { findOrCreateCustomer } from '../utils/customerUtils.js';
import { withOrderLock } from '../utils/orderLock.js';

/**
 * Cache raw Shopify order data to ShopifyOrderCache table
 * This should be called FIRST before processing to ERP
 *
 * @param {PrismaClient} prisma
 * @param {string} shopifyOrderId
 * @param {object} shopifyOrder - Raw Shopify order object
 * @param {string} webhookTopic - e.g., 'orders/create', 'orders/updated'
 */
export async function cacheShopifyOrder(prisma, shopifyOrderId, shopifyOrder, webhookTopic = 'api_sync') {
    const orderId = String(shopifyOrderId);

    // Extract discount codes (comma-separated, empty string if none)
    const discountCodes = (shopifyOrder.discount_codes || [])
        .map(d => d.code).join(', ') || '';

    // Calculate payment method from gateway names and financial status
    // NOTE: Once an order is COD, it stays COD even after payment (don't confuse with Prepaid)
    const gatewayNames = (shopifyOrder.payment_gateway_names || []).join(', ').toLowerCase();
    const isPrepaidGateway = gatewayNames.includes('shopflo') || gatewayNames.includes('razorpay');
    const isCodGateway = gatewayNames.includes('cod') || gatewayNames.includes('cash') || gatewayNames.includes('manual');

    // Check existing cache entry to preserve COD status
    const existingCache = await prisma.shopifyOrderCache.findUnique({
        where: { id: orderId },
        select: { paymentMethod: true }
    });

    let paymentMethod;
    if (isPrepaidGateway) {
        paymentMethod = 'Prepaid';
    } else if (isCodGateway || existingCache?.paymentMethod === 'COD') {
        // Gateway indicates COD or was already COD - preserve it
        paymentMethod = 'COD';
    } else if (shopifyOrder.financial_status === 'pending') {
        // New order with pending payment and no prepaid gateway = likely COD
        paymentMethod = 'COD';
    } else {
        paymentMethod = 'Prepaid';
    }

    // Extract tracking info from fulfillments
    const fulfillment = shopifyOrder.fulfillments?.find(f => f.tracking_number)
        || shopifyOrder.fulfillments?.[0];
    const trackingNumber = fulfillment?.tracking_number || null;
    const trackingCompany = fulfillment?.tracking_company || null;
    const trackingUrl = fulfillment?.tracking_url || fulfillment?.tracking_urls?.[0] || null;
    const shippedAt = fulfillment?.created_at ? new Date(fulfillment.created_at) : null;
    const shipmentStatus = fulfillment?.shipment_status || null; // in_transit, out_for_delivery, delivered, etc.
    const fulfillmentUpdatedAt = fulfillment?.updated_at ? new Date(fulfillment.updated_at) : null;
    // Check if delivered - Shopify sets shipment_status to 'delivered'
    const deliveredAt = shipmentStatus === 'delivered' && fulfillmentUpdatedAt ? fulfillmentUpdatedAt : null;

    // Extract shipping address fields
    const addr = shopifyOrder.shipping_address;
    const shippingCity = addr?.city || null;
    const shippingState = addr?.province || null;
    const shippingCountry = addr?.country || null;

    const cacheData = {
        rawData: JSON.stringify(shopifyOrder),
        orderNumber: shopifyOrder.name || null,
        financialStatus: shopifyOrder.financial_status || null,
        fulfillmentStatus: shopifyOrder.fulfillment_status || null,
        // Extracted Shopify fields
        discountCodes,
        customerNotes: shopifyOrder.note || null,
        paymentMethod,
        tags: shopifyOrder.tags || null,
        trackingNumber,
        trackingCompany,
        trackingUrl,
        shippedAt,
        shipmentStatus,
        deliveredAt,
        fulfillmentUpdatedAt,
        shippingCity,
        shippingState,
        shippingCountry,
        // Metadata
        webhookTopic,
        lastWebhookAt: new Date(),
    };

    await prisma.shopifyOrderCache.upsert({
        where: { id: orderId },
        create: {
            id: orderId,
            ...cacheData,
        },
        update: {
            ...cacheData,
            // Clear any previous error since we have new data
            processingError: null,
        }
    });
}

/**
 * Mark cache entry as successfully processed
 */
export async function markCacheProcessed(prisma, shopifyOrderId) {
    await prisma.shopifyOrderCache.update({
        where: { id: String(shopifyOrderId) },
        data: { processedAt: new Date(), processingError: null }
    });
}

/**
 * Mark cache entry as failed with error message
 */
export async function markCacheError(prisma, shopifyOrderId, errorMessage) {
    await prisma.shopifyOrderCache.update({
        where: { id: String(shopifyOrderId) },
        data: { processingError: errorMessage }
    });
}

/**
 * Process a Shopify order to the ERP Order table
 * This is the SINGLE source of truth for order processing logic
 *
 * @param {PrismaClient} prisma
 * @param {object} shopifyOrder - Raw Shopify order object
 * @param {object} options - Processing options
 * @param {boolean} options.skipNoSku - If true, skip orders with no matching SKUs (default: false for webhooks, true for bulk sync)
 * @returns {object} { action: 'created'|'updated'|'skipped'|'cancelled'|'fulfilled', orderId?, linesCreated?, error? }
 */
export async function processShopifyOrderToERP(prisma, shopifyOrder, options = {}) {
    const { skipNoSku = false } = options;
    const shopifyOrderId = String(shopifyOrder.id);
    const orderName = shopifyOrder.name || shopifyOrder.order_number || shopifyOrderId;

    // Check if order exists - first by shopifyOrderId, then by orderNumber
    let existingOrder = await prisma.order.findFirst({
        where: { shopifyOrderId },
        include: { orderLines: true }
    });

    // If not found by shopifyOrderId, check by orderNumber (handles orders created before sync)
    if (!existingOrder) {
        const orderNumber = shopifyOrder.name || String(shopifyOrder.order_number);
        if (orderNumber) {
            existingOrder = await prisma.order.findFirst({
                where: { orderNumber },
                include: { orderLines: true }
            });
        }
    }

    // Extract customer and shipping info
    const customer = shopifyOrder.customer;
    const shippingAddress = shopifyOrder.shipping_address;

    // Find or create customer using shared utility
    const { customer: dbCustomer } = await findOrCreateCustomer(
        prisma,
        customer,
        {
            shippingAddress,
            orderDate: shopifyOrder.created_at,
        }
    );
    const customerId = dbCustomer?.id || null;

    // Determine order status
    // NOTE: Shopify fulfillment is informational only. ERP manages shipped/delivered statuses.
    // Preserve ERP-managed statuses (shipped, delivered) - only allow cancelled to override
    let status = shopifyClient.mapOrderStatus(shopifyOrder);

    if (existingOrder) {
        const erpManagedStatuses = ['shipped', 'delivered'];
        if (erpManagedStatuses.includes(existingOrder.status) && status !== 'cancelled') {
            // Preserve ERP status unless Shopify cancels the order
            status = existingOrder.status;
        }
    }

    // Determine payment method (COD vs Prepaid)
    // NOTE: Once an order is COD, it stays COD even after payment (don't confuse with Prepaid)
    const gatewayNames = (shopifyOrder.payment_gateway_names || []).join(', ').toLowerCase();
    const isPrepaidGateway = gatewayNames.includes('shopflo') || gatewayNames.includes('razorpay');
    const isCodGateway = gatewayNames.includes('cod') || gatewayNames.includes('cash') || gatewayNames.includes('manual');

    let paymentMethod;
    if (isPrepaidGateway) {
        paymentMethod = 'Prepaid';
    } else if (isCodGateway || existingOrder?.paymentMethod === 'COD') {
        // Gateway indicates COD or was already COD - preserve it
        paymentMethod = 'COD';
    } else if (shopifyOrder.financial_status === 'pending') {
        // New order with pending payment and no prepaid gateway = likely COD
        paymentMethod = 'COD';
    } else {
        paymentMethod = 'Prepaid';
    }

    // Extract tracking info from fulfillments
    let awbNumber = existingOrder?.awbNumber || null;
    let courier = existingOrder?.courier || null;
    let shippedAt = existingOrder?.shippedAt || null;

    if (shopifyOrder.fulfillments?.length > 0) {
        const fulfillment = shopifyOrder.fulfillments.find(f => f.tracking_number) || shopifyOrder.fulfillments[0];
        awbNumber = fulfillment.tracking_number || awbNumber;
        courier = fulfillment.tracking_company || courier;
        if (fulfillment.created_at && !shippedAt) {
            shippedAt = new Date(fulfillment.created_at);
        }
    }

    // Build customer name
    const customerName = shippingAddress
        ? `${shippingAddress.first_name || ''} ${shippingAddress.last_name || ''}`.trim()
        : customer?.first_name
            ? `${customer.first_name} ${customer.last_name || ''}`.trim()
            : 'Unknown';

    // Extract discount codes (join multiple codes with comma)
    const discountCodes = shopifyOrder.discount_codes || [];
    const discountCode = discountCodes.length > 0
        ? discountCodes.map(d => d.code).join(', ')
        : null;

    // Extract tags (Shopify order tags)
    const orderTags = shopifyOrder.tags || null;

    // Extract internal notes from Shopify note_attributes (staff-only notes)
    // Shopify note_attributes is an array of {name, value} objects
    const noteAttributes = shopifyOrder.note_attributes || [];
    const internalNote = noteAttributes.find(n => n.name === 'internal_note' || n.name === 'staff_note')?.value;

    // Build order data
    // NOTE: Raw Shopify data is stored in ShopifyOrderCache, not duplicated in Order
    // Comprehensive field mapping for order updates
    const orderData = {
        shopifyOrderId,
        orderNumber: shopifyOrder.name || String(shopifyOrder.order_number) || `SHOP-${shopifyOrderId.slice(-8)}`,
        channel: shopifyClient.mapOrderChannel(shopifyOrder),
        status,
        customerId,
        customerName: customerName || 'Unknown',
        customerEmail: customer?.email || shopifyOrder.email || null,
        customerPhone: shippingAddress?.phone || customer?.phone || shopifyOrder.phone || null,
        shippingAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
        totalAmount: parseFloat(shopifyOrder.total_price) || 0,
        discountCode,
        shopifyFulfillmentStatus: shopifyOrder.fulfillment_status || 'unfulfilled',
        orderDate: shopifyOrder.created_at ? new Date(shopifyOrder.created_at) : new Date(),
        customerNotes: shopifyOrder.note || null,
        // Preserve existing internal notes, append Shopify note_attributes if present
        internalNotes: existingOrder?.internalNotes || internalNote || null,
        paymentMethod,
        awbNumber,
        courier,
        shippedAt,
        syncedAt: new Date(),
    };

    // Add cancellation note if cancelled
    if (shopifyOrder.cancelled_at && !existingOrder?.internalNotes?.includes('Cancelled via Shopify')) {
        orderData.internalNotes = existingOrder?.internalNotes
            ? `${existingOrder.internalNotes}\nCancelled via Shopify at ${shopifyOrder.cancelled_at}`
            : `Cancelled via Shopify at ${shopifyOrder.cancelled_at}`;
    }

    if (existingOrder) {
        // Comprehensive update detection - check all syncable fields
        const needsUpdate =
            // Core status changes
            existingOrder.status !== status ||
            existingOrder.shopifyFulfillmentStatus !== orderData.shopifyFulfillmentStatus ||
            // Fulfillment/shipping info
            existingOrder.awbNumber !== awbNumber ||
            existingOrder.courier !== courier ||
            // Payment
            existingOrder.paymentMethod !== paymentMethod ||
            // Customer-facing notes
            existingOrder.customerNotes !== orderData.customerNotes ||
            // Discounts
            existingOrder.discountCode !== discountCode ||
            // Contact info (can change if customer updates)
            existingOrder.customerEmail !== orderData.customerEmail ||
            existingOrder.customerPhone !== orderData.customerPhone ||
            // Amounts (can change with refunds/modifications)
            existingOrder.totalAmount !== orderData.totalAmount ||
            // Shipping address changes
            existingOrder.shippingAddress !== orderData.shippingAddress;

        if (needsUpdate) {
            await prisma.order.update({
                where: { id: existingOrder.id },
                data: orderData
            });

            // Determine change type for logging
            let changeType = 'updated';
            if (shopifyOrder.cancelled_at && existingOrder.status !== 'cancelled') {
                changeType = 'cancelled';
            } else if (shopifyOrder.fulfillment_status === 'fulfilled' &&
                existingOrder.shopifyFulfillmentStatus !== 'fulfilled') {
                changeType = 'fulfilled';
            }

            return { action: changeType, orderId: existingOrder.id };
        }

        return { action: 'skipped', orderId: existingOrder.id };
    }

    // Create new order with lines
    const lineItems = shopifyOrder.line_items || [];
    const orderLines = [];

    for (const item of lineItems) {
        const shopifyVariantId = item.variant_id ? String(item.variant_id) : null;

        // Try to find matching SKU
        let sku = null;
        if (shopifyVariantId) {
            sku = await prisma.sku.findFirst({ where: { shopifyVariantId } });
        }
        if (!sku && item.sku) {
            sku = await prisma.sku.findFirst({ where: { skuCode: item.sku } });
        }

        if (sku) {
            // Calculate effective unit price after discounts
            const originalPrice = parseFloat(item.price) || 0;
            const discountAllocations = item.discount_allocations || [];
            const totalDiscount = discountAllocations.reduce(
                (sum, alloc) => sum + (parseFloat(alloc.amount) || 0),
                0
            );
            // Effective price = original price - (total line discount / quantity)
            const effectiveUnitPrice = originalPrice - (totalDiscount / item.quantity);

            orderLines.push({
                shopifyLineId: String(item.id),
                skuId: sku.id,
                qty: item.quantity,
                unitPrice: Math.round(effectiveUnitPrice * 100) / 100, // Round to 2 decimal places
                lineStatus: 'pending',
            });
        }
    }

    // Handle no matching SKUs
    if (orderLines.length === 0) {
        if (skipNoSku) {
            return { action: 'skipped', reason: 'no_matching_skus' };
        }
        // For webhooks, still create order but with no lines (so it's visible)
        // This allows manual intervention
    }

    const newOrder = await prisma.order.create({
        data: {
            ...orderData,
            orderLines: {
                create: orderLines
            }
        }
    });

    return {
        action: 'created',
        orderId: newOrder.id,
        linesCreated: orderLines.length,
        totalLineItems: lineItems.length
    };
}

/**
 * Process an order from ShopifyOrderCache entry
 *
 * @param {PrismaClient} prisma
 * @param {object} cacheEntry - ShopifyOrderCache record
 * @param {object} options - Processing options
 */
export async function processFromCache(prisma, cacheEntry, options = {}) {
    const shopifyOrder = JSON.parse(cacheEntry.rawData);
    return processShopifyOrderToERP(prisma, shopifyOrder, options);
}

/**
 * Cache and process a Shopify order (convenience function)
 * Used by webhooks and sync workers
 *
 * Uses order lock to prevent race conditions when the same order is processed
 * simultaneously by webhook and sync job.
 *
 * @param {PrismaClient} prisma
 * @param {object} shopifyOrder
 * @param {string} webhookTopic
 * @param {object} options
 */
export async function cacheAndProcessOrder(prisma, shopifyOrder, webhookTopic = 'api_sync', options = {}) {
    const shopifyOrderId = String(shopifyOrder.id);
    const source = webhookTopic.startsWith('orders/') ? 'webhook' : 'sync';

    // Use order lock to prevent race conditions between webhook and sync
    const lockResult = await withOrderLock(shopifyOrderId, source, async () => {
        // Step 1: Cache first (always succeeds)
        await cacheShopifyOrder(prisma, shopifyOrderId, shopifyOrder, webhookTopic);

        // Step 2: Process to ERP
        try {
            const result = await processShopifyOrderToERP(prisma, shopifyOrder, options);

            // Step 3a: Mark as processed
            await markCacheProcessed(prisma, shopifyOrderId);

            return result;
        } catch (error) {
            // Step 3b: Mark error but don't throw
            await markCacheError(prisma, shopifyOrderId, error.message);

            return { action: 'cache_only', error: error.message, cached: true };
        }
    });

    // If we couldn't acquire the lock, return skipped
    if (lockResult.skipped) {
        return {
            action: 'skipped',
            reason: 'concurrent_processing',
            source,
        };
    }

    return lockResult.result;
}
