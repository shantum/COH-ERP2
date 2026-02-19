/**
 * Shopify Order Processor - Single source of truth for order processing
 *
 * CACHE-FIRST PATTERN (critical for reliability):
 * 1. Always cache raw Shopify data FIRST via cacheShopifyOrders()
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
 * - Shopify fulfillment syncs AWB, courier, AND lineStatus=shipped to lines
 *
 * @module services/shopifyOrderProcessor
 * @requires ./shopify
 * @requires ../utils/customerUtils
 * @requires ../utils/orderLock
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import shopifyClient from './shopify.js';
import type { ShopifyOrder, ShopifyFulfillment, ShopifyAddress, ShopifyCustomer } from './shopify.js';
import { findOrCreateCustomer, type ShopifyCustomerData } from '../utils/customerUtils.js';
import { withOrderLock } from '../utils/orderLock.js';
import { detectPaymentMethod, extractInternalNote, calculateEffectiveUnitPrice } from '../utils/shopifyHelpers.js';
import { updateCustomerTier, incrementCustomerOrderCount } from '../utils/tierUtils.js';
import { syncLogger } from '../utils/logger.js';
import { recomputeOrderStatus } from '../utils/orderStatus.js';
import { generateDraftInvoice } from './orderInvoiceGenerator.js';
import { deferredExecutor } from './deferredExecutor.js';

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
        [key: string]: unknown;
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

/**
 * SKU lookup abstraction for DB queries or Map lookups
 * Returns { id: string } to match Prisma's minimal select pattern
 */
type SkuLookupFn = (variantId: string | null, skuCode: string | null) => Promise<{ id: string } | null>;

/**
 * Context for building order data
 */
interface OrderBuildContext {
    shopifyOrder: ExtendedShopifyOrder;
    existingOrder: OrderWithLines | null;
    customerId: string | null;
}

/**
 * Result of order line creation
 */
interface OrderLinesResult {
    orderLinesData: Prisma.OrderLineCreateWithoutOrderInput[];
    totalLineItems: number;
    shouldSkip: boolean;
    skipReason?: string;
}

/**
 * Result of change detection
 */
interface ChangeDetectionResult {
    needsUpdate: boolean;
    changeType: ProcessResult['action'];
}

/**
 * Tracking info extracted from fulfillments
 */
interface TrackingInfo {
    awbNumber: string | null;
    courier: string | null;
    shippedAt: Date | null;
}

/**
 * Order data object built for create/update operations
 * Note: awbNumber, courier, shippedAt are now on OrderLine, not Order
 */
interface OrderDataPayload {
    shopifyOrderId: string;
    orderNumber: string;
    channel: string;
    status: string;
    customerId: string | null;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    shippingAddress: string | null;
    customerState: string | null;
    totalAmount: number;
    orderDate: Date;
    internalNotes: string | null;
    paymentMethod: string;
    syncedAt: Date;
}

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
        const awbNumber = fulfillment.tracking_number || null;
        const courier = fulfillment.tracking_company || null;
        const trackingStatus = mapShipmentStatus(fulfillment.shipment_status);

        // CASE 1: line_items present - PRECISE sync to specific lines
        if (fulfillment.line_items?.length) {
            const shopifyLineIds = fulfillment.line_items.map((li: { id: number }) => String(li.id));

            // Sync tracking data only - ERP is source of truth for shipped status
            // lineStatus changes must go through ERP workflow (allocate → pick → pack → ship)
            const result = await prisma.orderLine.updateMany({
                where: {
                    orderId,
                    shopifyLineId: { in: shopifyLineIds },
                    lineStatus: { not: 'cancelled' },
                },
                data: {
                    awbNumber,
                    courier,
                    trackingStatus,
                }
            });

            syncedCount += result.count;
            syncLogger.info({
                orderNumber: shopifyOrder.name,
                fulfillmentId: fulfillment.id,
                lineCount: shopifyLineIds.length,
                updatedCount: result.count,
                awbNumber,
            }, 'Synced fulfillment tracking to specific lines');
        }
        // CASE 2: No line_items - FALLBACK: update all lines without AWB
        // This handles single-fulfillment orders where Shopify may omit line_items
        // Sync tracking data only - ERP is source of truth for shipped status
        else if (awbNumber) {
            const result = await prisma.orderLine.updateMany({
                where: {
                    orderId,
                    awbNumber: null, // Only update lines without existing AWB (preserve split shipments)
                    lineStatus: { not: 'cancelled' },
                },
                data: {
                    awbNumber,
                    courier,
                    trackingStatus,
                }
            });

            syncedCount += result.count;
            if (result.count > 0) {
                syncLogger.info({
                    orderNumber: shopifyOrder.name,
                    fulfillmentId: fulfillment.id,
                    updatedCount: result.count,
                    awbNumber,
                }, 'Synced fulfillment tracking via fallback (no line_items in fulfillment)');
            }
        }
    }

    // Promote shipped lines to delivered when Shopify says delivered
    // Check if any fulfillment has shipment_status 'delivered'
    const hasDeliveredFulfillment = fulfillments.some(
        f => f.shipment_status === 'delivered'
    );
    if (hasDeliveredFulfillment) {
        const promoted = await prisma.orderLine.updateMany({
            where: {
                orderId,
                lineStatus: 'shipped',
            },
            data: {
                lineStatus: 'delivered',
                deliveredAt: new Date(),
            },
        });
        if (promoted.count > 0) {
            syncLogger.info({
                orderNumber: shopifyOrder.name,
                promotedCount: promoted.count,
            }, 'Promoted shipped lines to delivered (Shopify confirmation)');
        }
    }

    return { synced: syncedCount, fulfillments: fulfillments.length };
}

// ============================================
// ORDER PROCESSING HELPERS (Shared Logic)
// ============================================

/**
 * Build customer data object for findOrCreateCustomer
 */
function buildCustomerData(customer: ShopifyCustomer | undefined | null): ShopifyCustomerData | null {
    if (!customer) return null;
    return {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone,
        default_address: customer.default_address,
    };
}

/**
 * Determine order status with ERP precedence rules
 * - ERP-managed statuses (shipped, delivered) are preserved over Shopify
 * - ERP is source of truth: Shopify fulfillment does NOT auto-ship orders
 */
function determineOrderStatus(
    shopifyOrder: ExtendedShopifyOrder,
    existingOrder: OrderWithLines | null
): string {
    let status: string = shopifyClient.mapOrderStatus(shopifyOrder);

    if (existingOrder) {
        const erpManagedStatuses: string[] = ['shipped', 'delivered'];
        if (erpManagedStatuses.includes(existingOrder.status) && status !== 'cancelled') {
            status = existingOrder.status;
        } else if (existingOrder.status === 'open') {
            status = 'open';
        }
    }

    return status;
}

/**
 * Extract tracking info from Shopify fulfillments
 * Note: Tracking data is now stored at OrderLine level, not Order level.
 * This function extracts from Shopify fulfillments for new orders or fallback.
 */
function extractOrderTrackingInfo(
    shopifyOrder: ExtendedShopifyOrder,
    existingOrder: OrderWithLines | null
): TrackingInfo {
    // Tracking is now on OrderLine, get from first shipped line if exists
    const existingShippedLine = existingOrder?.orderLines?.find(l => l.shippedAt || l.awbNumber);
    let awbNumber = existingShippedLine?.awbNumber || null;
    let courier = existingShippedLine?.courier || null;
    let shippedAt = existingShippedLine?.shippedAt || null;

    if (shopifyOrder.fulfillments?.length && shopifyOrder.fulfillments.length > 0) {
        const fulfillment = shopifyOrder.fulfillments.find(f => f.tracking_number) || shopifyOrder.fulfillments[0];
        awbNumber = fulfillment.tracking_number || awbNumber;
        courier = fulfillment.tracking_company || courier;
        if (fulfillment.created_at && !shippedAt) {
            shippedAt = new Date(fulfillment.created_at);
        }
    }

    return { awbNumber, courier, shippedAt };
}

/**
 * Build customer display name from shipping address or customer
 */
function buildCustomerName(
    shippingAddress: ShopifyAddress | undefined | null,
    customer: ShopifyCustomer | undefined | null
): string {
    if (shippingAddress) {
        return `${shippingAddress.first_name || ''} ${shippingAddress.last_name || ''}`.trim() || 'Unknown';
    }
    if (customer?.first_name) {
        return `${customer.first_name} ${customer.last_name || ''}`.trim();
    }
    return 'Unknown';
}

/**
 * Build complete order data payload for create/update
 * Note: Tracking fields (awbNumber, courier, shippedAt) are synced to OrderLines via syncFulfillmentsToOrderLines
 */
function buildOrderData(
    ctx: OrderBuildContext,
    status: string,
    _tracking: TrackingInfo // Tracking is now on OrderLine, kept for signature compatibility
): OrderDataPayload {
    const { shopifyOrder, existingOrder, customerId } = ctx;
    const shopifyOrderId = String(shopifyOrder.id);
    const orderNumber = shopifyOrder.name || String(shopifyOrder.order_number);
    const customer = shopifyOrder.customer;
    const shippingAddress = shopifyOrder.shipping_address;

    const customerName = buildCustomerName(shippingAddress, customer);
    const paymentMethod = detectPaymentMethod(shopifyOrder, existingOrder?.paymentMethod);
    const internalNote = extractInternalNote(shopifyOrder.note_attributes);

    let internalNotes = existingOrder?.internalNotes || internalNote || null;

    // Add cancellation note if cancelled
    if (shopifyOrder.cancelled_at && !existingOrder?.internalNotes?.includes('Cancelled via Shopify')) {
        internalNotes = existingOrder?.internalNotes
            ? `${existingOrder.internalNotes}\nCancelled via Shopify at ${shopifyOrder.cancelled_at}`
            : `Cancelled via Shopify at ${shopifyOrder.cancelled_at}`;
    }

    return {
        shopifyOrderId,
        orderNumber: orderNumber || `SHOP-${shopifyOrderId.slice(-8)}`,
        channel: shopifyClient.mapOrderChannel(shopifyOrder),
        status,
        customerId,
        customerName,
        customerEmail: customer?.email || shopifyOrder.email || null,
        customerPhone: shippingAddress?.phone || customer?.phone || shopifyOrder.phone || null,
        shippingAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
        customerState: shippingAddress?.province || null,
        totalAmount: parseFloat(shopifyOrder.total_price) || 0,
        orderDate: shopifyOrder.created_at ? new Date(shopifyOrder.created_at) : new Date(),
        internalNotes,
        paymentMethod,
        syncedAt: new Date(),
    };
}

/**
 * Detect if an existing order needs update and determine change type
 * Note: awbNumber, courier are now on OrderLine, synced via syncFulfillmentsToOrderLines
 */
function detectOrderChanges(
    existingOrder: OrderWithLines,
    orderData: OrderDataPayload,
    shopifyOrder: ExtendedShopifyOrder
): ChangeDetectionResult {
    const needsUpdate =
        existingOrder.status !== orderData.status ||
        existingOrder.paymentMethod !== orderData.paymentMethod ||
        existingOrder.customerEmail !== orderData.customerEmail ||
        existingOrder.customerPhone !== orderData.customerPhone ||
        existingOrder.totalAmount !== orderData.totalAmount ||
        existingOrder.shippingAddress !== orderData.shippingAddress;

    let changeType: ProcessResult['action'] = 'updated';
    if (shopifyOrder.cancelled_at && existingOrder.status !== 'cancelled') {
        changeType = 'cancelled';
    } else if (shopifyOrder.fulfillment_status === 'fulfilled') {
        changeType = 'fulfilled';
    }

    return { needsUpdate, changeType };
}

/**
 * Create order lines data with SKU lookup abstraction
 * @param shopifyOrder - The Shopify order
 * @param skuLookup - Function to look up SKU by variant ID or SKU code
 * @param skipNoSku - If true, return shouldSkip when no SKUs match; if false, allow empty lines
 */
async function createOrderLinesData(
    shopifyOrder: ExtendedShopifyOrder,
    skuLookup: SkuLookupFn,
    skipNoSku: boolean
): Promise<OrderLinesResult> {
    const lineItems = shopifyOrder.line_items || [];
    const shippingAddress = shopifyOrder.shipping_address;
    const orderLinesData: Prisma.OrderLineCreateWithoutOrderInput[] = [];

    for (const item of lineItems) {
        const shopifyVariantId = item.variant_id ? String(item.variant_id) : null;

        // Look up SKU using the provided lookup function
        const sku = await skuLookup(shopifyVariantId, item.sku || null);

        if (sku) {
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
    if (orderLinesData.length === 0 && skipNoSku) {
        return {
            orderLinesData: [],
            totalLineItems: lineItems.length,
            shouldSkip: true,
            skipReason: 'no_matching_skus',
        };
    }

    return {
        orderLinesData,
        totalLineItems: lineItems.length,
        shouldSkip: false,
    };
}

/**
 * Handle update for an existing order
 * Returns ProcessResult if update was performed or skipped, null to continue to creation
 */
async function handleExistingOrderUpdate(
    prisma: PrismaClient,
    existingOrder: OrderWithLines,
    orderData: OrderDataPayload,
    shopifyOrder: ExtendedShopifyOrder
): Promise<ProcessResult> {
    const { needsUpdate, changeType } = detectOrderChanges(existingOrder, orderData, shopifyOrder);

    if (needsUpdate) {
        await prisma.order.update({
            where: { id: existingOrder.id },
            data: orderData
        });

        // If order is being cancelled via Shopify, also cancel all order lines
        if (changeType === 'cancelled') {
            await prisma.orderLine.updateMany({
                where: {
                    orderId: existingOrder.id,
                    lineStatus: { not: 'cancelled' }
                },
                data: { lineStatus: 'cancelled' }
            });
        }

        const fulfillmentSync = await syncFulfillmentsToOrderLines(prisma, existingOrder.id, shopifyOrder);

        // Recompute order status from lines after any mutation
        await recomputeOrderStatus(existingOrder.id);

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

/**
 * Create new order with lines and post-processing
 */
async function createNewOrderWithLines(
    prisma: PrismaClient,
    orderData: OrderDataPayload,
    linesResult: OrderLinesResult,
    shopifyOrder: ExtendedShopifyOrder
): Promise<ProcessResult> {
    const newOrder = await prisma.order.create({
        data: {
            ...orderData,
            orderLines: {
                create: linesResult.orderLinesData
            }
        }
    });

    // Sync fulfillments to order lines if order came in already fulfilled
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

    // Defer draft invoice generation (non-critical, shouldn't block order creation)
    deferredExecutor.enqueue(
        async () => {
            try {
                await generateDraftInvoice(prisma, newOrder.id);
            } catch (err: unknown) {
                syncLogger.warn({
                    orderId: newOrder.id,
                    error: err instanceof Error ? err.message : 'Unknown error',
                }, 'Failed to generate draft invoice — can be retried via backfill');
            }
        },
        { orderId: newOrder.id, action: 'generate_draft_invoice' },
    );

    // Update customer stats: increment orderCount and update tier
    if (orderData.customerId) {
        await incrementCustomerOrderCount(prisma, orderData.customerId);
        if (orderData.totalAmount > 0) {
            await updateCustomerTier(prisma, orderData.customerId);
        }
    }

    return {
        action: 'created',
        orderId: newOrder.id,
        linesCreated: linesResult.orderLinesData.length,
        totalLineItems: linesResult.totalLineItems,
        fulfillmentSync: fulfillmentSync || undefined,
    };
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
    const orderNumber = shopifyOrder.name || String(shopifyOrder.order_number);

    // Check if order exists - first by shopifyOrderId, then by orderNumber
    const existingOrder = await prisma.order.findFirst({
        where: {
            OR: [
                { shopifyOrderId },
                ...(orderNumber ? [{ orderNumber }] : [])
            ]
        },
        include: { orderLines: true }
    });

    // Find or create customer
    const customerData = buildCustomerData(shopifyOrder.customer);
    const { customer: dbCustomer } = await findOrCreateCustomer(
        prisma,
        customerData,
        {
            shippingAddress: shopifyOrder.shipping_address as Record<string, unknown> | undefined,
            orderDate: new Date(shopifyOrder.created_at),
        }
    );
    const customerId = dbCustomer?.id || null;

    // Use shared helpers for status and tracking
    const status = determineOrderStatus(shopifyOrder, existingOrder);
    const tracking = extractOrderTrackingInfo(shopifyOrder, existingOrder);

    // Build order data using shared helper
    const orderData = buildOrderData(
        { shopifyOrder, existingOrder, customerId },
        status,
        tracking
    );

    // Handle existing order update
    if (existingOrder) {
        return handleExistingOrderUpdate(prisma, existingOrder, orderData, shopifyOrder);
    }

    // Create order lines with DB-based SKU lookup
    const dbSkuLookup: SkuLookupFn = async (variantId, skuCode) => {
        if (variantId) {
            const sku = await prisma.sku.findFirst({ where: { shopifyVariantId: variantId } });
            if (sku) return { id: sku.id };
        }
        if (skuCode) {
            const sku = await prisma.sku.findFirst({ where: { skuCode } });
            if (sku) return { id: sku.id };
        }
        return null;
    };

    const linesResult = await createOrderLinesData(shopifyOrder, dbSkuLookup, skipNoSku);

    // Handle skip case (batch processing with no matching SKUs)
    if (linesResult.shouldSkip) {
        return { action: 'skipped', reason: linesResult.skipReason };
    }

    // For webhooks (skipNoSku=false), allow empty orders for manual intervention
    return createNewOrderWithLines(prisma, orderData, linesResult, shopifyOrder);
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

// ============================================
// BATCH PROCESSING (OPTIMIZED)
// ============================================

/**
 * Batch processing context with pre-fetched data
 */
interface BatchContext {
    existingOrdersMap: Map<string, OrderWithLines>;
    skuByVariantId: Map<string, { id: string }>;
    skuByCode: Map<string, { id: string }>;
}

/**
 * Cache entry type for batch processing
 */
interface CacheEntryForBatch {
    id: string;
    rawData: string;
    orderNumber: string | null;
}

/**
 * Result of batch processing
 */
export interface BatchProcessResult {
    processed: number;
    succeeded: number;
    failed: number;
    errors: Array<{ orderNumber: string | null; error: string }>;
}

/**
 * Pre-fetch all data needed for batch processing
 * This reduces N+1 queries to a constant number of queries
 */
async function prefetchBatchContext(
    prisma: PrismaClient,
    cacheEntries: CacheEntryForBatch[]
): Promise<BatchContext> {
    // Parse all orders to extract IDs and SKU references
    const shopifyOrderIds: string[] = [];
    const orderNumbers: string[] = [];
    const variantIds = new Set<string>();
    const skuCodes = new Set<string>();

    for (const entry of cacheEntries) {
        try {
            const order = JSON.parse(entry.rawData) as ExtendedShopifyOrder;
            shopifyOrderIds.push(String(order.id));

            const orderNumber = order.name || String(order.order_number);
            if (orderNumber) orderNumbers.push(orderNumber);

            // Collect all variant IDs and SKU codes from line items
            for (const item of order.line_items || []) {
                if (item.variant_id) variantIds.add(String(item.variant_id));
                if (item.sku) skuCodes.add(item.sku);
            }
        } catch {
            // Skip malformed entries
        }
    }

    // Batch fetch existing orders (by shopifyOrderId OR orderNumber)
    const existingOrders = await prisma.order.findMany({
        where: {
            OR: [
                { shopifyOrderId: { in: shopifyOrderIds } },
                { orderNumber: { in: orderNumbers } }
            ]
        },
        include: { orderLines: true }
    });

    // Build lookup maps for existing orders
    const existingOrdersMap = new Map<string, OrderWithLines>();
    for (const order of existingOrders) {
        if (order.shopifyOrderId) {
            existingOrdersMap.set(`shopify:${order.shopifyOrderId}`, order);
        }
        if (order.orderNumber) {
            existingOrdersMap.set(`number:${order.orderNumber}`, order);
        }
    }

    // Batch fetch SKUs (by variant ID and SKU code)
    const [skusByVariant, skusByCode] = await Promise.all([
        variantIds.size > 0
            ? prisma.sku.findMany({
                where: { shopifyVariantId: { in: Array.from(variantIds) } },
                select: { id: true, shopifyVariantId: true }
            })
            : [],
        skuCodes.size > 0
            ? prisma.sku.findMany({
                where: { skuCode: { in: Array.from(skuCodes) } },
                select: { id: true, skuCode: true }
            })
            : []
    ]);

    // Build SKU lookup maps
    const skuByVariantId = new Map<string, { id: string }>();
    for (const sku of skusByVariant) {
        if (sku.shopifyVariantId) {
            skuByVariantId.set(sku.shopifyVariantId, { id: sku.id });
        }
    }

    const skuByCode = new Map<string, { id: string }>();
    for (const sku of skusByCode) {
        if (sku.skuCode) {
            skuByCode.set(sku.skuCode, { id: sku.id });
        }
    }

    return { existingOrdersMap, skuByVariantId, skuByCode };
}

/**
 * Process a single order using pre-fetched batch context
 * Optimized version that uses Maps instead of DB queries for lookups
 */
async function processOrderWithContext(
    prisma: PrismaClient,
    shopifyOrder: ExtendedShopifyOrder,
    context: BatchContext
): Promise<ProcessResult> {
    const shopifyOrderId = String(shopifyOrder.id);
    const orderNumber = shopifyOrder.name || String(shopifyOrder.order_number);

    // Look up existing order from pre-fetched map (O(1) instead of DB query)
    const existingOrder = context.existingOrdersMap.get(`shopify:${shopifyOrderId}`)
        || (orderNumber ? context.existingOrdersMap.get(`number:${orderNumber}`) : undefined)
        || null;

    // Find or create customer (this still does DB query, but is fast)
    const customerData = buildCustomerData(shopifyOrder.customer);
    const { customer: dbCustomer } = await findOrCreateCustomer(
        prisma,
        customerData,
        {
            shippingAddress: shopifyOrder.shipping_address as Record<string, unknown> | undefined,
            orderDate: new Date(shopifyOrder.created_at),
        }
    );
    const customerId = dbCustomer?.id || null;

    // Use shared helpers for status and tracking
    const status = determineOrderStatus(shopifyOrder, existingOrder);
    const tracking = extractOrderTrackingInfo(shopifyOrder, existingOrder);

    // Build order data using shared helper
    const orderData = buildOrderData(
        { shopifyOrder, existingOrder, customerId },
        status,
        tracking
    );

    // Handle existing order update
    if (existingOrder) {
        return handleExistingOrderUpdate(prisma, existingOrder, orderData, shopifyOrder);
    }

    // Create order lines with Map-based SKU lookup (O(1) per item)
    const mapSkuLookup: SkuLookupFn = async (variantId, skuCode) => {
        if (variantId) {
            const sku = context.skuByVariantId.get(variantId);
            if (sku) return sku;
        }
        if (skuCode) {
            const sku = context.skuByCode.get(skuCode);
            if (sku) return sku;
        }
        return null;
    };

    // Batch processing always skips orders with no matching SKUs
    const linesResult = await createOrderLinesData(shopifyOrder, mapSkuLookup, true);

    if (linesResult.shouldSkip) {
        return { action: 'skipped', reason: linesResult.skipReason };
    }

    return createNewOrderWithLines(prisma, orderData, linesResult, shopifyOrder);
}

/**
 * Process multiple cache entries in parallel with concurrency control
 *
 * OPTIMIZATIONS:
 * 1. Pre-fetches all existing orders in ONE query
 * 2. Pre-fetches all SKUs in TWO queries (by variant ID and code)
 * 3. Processes orders in parallel (configurable concurrency)
 *
 * @param prisma - Prisma client
 * @param entries - Cache entries to process
 * @param options - Processing options
 * @param options.concurrency - Max concurrent processing (default: 10)
 * @returns Batch processing results
 */
export async function processCacheBatch(
    prisma: PrismaClient,
    entries: CacheEntryForBatch[],
    options: { concurrency?: number } = {}
): Promise<BatchProcessResult> {
    const { concurrency = 10 } = options;

    if (entries.length === 0) {
        return { processed: 0, succeeded: 0, failed: 0, errors: [] };
    }

    // Step 1: Pre-fetch all needed data in batch
    const context = await prefetchBatchContext(prisma, entries);

    // Step 2: Process in parallel with concurrency control
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ orderNumber: string | null; error: string }> = [];

    // Process in chunks to control concurrency
    for (let i = 0; i < entries.length; i += concurrency) {
        const chunk = entries.slice(i, i + concurrency);

        const results = await Promise.allSettled(
            chunk.map(async (entry) => {
                const shopifyOrder = JSON.parse(entry.rawData) as ExtendedShopifyOrder;

                try {
                    const result = await processOrderWithContext(prisma, shopifyOrder, context);

                    // Mark as processed - including skipped orders so they don't get re-processed
                    if (result.action !== 'cache_only') {
                        await markCacheProcessed(prisma, entry.id);
                    }

                    return { success: true, orderNumber: entry.orderNumber };
                } catch (err) {
                    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
                    await markCacheError(prisma, entry.id, errorMsg);
                    return { success: false, orderNumber: entry.orderNumber, error: errorMsg };
                }
            })
        );

        // Collect results
        for (const result of results) {
            if (result.status === 'fulfilled') {
                if (result.value.success) {
                    succeeded++;
                } else {
                    failed++;
                    if (errors.length < 50) {
                        errors.push({
                            orderNumber: result.value.orderNumber,
                            error: result.value.error || 'Unknown'
                        });
                    }
                }
            } else {
                failed++;
                if (errors.length < 50) {
                    errors.push({ orderNumber: null, error: result.reason?.message || 'Unknown' });
                }
            }
        }
    }

    return {
        processed: entries.length,
        succeeded,
        failed,
        errors
    };
}
