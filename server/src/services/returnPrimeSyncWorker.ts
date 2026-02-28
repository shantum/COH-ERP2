/**
 * Return Prime Sync Retry Worker
 *
 * Background worker that retries failed outbound syncs to Return Prime.
 * Runs periodically to pick up lines with sync errors and retry them.
 */

import prisma from '../lib/prisma.js';
import { syncReturnPrimeStatus } from '../utils/returnPrimeSync.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'returnprime-sync-worker' });

// ============================================
// CONSTANTS
// ============================================

const RETRY_BATCH_SIZE = 50;
const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRY_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============================================
// WORKER STATE
// ============================================

let retryInterval: NodeJS.Timeout | null = null;
let isRunning = false;

// ============================================
// RETRY LOGIC
// ============================================

/**
 * Retry failed Return Prime syncs
 * Picks up lines with sync errors and attempts to sync them again
 */
export async function retryFailedReturnPrimeSyncs(): Promise<{
    attempted: number;
    succeeded: number;
    failed: number;
}> {
    if (isRunning) {
        log.info('Already running, skipping');
        return { attempted: 0, succeeded: 0, failed: 0 };
    }

    isRunning = true;
    const results = { attempted: 0, succeeded: 0, failed: 0 };

    try {
        // Find lines with sync errors that haven't been retried recently
        const failedLines = await prisma.orderLine.findMany({
            where: {
                returnPrimeSyncError: { not: null },
                returnPrimeRequestId: { not: null },
                // Only retry syncable statuses
                returnStatus: { in: ['inspected', 'refunded', 'cancelled', 'rejected'] },
                // Don't retry too frequently - wait at least RETRY_INTERVAL since last sync attempt
                OR: [
                    { returnPrimeSyncedAt: null },
                    {
                        returnPrimeSyncedAt: {
                            lt: new Date(Date.now() - RETRY_INTERVAL_MS),
                        },
                    },
                ],
                // Don't retry lines older than MAX_RETRY_AGE
                returnRequestedAt: {
                    gt: new Date(Date.now() - MAX_RETRY_AGE_MS),
                },
            },
            take: RETRY_BATCH_SIZE,
            select: {
                id: true,
                returnStatus: true,
                returnPrimeSyncError: true,
            },
            orderBy: {
                returnRequestedAt: 'asc', // Oldest first
            },
        });

        if (failedLines.length === 0) {
            return results;
        }

        log.info({ count: failedLines.length }, 'Found lines to retry');

        for (const line of failedLines) {
            results.attempted++;

            try {
                // syncReturnPrimeStatus is fire-and-forget but we want to track results,
                // so we call it and trust it updates DB fields (syncedAt / syncError)
                syncReturnPrimeStatus(line.id, line.returnStatus || '');
                results.succeeded++;
            } catch (err) {
                log.error({ orderLineId: line.id, err }, 'Return Prime sync dispatch failed');
                results.failed++;
            }
        }

        log.info({ succeeded: results.succeeded, attempted: results.attempted }, 'Retry batch dispatched');

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ error: message }, 'Worker error');
    } finally {
        isRunning = false;
    }

    return results;
}

// ============================================
// WORKER CONTROL
// ============================================

/**
 * Start the retry worker
 */
export function startReturnPrimeSyncWorker(): void {
    if (retryInterval) {
        log.info('Already started');
        return;
    }

    log.info({ intervalSeconds: RETRY_INTERVAL_MS / 1000 }, 'Starting worker');

    // Run immediately on start
    retryFailedReturnPrimeSyncs().catch(err => {
        log.error({ err }, 'Initial run error');
    });

    // Then run on interval
    retryInterval = setInterval(() => {
        retryFailedReturnPrimeSyncs().catch(err => {
            log.error({ err }, 'Interval run error');
        });
    }, RETRY_INTERVAL_MS);
}

/**
 * Stop the retry worker
 */
export function stopReturnPrimeSyncWorker(): void {
    if (retryInterval) {
        clearInterval(retryInterval);
        retryInterval = null;
        log.info('Stopped');
    }
}

/**
 * Get worker status
 */
export function getReturnPrimeSyncWorkerStatus(): {
    running: boolean;
    intervalMs: number;
} {
    return {
        running: !!retryInterval,
        intervalMs: RETRY_INTERVAL_MS,
    };
}

export default {
    start: startReturnPrimeSyncWorker,
    stop: stopReturnPrimeSyncWorker,
    retry: retryFailedReturnPrimeSyncs,
    status: getReturnPrimeSyncWorkerStatus,
};
