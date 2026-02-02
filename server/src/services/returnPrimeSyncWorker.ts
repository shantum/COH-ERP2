/**
 * Return Prime Sync Retry Worker
 *
 * Background worker that retries failed outbound syncs to Return Prime.
 * Runs periodically to pick up lines with sync errors and retry them.
 */

import prisma from '../lib/prisma.js';
import { getReturnPrimeClient } from './returnPrime.js';

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
        console.log('[ReturnPrimeSyncWorker] Already running, skipping');
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
                returnPrimeRequestId: true,
                returnStatus: true,
                returnCondition: true,
                returnConditionNotes: true,
                returnReceivedAt: true,
                returnPrimeSyncError: true,
            },
            orderBy: {
                returnRequestedAt: 'asc', // Oldest first
            },
        });

        if (failedLines.length === 0) {
            return results;
        }

        console.log(`[ReturnPrimeSyncWorker] Found ${failedLines.length} lines to retry`);

        const rpClient = await getReturnPrimeClient();

        if (!rpClient.isConfigured()) {
            console.warn('[ReturnPrimeSyncWorker] Return Prime client not configured, skipping');
            return results;
        }

        for (const line of failedLines) {
            results.attempted++;

            try {
                // Only sync received status for now
                if (line.returnStatus === 'received' && line.returnPrimeRequestId) {
                    await rpClient.updateRequestStatus(line.returnPrimeRequestId, 'received', {
                        received_at: line.returnReceivedAt?.toISOString(),
                        condition: line.returnCondition || undefined,
                        notes: line.returnConditionNotes || undefined,
                    });

                    // Clear error and update sync timestamp
                    await prisma.orderLine.update({
                        where: { id: line.id },
                        data: {
                            returnPrimeSyncedAt: new Date(),
                            returnPrimeSyncError: null,
                        },
                    });

                    results.succeeded++;
                    console.log(`[ReturnPrimeSyncWorker] Successfully synced line ${line.id}`);
                }
            } catch (error) {
                results.failed++;
                const message = error instanceof Error ? error.message : 'Unknown error';

                // Update error message but don't clear syncedAt (for retry delay)
                await prisma.orderLine.update({
                    where: { id: line.id },
                    data: {
                        returnPrimeSyncError: `Retry failed: ${message}`.slice(0, 500),
                        returnPrimeSyncedAt: new Date(), // Update to delay next retry
                    },
                });

                console.warn(`[ReturnPrimeSyncWorker] Failed to sync line ${line.id}: ${message}`);
            }
        }

        console.log(`[ReturnPrimeSyncWorker] Completed: ${results.succeeded}/${results.attempted} succeeded`);

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ReturnPrimeSyncWorker] Worker error:', message);
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
        console.log('[ReturnPrimeSyncWorker] Already started');
        return;
    }

    console.log(`[ReturnPrimeSyncWorker] Starting with ${RETRY_INTERVAL_MS / 1000}s interval`);

    // Run immediately on start
    retryFailedReturnPrimeSyncs().catch(err => {
        console.error('[ReturnPrimeSyncWorker] Initial run error:', err);
    });

    // Then run on interval
    retryInterval = setInterval(() => {
        retryFailedReturnPrimeSyncs().catch(err => {
            console.error('[ReturnPrimeSyncWorker] Interval run error:', err);
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
        console.log('[ReturnPrimeSyncWorker] Stopped');
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
