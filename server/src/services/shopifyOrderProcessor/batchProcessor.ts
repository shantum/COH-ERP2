/**
 * Batch processing for Shopify orders from cache
 * Optimized with pre-fetched data to reduce N+1 queries
 *
 * @module services/shopifyOrderProcessor/batchProcessor
 */

import type { PrismaClient } from '@prisma/client';
import { findOrCreateCustomer } from '../../utils/customerUtils.js';
import { markCacheProcessed, markCacheError } from './cacheManager.js';
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
    OrderWithLines,
    BatchContext,
    CacheEntryForBatch,
    BatchProcessResult,
    ProcessResult,
    SkuLookupFn,
} from './types.js';

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
