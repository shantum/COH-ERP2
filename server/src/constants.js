/**
 * Application-wide constants
 * Extracted from various files to improve maintainability
 */

// ============================================
// INVENTORY CONSTANTS
// ============================================

/**
 * Default fabric consumption when not specified at SKU or product level
 */
export const DEFAULT_FABRIC_CONSUMPTION = 1.5;

/**
 * Number of days of stock to maintain before reordering
 */
export const STOCK_ALERT_THRESHOLD_DAYS = 30;

/**
 * Lead time for fabric orders (days)
 */
export const DEFAULT_FABRIC_LEAD_TIME_DAYS = 14;

// ============================================
// ORDER CONSTANTS
// ============================================

/**
 * Number of days after delivery before auto-archiving orders
 */
export const AUTO_ARCHIVE_DAYS = 90;

/**
 * Days in RTO before showing warning status
 */
export const RTO_WARNING_DAYS = 3;

/**
 * Days in RTO before showing urgent status
 */
export const RTO_URGENT_DAYS = 7;

/**
 * Days in transit before showing delivery delayed status
 */
export const DELIVERY_DELAYED_DAYS = 7;

// ============================================
// SHOPIFY SYNC CONSTANTS
// ============================================

/**
 * Number of items to fetch per batch from Shopify
 */
export const SHOPIFY_BATCH_SIZE = 50;

/**
 * Maximum concurrent requests to Shopify API
 */
export const SHOPIFY_CONCURRENCY_LIMIT = 5;

/**
 * Maximum products to fetch with metafields in preview
 */
export const SHOPIFY_PREVIEW_METAFIELD_LIMIT = 20;

// ============================================
// TRACKING CONSTANTS
// ============================================

/**
 * Interval between automatic tracking syncs (hours)
 */
export const TRACKING_SYNC_INTERVAL_HOURS = 4;

/**
 * Maximum AWBs that can be tracked in a single batch request
 */
export const TRACKING_BATCH_MAX_AWBS = 10;

// ============================================
// COD REMITTANCE CONSTANTS
// ============================================

/**
 * Tolerance percentage for amount mismatch before flagging for manual review
 */
export const COD_AMOUNT_MISMATCH_TOLERANCE_PCT = 5;

// ============================================
// PAGINATION CONSTANTS
// ============================================

/**
 * Default number of items per page
 */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Maximum number of items per page
 */
export const MAX_PAGE_SIZE = 1000;

/**
 * Default limit for list endpoints
 */
export const DEFAULT_LIST_LIMIT = 50;

// ============================================
// FILE UPLOAD CONSTANTS
// ============================================

/**
 * Maximum file size for CSV uploads (bytes)
 */
export const MAX_CSV_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Allowed file extensions for CSV uploads
 */
export const ALLOWED_CSV_EXTENSIONS = ['.csv'];

// ============================================
// CACHE CLEANUP CONSTANTS
// ============================================

/**
 * Age in days before cache entries are considered stale
 */
export const CACHE_STALE_DAYS = 90;

/**
 * Number of cache entries to process per batch during cleanup
 */
export const CACHE_CLEANUP_BATCH_SIZE = 100;

// ============================================
// SYNC WORKER CONSTANTS
// ============================================

/**
 * Configuration for sync worker modes
 */
export const SYNC_WORKER_CONFIG = {
    deep: {
        batchSize: 250,
        batchDelay: 1500,
        gcInterval: 3,
        disconnectInterval: 5
    },
    incremental: {
        batchSize: 250,
        batchDelay: 500,
        gcInterval: 10,
        disconnectInterval: 20
    },
    maxErrors: 20,
};

// ============================================
// ORDER LOCK CONSTANTS
// ============================================

/**
 * Order lock configuration for preventing race conditions
 */
export const ORDER_LOCK_CONFIG = {
    timeoutMs: parseInt(process.env.ORDER_LOCK_TIMEOUT_MS || '90000', 10),
};

// ============================================
// FULL DUMP CONSTANTS
// ============================================

/**
 * Configuration for Shopify full dump operations
 */
export const FULL_DUMP_CONFIG = {
    batchSize: 250,
    batchDelay: 100,
    maxConsecutiveSmallBatches: 3,
};

// ============================================
// CIRCUIT BREAKER CONSTANTS
// ============================================

/**
 * Circuit breaker configuration for API failure protection
 */
export const CIRCUIT_BREAKER_CONFIG = {
    failureThreshold: 5,
    resetTimeoutMs: 60000,
    halfOpenMaxRequests: 3,
};
