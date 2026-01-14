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

import type { PrismaClient, Prisma } from '@prisma/client';
import shopifyClient from './shopify.js';
import type { ShopifyOrder, ShopifyFulfillment, ShopifyLineItem, ShopifyAddress, ShopifyCustomer } from './shopify.js';
import { findOrCreateCustomer, type ShopifyCustomerData } from '../utils/customerUtils.js';
import { withOrderLock } from '../utils/orderLock.js';
import { detectPaymentMethod, extractInternalNote, calculateEffectiveUnitPrice } from '../utils/shopifyHelpers.js';
import { updateCustomerTier } from '../utils/tierUtils.js';
import { syncLogger } from '../utils/logger.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Extended Shopify fulfillment with additional fields
 * Extends the base ShopifyFulfillment with fields used in processing
 */
interface ExtendedShopifyFulfillment extends ShopifyFulfillment {
    shipment_status?: string | null;
    line_items?: Array<{
        id: number;
        fulfillment_status?: string;
        [key: string]: any;
    }>;
}

/**
 * Extended Shopify order with extended fulfillments
 */
interface ExtendedShopifyOrder extends Omit<ShopifyOrder, 'fulfillments'> {
    fulfillments?: ExtendedShopifyFulfillment[];
}

/**
 * Cache payload stored in ShopifyOrderCache
 */
export interface CachePayload {
    rawData: string;
    orderNumber: string | null;
    financialStatus: string | null;
    fulfillmentStatus: string | null;
    paymentMethod: string;
    discountCodes: string;
    customerNotes: string | null;
    tags: string | null;
    trackingNumber: string | null;
    trackingCompany: string | null;
    trackingUrl: string | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    shipmentStatus: string | null;
    fulfillmentUpdatedAt: Date | null;
    shippingCity: string | null;
    shippingState: string | null;
    shippingCountry: string | null;
    webhookTopic: string;
    lastWebhookAt: Date;
}

/**
 * Result of order processing
 */
export interface ProcessResult {
    action: 'created' | 'updated' | 'skipped' | 'cancelled' | 'fulfilled' | 'cache_only' | 'fulfillment_synced';
    orderId?: string;
    linesCreated?: number;
    totalLineItems?: number;
    reason?: string;
    error?: string;
    cached?: boolean;
    fulfillmentSync?: FulfillmentSyncResult;
}

/**
 * Result of fulfillment sync operation
 */
export interface FulfillmentSyncResult {
    synced: number;
    fulfillments: number;
}

/**
 * Options for processing orders
 */
export interface ProcessOptions {
    skipNoSku?: boolean;
}

/**
 * Options for cache and process operation
 */
export interface CacheAndProcessOptions extends ProcessOptions {
    // Additional options can be added here
}

/**
 * Result of withOrderLock operation
 */
interface LockResult {
    skipped: boolean;
    result?: ProcessResult;
}

// Re-export types from shopify.ts (avoid redeclaring)
// These types are already defined in shopify.ts

/**
 * Order with orderLines relation
 */
type OrderWithLines = Prisma.OrderGetPayload<{
    include: { orderLines: true };
}>;

// ============================================
// CACHE MANAGEMENT FUNCTIONS
// ============================================

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
 * Cache a single Shopify order (convenience wrapper)
 * @deprecated Use cacheShopifyOrders() instead
 */
export async function cacheShopifyOrder(
    prisma: PrismaClient,
    shopifyOrderId: string | number,
    shopifyOrder: ExtendedShopifyOrder,
    webhookTopic = 'api_sync'
): Promise<void> {
    await cacheShopifyOrders(prisma, shopifyOrder, webhookTopic);
}

/**
 * Batch cache multiple Shopify orders (convenience wrapper)
 * @deprecated Use cacheShopifyOrders() instead
 */
export async function batchCacheShopifyOrders(
    prisma: PrismaClient,
    orders: ExtendedShopifyOrder[],
    webhookTopic = 'full_dump'
): Promise<number> {
    return cacheShopifyOrders(prisma, orders, webhookTopic);
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

// ============================================
// FULFILLMENT SYNC (Line-Level Tracking)
// ============================================

/**
 * Map Shopify shipment_status to ERP trackingStatus
 */
function mapShipmentStatus(shopifyStatus: string | null | undefined): string {
    const map: Record<string, string> = {
        'in_transit': 'in_transit',
        'out_for_delivery': 'out_for_delivery',
        'delivered': 'delivered',
        'failure': 'delivery_delayed',
        'attempted_delivery': 'out_for_delivery',
    };
    return shopifyStatus ? (map[shopifyStatus] || 'in_transit') : 'in_transit';
}

/**
 * Update order status based on line statuses
 * Order becomes 'shipped' when ALL non-cancelled lines are shipped
 */
async function updateOrderStatusFromLines(prisma: PrismaClient, orderId: string): Promise<void> {
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
 * @param prisma - Prisma client
 * @param orderId - ERP Order ID
 * @param shopifyOrder - Raw Shopify order object
 * @returns Sync results with counts
 */
export async function syncFulfillmentsToOrderLines(
    prisma: PrismaClient,
    orderId: string,
    shopifyOrder: ExtendedShopifyOrder
): Promise<FulfillmentSyncResult> {
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
        const shopifyLineIds = fulfillment.line_items.map((li: { id: number }) => String(li.id));

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

// ============================================
// ORDER PROCESSING
// ============================================

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
 * @param prisma - Prisma client
 * @param shopifyOrder - Raw Shopify order object
 * @param options - Processing options
 *
 * @returns Result object with action and details
 *
 * @example
 * // Webhook: fail if no SKUs (order still cached for retry)
 * const result = await processShopifyOrderToERP(prisma, shopifyOrder);
 *
 * @example
 * // Bulk sync: skip orders with no SKUs
 * const result = await processShopifyOrderToERP(prisma, shopifyOrder, { skipNoSku: true });
 */
export async function processShopifyOrderToERP(
    prisma: PrismaClient,
    shopifyOrder: ExtendedShopifyOrder,
    options: ProcessOptions = {}
): Promise<ProcessResult> {
    const { skipNoSku = false } = options;
    const shopifyOrderId = String(shopifyOrder.id);
    const orderName = shopifyOrder.name || String(shopifyOrder.order_number) || shopifyOrderId;

    // Check if order exists - first by shopifyOrderId, then by orderNumber
    // This handles both synced orders (have shopifyOrderId) and manual orders (only have orderNumber)
    const orderNumber = shopifyOrder.name || String(shopifyOrder.order_number);

    let existingOrder = await prisma.order.findFirst({
        where: {
            OR: [
                { shopifyOrderId },
                ...(orderNumber ? [{ orderNumber }] : [])
            ]
        },
        include: { orderLines: true }
    });

    // Extract customer and shipping info
    const customer = shopifyOrder.customer;
    const shippingAddress = shopifyOrder.shipping_address;

    // Convert ShopifyCustomer to ShopifyCustomerData for findOrCreateCustomer
    const customerData: ShopifyCustomerData | null = customer ? {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone,
        default_address: customer.default_address,
    } : null;

    // Find or create customer using shared utility
    const { customer: dbCustomer } = await findOrCreateCustomer(
        prisma,
        customerData,
        {
            shippingAddress: shippingAddress as Record<string, unknown> | undefined,
            orderDate: new Date(shopifyOrder.created_at),
        }
    );
    const customerId = dbCustomer?.id || null;

    // Determine order status
    // ERP is source of truth - Shopify fulfillment does NOT auto-ship orders
    let status: string = shopifyClient.mapOrderStatus(shopifyOrder);

    if (existingOrder) {
        const erpManagedStatuses: string[] = ['shipped', 'delivered'];

        if (erpManagedStatuses.includes(existingOrder.status) && status !== 'cancelled') {
            // Preserve ERP-managed statuses (shipped, delivered)
            status = existingOrder.status;
        } else if (existingOrder.status === 'open') {
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

    if (shopifyOrder.fulfillments?.length && shopifyOrder.fulfillments.length > 0) {
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
    const internalNote = extractInternalNote(shopifyOrder.note_attributes);

    // Build order data - ONLY ERP-owned fields (not Shopify fields)
    // Shopify data is accessed via order.shopifyCache relation
    const orderData = {
        shopifyOrderId,
        orderNumber: orderNumber || `SHOP-${shopifyOrderId.slice(-8)}`,
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
            let changeType: ProcessResult['action'] = 'updated';
            if (shopifyOrder.cancelled_at && existingOrder.status !== 'cancelled') {
                changeType = 'cancelled';
            } else if (shopifyOrder.fulfillment_status === 'fulfilled') {
                changeType = 'fulfilled';
            }

            // Sync fulfillments to order lines (partial shipment support)
            const fulfillmentSync = await syncFulfillmentsToOrderLines(prisma, existingOrder.id, shopifyOrder);

            return { action: changeType, orderId: existingOrder.id, fulfillmentSync };
        }

        // Even if order data hasn't changed, sync fulfillments (they may have updated)
        if (shopifyOrder.fulfillments?.length && shopifyOrder.fulfillments.length > 0) {
            const fulfillmentSync = await syncFulfillmentsToOrderLines(prisma, existingOrder.id, shopifyOrder);
            if (fulfillmentSync.synced > 0) {
                return { action: 'fulfillment_synced', orderId: existingOrder.id, fulfillmentSync };
            }
        }

        return { action: 'skipped', orderId: existingOrder.id };
    }

    // Create new order with lines
    const lineItems = shopifyOrder.line_items || [];
    const orderLinesData = [];

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
            // Calculate effective unit price after discounts using typed helper
            const originalPrice = parseFloat(item.price) || 0;
            const effectiveUnitPrice = calculateEffectiveUnitPrice(
                originalPrice,
                item.quantity,
                item.discount_allocations
            );

            orderLinesData.push({
                shopifyLineId: String(item.id),
                sku: { connect: { id: sku.id } },
                qty: item.quantity,
                unitPrice: effectiveUnitPrice,
                lineStatus: 'pending',
                shippingAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
            });
        }
    }

    // Handle no matching SKUs
    if (orderLinesData.length === 0) {
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
                create: orderLinesData
            }
        }
    });

    // Sync fulfillments to order lines if order came in already fulfilled
    // This handles orders that were fulfilled before sync
    // Guarded - fulfillment sync failure shouldn't fail order creation
    let fulfillmentSync: FulfillmentSyncResult | null = null;
    if (shopifyOrder.fulfillments?.length && shopifyOrder.fulfillments.length > 0) {
        try {
            fulfillmentSync = await syncFulfillmentsToOrderLines(prisma, newOrder.id, shopifyOrder);
        } catch (fulfillmentError: unknown) {
            syncLogger.warn({
                orderId: newOrder.id,
                shopifyOrderId: String(shopifyOrder.id),
                error: fulfillmentError instanceof Error ? fulfillmentError.message : 'Unknown error'
            }, 'Failed to sync fulfillments for new order - order was created successfully');
        }
    }

    // Update customer tier based on new order
    // New orders with totalAmount > 0 may qualify customer for tier upgrade
    if (orderData.customerId && orderData.totalAmount > 0) {
        await updateCustomerTier(prisma, orderData.customerId);
    }

    return {
        action: 'created',
        orderId: newOrder.id,
        linesCreated: orderLinesData.length,
        totalLineItems: lineItems.length,
        fulfillmentSync: fulfillmentSync || undefined,
    };
}

/**
 * Process an order from ShopifyOrderCache entry
 *
 * @param prisma - Prisma client
 * @param cacheEntry - ShopifyOrderCache record
 * @param options - Processing options
 */
export async function processFromCache(
    prisma: PrismaClient,
    cacheEntry: { rawData: string },
    options: ProcessOptions = {}
): Promise<ProcessResult> {
    const shopifyOrder = JSON.parse(cacheEntry.rawData) as ExtendedShopifyOrder;
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
 * @param prisma - Prisma client
 * @param shopifyOrder - Raw Shopify order object
 * @param webhookTopic - Source: 'orders/create', 'orders/updated', 'api_sync'
 * @param options - Options passed to processShopifyOrderToERP
 *
 * @returns Result object
 *
 * @example
 * // In webhook
 * const result = await cacheAndProcessOrder(prisma, shopifyOrder, 'orders/create');
 *
 * @example
 * // In background sync
 * const result = await cacheAndProcessOrder(prisma, shopifyOrder, 'api_sync', { skipNoSku: true });
 */
export async function cacheAndProcessOrder(
    prisma: PrismaClient,
    shopifyOrder: ExtendedShopifyOrder,
    webhookTopic = 'api_sync',
    options: CacheAndProcessOptions = {}
): Promise<ProcessResult> {
    const shopifyOrderId = String(shopifyOrder.id);
    const source = webhookTopic.startsWith('orders/') ? 'webhook' : 'sync';

    // Use order lock to prevent race conditions between webhook and sync
    const lockResult = await withOrderLock(shopifyOrderId, source, async () => {
        // Step 1: Cache first (always succeeds)
        await cacheShopifyOrders(prisma, shopifyOrder, webhookTopic);

        // Step 2: Process to ERP
        try {
            const result = await processShopifyOrderToERP(prisma, shopifyOrder, options);

            // Step 3a: Mark as processed (guarded - don't fail if this errors)
            try {
                await markCacheProcessed(prisma, shopifyOrderId);
            } catch (markError: unknown) {
                syncLogger.warn({
                    shopifyOrderId,
                    error: markError instanceof Error ? markError.message : 'Unknown error'
                }, 'Failed to mark cache as processed');
            }

            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            // Step 3b: Mark error but don't throw
            await markCacheError(prisma, shopifyOrderId, errorMessage);

            return { action: 'cache_only' as const, error: errorMessage, cached: true };
        }
    }) as LockResult;

    // If we couldn't acquire the lock, return skipped
    if (lockResult.skipped) {
        return {
            action: 'skipped',
            reason: 'concurrent_processing',
        };
    }

    return lockResult.result!;
}
