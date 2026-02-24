/**
 * Shopify Order Processor - Single source of truth for order processing
 *
 * CACHE-FIRST PATTERN (critical for reliability):
 * 1. Always cache raw Shopify data FIRST via cacheShopifyOrders()
 * 2. Then process to ERP via processShopifyOrderToERP()
 * 3. If processing fails, order is still cached for retry
 * 4. Webhook/Sync can re-process from cache later without re-fetching Shopify
 *
 * @module services/shopifyOrderProcessor
 */

// Types
export type {
    CachePayload,
    ProcessResult,
    FulfillmentSyncResult,
    ProcessOptions,
    CacheAndProcessOptions,
    BatchProcessResult,
} from './types.js';

// Cache management
export { cacheShopifyOrders, markCacheProcessed, markCacheError } from './cacheManager.js';

// Fulfillment sync
export { syncFulfillmentsToOrderLines } from './fulfillmentSync.js';

// Core processing
export { processShopifyOrderToERP, processFromCache, cacheAndProcessOrder } from './processor.js';

// Batch processing
export { processCacheBatch } from './batchProcessor.js';
