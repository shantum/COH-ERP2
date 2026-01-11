/**
 * Shopify Order Processor - Single source of truth for order processing
 *
 * CACHE-FIRST PATTERN (critical for reliability):
 * 1. Always cache raw Shopify data FIRST via cacheShopifyOrder()
 * 2. Then process to ERP via processShopifyOrderToERP()
 * 3. If processing fails, order is still cached for retry
 * 4. Webhook/Sync can re-process from cache later without re-fetching Shopify
 *
 * PAYMENT METHOD DETECTION (priority order):
 * a) Check gateway names: shopflo/razorpay = Prepaid, cod/cash/manual = COD
 * b) Preserve existing COD status: Once COD, always COD even after payment
 * c) Financial status fallback: pending + no prepaid gateway = likely COD
 * d) Final fallback: Prepaid
 *
 * KEY BEHAVIORS:
 * - Idempotent: Can safely re-process same order multiple times
 * - Race condition safe: Uses withOrderLock to prevent concurrent processing
 * - Fulfillment mapping: Maps Shopify line-level fulfillments to OrderLines via shopifyLineId
 * - ERP is source of truth for shipping: Shopify fulfillment captures tracking data but does NOT auto-ship
 *
 * @module services/shopifyOrderProcessor
 * @requires ./shopify
 * @requires ../utils/customerUtils
 * @requires ../utils/orderLock
 */

import shopifyClient from './shopify.js';
import { findOrCreateCustomer } from '../utils/customerUtils.js';
import { withOrderLock } from '../utils/orderLock.js';
import { detectPaymentMethod } from '../utils/shopifyHelpers.js';

/**
 * Cache raw Shopify order data to ShopifyOrderCache table
 *
 * IMPORTANT: Called FIRST before processShopifyOrderToERP. Handles:
 * - Extracting payment method via CACHE-FIRST PATTERN (see module docs)
 * - Preserving COD status: Once COD, always COD even after payment
 * - Extracting fulfillment/tracking info from fulfillments array
 * - Extracting shipping address fields (city, state, country)
 *
 * PAYMENT METHOD DETECTION (priority order):
 * 1. Check payment_gateway_names: shopflo/razorpay = Prepaid, cod/cash/manual = COD
 * 2. If isCodGateway OR existing cache is COD → preserve COD
 * 3. If isPrepaidGateway → mark Prepaid
 * 4. If financial_status='pending' + no prepaid gateway → assume COD (common for new orders)
 * 5. Fallback: Prepaid
 *
 * KEY: Once an order is marked COD, it STAYS COD even after payment is received.
 * This prevents confusion between payment status and fulfillment method.
 *
 * @param {PrismaClient} prisma - Prisma client
 * @param {string} shopifyOrderId - Shopify order ID (will be stringified)
 * @param {object} shopifyOrder - Raw Shopify order object from API
 * @param {string} [webhookTopic='api_sync'] - Source: 'orders/create', 'orders/updated', 'api_sync'
 *
 * @returns {Promise<void>}
 *
 * @example
 * const shopifyOrder = await shopify.rest.Order.find({ ...});
 * await cacheShopifyOrder(prisma, shopifyOrder.id, shopifyOrder, 'orders/create');
 * // Caches: discountCodes, customerNotes, financialStatus, fulfillmentStatus, etc.
 */
export async function cacheShopifyOrder(prisma, shopifyOrderId, shopifyOrder, webhookTopic = 'api_sync') {
    const orderId = String(shopifyOrderId);

    // Extract discount codes (comma-separated, empty string if none)
    const discountCodes = (shopifyOrder.discount_codes || [])
        .map(d => d.code).join(', ') || '';

    // Extract tracking info from fulfillments (for reference only, not source of truth)
    // NOTE: Order table owns tracking data (awbNumber, courier), these are Shopify's view
    const fulfillment = shopifyOrder.fulfillments?.find(f => f.tracking_number)
        || shopifyOrder.fulfillments?.[0];
    const trackingNumber = fulfillment?.tracking_number || null;
    const trackingCompany = fulfillment?.tracking_company || null;
    const trackingUrl = fulfillment?.tracking_url || fulfillment?.tracking_urls?.[0] || null;
    const shippedAt = fulfillment?.created_at ? new Date(fulfillment.created_at) : null;
    const shipmentStatus = fulfillment?.shipment_status || null;
    const fulfillmentUpdatedAt = fulfillment?.updated_at ? new Date(fulfillment.updated_at) : null;

    // Check for delivered status from fulfillment events
    const deliveredEvent = fulfillment?.line_items?.[0]?.fulfillment_status === 'fulfilled'
        && shipmentStatus === 'delivered';
    const deliveredAt = deliveredEvent && fulfillment?.updated_at
        ? new Date(fulfillment.updated_at) : null;

    // Detect payment method using shared utility
    // Check existing cache to preserve COD status
    const existingCache = await prisma.shopifyOrderCache.findUnique({
        where: { id: orderId },
        select: { paymentMethod: true }
    });
    const paymentMethod = detectPaymentMethod(shopifyOrder, existingCache?.paymentMethod);

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
        // Extracted Shopify-owned fields (read-only)
        discountCodes,
        customerNotes: shopifyOrder.note || null,
        tags: shopifyOrder.tags || null,
        paymentMethod,
        // Tracking info from Shopify (may differ from ERP)
        trackingNumber,
        trackingCompany,
        trackingUrl,
        shippedAt,
        deliveredAt,
        shipmentStatus,
        fulfillmentUpdatedAt,
        // Address
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

// ============================================
// FULFILLMENT SYNC (Line-Level Tracking)
// ============================================

/**
 * Map Shopify shipment_status to ERP trackingStatus
 */
function mapShipmentStatus(shopifyStatus) {
    const map = {
        'in_transit': 'in_transit',
        'out_for_delivery': 'out_for_delivery',
        'delivered': 'delivered',
        'failure': 'delivery_delayed',
        'attempted_delivery': 'out_for_delivery',
    };
    return map[shopifyStatus] || 'in_transit';
}

/**
 * Update order status based on line statuses
 * Order becomes 'shipped' when ALL non-cancelled lines are shipped
 */
async function updateOrderStatusFromLines(prisma, orderId) {
    const lines = await prisma.orderLine.findMany({
        where: { orderId, lineStatus: { not: 'cancelled' } },
        select: { lineStatus: true }
    });

    if (lines.length === 0) return;

    const allShipped = lines.every(l => l.lineStatus === 'shipped');

    if (allShipped) {
        await prisma.order.update({
            where: { id: orderId },
            data: { status: 'shipped' }
        });
    }
}

/**
 * Sync fulfillment data from Shopify to OrderLines
 * Maps each fulfillment's line_items to ERP OrderLines via shopifyLineId
 *
 * This enables partial shipment tracking - different lines can have different AWBs
 *
 * @param {PrismaClient} prisma
 * @param {string} orderId - ERP Order ID
 * @param {object} shopifyOrder - Raw Shopify order object
 * @returns {object} { synced: number, fulfillments: number }
 */
export async function syncFulfillmentsToOrderLines(prisma, orderId, shopifyOrder) {
    const fulfillments = shopifyOrder.fulfillments || [];
    if (fulfillments.length === 0) return { synced: 0, fulfillments: 0 };

    let syncedCount = 0;

    for (const fulfillment of fulfillments) {
        // Skip if no line_items in this fulfillment
        if (!fulfillment.line_items?.length) continue;

        const awbNumber = fulfillment.tracking_number || null;
        const courier = fulfillment.tracking_company || null;
        const shippedAt = fulfillment.created_at ? new Date(fulfillment.created_at) : new Date();
        const trackingStatus = mapShipmentStatus(fulfillment.shipment_status);

        // Get Shopify line IDs from this fulfillment
        const shopifyLineIds = fulfillment.line_items.map(li => String(li.id));

        // Update matching OrderLines with tracking data from Shopify fulfillment
        // NOTE: Does NOT change lineStatus - ERP is source of truth for shipping status
        // Skip cancelled lines and lines already shipped (to preserve existing tracking)
        const result = await prisma.orderLine.updateMany({
            where: {
                orderId,
                shopifyLineId: { in: shopifyLineIds },
                lineStatus: { notIn: ['cancelled', 'shipped'] },
            },
            data: {
                awbNumber,
                courier,
                trackingStatus,
                // NOT setting lineStatus to 'shipped' - user must explicitly ship through ERP
                // NOT setting shippedAt - this is set when ERP ships the order
            }
        });

        syncedCount += result.count;
    }

    // NOTE: Not updating order status automatically - ERP is source of truth for shipping
    // Tracking data is captured but order/line status remains unchanged

    return { synced: syncedCount, fulfillments: fulfillments.length };
}

/**
 * Process a Shopify order to the ERP Order table
 *
 * SINGLE SOURCE OF TRUTH for order processing logic. Handles:
 * - Create new orders with matching SKUs
 * - Update existing orders (by shopifyOrderId or orderNumber)
 * - Payment method via CACHE-FIRST PATTERN (see module docs)
 * - Line-level fulfillment sync (partial shipment support) - captures tracking data only
 *
 * STATUS TRANSITIONS:
 * - ERP-managed statuses (shipped, delivered) are preserved over Shopify
 * - ERP is source of truth: Shopify fulfillment captures tracking but does NOT auto-ship
 *
 * @param {PrismaClient} prisma - Prisma client
 * @param {object} shopifyOrder - Raw Shopify order object
 * @param {object} [options={}] - Processing options
 * @param {boolean} [options.skipNoSku=false] - Skip orders with no matching SKUs (false for webhooks, true for bulk sync)
 *
 * @returns {Promise<object>} Result object
 * @returns {string} result.action - 'created'|'updated'|'skipped'|'cancelled'|'fulfilled'|'cache_only'
 * @returns {string} [result.orderId] - Created/updated order ID
 * @returns {number} [result.linesCreated] - Count of lines created
 * @returns {number} [result.totalLineItems] - Total Shopify line items in order
 * @returns {object} [result.fulfillmentSync] - Line fulfillment sync results
 * @returns {string} [result.reason] - Reason for skip if action='skipped'
 * @returns {string} [result.error] - Error message if action='cache_only'
 *
 * @example
 * // Webhook: fail if no SKUs (order still cached for retry)
 * const result = await processShopifyOrderToERP(prisma, shopifyOrder);
 *
 * // Bulk sync: skip orders with no SKUs
 * const result = await processShopifyOrderToERP(prisma, shopifyOrder, { skipNoSku: true });
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
    // ERP is source of truth - Shopify fulfillment does NOT auto-ship orders
    let status = shopifyClient.mapOrderStatus(shopifyOrder);

    if (existingOrder) {
        const erpManagedStatuses = ['shipped', 'delivered'];

        if (erpManagedStatuses.includes(existingOrder.status) && status !== 'cancelled') {
            // Preserve ERP-managed statuses (shipped, delivered)
            status = existingOrder.status;
        } else if (existingOrder.status === 'open' && status === 'shipped') {
            // ERP is source of truth: ignore Shopify fulfillment status for open orders
            // User must explicitly ship through ERP
            status = 'open';
        }
    }

    // Determine payment method using shared utility
    // NOTE: Once an order is COD, it stays COD even after payment (don't confuse with Prepaid)
    const paymentMethod = detectPaymentMethod(shopifyOrder, existingOrder?.paymentMethod);

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

    // NOTE: discountCodes, customerNotes, shopifyFulfillmentStatus are stored in ShopifyOrderCache only
    // Access them via order.shopifyCache JOIN pattern (like VLOOKUP)

    // Extract internal notes from Shopify note_attributes (staff-only notes)
    // Shopify note_attributes is an array of {name, value} objects
    const noteAttributes = shopifyOrder.note_attributes || [];
    const internalNote = noteAttributes.find(n => n.name === 'internal_note' || n.name === 'staff_note')?.value;

    // Build order data - ONLY ERP-owned fields (not Shopify fields)
    // Shopify data is accessed via order.shopifyCache relation
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
        orderDate: shopifyOrder.created_at ? new Date(shopifyOrder.created_at) : new Date(),
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
        // Update detection - only check ERP-owned fields
        // Shopify fields (discountCode, customerNotes, shopifyFulfillmentStatus) are in cache only
        const needsUpdate =
            // Core status changes
            existingOrder.status !== status ||
            // Fulfillment/shipping info
            existingOrder.awbNumber !== awbNumber ||
            existingOrder.courier !== courier ||
            // Payment
            existingOrder.paymentMethod !== paymentMethod ||
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

            // Sync fulfillments to order lines (partial shipment support)
            const fulfillmentSync = await syncFulfillmentsToOrderLines(prisma, existingOrder.id, shopifyOrder);

            return { action: changeType, orderId: existingOrder.id, fulfillmentSync };
        }

        // Even if order data hasn't changed, sync fulfillments (they may have updated)
        if (shopifyOrder.fulfillments?.length > 0) {
            const fulfillmentSync = await syncFulfillmentsToOrderLines(prisma, existingOrder.id, shopifyOrder);
            if (fulfillmentSync.synced > 0) {
                return { action: 'fulfillment_synced', orderId: existingOrder.id, fulfillmentSync };
            }
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
                shippingAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
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

    // Sync fulfillments to order lines if order came in already fulfilled
    // This handles orders that were fulfilled before sync
    let fulfillmentSync = null;
    if (shopifyOrder.fulfillments?.length > 0) {
        fulfillmentSync = await syncFulfillmentsToOrderLines(prisma, newOrder.id, shopifyOrder);
    }

    return {
        action: 'created',
        orderId: newOrder.id,
        linesCreated: orderLines.length,
        totalLineItems: lineItems.length,
        fulfillmentSync,
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
 * Cache and process a Shopify order (convenience function for webhooks and sync)
 *
 * RECOMMENDED ENTRY POINT for webhooks and background jobs. Implements:
 * - Order locking: Prevents race conditions when webhook + sync process same order
 * - Cache-first pattern: Caches before processing
 * - Error isolation: Processing errors cached but don't lose order data
 * - Retry-safe: Failed orders can be re-processed via sync
 *
 * FLOW:
 * 1. Acquire lock (skip if order already processing)
 * 2. Cache raw Shopify data
 * 3. Process to ERP (failures don't lose cached data)
 * 4. Mark as processed or failed
 *
 * @param {PrismaClient} prisma - Prisma client
 * @param {object} shopifyOrder - Raw Shopify order object
 * @param {string} [webhookTopic='api_sync'] - Source: 'orders/create', 'orders/updated', 'api_sync'
 * @param {object} [options={}] - Options passed to processShopifyOrderToERP
 *
 * @returns {Promise<object>} Result object
 * @returns {string} result.action - 'created'|'updated'|'skipped'|'cache_only'|'fulfillment_synced'|'concurrent_processing'
 * @returns {string} [result.orderId] - Order ID if created/updated
 * @returns {boolean} [result.cached] - True if cached even though processing failed
 *
 * @example
 * // In webhook
 * const result = await cacheAndProcessOrder(prisma, shopifyOrder, 'orders/create');
 *
 * // In background sync
 * const result = await cacheAndProcessOrder(prisma, shopifyOrder, 'api_sync', { skipNoSku: true });
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
