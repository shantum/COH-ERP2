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
import { cacheShopifyOrders, processCacheBatch } from './shopifyOrderProcessor.js';
import prisma from '../lib/prisma.js';
import { syncLogger } from '../utils/logger.js';
import { trackWorkerRun } from '../utils/workerRunTracker.js';

// ============================================
// TYPES & INTERFACES
// ============================================

/**
 * Error information for a failed order
 */
interface OrderError {
    orderNumber: string;
    error: string;
}

/**
 * Result of step 1: dumping orders from Shopify to cache
 */
interface DumpResult {
    fetched: number;
    cached: number;
    skipped: number;
}

/**
 * Result of step 2: processing cached orders to ERP
 */
interface ProcessResult {
    found: number;
    processed: number;
    failed: number;
    errors?: OrderError[];
}

/**
 * Complete result of a sync run
 */
interface SyncResult {
    startedAt: string;
    step1_dump: DumpResult | null;
    step2_process: ProcessResult | null;
    durationMs: number;
    error: string | null;
}

/**
 * Current status of the sync scheduler
 */
interface SyncStatus {
    isRunning: boolean;
    schedulerActive: boolean;
    intervalMinutes: number;
    lookbackHours: number;
    lastSyncAt: Date | null;
    lastSyncResult: SyncResult | null;
}

// ============================================
// CONFIGURATION
// ============================================

// Sync interval in milliseconds (1 hour)
const SYNC_INTERVAL_MS = 60 * 60 * 1000;

// How far back to look for orders (24 hours)
const LOOKBACK_HOURS = 24;

// ============================================
// STATE MANAGEMENT
// ============================================

let syncInterval: NodeJS.Timeout | null = null;
let isRunning = false;
let lastSyncAt: Date | null = null;
let lastSyncResult: SyncResult | null = null;

// ============================================
// CORE SYNC LOGIC
// ============================================

/**
 * Run the hourly sync
 */
async function runHourlySync(): Promise<SyncResult | null> {
    if (isRunning) {
        syncLogger.debug('Scheduled sync already in progress, skipping');
        return null;
    }

    isRunning = true;
    const startTime = Date.now();

    const result: SyncResult = {
        startedAt: new Date().toISOString(),
        step1_dump: null,
        step2_process: null,
        durationMs: 0,
        error: null
    };

    try {
        syncLogger.info('Starting hourly sync');

        // Reload Shopify config
        await shopifyClient.loadFromDatabase();

        if (!shopifyClient.isConfigured()) {
            syncLogger.warn('Shopify not configured, skipping sync');
            result.error = 'Shopify not configured';
            return result;
        }

        // Step 1: Dump last 24 hours from Shopify to cache
        syncLogger.info({ lookbackHours: LOOKBACK_HOURS }, 'Step 1: Fetching recent orders');

        const since = new Date();
        since.setHours(since.getHours() - LOOKBACK_HOURS);

        const orders = await shopifyClient.getAllOrders(
            (fetched, total) => {
                if (fetched % 50 === 0) {
                    syncLogger.debug({ fetched, total }, 'Fetching progress');
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
                await cacheShopifyOrders(prisma, order, 'scheduled_sync');
                cached++;
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                syncLogger.error({ orderName: order.name, error: errorMessage }, 'Error caching order');
                skipped++;
            }
        }

        result.step1_dump = {
            fetched: orders.length,
            cached,
            skipped
        };
        syncLogger.info({ cached, skipped }, 'Step 1 complete');

        // Step 2: Process any unprocessed cache entries (using optimized batch processor)
        syncLogger.info('Step 2: Processing unprocessed cache entries (batch mode)');

        const unprocessed = await prisma.shopifyOrderCache.findMany({
            where: { processedAt: null, processingError: null },
            orderBy: { lastWebhookAt: 'asc' },
            take: 500,
            select: { id: true, rawData: true, orderNumber: true }
        });

        if (unprocessed.length > 0) {
            const batchResult = await processCacheBatch(prisma, unprocessed, { concurrency: 10 });

            const errors: OrderError[] = batchResult.errors.slice(0, 5).map(e => ({
                orderNumber: e.orderNumber || 'unknown',
                error: e.error
            }));

            result.step2_process = {
                found: unprocessed.length,
                processed: batchResult.succeeded,
                failed: batchResult.failed,
                errors: errors.length > 0 ? errors : undefined
            };
            syncLogger.info({ processed: batchResult.succeeded, failed: batchResult.failed }, 'Step 2 complete');
        } else {
            result.step2_process = {
                found: 0,
                processed: 0,
                failed: 0
            };
            syncLogger.info('Step 2 complete: no unprocessed entries');
        }

        result.durationMs = Date.now() - startTime;
        lastSyncAt = new Date();
        lastSyncResult = result;

        syncLogger.info({ durationMs: result.durationMs }, 'Hourly sync completed');

        return result;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        syncLogger.error({ error: errorMessage }, 'Scheduled sync failed');
        result.error = errorMessage;
        result.durationMs = Date.now() - startTime;
        lastSyncResult = result;
        return result;
    } finally {
        isRunning = false;
    }
}

// ============================================
// SCHEDULER CONTROL
// ============================================

/**
 * Start the scheduled sync
 */
function start(): void {
    if (syncInterval) {
        syncLogger.debug('Scheduler already running');
        return;
    }

    syncLogger.info({ intervalMinutes: SYNC_INTERVAL_MS / 1000 / 60 }, 'Starting scheduler');

    // Run immediately on start
    trackWorkerRun('shopify_sync', runHourlySync, 'startup').catch(() => {});

    // Then run every hour
    syncInterval = setInterval(() => {
        trackWorkerRun('shopify_sync', runHourlySync, 'scheduled').catch(() => {});
    }, SYNC_INTERVAL_MS);
}

/**
 * Stop the scheduled sync
 */
function stop(): void {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        syncLogger.info('Scheduler stopped');
    }
}

/**
 * Get sync status
 */
function getStatus(): SyncStatus {
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
async function triggerSync(): Promise<SyncResult | null> {
    return trackWorkerRun('shopify_sync', runHourlySync, 'manual');
}

// ============================================
// EXPORTS
// ============================================

export default {
    start,
    stop,
    getStatus,
    triggerSync,
    runHourlySync
};

export type {
    SyncResult,
    SyncStatus,
    DumpResult,
    ProcessResult,
    OrderError
};
