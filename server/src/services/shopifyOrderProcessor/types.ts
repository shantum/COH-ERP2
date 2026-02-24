/**
 * Type definitions for Shopify Order Processor
 * @module services/shopifyOrderProcessor/types
 */

import type { Prisma } from '@prisma/client';
import type { ShopifyOrder, ShopifyFulfillment } from '../shopify/index.js';

// ============================================
// SHOPIFY EXTENSIONS
// ============================================

/**
 * Extended Shopify fulfillment with additional fields
 * Extends the base ShopifyFulfillment with fields used in processing
 */
export interface ExtendedShopifyFulfillment extends ShopifyFulfillment {
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
export interface ExtendedShopifyOrder extends Omit<ShopifyOrder, 'fulfillments'> {
    fulfillments?: ExtendedShopifyFulfillment[];
}

// ============================================
// PUBLIC TYPES (exported from index)
// ============================================

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
 * Result of batch processing
 */
export interface BatchProcessResult {
    processed: number;
    succeeded: number;
    failed: number;
    errors: Array<{ orderNumber: string | null; error: string }>;
}

// ============================================
// INTERNAL TYPES (used across modules)
// ============================================

/**
 * Result of withOrderLock operation
 */
export interface LockResult {
    skipped: boolean;
    result?: ProcessResult;
}

/**
 * Order with orderLines relation
 */
export type OrderWithLines = Prisma.OrderGetPayload<{
    include: { orderLines: true };
}>;

/**
 * SKU lookup abstraction for DB queries or Map lookups
 * Returns { id: string } to match Prisma's minimal select pattern
 */
export type SkuLookupFn = (variantId: string | null, skuCode: string | null) => Promise<{ id: string } | null>;

/**
 * Context for building order data
 */
export interface OrderBuildContext {
    shopifyOrder: ExtendedShopifyOrder;
    existingOrder: OrderWithLines | null;
    customerId: string | null;
}

/**
 * Result of order line creation
 */
export interface OrderLinesResult {
    orderLinesData: Prisma.OrderLineCreateWithoutOrderInput[];
    totalLineItems: number;
    shouldSkip: boolean;
    skipReason?: string;
}

/**
 * Result of change detection
 */
export interface ChangeDetectionResult {
    needsUpdate: boolean;
    changeType: ProcessResult['action'];
}

/**
 * Tracking info extracted from fulfillments
 */
export interface TrackingInfo {
    awbNumber: string | null;
    courier: string | null;
    shippedAt: Date | null;
}

/**
 * Order data object built for create/update operations
 * Note: awbNumber, courier, shippedAt are now on OrderLine, not Order
 */
export interface OrderDataPayload {
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
    paymentGateway: string | null;
    syncedAt: Date;
    // Prepaid settlement fields (set at import for prepaid orders)
    paymentStatus?: string;
    paymentConfirmedAt?: Date | null;
    settledAt?: Date | null;
    settlementAmount?: number | null;
    settlementRef?: string | null;
}

/**
 * Batch processing context with pre-fetched data
 */
export interface BatchContext {
    existingOrdersMap: Map<string, OrderWithLines>;
    skuByVariantId: Map<string, { id: string }>;
    skuByCode: Map<string, { id: string }>;
}

/**
 * Cache entry type for batch processing
 */
export interface CacheEntryForBatch {
    id: string;
    rawData: string;
    orderNumber: string | null;
}
