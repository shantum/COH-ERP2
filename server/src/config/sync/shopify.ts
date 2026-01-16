/**
 * Shopify Sync Configuration
 *
 * Defines all settings and rules for syncing data with Shopify.
 * Includes batch sizes, concurrency limits, and sync behavior rules.
 *
 * TO CHANGE SHOPIFY SYNC SETTINGS:
 * Simply update the values below. Changes take effect on next sync.
 */

// ============================================
// API SETTINGS
// ============================================

/**
 * Number of items to fetch per batch from Shopify API
 */
export const SHOPIFY_BATCH_SIZE = 50;

/**
 * Maximum concurrent requests to Shopify API
 *
 * Shopify has rate limits - keep this low to avoid 429 errors.
 */
export const SHOPIFY_CONCURRENCY_LIMIT = 5;

/**
 * Maximum products to fetch with metafields in preview mode
 */
export const SHOPIFY_PREVIEW_METAFIELD_LIMIT = 20;

// ============================================
// SYNC TIMING
// ============================================

/**
 * Default number of days to look back when syncing orders
 */
export const SHOPIFY_LOOKBACK_DAYS = 30;

// ============================================
// ORDER UPDATE RULES
// ============================================

/**
 * Fields that trigger an order update when changed
 *
 * When syncing from Shopify, if any of these fields differ between
 * the Shopify data and ERP data, the order is updated.
 */
export const ORDER_UPDATE_TRIGGER_FIELDS = [
    'status',
    'awbNumber',
    'courier',
    'paymentMethod',
    'customerEmail',
    'customerPhone',
    'totalAmount',
    'shippingAddress',
] as const;

export type OrderUpdateTriggerField = typeof ORDER_UPDATE_TRIGGER_FIELDS[number];

// ============================================
// CUSTOMER SYNC RULES
// ============================================

/**
 * Skip customers with no orders during sync
 */
export const SKIP_CUSTOMERS_WITHOUT_ORDERS = true;

/**
 * Require email for customer sync (skip if missing)
 */
export const REQUIRE_CUSTOMER_EMAIL = true;

// ============================================
// CACHE SETTINGS
// ============================================

/**
 * Days before cache entries are considered stale
 */
export const SHOPIFY_CACHE_STALE_DAYS = 90;

/**
 * Batch size for cache cleanup operations
 */
export const SHOPIFY_CACHE_CLEANUP_BATCH_SIZE = 100;

// ============================================
// CONSOLIDATED EXPORT
// ============================================

/**
 * All Shopify sync configuration in one object
 */
export const SHOPIFY_SYNC = {
    /** API settings */
    batchSize: SHOPIFY_BATCH_SIZE,
    concurrencyLimit: SHOPIFY_CONCURRENCY_LIMIT,
    previewMetafieldLimit: SHOPIFY_PREVIEW_METAFIELD_LIMIT,

    /** Sync timing */
    lookbackDays: SHOPIFY_LOOKBACK_DAYS,

    /** Order update rules */
    updateTriggerFields: ORDER_UPDATE_TRIGGER_FIELDS,

    /** Customer sync rules */
    skipCustomersWithoutOrders: SKIP_CUSTOMERS_WITHOUT_ORDERS,
    requireCustomerEmail: REQUIRE_CUSTOMER_EMAIL,

    /** Cache settings */
    cacheStaleDays: SHOPIFY_CACHE_STALE_DAYS,
    cacheCleanupBatchSize: SHOPIFY_CACHE_CLEANUP_BATCH_SIZE,
} as const;

// ============================================
// SYNC WORKER CONFIGURATION
// ============================================

/**
 * Configuration for sync worker modes
 *
 * - deep: Full sync with all data
 * - incremental: Quick sync for recent changes
 */
export const SYNC_WORKER_CONFIG = {
    deep: {
        /** Orders per batch */
        batchSize: 250,
        /** Delay between batches (ms) */
        batchDelay: 1500,
        /** Garbage collection interval (batches) */
        gcInterval: 3,
        /** Prisma disconnect interval (batches) */
        disconnectInterval: 5,
    },
    incremental: {
        /** Orders per batch */
        batchSize: 250,
        /** Delay between batches (ms) */
        batchDelay: 500,
        /** Garbage collection interval (batches) */
        gcInterval: 10,
        /** Prisma disconnect interval (batches) */
        disconnectInterval: 20,
    },
    /** Maximum errors before aborting sync */
    maxErrors: 20,
} as const;

/**
 * Full dump configuration for bulk Shopify imports
 */
export const FULL_DUMP_CONFIG = {
    /** Items per batch */
    batchSize: 250,
    /** Delay between batches (ms) */
    batchDelay: 100,
    /** Stop after N consecutive small batches */
    maxConsecutiveSmallBatches: 3,
} as const;
