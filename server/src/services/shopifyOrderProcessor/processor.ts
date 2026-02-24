/**
 * Core order processing - single source of truth for Shopify -> ERP order processing
 *
 * CACHE-FIRST PATTERN (critical for reliability):
 * 1. Always cache raw Shopify data FIRST via cacheShopifyOrders()
 * 2. Then process to ERP via processShopifyOrderToERP()
 * 3. If processing fails, order is still cached for retry
 * 4. Webhook/Sync can re-process from cache later without re-fetching Shopify
 *
 * @module services/shopifyOrderProcessor/processor
 */

import type { PrismaClient } from '@prisma/client';
import { findOrCreateCustomer } from '../../utils/customerUtils.js';
import { withOrderLock } from '../../utils/orderLock.js';
import { syncLogger } from '../../utils/logger.js';
import { cacheShopifyOrders, markCacheProcessed, markCacheError } from './cacheManager.js';
import {
    buildCustomerData,
    determineOrderStatus,
    extractOrderTrackingInfo,
    buildOrderData,
    handleExistingOrderUpdate,
    createOrderLinesData,
    createNewOrderWithLines,
} from './orderBuilder.js';
import type {
    ExtendedShopifyOrder,
    ProcessResult,
    ProcessOptions,
    CacheAndProcessOptions,
    LockResult,
    SkuLookupFn,
} from './types.js';

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
