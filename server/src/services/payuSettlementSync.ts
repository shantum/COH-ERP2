/**
 * PayU Settlement Sync Service
 *
 * Periodically fetches settlement data from PayU's Settlement Range API,
 * stores settlement records, and matches them to HDFC bank deposits via UTR.
 *
 * Pattern: follows trackingSync.ts — module state, concurrency guard,
 * start/stop/getStatus/triggerSync, trackWorkerRun wrapper.
 */

import prisma from '../lib/prisma.js';
import payuClient from './payuClient.js';
import { settlementLogger } from '../utils/logger.js';
import { trackWorkerRun } from '../utils/workerRunTracker.js';
import {
    PAYU_SYNC_INTERVAL_MS,
    PAYU_LOOKBACK_DAYS,
    PAYU_STARTUP_DELAY_MS,
    PAYU_MAX_DATE_RANGE_DAYS,
} from '../config/index.js';
import type { PayuSettlementRecord } from '../types/payuApi.js';

// ============================================
// TYPES
// ============================================

interface SyncResult {
    startedAt: string;
    daysChecked: number;
    settlementsFound: number;
    settlementsNew: number;
    bankMatched: number;
    bankUnmatched: number;
    errors: number;
    durationMs: number;
    error: string | null;
}

interface SyncStatus {
    isRunning: boolean;
    schedulerActive: boolean;
    intervalHours: number;
    lastSyncAt: Date | null;
    lastSyncResult: SyncResult | null;
}

// ============================================
// STATE
// ============================================

let syncInterval: NodeJS.Timeout | null = null;
let startupTimeout: NodeJS.Timeout | null = null;
let isRunning = false;
let lastSyncAt: Date | null = null;
let lastSyncResult: SyncResult | null = null;

function makeEmptyResult(): SyncResult {
    return {
        startedAt: new Date().toISOString(),
        daysChecked: 0,
        settlementsFound: 0,
        settlementsNew: 0,
        bankMatched: 0,
        bankUnmatched: 0,
        errors: 0,
        durationMs: 0,
        error: null,
    };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// ============================================
// HELPERS
// ============================================

/** Format Date to "YYYY-MM-DD" for API calls */
function formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
}

/**
 * Build 3-day windows for a date range (PayU API limit: max 3 days per call).
 * Returns [{ dateFrom, dateTo }] pairs, most recent first.
 */
function buildDateWindows(startDate: Date, endDate: Date): Array<{ dateFrom: string; dateTo: string }> {
    const windows: Array<{ dateFrom: string; dateTo: string }> = [];
    let currentEnd = new Date(endDate);

    while (currentEnd >= startDate) {
        const windowEnd = formatDate(currentEnd);

        // Window start is (PAYU_MAX_DATE_RANGE_DAYS - 1) days before window end
        const windowStart = new Date(currentEnd.getTime() - (PAYU_MAX_DATE_RANGE_DAYS - 1) * 86400000);

        // Don't go before the start date
        const effectiveStart = windowStart < startDate ? startDate : windowStart;

        windows.push({ dateFrom: formatDate(effectiveStart), dateTo: windowEnd });

        // Move to one day before the effective start (using ms to avoid date mutation bugs)
        currentEnd = new Date(effectiveStart.getTime() - 86400000);
    }

    return windows;
}

/**
 * Try to match a PayU settlement to an HDFC bank deposit by UTR.
 * Multiple settlements can share one UTR (batched bank deposit).
 */
async function tryBankMatch(settlementDbId: string, utrNumber: string): Promise<boolean> {
    // HDFC stores UTR with leading zeros in reference (e.g. "0000001442998025")
    // PayU gives bare UTR (e.g. "1442998025"). Match both formats.
    const paddedUtr = utrNumber.padStart(16, '0');
    const bankTxn = await prisma.bankTransaction.findFirst({
        where: {
            bank: 'hdfc',
            direction: 'credit',
            OR: [
                { utr: utrNumber },
                { utr: paddedUtr },
                { reference: utrNumber },
                { reference: paddedUtr },
            ],
        },
        select: { id: true },
    });

    if (bankTxn) {
        await prisma.payuSettlement.update({
            where: { id: settlementDbId },
            data: {
                bankTransactionId: bankTxn.id,
                matchedAt: new Date(),
                matchConfidence: 'utr_exact',
            },
        });
        return true;
    }

    return false;
}

/**
 * Process a single settlement: idempotency check, create record, bank match.
 * Shared by both sync and backfill to avoid code duplication.
 */
async function processSettlement(settlement: PayuSettlementRecord, result: SyncResult): Promise<void> {
    result.settlementsFound++;

    // Idempotency check
    const existing = await prisma.payuSettlement.findUnique({
        where: { settlementId: settlement.settlementId },
    });
    if (existing) return;

    // Parse and validate settlement date
    const completedDate = new Date(settlement.settlementCompletedDate);
    if (isNaN(completedDate.getTime())) {
        settlementLogger.warn({ settlementId: settlement.settlementId, date: settlement.settlementCompletedDate }, 'Could not parse settlement date');
        result.errors++;
        return;
    }

    // Parse and validate amount — never silently store 0
    const amount = parseFloat(settlement.settlementAmount);
    if (isNaN(amount)) {
        settlementLogger.warn({ settlementId: settlement.settlementId, raw: settlement.settlementAmount }, 'Invalid settlementAmount');
        result.errors++;
        return;
    }

    // Create settlement record
    const created = await prisma.payuSettlement.create({
        data: {
            settlementId: settlement.settlementId,
            utrNumber: settlement.utrNumber,
            settlementAmount: amount,
            merchantId: String(settlement.merchantId),
            settlementCompletedDate: completedDate,
            transactions: JSON.parse(JSON.stringify(settlement.transaction)),
            transactionCount: settlement.transaction.length,
        },
    });

    result.settlementsNew++;

    // Try UTR bank match
    const matched = await tryBankMatch(created.id, settlement.utrNumber);
    if (matched) {
        result.bankMatched++;
    } else {
        result.bankUnmatched++;
    }
}

// ============================================
// CORE SYNC LOGIC
// ============================================

async function runPayuSync(): Promise<SyncResult> {
    if (isRunning) {
        settlementLogger.warn('PayU settlement sync already running, skipping');
        return lastSyncResult ?? { ...makeEmptyResult(), error: 'Already running' };
    }

    isRunning = true;
    const startTime = Date.now();
    const result = makeEmptyResult();

    try {
        settlementLogger.info({ lookbackDays: PAYU_LOOKBACK_DAYS }, 'Starting PayU settlement sync');

        await payuClient.loadFromDatabase();
        if (!payuClient.isConfigured()) {
            settlementLogger.info('PayU not configured, skipping sync');
            result.error = 'PayU not configured';
            return result;
        }

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - PAYU_LOOKBACK_DAYS);

        const windows = buildDateWindows(startDate, endDate);
        result.daysChecked = PAYU_LOOKBACK_DAYS;

        for (const window of windows) {
            try {
                const settlements = await payuClient.getSettlements(window.dateFrom, window.dateTo);

                for (const settlement of settlements) {
                    try {
                        await processSettlement(settlement, result);
                    } catch (settErr: unknown) {
                        settlementLogger.error({ error: getErrorMessage(settErr), settlementId: settlement.settlementId }, 'Error processing settlement');
                        result.errors++;
                    }
                }
            } catch (windowErr: unknown) {
                settlementLogger.error({ error: getErrorMessage(windowErr), window }, 'Error fetching settlements for window');
                result.errors++;
            }

            // In-flight progress
            result.durationMs = Date.now() - startTime;
            lastSyncResult = { ...result };
        }

        result.durationMs = Date.now() - startTime;
        lastSyncAt = new Date();
        lastSyncResult = result;

        settlementLogger.info({
            durationMs: result.durationMs,
            settlementsNew: result.settlementsNew,
            bankMatched: result.bankMatched,
            errors: result.errors,
        }, 'PayU settlement sync completed');

        return result;
    } catch (error: unknown) {
        settlementLogger.error({ error: getErrorMessage(error) }, 'PayU settlement sync failed');
        result.error = getErrorMessage(error);
        result.durationMs = Date.now() - startTime;
        lastSyncResult = result;
        return result;
    } finally {
        isRunning = false;
    }
}

// ============================================
// BACKFILL
// ============================================

async function runBackfill(startDateStr: string, endDateStr: string): Promise<SyncResult> {
    if (isRunning) {
        settlementLogger.warn('PayU settlement sync already running, skipping backfill');
        return lastSyncResult ?? { ...makeEmptyResult(), error: 'Already running' };
    }

    isRunning = true;
    const startTime = Date.now();
    const result = makeEmptyResult();

    try {
        settlementLogger.info({ startDate: startDateStr, endDate: endDateStr }, 'Starting PayU settlement backfill');

        await payuClient.loadFromDatabase();
        if (!payuClient.isConfigured()) {
            result.error = 'PayU not configured';
            return result;
        }

        const start = new Date(startDateStr + 'T00:00:00Z');
        const end = new Date(endDateStr + 'T00:00:00Z');
        const windows = buildDateWindows(start, end);

        for (const window of windows) {
            result.daysChecked++;

            try {
                const settlements = await payuClient.getSettlements(window.dateFrom, window.dateTo);

                for (const settlement of settlements) {
                    try {
                        await processSettlement(settlement, result);
                    } catch (settErr: unknown) {
                        settlementLogger.error({ error: getErrorMessage(settErr), settlementId: settlement.settlementId }, 'Error during backfill settlement');
                        result.errors++;
                    }
                }
            } catch (windowErr: unknown) {
                settlementLogger.error({ error: getErrorMessage(windowErr), window }, 'Error during backfill window');
                result.errors++;
            }

            result.durationMs = Date.now() - startTime;
            lastSyncResult = { ...result };
        }

        result.durationMs = Date.now() - startTime;
        lastSyncAt = new Date();
        lastSyncResult = result;

        settlementLogger.info({
            startDate: startDateStr, endDate: endDateStr,
            settlementsNew: result.settlementsNew,
            bankMatched: result.bankMatched,
            errors: result.errors,
            durationMs: result.durationMs,
        }, 'PayU settlement backfill completed');

        return result;
    } catch (error: unknown) {
        settlementLogger.error({ error: getErrorMessage(error) }, 'PayU settlement backfill failed');
        result.error = getErrorMessage(error);
        result.durationMs = Date.now() - startTime;
        lastSyncResult = result;
        return result;
    } finally {
        isRunning = false;
    }
}

// ============================================
// WORKER INTERFACE
// ============================================

function start(): void {
    if (syncInterval) {
        settlementLogger.debug('PayU settlement scheduler already running');
        return;
    }

    settlementLogger.info({
        intervalHours: PAYU_SYNC_INTERVAL_MS / 1000 / 60 / 60,
        startupDelayMin: PAYU_STARTUP_DELAY_MS / 1000 / 60,
    }, 'Starting PayU settlement sync scheduler');

    startupTimeout = setTimeout(() => {
        startupTimeout = null;
        trackWorkerRun('payu_settlement_sync', runPayuSync, 'startup').catch((err) => settlementLogger.error({ err }, 'Startup sync failed'));
    }, PAYU_STARTUP_DELAY_MS);

    syncInterval = setInterval(() => {
        trackWorkerRun('payu_settlement_sync', runPayuSync, 'scheduled').catch((err) => settlementLogger.error({ err }, 'Scheduled sync failed'));
    }, PAYU_SYNC_INTERVAL_MS);
}

function stop(): void {
    if (startupTimeout) {
        clearTimeout(startupTimeout);
        startupTimeout = null;
    }
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        settlementLogger.info('PayU settlement scheduler stopped');
    }
}

function getStatus(): SyncStatus {
    return {
        isRunning,
        schedulerActive: !!syncInterval,
        intervalHours: PAYU_SYNC_INTERVAL_MS / 1000 / 60 / 60,
        lastSyncAt,
        lastSyncResult,
    };
}

async function triggerSync(): Promise<SyncResult> {
    return trackWorkerRun('payu_settlement_sync', runPayuSync, 'manual');
}

async function triggerBackfill(startDate: string, endDate: string): Promise<SyncResult> {
    return trackWorkerRun('payu_settlement_backfill', () => runBackfill(startDate, endDate), 'manual');
}

// ============================================
// EXPORTS
// ============================================

export default {
    start,
    stop,
    getStatus,
    triggerSync,
    triggerBackfill,
};
