/**
 * Shopify Order Processor - Single source of truth for order processing
 *
 * This module consolidates order processing logic that was previously
 * duplicated in webhooks.js, shopify.js, and syncWorker.js
 */

import shopifyClient from './shopify.js';

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

    await prisma.shopifyOrderCache.upsert({
        where: { id: orderId },
        create: {
            id: orderId,
            rawData: JSON.stringify(shopifyOrder),
            orderNumber: shopifyOrder.name || null,
            financialStatus: shopifyOrder.financial_status || null,
            fulfillmentStatus: shopifyOrder.fulfillment_status || null,
            webhookTopic,
            lastWebhookAt: new Date(),
        },
        update: {
            rawData: JSON.stringify(shopifyOrder),
            orderNumber: shopifyOrder.name || null,
            financialStatus: shopifyOrder.financial_status || null,
            fulfillmentStatus: shopifyOrder.fulfillment_status || null,
            webhookTopic,
            lastWebhookAt: new Date(),
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

    // Check if order exists
    const existingOrder = await prisma.order.findFirst({
        where: { shopifyOrderId },
        include: { orderLines: true }
    });

    // Extract customer info
    const customer = shopifyOrder.customer;
    const shippingAddress = shopifyOrder.shipping_address;

    // Find or create customer
    let customerId = null;
    if (customer) {
        const shopifyCustomerId = String(customer.id);
        const customerEmail = customer.email?.toLowerCase();

        let dbCustomer = await prisma.customer.findFirst({
            where: {
                OR: [
                    { shopifyCustomerId },
                    ...(customerEmail ? [{ email: customerEmail }] : [])
                ].filter(Boolean)
            }
        });

        if (!dbCustomer && customerEmail) {
            dbCustomer = await prisma.customer.create({
                data: {
                    email: customerEmail,
                    firstName: customer.first_name || null,
                    lastName: customer.last_name || null,
                    phone: customer.phone || null,
                    shopifyCustomerId,
                    defaultAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
                    firstOrderDate: new Date(shopifyOrder.created_at),
                }
            });
        }

        customerId = dbCustomer?.id;

        // Update customer's last order date
        if (customerId) {
            await prisma.customer.update({
                where: { id: customerId },
                data: { lastOrderDate: new Date(shopifyOrder.created_at) },
            });
        }
    }

    // Determine order status
    let status = shopifyClient.mapOrderStatus(shopifyOrder);

    // Preserve local 'shipped' status if order is fulfilled in Shopify
    if (shopifyOrder.fulfillment_status === 'fulfilled' && existingOrder?.status === 'shipped') {
        status = 'shipped';
    }

    // Determine payment method (COD vs Prepaid)
    const gatewayNames = (shopifyOrder.payment_gateway_names || []).join(', ').toLowerCase();
    const isPrepaidGateway = gatewayNames.includes('shopflo') || gatewayNames.includes('razorpay');
    const paymentMethod = isPrepaidGateway ? 'Prepaid' :
        (shopifyOrder.financial_status === 'pending' ? 'COD' : 'Prepaid');

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

    // Build order data
    const orderData = {
        shopifyOrderId,
        orderNumber: shopifyOrder.name || String(shopifyOrder.order_number) || `SHOP-${shopifyOrderId.slice(-8)}`,
        shopifyData: JSON.stringify(shopifyOrder),
        channel: shopifyClient.mapOrderChannel(shopifyOrder),
        status,
        customerId,
        customerName: customerName || 'Unknown',
        customerEmail: customer?.email || shopifyOrder.email || null,
        customerPhone: shippingAddress?.phone || customer?.phone || shopifyOrder.phone || null,
        shippingAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
        totalAmount: parseFloat(shopifyOrder.total_price) || 0,
        shopifyFulfillmentStatus: shopifyOrder.fulfillment_status || 'unfulfilled',
        orderDate: shopifyOrder.created_at ? new Date(shopifyOrder.created_at) : new Date(),
        customerNotes: shopifyOrder.note || null,
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
        // Check if update is needed
        const needsUpdate = existingOrder.status !== status ||
            existingOrder.shopifyFulfillmentStatus !== orderData.shopifyFulfillmentStatus ||
            existingOrder.awbNumber !== awbNumber ||
            existingOrder.courier !== courier ||
            existingOrder.paymentMethod !== paymentMethod ||
            existingOrder.customerNotes !== orderData.customerNotes;

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
            orderLines.push({
                shopifyLineId: String(item.id),
                skuId: sku.id,
                qty: item.quantity,
                unitPrice: parseFloat(item.price) || 0,
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
 * @param {PrismaClient} prisma
 * @param {object} shopifyOrder
 * @param {string} webhookTopic
 * @param {object} options
 */
export async function cacheAndProcessOrder(prisma, shopifyOrder, webhookTopic = 'api_sync', options = {}) {
    const shopifyOrderId = String(shopifyOrder.id);

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
}
