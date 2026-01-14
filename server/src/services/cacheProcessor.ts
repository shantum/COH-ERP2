/**
 * Background Cache Processor
 *
 * Continuously processes pending ShopifyOrderCache entries to ERP tables.
 * Runs automatically in the background, checking for new entries every interval.
 *
 * FEATURES:
 * - Auto-starts on server boot (if enabled)
 * - Processes in batches with parallel execution
 * - Backs off when queue is empty
 * - Graceful shutdown support
 *
 * CONFIGURATION:
 * - POLL_INTERVAL_MS: How often to check for pending entries (default: 30s)
 * - BATCH_SIZE: Max entries per batch (default: 200)
 * - CONCURRENCY: Parallel processing within batch (default: 10)
 * - IDLE_BACKOFF_MS: Wait time when queue is empty (default: 60s)
 */

import prisma from '../lib/prisma.js';
import { processCacheBatch } from './shopifyOrderProcessor.js';
import { syncLogger } from '../utils/logger.js';
import shutdownCoordinator from '../utils/shutdownCoordinator.js';

// ============================================
// CONFIGURATION
// ============================================

/** How often to poll for pending entries (30 seconds) */
const POLL_INTERVAL_MS = 30 * 1000;

/** Max entries to process per batch */
const BATCH_SIZE = 200;

/** Parallel processing concurrency */
const CONCURRENCY = 10;

/** Backoff when queue is empty (60 seconds) */
const IDLE_BACKOFF_MS = 60 * 1000;

/** Max consecutive errors before pausing */
const MAX_CONSECUTIVE_ERRORS = 5;

/** Pause duration after max errors (5 minutes) */
const ERROR_PAUSE_MS = 5 * 60 * 1000;

// ============================================
// STATE
// ============================================

interface ProcessorStats {
    totalProcessed: number;
    totalSucceeded: number;
    totalFailed: number;
    batchesRun: number;
    lastBatchAt: Date | null;
    lastBatchSize: number;
    lastBatchDurationMs: number;
    ordersPerSecond: number;
    consecutiveErrors: number;
    lastError: string | null;
}

let isRunning = false;
let isPaused = false;
let pollTimeout: NodeJS.Timeout | null = null;
let startedAt: Date | null = null;

const stats: ProcessorStats = {
    totalProcessed: 0,
    totalSucceeded: 0,
    totalFailed: 0,
    batchesRun: 0,
    lastBatchAt: null,
    lastBatchSize: 0,
    lastBatchDurationMs: 0,
    ordersPerSecond: 0,
    consecutiveErrors: 0,
    lastError: null,
};

// ============================================
// CORE PROCESSING LOOP
// ============================================

/**
 * Process one batch of pending cache entries
 */
async function processBatch(): Promise<{ processed: number; isEmpty: boolean }> {
    // Check for pending entries
    const entries = await prisma.shopifyOrderCache.findMany({
        where: {
            processedAt: null,
            processingError: null
        },
        orderBy: { lastWebhookAt: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, rawData: true, orderNumber: true }
    });

    if (entries.length === 0) {
        return { processed: 0, isEmpty: true };
    }

    const startTime = Date.now();

    // Process batch using optimized function
    const result = await processCacheBatch(prisma, entries, { concurrency: CONCURRENCY });

    const durationMs = Date.now() - startTime;
    const ordersPerSecond = result.processed > 0 ? result.processed / (durationMs / 1000) : 0;

    // Update stats
    stats.totalProcessed += result.processed;
    stats.totalSucceeded += result.succeeded;
    stats.totalFailed += result.failed;
    stats.batchesRun++;
    stats.lastBatchAt = new Date();
    stats.lastBatchSize = result.processed;
    stats.lastBatchDurationMs = durationMs;
    stats.ordersPerSecond = ordersPerSecond;

    if (result.failed > 0 && result.errors.length > 0) {
        stats.lastError = result.errors[0].error;
    }

    syncLogger.info({
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
        durationMs,
        ordersPerSecond: ordersPerSecond.toFixed(1)
    }, 'Cache processor: batch completed');

    return { processed: result.processed, isEmpty: false };
}

/**
 * Main processing loop
 */
async function runLoop(): Promise<void> {
    if (!isRunning || isPaused) return;

    try {
        const result = await processBatch();

        // Reset error counter on success
        if (result.processed > 0) {
            stats.consecutiveErrors = 0;
        }

        // Schedule next run
        if (isRunning && !isPaused) {
            const delay = result.isEmpty ? IDLE_BACKOFF_MS : POLL_INTERVAL_MS;
            pollTimeout = setTimeout(runLoop, delay);

            if (result.isEmpty) {
                syncLogger.debug({ nextCheckInSeconds: delay / 1000 }, 'Cache processor: queue empty, backing off');
            }
        }
    } catch (error) {
        stats.consecutiveErrors++;
        stats.lastError = error instanceof Error ? error.message : String(error);

        syncLogger.error({
            error: stats.lastError,
            consecutiveErrors: stats.consecutiveErrors
        }, 'Cache processor: batch error');

        // Pause if too many consecutive errors
        if (stats.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            syncLogger.warn({
                pauseMinutes: ERROR_PAUSE_MS / 60000
            }, 'Cache processor: too many errors, pausing');

            isPaused = true;
            setTimeout(() => {
                isPaused = false;
                stats.consecutiveErrors = 0;
                if (isRunning) {
                    syncLogger.info('Cache processor: resuming after error pause');
                    runLoop();
                }
            }, ERROR_PAUSE_MS);
        } else if (isRunning && !isPaused) {
            // Retry with backoff
            pollTimeout = setTimeout(runLoop, IDLE_BACKOFF_MS);
        }
    }
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Start the background cache processor
 */
function start(): void {
    if (isRunning) {
        syncLogger.debug('Cache processor already running');
        return;
    }

    isRunning = true;
    isPaused = false;
    startedAt = new Date();

    syncLogger.info({
        pollIntervalSeconds: POLL_INTERVAL_MS / 1000,
        batchSize: BATCH_SIZE,
        concurrency: CONCURRENCY
    }, 'Cache processor: starting');

    // Register shutdown handler
    shutdownCoordinator.register('cacheProcessor', async () => {
        syncLogger.info('Cache processor: shutting down gracefully');
        stop();
    });

    // Start the loop
    runLoop();
}

/**
 * Stop the background cache processor
 */
function stop(): void {
    if (!isRunning) return;

    isRunning = false;
    isPaused = false;

    if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
    }

    syncLogger.info('Cache processor: stopped');
}

/**
 * Pause processing (keeps running but skips batches)
 */
function pause(): void {
    if (!isRunning) return;
    isPaused = true;
    syncLogger.info('Cache processor: paused');
}

/**
 * Resume processing after pause
 */
function resume(): void {
    if (!isRunning) return;
    if (!isPaused) return;

    isPaused = false;
    stats.consecutiveErrors = 0;
    syncLogger.info('Cache processor: resumed');
    runLoop();
}

/**
 * Get current status and stats
 */
function getStatus(): {
    isRunning: boolean;
    isPaused: boolean;
    startedAt: Date | null;
    config: {
        pollIntervalSeconds: number;
        batchSize: number;
        concurrency: number;
        idleBackoffSeconds: number;
    };
    stats: ProcessorStats;
    pendingCount?: number;
} {
    return {
        isRunning,
        isPaused,
        startedAt,
        config: {
            pollIntervalSeconds: POLL_INTERVAL_MS / 1000,
            batchSize: BATCH_SIZE,
            concurrency: CONCURRENCY,
            idleBackoffSeconds: IDLE_BACKOFF_MS / 1000,
        },
        stats: { ...stats },
    };
}

/**
 * Get status with pending count (async)
 */
async function getStatusWithPending(): Promise<ReturnType<typeof getStatus> & { pendingCount: number }> {
    const status = getStatus();
    const pendingCount = await prisma.shopifyOrderCache.count({
        where: { processedAt: null, processingError: null }
    });
    return { ...status, pendingCount };
}

/**
 * Trigger an immediate batch (doesn't wait for poll interval)
 */
async function triggerBatch(): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (!isRunning) {
        throw new Error('Cache processor is not running. Call start() first.');
    }

    syncLogger.info('Cache processor: manual batch triggered');

    // Cancel pending poll and run immediately
    if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
    }

    const result = await processBatch();

    // Schedule next regular poll
    if (isRunning && !isPaused) {
        const delay = result.isEmpty ? IDLE_BACKOFF_MS : POLL_INTERVAL_MS;
        pollTimeout = setTimeout(runLoop, delay);
    }

    return {
        processed: result.processed,
        succeeded: stats.lastBatchSize > 0 ? stats.totalSucceeded : 0,
        failed: stats.totalFailed
    };
}

// ============================================
// EXPORTS
// ============================================

export const cacheProcessor = {
    start,
    stop,
    pause,
    resume,
    getStatus,
    getStatusWithPending,
    triggerBatch,
};

export default cacheProcessor;
