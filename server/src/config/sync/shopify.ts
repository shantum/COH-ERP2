/**
 * Shopify Sync Configuration
 *
 * Defines settings for sync workers and bulk imports.
 *
 * TO CHANGE SHOPIFY SYNC SETTINGS:
 * Simply update the values below. Changes take effect on next sync.
 */

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
