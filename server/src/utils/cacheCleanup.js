/**
 * Cache Cleanup Utilities
 *
 * Scheduled cleanup of stale cache entries to prevent database bloat.
 * Should be run periodically (e.g., daily) via cron or scheduler.
 */

import prisma from '../lib/prisma.js';

// Default retention periods (in days)
const DEFAULT_ORDER_CACHE_RETENTION_DAYS = 180; // 6 months
const DEFAULT_PRODUCT_CACHE_RETENTION_DAYS = 90; // 3 months
const DEFAULT_WEBHOOK_LOG_RETENTION_DAYS = 30; // 1 month
const DEFAULT_FAILED_SYNC_RETENTION_DAYS = 14; // 2 weeks after resolution

/**
 * Clean up old ShopifyOrderCache entries
 *
 * Removes cache entries that:
 * - Have been processed AND are older than retention period
 * - Are not linked to any active order (orphaned cache)
 *
 * @param {number} retentionDays - How many days to keep cache entries
 * @returns {Object} - { deletedCount, errors }
 */
export async function cleanupOrderCache(retentionDays = DEFAULT_ORDER_CACHE_RETENTION_DAYS) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    console.log(`[CacheCleanup] Cleaning ShopifyOrderCache older than ${retentionDays} days (before ${cutoffDate.toISOString()})`);

    try {
        // Delete old processed cache entries that are not linked to active orders
        const result = await prisma.shopifyOrderCache.deleteMany({
            where: {
                AND: [
                    { processedAt: { not: null } },
                    { lastWebhookAt: { lt: cutoffDate } },
                    // Only delete if the linked order is archived or doesn't exist
                    {
                        OR: [
                            { order: null },
                            { order: { isArchived: true } }
                        ]
                    }
                ]
            }
        });

        console.log(`[CacheCleanup] Deleted ${result.count} old ShopifyOrderCache entries`);
        return { deletedCount: result.count, errors: [] };
    } catch (error) {
        console.error('[CacheCleanup] Error cleaning order cache:', error.message);
        return { deletedCount: 0, errors: [error.message] };
    }
}

/**
 * Clean up old ShopifyProductCache entries
 *
 * @param {number} retentionDays - How many days to keep cache entries
 * @returns {Object} - { deletedCount, errors }
 */
export async function cleanupProductCache(retentionDays = DEFAULT_PRODUCT_CACHE_RETENTION_DAYS) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    console.log(`[CacheCleanup] Cleaning ShopifyProductCache older than ${retentionDays} days`);

    try {
        const result = await prisma.shopifyProductCache.deleteMany({
            where: {
                AND: [
                    { processedAt: { not: null } },
                    { lastWebhookAt: { lt: cutoffDate } }
                ]
            }
        });

        console.log(`[CacheCleanup] Deleted ${result.count} old ShopifyProductCache entries`);
        return { deletedCount: result.count, errors: [] };
    } catch (error) {
        console.error('[CacheCleanup] Error cleaning product cache:', error.message);
        return { deletedCount: 0, errors: [error.message] };
    }
}

/**
 * Clean up old WebhookLog entries
 *
 * @param {number} retentionDays - How many days to keep logs
 * @returns {Object} - { deletedCount, errors }
 */
export async function cleanupWebhookLogs(retentionDays = DEFAULT_WEBHOOK_LOG_RETENTION_DAYS) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    console.log(`[CacheCleanup] Cleaning WebhookLog older than ${retentionDays} days`);

    try {
        const result = await prisma.webhookLog.deleteMany({
            where: {
                receivedAt: { lt: cutoffDate }
            }
        });

        console.log(`[CacheCleanup] Deleted ${result.count} old WebhookLog entries`);
        return { deletedCount: result.count, errors: [] };
    } catch (error) {
        console.error('[CacheCleanup] Error cleaning webhook logs:', error.message);
        return { deletedCount: 0, errors: [error.message] };
    }
}

/**
 * Clean up resolved FailedSyncItem entries
 *
 * @param {number} retentionDays - How many days to keep resolved items
 * @returns {Object} - { deletedCount, errors }
 */
export async function cleanupFailedSyncItems(retentionDays = DEFAULT_FAILED_SYNC_RETENTION_DAYS) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    console.log(`[CacheCleanup] Cleaning resolved FailedSyncItem older than ${retentionDays} days`);

    try {
        const result = await prisma.failedSyncItem.deleteMany({
            where: {
                AND: [
                    { status: { in: ['resolved', 'abandoned'] } },
                    { updatedAt: { lt: cutoffDate } }
                ]
            }
        });

        console.log(`[CacheCleanup] Deleted ${result.count} resolved FailedSyncItem entries`);
        return { deletedCount: result.count, errors: [] };
    } catch (error) {
        console.error('[CacheCleanup] Error cleaning failed sync items:', error.message);
        return { deletedCount: 0, errors: [error.message] };
    }
}

/**
 * Clean up old completed SyncJob entries
 *
 * @param {number} retentionDays - How many days to keep job records
 * @returns {Object} - { deletedCount, errors }
 */
export async function cleanupSyncJobs(retentionDays = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    console.log(`[CacheCleanup] Cleaning completed SyncJob older than ${retentionDays} days`);

    try {
        const result = await prisma.syncJob.deleteMany({
            where: {
                AND: [
                    { status: { in: ['completed', 'failed', 'cancelled'] } },
                    { completedAt: { lt: cutoffDate } }
                ]
            }
        });

        console.log(`[CacheCleanup] Deleted ${result.count} old SyncJob entries`);
        return { deletedCount: result.count, errors: [] };
    } catch (error) {
        console.error('[CacheCleanup] Error cleaning sync jobs:', error.message);
        return { deletedCount: 0, errors: [error.message] };
    }
}

/**
 * Run all cache cleanup tasks
 *
 * @param {Object} options - Custom retention periods
 * @returns {Object} - Combined results
 */
export async function runAllCleanup(options = {}) {
    console.log('[CacheCleanup] Starting full cleanup...');
    const startTime = Date.now();

    const results = {
        orderCache: await cleanupOrderCache(options.orderCacheRetentionDays),
        productCache: await cleanupProductCache(options.productCacheRetentionDays),
        webhookLogs: await cleanupWebhookLogs(options.webhookLogRetentionDays),
        failedSyncItems: await cleanupFailedSyncItems(options.failedSyncRetentionDays),
        syncJobs: await cleanupSyncJobs(options.syncJobRetentionDays),
    };

    const totalDeleted = Object.values(results).reduce((sum, r) => sum + r.deletedCount, 0);
    const totalErrors = Object.values(results).reduce((sum, r) => sum + r.errors.length, 0);
    const duration = Date.now() - startTime;

    console.log(`[CacheCleanup] Completed in ${duration}ms. Deleted ${totalDeleted} entries, ${totalErrors} errors.`);

    return {
        ...results,
        summary: {
            totalDeleted,
            totalErrors,
            durationMs: duration,
        }
    };
}

/**
 * Get cache statistics for monitoring
 *
 * @returns {Object} - Cache entry counts by type
 */
export async function getCacheStats() {
    const [orderCacheCount, productCacheCount, webhookLogCount, failedSyncCount, syncJobCount] = await Promise.all([
        prisma.shopifyOrderCache.count(),
        prisma.shopifyProductCache.count(),
        prisma.webhookLog.count(),
        prisma.failedSyncItem.count(),
        prisma.syncJob.count({ where: { status: { in: ['completed', 'failed', 'cancelled'] } } }),
    ]);

    // Get counts by age
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [oldOrderCache, oldProductCache, oldWebhookLogs] = await Promise.all([
        prisma.shopifyOrderCache.count({ where: { lastWebhookAt: { lt: thirtyDaysAgo } } }),
        prisma.shopifyProductCache.count({ where: { lastWebhookAt: { lt: thirtyDaysAgo } } }),
        prisma.webhookLog.count({ where: { receivedAt: { lt: thirtyDaysAgo } } }),
    ]);

    return {
        orderCache: { total: orderCacheCount, olderThan30Days: oldOrderCache },
        productCache: { total: productCacheCount, olderThan30Days: oldProductCache },
        webhookLogs: { total: webhookLogCount, olderThan30Days: oldWebhookLogs },
        failedSyncItems: { total: failedSyncCount },
        syncJobs: { total: syncJobCount },
    };
}
