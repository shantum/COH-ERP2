/**
 * Scheduled Sync Service
 *
 * Runs hourly to ensure Shopify data is always in sync:
 * 1. Full dump of last 24 hours from Shopify -> Cache
 * 2. Process any unprocessed cache entries -> ERP
 *
 * This catches any orders that webhooks might have missed.
 */

import shopifyClient from './shopify.js';
import { cacheShopifyOrder, processFromCache, markCacheProcessed, markCacheError } from './shopifyOrderProcessor.js';
import prisma from '../lib/prisma.js';

// Sync interval in milliseconds (1 hour)
const SYNC_INTERVAL_MS = 60 * 60 * 1000;

// How far back to look for orders (24 hours)
const LOOKBACK_HOURS = 24;

let syncInterval = null;
let isRunning = false;
let lastSyncAt = null;
let lastSyncResult = null;

/**
 * Run the hourly sync
 */
async function runHourlySync() {
    if (isRunning) {
        console.log('[Scheduled Sync] Sync already in progress, skipping...');
        return null;
    }

    isRunning = true;
    const startTime = Date.now();

    const result = {
        startedAt: new Date().toISOString(),
        step1_dump: null,
        step2_process: null,
        durationMs: 0,
        error: null
    };

    try {
        console.log('[Scheduled Sync] Starting hourly sync...');

        // Reload Shopify config
        await shopifyClient.loadFromDatabase();

        if (!shopifyClient.isConfigured()) {
            console.log('[Scheduled Sync] Shopify not configured, skipping sync');
            result.error = 'Shopify not configured';
            return result;
        }

        // Step 1: Dump last 24 hours from Shopify to cache
        console.log(`[Scheduled Sync] Step 1: Fetching orders from last ${LOOKBACK_HOURS} hours...`);

        const since = new Date();
        since.setHours(since.getHours() - LOOKBACK_HOURS);

        const orders = await shopifyClient.getAllOrders(
            (fetched, total) => {
                if (fetched % 50 === 0) {
                    console.log(`[Scheduled Sync] Fetched ${fetched}/${total} orders...`);
                }
            },
            {
                status: 'any',
                created_at_min: since.toISOString()
            }
        );

        let cached = 0;
        let skipped = 0;

        for (const order of orders) {
            try {
                await cacheShopifyOrder(prisma, String(order.id), order, 'scheduled_sync');
                cached++;
            } catch (err) {
                console.error(`[Scheduled Sync] Error caching ${order.name}:`, err.message);
                skipped++;
            }
        }

        result.step1_dump = {
            fetched: orders.length,
            cached,
            skipped
        };
        console.log(`[Scheduled Sync] Step 1 complete: ${cached} cached, ${skipped} skipped`);

        // Step 2: Process any unprocessed cache entries
        console.log('[Scheduled Sync] Step 2: Processing unprocessed cache entries...');

        const unprocessed = await prisma.shopifyOrderCache.findMany({
            where: { processedAt: null },
            orderBy: { lastWebhookAt: 'asc' },
            take: 500 // Process up to 500 at a time
        });

        let processed = 0;
        let failed = 0;
        const errors = [];

        for (const entry of unprocessed) {
            try {
                await processFromCache(prisma, entry);
                await markCacheProcessed(prisma, entry.id);
                processed++;
            } catch (err) {
                await markCacheError(prisma, entry.id, err.message);
                failed++;
                if (errors.length < 5) {
                    errors.push({ orderNumber: entry.orderNumber, error: err.message });
                }
            }
        }

        result.step2_process = {
            found: unprocessed.length,
            processed,
            failed,
            errors: errors.length > 0 ? errors : undefined
        };
        console.log(`[Scheduled Sync] Step 2 complete: ${processed} processed, ${failed} failed`);

        result.durationMs = Date.now() - startTime;
        lastSyncAt = new Date();
        lastSyncResult = result;

        console.log(`[Scheduled Sync] Completed in ${Math.round(result.durationMs / 1000)}s`);

        return result;
    } catch (error) {
        console.error('[Scheduled Sync] Error:', error);
        result.error = error.message;
        result.durationMs = Date.now() - startTime;
        lastSyncResult = result;
        return result;
    } finally {
        isRunning = false;
    }
}

/**
 * Start the scheduled sync
 */
function start() {
    if (syncInterval) {
        console.log('[Scheduled Sync] Already running');
        return;
    }

    console.log(`[Scheduled Sync] Starting scheduler (every ${SYNC_INTERVAL_MS / 1000 / 60} minutes)`);

    // Run immediately on start
    runHourlySync();

    // Then run every hour
    syncInterval = setInterval(runHourlySync, SYNC_INTERVAL_MS);
}

/**
 * Stop the scheduled sync
 */
function stop() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        console.log('[Scheduled Sync] Stopped');
    }
}

/**
 * Get sync status
 */
function getStatus() {
    return {
        isRunning,
        schedulerActive: !!syncInterval,
        intervalMinutes: SYNC_INTERVAL_MS / 1000 / 60,
        lookbackHours: LOOKBACK_HOURS,
        lastSyncAt,
        lastSyncResult
    };
}

/**
 * Manually trigger a sync
 */
async function triggerSync() {
    return runHourlySync();
}

export default {
    start,
    stop,
    getStatus,
    triggerSync,
    runHourlySync
};
