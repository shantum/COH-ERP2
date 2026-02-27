/**
 * Unified cycle runners — runInwardCycle, runOutwardCycle, start, stop, getStatus, getBufferCounts
 */

import prisma from '../../lib/prisma.js';
import { sheetsLogger } from '../../utils/logger.js';
import {
    readRange,
    protectRowsWithWarning,
    removeOurProtections,
    getSheetId,
} from '../googleSheetsClient.js';
import {
    ENABLE_SHEET_OFFLOAD,
    ENABLE_AUTO_INGEST,
    ENABLE_AUTO_OUTWARD,
    AUTO_INGEST_HOUR_IST,
    AUTO_INGEST_MINUTE_IST,
    AUTO_INGEST_REPORT_EMAIL,
    ORDERS_MASTERSHEET_ID,
    LIVE_TABS,
    INWARD_LIVE_COLS,
    OUTWARD_LIVE_COLS,
    INGESTED_PREFIX,
} from '../../config/sync/sheets/index.js';
import type {
    IngestInwardResult,
    IngestOutwardResult,
    MoveShippedResult,
    OffloadStatus,
    BalanceSnapshot,
    StepTracker,
} from './state.js';
import {
    schedulerActive,
    setSchedulerActive,
    ingestInwardState,
    ingestOutwardState,
    moveShippedState,
    cleanupDoneState,
    migrateFormulasState,
    pushBalancesState,
    pushFabricBalancesState,
    importFabricBalancesState,
    fabricInwardState,
    cycleProgress,
    initCycleSteps,
    getStep,
    stepStart,
    stepDone,
    stepFailed,
    stepSkipped,
    skipRemainingSteps,
    finishCycle,
    getCycleProgress,
    resetCycleProgress,
} from './state.js';
import {
    invalidateCaches,
    pushRecentRun,
} from './helpers.js';
import { ingestInwardLive } from './inward.js';
import { ingestOutwardLive, linkOutwardToOrders, triggerMoveShipped } from './outward.js';
import {
    readInventorySnapshot,
    compareSnapshots,
    updateSheetBalances,
    pushBalancesCore,
    cleanupSingleTab,
} from './balances.js';

// ============================================
// BUFFER ROW COUNTS (for admin UI)
// ============================================

export async function getBufferCounts(): Promise<{ inward: number; outward: number }> {
    try {
        const [inwardRows, outwardRows] = await Promise.all([
            readRange(ORDERS_MASTERSHEET_ID, `'${LIVE_TABS.INWARD}'!A:J`),
            readRange(ORDERS_MASTERSHEET_ID, `'${LIVE_TABS.OUTWARD}'!A:AG`),
        ]);

        // Only count rows where SKU exists AND status is not DONE
        const countActive = (rows: unknown[][], skuIdx: number, statusIdx: number) =>
            rows.length <= 1 ? 0 : rows.slice(1).filter(r =>
                String((r as string[])[skuIdx] ?? '').trim() &&
                !String((r as string[])[statusIdx] ?? '').trim().startsWith(INGESTED_PREFIX)
            ).length;

        return {
            inward: countActive(inwardRows, INWARD_LIVE_COLS.SKU, INWARD_LIVE_COLS.IMPORT_ERRORS),
            outward: countActive(outwardRows, OUTWARD_LIVE_COLS.SKU, OUTWARD_LIVE_COLS.IMPORT_ERRORS),
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        sheetsLogger.error({ error: message }, 'Failed to get buffer counts');
        return { inward: -1, outward: -1 };
    }
}

// ============================================
// AUTO-INGEST DAILY SCHEDULER
// ============================================

let autoIngestCheckInterval: ReturnType<typeof setInterval> | null = null;

/** Date string (YYYY-MM-DD in IST) of the last successful auto-ingest run */
let lastAutoIngestDate: string | null = null;

/** Get current date string in IST */
function getIstDateStr(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}

/** Get current hour and minute in IST */
function getIstTime(): { hour: number; minute: number } {
    const parts = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false }).split(':');
    return { hour: Number(parts[0]), minute: Number(parts[1]) };
}

/** Run the full daily pipeline: inward → move-shipped → outward → combined email report */
async function runDailyPipeline(): Promise<void> {
    const todayStr = getIstDateStr();
    sheetsLogger.info({ date: todayStr }, 'Daily pipeline: starting');

    // 1. Inward cycle
    const inwardResult = await runInwardCycle();

    // 2. Move-shipped + Outward (if enabled)
    let moveResult: MoveShippedResult | null = null;
    let outwardResult: IngestOutwardResult | null = null;

    if (ENABLE_AUTO_OUTWARD) {
        // Move shipped rows from "Orders from COH" → "Outward (Live)"
        try {
            sheetsLogger.info('Daily pipeline: starting move-shipped');
            moveResult = await triggerMoveShipped();
        } catch (err: unknown) {
            sheetsLogger.error(
                { error: err instanceof Error ? err.message : String(err) },
                'Daily pipeline: move-shipped failed (non-fatal, continuing to outward)'
            );
        }

        // Outward ingestion from "Outward (Live)" → DB
        try {
            sheetsLogger.info('Daily pipeline: starting outward cycle');
            outwardResult = await runOutwardCycle();
        } catch (err: unknown) {
            sheetsLogger.error(
                { error: err instanceof Error ? err.message : String(err) },
                'Daily pipeline: outward cycle failed (non-fatal)'
            );
        }
    } else {
        sheetsLogger.info('Daily pipeline: outward auto-ingest disabled (ENABLE_AUTO_OUTWARD=false)');
    }

    // Mark as run for today regardless of outcome (avoid infinite retry loops)
    lastAutoIngestDate = todayStr;

    // 3. Send combined email report
    try {
        const { sendCustomerEmail, renderDailyReport } = await import('../email/index.js');

        const dateDisplay = new Date().toLocaleDateString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });

        const { html, text, subject } = renderDailyReport({
            date: dateDisplay,

            // Inward
            inwardIngested: inwardResult.inwardIngested,
            inwardSkipped: inwardResult.skipped,
            inwardRowsMarkedDone: inwardResult.rowsMarkedDone,
            inwardSkusUpdated: inwardResult.skusUpdated,
            inwardErrors: inwardResult.errors,
            inwardDurationMs: inwardResult.durationMs,
            inwardValidationErrors: inwardResult.inwardValidationErrors ?? {},
            inwardBalancePassed: inwardResult.balanceVerification?.passed ?? null,
            inwardBalanceDrifted: inwardResult.balanceVerification?.drifted ?? 0,
            inwardErrorMessage: inwardResult.error,
            fabricConsumption: inwardResult.fabricConsumption,

            // Move Shipped
            moveShippedRowsFound: moveResult?.shippedRowsFound ?? 0,
            moveShippedSkipped: moveResult?.skippedRows ?? 0,
            moveShippedSkipReasons: moveResult?.skipReasons ?? {},
            moveShippedWritten: moveResult?.rowsWrittenToOutward ?? 0,
            moveShippedVerified: moveResult?.rowsVerified ?? 0,
            moveShippedDeleted: moveResult?.rowsDeletedFromOrders ?? 0,
            moveShippedErrors: moveResult?.errors ?? [],
            moveShippedDurationMs: moveResult?.durationMs ?? 0,

            // Outward
            outwardIngested: outwardResult?.outwardIngested ?? 0,
            outwardLinked: outwardResult?.ordersLinked ?? 0,
            outwardSkipped: outwardResult?.skipped ?? 0,
            outwardErrors: outwardResult?.errors ?? 0,
            outwardDurationMs: outwardResult?.durationMs ?? 0,
            outwardSkipReasons: outwardResult?.outwardSkipReasons,
            outwardBalancePassed: outwardResult?.balanceVerification?.passed ?? null,
            outwardBalanceDrifted: outwardResult?.balanceVerification?.drifted ?? 0,
            outwardErrorMessage: outwardResult?.error ?? null,
        });

        await sendCustomerEmail({
            to: AUTO_INGEST_REPORT_EMAIL,
            subject,
            html,
            text,
            templateKey: 'daily_pipeline_report',
        });

        sheetsLogger.info({
            to: AUTO_INGEST_REPORT_EMAIL,
            inward: inwardResult.inwardIngested,
            outward: outwardResult?.outwardIngested ?? 0,
            moved: moveResult?.rowsWrittenToOutward ?? 0,
        }, 'Daily pipeline report email sent');
    } catch (emailErr: unknown) {
        sheetsLogger.error(
            { error: emailErr instanceof Error ? emailErr.message : String(emailErr) },
            'Failed to send daily pipeline report email (non-fatal)'
        );
    }

    sheetsLogger.info({ date: todayStr }, 'Daily pipeline: complete');
}

// ============================================
// PUBLIC API
// ============================================

export function start(): void {
    if (!ENABLE_SHEET_OFFLOAD) {
        sheetsLogger.info('Sheet offload worker disabled (ENABLE_SHEET_OFFLOAD != true)');
        return;
    }

    if (schedulerActive) {
        sheetsLogger.debug('Offload scheduler already running');
        return;
    }

    setSchedulerActive(true);

    if (ENABLE_AUTO_INGEST) {
        sheetsLogger.info(
            { scheduleIST: `${AUTO_INGEST_HOUR_IST}:${String(AUTO_INGEST_MINUTE_IST).padStart(2, '0')}`, reportTo: AUTO_INGEST_REPORT_EMAIL },
            'Auto-ingest enabled — checking every minute for scheduled time'
        );

        // Check every 60s if it's time to run. If the server was down at the scheduled time,
        // it will catch up as soon as it's back online (runs if past schedule + not run today).
        autoIngestCheckInterval = setInterval(() => {
            const today = getIstDateStr();
            if (lastAutoIngestDate === today) return; // already ran today

            const { hour, minute } = getIstTime();
            const isPastSchedule = hour > AUTO_INGEST_HOUR_IST ||
                (hour === AUTO_INGEST_HOUR_IST && minute >= AUTO_INGEST_MINUTE_IST);

            if (!isPastSchedule) return; // not yet time

            // Time to run — fire and forget (concurrency guards in cycle runners handle overlap)
            runDailyPipeline().catch(err => {
                sheetsLogger.error({ error: err instanceof Error ? err.message : String(err) }, 'Daily pipeline run failed');
            });
        }, 60_000);
    } else {
        sheetsLogger.info('Sheet offload worker ready (manual trigger only, auto-ingest disabled)');
    }
}

export function stop(): void {
    if (autoIngestCheckInterval) {
        clearInterval(autoIngestCheckInterval);
        autoIngestCheckInterval = null;
    }
    setSchedulerActive(false);
    sheetsLogger.info('Sheet offload worker stopped');
}

export function getStatus(): OffloadStatus {
    return {
        ingestInward: {
            isRunning: ingestInwardState.isRunning,
            lastRunAt: ingestInwardState.lastRunAt,
            lastResult: ingestInwardState.lastResult,
            recentRuns: [...ingestInwardState.recentRuns],
        },
        ingestOutward: {
            isRunning: ingestOutwardState.isRunning,
            lastRunAt: ingestOutwardState.lastRunAt,
            lastResult: ingestOutwardState.lastResult,
            recentRuns: [...ingestOutwardState.recentRuns],
        },
        moveShipped: {
            isRunning: moveShippedState.isRunning,
            lastRunAt: moveShippedState.lastRunAt,
            lastResult: moveShippedState.lastResult,
            recentRuns: [...moveShippedState.recentRuns],
        },
        cleanupDone: {
            isRunning: cleanupDoneState.isRunning,
            lastRunAt: cleanupDoneState.lastRunAt,
            lastResult: cleanupDoneState.lastResult,
            recentRuns: [...cleanupDoneState.recentRuns],
        },
        migrateFormulas: {
            isRunning: migrateFormulasState.isRunning,
            lastRunAt: migrateFormulasState.lastRunAt,
            lastResult: migrateFormulasState.lastResult,
            recentRuns: [...migrateFormulasState.recentRuns],
        },
        pushBalances: {
            isRunning: pushBalancesState.isRunning,
            lastRunAt: pushBalancesState.lastRunAt,
            lastResult: pushBalancesState.lastResult,
            recentRuns: [...pushBalancesState.recentRuns],
        },
        pushFabricBalances: {
            isRunning: pushFabricBalancesState.isRunning,
            lastRunAt: pushFabricBalancesState.lastRunAt,
            lastResult: pushFabricBalancesState.lastResult,
            recentRuns: [...pushFabricBalancesState.recentRuns],
        },
        importFabricBalances: {
            isRunning: importFabricBalancesState.isRunning,
            lastRunAt: importFabricBalancesState.lastRunAt,
            lastResult: importFabricBalancesState.lastResult,
            recentRuns: [...importFabricBalancesState.recentRuns],
        },
        fabricInward: {
            isRunning: fabricInwardState.isRunning,
            lastRunAt: fabricInwardState.lastRunAt,
            lastResult: fabricInwardState.lastResult,
            recentRuns: [...fabricInwardState.recentRuns],
        },
        schedulerActive,
    };
}

// ============================================
// UNIFIED CYCLE RUNNERS
// ============================================

export async function runInwardCycle(): Promise<IngestInwardResult> {
    // Guard against ALL concurrent operations
    if (cycleProgress.isRunning || ingestInwardState.isRunning || ingestOutwardState.isRunning || pushBalancesState.isRunning || cleanupDoneState.isRunning) {
        return {
            startedAt: new Date().toISOString(),
            inwardIngested: 0, skipped: 0, rowsMarkedDone: 0, skusUpdated: 0,
            errors: 0, durationMs: 0,
            error: 'Another cycle or sheet job is already running',
            inwardValidationErrors: {},
        };
    }

    const cycleStart = Date.now();
    initCycleSteps('inward');
    ingestInwardState.isRunning = true;

    const result: IngestInwardResult = {
        startedAt: new Date().toISOString(),
        inwardIngested: 0,
        skipped: 0,
        rowsMarkedDone: 0,
        skusUpdated: 0,
        errors: 0,
        durationMs: 0,
        error: null,
        inwardValidationErrors: {},
    };

    const tracker: StepTracker = {
        start: stepStart,
        done: stepDone,
        fail: stepFailed,
    };

    try {
        // PRE-FLIGHT 1: Balance check
        let s = stepStart('Balance check');
        let beforeSnapshot: BalanceSnapshot | null = null;
        try {
            beforeSnapshot = await readInventorySnapshot();
            stepDone('Balance check', s, `${beforeSnapshot.rowCount} SKUs read`);
        } catch (err: unknown) {
            stepFailed('Balance check', s, err instanceof Error ? err.message : 'Unknown error');
        }

        // PRE-FLIGHT 2: Read current balances
        s = stepStart('CSV backup');
        try {
            const skus = await prisma.sku.findMany({
                select: { skuCode: true, currentBalance: true },
            });
            stepDone('CSV backup', s, `${skus.length} SKUs read`);
        } catch (err: unknown) {
            stepFailed('CSV backup', s, err instanceof Error ? err.message : 'Unknown error');
        }

        // PRE-FLIGHT 3: Push balances
        s = stepStart('Push balances');
        try {
            const pushResult = await pushBalancesCore();
            stepDone('Push balances', s, `${pushResult.skusUpdated} updated`);
        } catch (err: unknown) {
            stepFailed('Push balances', s, err instanceof Error ? err.message : 'Unknown error');
        }

        // PRE-FLIGHT 4: DB health check (fatal)
        s = stepStart('DB health check');
        try {
            await prisma.$queryRaw`SELECT 1`;
            stepDone('DB health check', s, 'OK');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            stepFailed('DB health check', s, msg);
            skipRemainingSteps();
            result.error = `DB health check failed: ${msg}`;
            result.durationMs = Date.now() - cycleStart;
            finishCycle(cycleStart);
            return result;
        }

        // IMPORT: Read + Validate + DB write + Mark DONE
        // Step tracking happens inside ingestInwardLive via the tracker
        const affectedSkuIds = await ingestInwardLive(result, tracker);

        // Mark any import steps still pending as skipped (e.g. early return with no data)
        for (const name of ['Read sheet rows', 'Validate rows', 'DB write', 'Mark DONE', 'Protect DONE rows']) {
            const step = getStep(name);
            if (step && step.status === 'pending') step.status = 'skipped';
        }

        // POST-FLIGHT: Push updated balances
        s = stepStart('Push updated balances');
        try {
            if (affectedSkuIds.size > 0) {
                await updateSheetBalances(affectedSkuIds, result);
            }
            if (result.inwardIngested > 0) {
                invalidateCaches();
            }
            stepDone('Push updated balances', s, `${result.skusUpdated} updated`);
        } catch (err: unknown) {
            stepFailed('Push updated balances', s, err instanceof Error ? err.message : 'Unknown error');
        }

        // POST-FLIGHT: Verify balances
        s = stepStart('Verify balances');
        try {
            if (beforeSnapshot && result.inwardIngested > 0) {
                await new Promise(resolve => setTimeout(resolve, 8000));
                const afterSnapshot = await readInventorySnapshot();
                const verification = compareSnapshots(beforeSnapshot, afterSnapshot);
                result.balanceVerification = verification;
                stepDone('Verify balances', s, verification.passed ? 'Passed' : `${verification.drifted} drifted`);
            } else {
                stepSkipped('Verify balances', 'No changes to verify');
            }
        } catch (err: unknown) {
            stepFailed('Verify balances', s, err instanceof Error ? err.message : 'Unknown error');
        }

        // POST-FLIGHT: Cleanup DONE rows (inward tab only)
        s = stepStart('Cleanup DONE rows');
        try {
            const cleanup = await cleanupSingleTab(
                LIVE_TABS.INWARD,
                INWARD_LIVE_COLS.DATE,
                INWARD_LIVE_COLS.IMPORT_ERRORS,
                `'${LIVE_TABS.INWARD}'!A:J`
            );
            stepDone('Cleanup DONE rows', s, `${cleanup.deleted} deleted`);
        } catch (err: unknown) {
            stepFailed('Cleanup DONE rows', s, err instanceof Error ? err.message : 'Unknown error');
        }

        // Summary
        s = stepStart('Summary');
        result.durationMs = Date.now() - cycleStart;
        stepDone('Summary', s, `${result.inwardIngested} ingested, ${result.skipped} skipped`);

        // Update legacy state
        ingestInwardState.lastRunAt = new Date();
        ingestInwardState.lastResult = result;
        pushRecentRun(ingestInwardState, {
            startedAt: result.startedAt,
            durationMs: result.durationMs,
            count: result.inwardIngested,
            error: result.error,
        });

        sheetsLogger.info({
            durationMs: result.durationMs,
            inwardIngested: result.inwardIngested,
            skipped: result.skipped,
        }, 'Inward cycle completed');

        return result;
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        sheetsLogger.error({ error: err.message, stack: err.stack }, 'Inward cycle failed');
        result.error = err.message;
        result.durationMs = Date.now() - cycleStart;
        skipRemainingSteps();

        ingestInwardState.lastResult = result;
        pushRecentRun(ingestInwardState, {
            startedAt: result.startedAt,
            durationMs: result.durationMs,
            count: result.inwardIngested,
            error: result.error,
        });

        return result;
    } finally {
        ingestInwardState.isRunning = false;
        finishCycle(cycleStart);
    }
}

export async function runOutwardCycle(): Promise<IngestOutwardResult> {
    // Guard against ALL concurrent operations
    if (cycleProgress.isRunning || ingestInwardState.isRunning || ingestOutwardState.isRunning || pushBalancesState.isRunning || cleanupDoneState.isRunning) {
        return {
            startedAt: new Date().toISOString(),
            outwardIngested: 0, ordersLinked: 0, skipped: 0, rowsMarkedDone: 0,
            skusUpdated: 0, errors: 0, durationMs: 0,
            error: 'Another cycle or sheet job is already running',
        };
    }

    const cycleStart = Date.now();
    initCycleSteps('outward');
    ingestOutwardState.isRunning = true;

    const result: IngestOutwardResult = {
        startedAt: new Date().toISOString(),
        outwardIngested: 0,
        ordersLinked: 0,
        skipped: 0,
        rowsMarkedDone: 0,
        skusUpdated: 0,
        errors: 0,
        durationMs: 0,
        error: null,
    };

    const tracker: StepTracker = {
        start: stepStart,
        done: stepDone,
        fail: stepFailed,
    };

    try {
        // PRE-FLIGHT 1: Balance check
        let s = stepStart('Balance check');
        let beforeSnapshot: BalanceSnapshot | null = null;
        try {
            beforeSnapshot = await readInventorySnapshot();
            stepDone('Balance check', s, `${beforeSnapshot.rowCount} SKUs read`);
        } catch (err: unknown) {
            stepFailed('Balance check', s, err instanceof Error ? err.message : 'Unknown error');
        }

        // PRE-FLIGHT 2: Read current balances
        s = stepStart('CSV backup');
        try {
            const skus = await prisma.sku.findMany({
                select: { skuCode: true, currentBalance: true },
            });
            stepDone('CSV backup', s, `${skus.length} SKUs read`);
        } catch (err: unknown) {
            stepFailed('CSV backup', s, err instanceof Error ? err.message : 'Unknown error');
        }

        // PRE-FLIGHT 3: Push balances
        s = stepStart('Push balances');
        try {
            const pushResult = await pushBalancesCore();
            stepDone('Push balances', s, `${pushResult.skusUpdated} updated`);
        } catch (err: unknown) {
            stepFailed('Push balances', s, err instanceof Error ? err.message : 'Unknown error');
        }

        // PRE-FLIGHT 4: DB health check (fatal)
        s = stepStart('DB health check');
        try {
            await prisma.$queryRaw`SELECT 1`;
            stepDone('DB health check', s, 'OK');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            stepFailed('DB health check', s, msg);
            skipRemainingSteps();
            result.error = `DB health check failed: ${msg}`;
            result.durationMs = Date.now() - cycleStart;
            finishCycle(cycleStart);
            return result;
        }

        // IMPORT: Read + Validate + DB write + Mark DONE
        const { affectedSkuIds, linkableItems, orderMap } = await ingestOutwardLive(result, tracker);

        // Mark any import steps still pending as skipped (e.g. early return with no data)
        for (const name of ['Read sheet rows', 'Validate rows', 'DB write', 'Mark DONE', 'Protect DONE rows']) {
            const step = getStep(name);
            if (step && step.status === 'pending') step.status = 'skipped';
        }

        // IMPORT 7b: Link orders
        s = stepStart('Link orders');
        try {
            if (linkableItems.length > 0) {
                await linkOutwardToOrders(linkableItems, result, orderMap);
                stepDone('Link orders', s, `${result.ordersLinked} linked`);
            } else {
                stepDone('Link orders', s, 'No orders to link');
            }
        } catch (err: unknown) {
            stepFailed('Link orders', s, err instanceof Error ? err.message : 'Unknown error');
        }


        // POST-FLIGHT: Push updated balances
        s = stepStart('Push updated balances');
        try {
            if (affectedSkuIds.size > 0) {
                await updateSheetBalances(affectedSkuIds, result);
            }
            if (result.outwardIngested > 0) {
                invalidateCaches();
            }
            stepDone('Push updated balances', s, `${result.skusUpdated} updated`);
        } catch (err: unknown) {
            stepFailed('Push updated balances', s, err instanceof Error ? err.message : 'Unknown error');
        }

        // POST-FLIGHT: Verify balances
        s = stepStart('Verify balances');
        try {
            if (beforeSnapshot && result.outwardIngested > 0) {
                await new Promise(resolve => setTimeout(resolve, 8000));
                const afterSnapshot = await readInventorySnapshot();
                const verification = compareSnapshots(beforeSnapshot, afterSnapshot);
                result.balanceVerification = verification;
                stepDone('Verify balances', s, verification.passed ? 'Passed' : `${verification.drifted} drifted`);
            } else {
                stepSkipped('Verify balances', 'No changes to verify');
            }
        } catch (err: unknown) {
            stepFailed('Verify balances', s, err instanceof Error ? err.message : 'Unknown error');
        }

        // POST-FLIGHT: Cleanup DONE rows (outward tab only)
        s = stepStart('Cleanup DONE rows');
        try {
            const cleanup = await cleanupSingleTab(
                LIVE_TABS.OUTWARD,
                OUTWARD_LIVE_COLS.OUTWARD_DATE,
                OUTWARD_LIVE_COLS.IMPORT_ERRORS,
                `'${LIVE_TABS.OUTWARD}'!A:AG`
            );
            stepDone('Cleanup DONE rows', s, `${cleanup.deleted} deleted`);
        } catch (err: unknown) {
            stepFailed('Cleanup DONE rows', s, err instanceof Error ? err.message : 'Unknown error');
        }

        // Summary
        s = stepStart('Summary');
        result.durationMs = Date.now() - cycleStart;
        stepDone('Summary', s, `${result.outwardIngested} ingested, ${result.ordersLinked} linked`);

        // Update legacy state
        ingestOutwardState.lastRunAt = new Date();
        ingestOutwardState.lastResult = result;
        pushRecentRun(ingestOutwardState, {
            startedAt: result.startedAt,
            durationMs: result.durationMs,
            count: result.outwardIngested,
            error: result.error,
        });

        sheetsLogger.info({
            durationMs: result.durationMs,
            outwardIngested: result.outwardIngested,
            ordersLinked: result.ordersLinked,
        }, 'Outward cycle completed');

        return result;
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        sheetsLogger.error({ error: err.message, stack: err.stack }, 'Outward cycle failed');
        result.error = err.message;
        result.durationMs = Date.now() - cycleStart;
        skipRemainingSteps();

        ingestOutwardState.lastResult = result;
        pushRecentRun(ingestOutwardState, {
            startedAt: result.startedAt,
            durationMs: result.durationMs,
            count: result.outwardIngested,
            error: result.error,
        });

        return result;
    } finally {
        ingestOutwardState.isRunning = false;
        finishCycle(cycleStart);
    }
}

export { getCycleProgress, resetCycleProgress };
