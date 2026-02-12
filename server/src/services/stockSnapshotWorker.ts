/**
 * Stock Snapshot Worker
 *
 * Manages monthly stock snapshot computation.
 * Manual trigger only — no scheduled interval (snapshots are monthly).
 *
 * Exports: start(), stop(), getStatus(), triggerSnapshot(), triggerBackfill()
 */

import { computeAndSaveMonth, backfillAll, type ComputeResult, type BackfillResult } from './stockSnapshotCompute.js';
import { snapshotLogger } from '../utils/logger.js';
import { nowIST } from '../utils/dateHelpers.js';
import { trackWorkerRun } from '../utils/workerRunTracker.js';

// ============================================
// MODULE STATE
// ============================================

let isRunning = false;
let lastRunAt: Date | null = null;
let lastRunResult: ComputeResult | BackfillResult | null = null;

// ============================================
// FUNCTIONS
// ============================================

/**
 * Compute last completed month's snapshot
 */
async function runSnapshot(): Promise<ComputeResult | null> {
    if (isRunning) {
        snapshotLogger.warn('Snapshot already running, skipping');
        return null;
    }

    isRunning = true;
    try {
        const ist = nowIST();
        // Last completed month
        let year = ist.getUTCFullYear();
        let month = ist.getUTCMonth(); // 0-based = previous month (1-based)
        if (month === 0) {
            month = 12;
            year--;
        }

        const result = await computeAndSaveMonth(year, month);
        lastRunAt = new Date();
        lastRunResult = result;
        return result;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        snapshotLogger.error({ error: message }, 'Snapshot trigger failed');
        return null;
    } finally {
        isRunning = false;
    }
}

/**
 * Run full backfill of all historical months
 */
async function runBackfill(): Promise<BackfillResult | null> {
    if (isRunning) {
        snapshotLogger.warn('Snapshot already running, skipping backfill');
        return null;
    }

    isRunning = true;
    try {
        const result = await backfillAll();
        lastRunAt = new Date();
        lastRunResult = result;
        return result;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        snapshotLogger.error({ error: message }, 'Backfill trigger failed');
        return null;
    } finally {
        isRunning = false;
    }
}

/**
 * Start — no-op for manual-only worker (satisfies worker pattern)
 */
function start(): void {
    snapshotLogger.info('Stock snapshot worker registered (manual trigger only)');
}

/**
 * Stop — no-op for manual-only worker
 */
function stop(): void {
    snapshotLogger.info('Stock snapshot worker stopped');
}

/**
 * Get worker status
 */
function getStatus() {
    return {
        isRunning,
        schedulerActive: false, // Manual trigger only
        lastRunAt,
        lastRunResult,
    };
}

/**
 * Manually trigger snapshot for last completed month
 */
async function triggerSnapshot(): Promise<ComputeResult | null> {
    return trackWorkerRun('stock_snapshot', runSnapshot, 'manual');
}

/**
 * Manually trigger full backfill
 */
async function triggerBackfill(): Promise<BackfillResult | null> {
    return trackWorkerRun('stock_snapshot_backfill', runBackfill, 'manual');
}

// ============================================
// EXPORTS
// ============================================

export default {
    start,
    stop,
    getStatus,
    triggerSnapshot,
    triggerBackfill,
};
