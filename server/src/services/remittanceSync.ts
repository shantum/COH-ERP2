/**
 * Remittance Sync Service
 *
 * Periodically fetches COD remittance data from iThink Logistics API,
 * matches to orders, marks them as COD-paid, and triggers Shopify sync.
 *
 * Creates CodRemittance records that bridge Orders -> Bank Deposits.
 *
 * Pattern: follows trackingSync.ts — module state, concurrency guard,
 * start/stop/getStatus/triggerSync, trackWorkerRun wrapper.
 */

import prisma from '../lib/prisma.js';
import ithinkClient from './ithinkLogistics/index.js';
import shopifyClient from './shopify/index.js';
import { settleOrderInvoice } from './orderSettlement.js';
import { remittanceLogger } from '../utils/logger.js';
import { trackWorkerRun } from '../utils/workerRunTracker.js';
import {
    ITHINK_REMITTANCE_SYNC_INTERVAL_MS,
    ITHINK_REMITTANCE_LOOKBACK_DAYS,
    ITHINK_REMITTANCE_STARTUP_DELAY_MS,
} from '../config/index.js';

// ============================================
// TYPES
// ============================================

interface SyncResult {
    startedAt: string;
    daysChecked: number;
    remittancesFound: number;
    remittancesNew: number;
    ordersMatched: number;
    ordersUpdated: number;
    ordersAlreadyPaid: number;
    ordersNotFound: number;
    shopifySynced: number;
    shopifyFailed: number;
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

// Amount mismatch tolerance (same as CSV upload route)
const AMOUNT_MISMATCH_TOLERANCE = 5; // 5%

function makeEmptyResult(): SyncResult {
    return {
        startedAt: new Date().toISOString(),
        daysChecked: 0,
        remittancesFound: 0,
        remittancesNew: 0,
        ordersMatched: 0,
        ordersUpdated: 0,
        ordersAlreadyPaid: 0,
        ordersNotFound: 0,
        shopifySynced: 0,
        shopifyFailed: 0,
        errors: 0,
        durationMs: 0,
        error: null,
    };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// ============================================
// CORE SYNC LOGIC
// ============================================

/**
 * Parse iThink date string ("15 Feb 2026") to Date
 */
function parseIThinkDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Format Date to "YYYY-MM-DD" for API calls
 */
function formatDateForApi(date: Date): string {
    return date.toISOString().split('T')[0];
}

/**
 * Process a single date: fetch summaries + details from API, create CodRemittance records.
 * When downloadOnly=true, skips order matching (just stores raw data for later matching).
 */
async function processDate(
    dateStr: string,
    result: SyncResult,
    shopifyReady: boolean,
    downloadOnly = false,
): Promise<void> {
    // 1. Fetch summaries for this date
    const summaries = await ithinkClient.getRemittances(dateStr);
    if (!summaries || summaries.length === 0) return;

    result.remittancesFound += summaries.length;

    // Check which summaries are new (not yet processed)
    const newSummaries = [];
    for (const summary of summaries) {
        const remittanceDate = parseIThinkDate(summary.remittance_date);
        if (!remittanceDate) {
            remittanceLogger.warn({ remittanceId: summary.remittance_id, dateStr: summary.remittance_date }, 'Could not parse remittance date');
            result.errors++;
            continue;
        }

        const remittanceId = String(summary.remittance_id);

        const existing = await prisma.codRemittance.findUnique({
            where: {
                remittanceId_remittanceDate: {
                    remittanceId,
                    remittanceDate,
                },
            },
        });

        if (!existing) {
            newSummaries.push({ summary, remittanceDate, remittanceId });
        }
    }

    if (newSummaries.length === 0) return;

    // 2. Fetch per-order details ONCE per date
    const details = await ithinkClient.getRemittanceDetails(dateStr);

    // 3. Process each new summary
    for (const { summary, remittanceDate, remittanceId } of newSummaries) {
        result.remittancesNew++;

        let ordersProcessed = 0;

        if (!downloadOnly) {
            ordersProcessed = await matchOrdersForDetails(details, remittanceDate, result, shopifyReady);
        }

        // 4. Create CodRemittance record
        await prisma.codRemittance.create({
            data: {
                remittanceId,
                remittanceDate,
                codGenerated: parseFloat(summary.cod_generated) || 0,
                billAdjusted: parseFloat(summary.bill_adjusted) || 0,
                refundAdjusted: parseFloat(summary.refund_adjusted) || 0,
                transactionCharges: parseFloat(summary.transaction_charges) || 0,
                transactionGstCharges: parseFloat(summary.transaction_gst_charges) || 0,
                walletAmount: parseFloat(summary.wallet_amount) || 0,
                advanceHold: parseFloat(summary.advance_hold) || 0,
                codRemitted: parseFloat(summary.cod_remitted) || 0,
                orderDetails: JSON.parse(JSON.stringify(details)),
                orderCount: details.length,
                ordersProcessed,
                source: 'api',
            },
        });
    }
}

// Shopify API rate limit: 2 requests/second for REST. Keep concurrency at 3 to stay safe.
const SHOPIFY_CONCURRENCY = 3;

/**
 * Match orders from remittance details, update COD status, batch sync to Shopify.
 * Phase 1: DB matching (sequential — fast).
 * Phase 2: Shopify sync (parallel with concurrency limit — slow part).
 */
async function matchOrdersForDetails(
    details: Array<{ order_no: string; netpayment: string; airway_bill_no: string; delivered_date: string; remittance_id: string; created_date: string }>,
    remittanceDate: Date,
    result: SyncResult,
    shopifyReady: boolean,
    bankTransactionId?: string | null,
): Promise<number> {
    let ordersProcessed = 0;

    // Look up admin user for invoice settlement (critical rule: role = 'admin', lowercase)
    const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
    const adminId = admin?.id;

    // Phase 1: Match orders in DB, collect Shopify-eligible ones
    interface ShopifyJob { orderId: string; shopifyOrderId: string; amount: number }
    const shopifyJobs: ShopifyJob[] = [];

    for (const detail of details) {
        try {
            const orderNumber = detail.order_no.replace(/^#/, '');
            const amount = parseFloat(detail.netpayment) || 0;

            const order = await prisma.order.findFirst({
                where: {
                    OR: [
                        { orderNumber },
                        { orderNumber: `#${orderNumber}` },
                    ],
                },
                select: {
                    id: true,
                    orderNumber: true,
                    shopifyOrderId: true,
                    totalAmount: true,
                    codRemittedAt: true,
                    paymentMethod: true,
                },
            });

            if (!order) {
                result.ordersNotFound++;
                continue;
            }

            result.ordersMatched++;

            if (order.codRemittedAt) {
                result.ordersAlreadyPaid++;
                continue;
            }

            let syncStatus = 'pending';
            let syncError: string | null = null;
            if (amount && order.totalAmount) {
                const diff = Math.abs(amount - order.totalAmount);
                const percentDiff = (diff / order.totalAmount) * 100;
                if (percentDiff > AMOUNT_MISMATCH_TOLERANCE) {
                    syncStatus = 'manual_review';
                    syncError = `Amount mismatch: API=${amount}, Order=${order.totalAmount} (${percentDiff.toFixed(1)}% diff)`;
                }
            }

            // Wrap order update + invoice settlement in a transaction
            const updated = await prisma.$transaction(async (tx) => {
                const upd = await tx.order.updateMany({
                    where: { id: order.id, codRemittedAt: null },
                    data: {
                        codRemittedAt: remittanceDate,
                        paymentStatus: 'paid',
                        codRemittedAmount: amount || null,
                        codShopifySyncStatus: syncStatus,
                        codShopifySyncError: syncError,
                        settledAt: remittanceDate,
                        settlementAmount: amount || null,
                        settlementRef: `COD-REM-${detail.remittance_id}`,
                    },
                });

                if (upd.count > 0 && adminId) {
                    await settleOrderInvoice(tx, {
                        orderId: order.id,
                        bankTransactionId: bankTransactionId ?? undefined,
                        amount: amount || order.totalAmount,
                        userId: adminId,
                        settlementRef: `COD-REM-${detail.remittance_id}`,
                    });
                }

                return upd;
            });

            if (updated.count === 0) {
                result.ordersAlreadyPaid++;
                continue;
            }

            result.ordersUpdated++;
            ordersProcessed++;

            // Collect for batch Shopify sync
            if (order.shopifyOrderId && syncStatus === 'pending' && shopifyReady) {
                shopifyJobs.push({
                    orderId: order.id,
                    shopifyOrderId: order.shopifyOrderId,
                    amount: amount || order.totalAmount,
                });
            }
        } catch (orderErr: unknown) {
            remittanceLogger.error({ error: getErrorMessage(orderErr), orderNo: detail.order_no }, 'Error processing remittance order');
            result.errors++;
        }
    }

    // Phase 2: Batch Shopify sync with concurrency limit
    if (shopifyJobs.length > 0) {
        const syncOne = async (job: ShopifyJob) => {
            try {
                const shopifyResult = await shopifyClient.markOrderAsPaid(
                    job.shopifyOrderId, job.amount, '', remittanceDate,
                );

                if (shopifyResult.success) {
                    await prisma.order.update({
                        where: { id: job.orderId },
                        data: {
                            codShopifySyncStatus: 'synced',
                            codShopifySyncedAt: new Date(),
                            codShopifySyncError: null,
                        },
                    });
                    result.shopifySynced++;
                } else {
                    await prisma.order.update({
                        where: { id: job.orderId },
                        data: {
                            codShopifySyncStatus: 'failed',
                            codShopifySyncError: shopifyResult.error,
                        },
                    });
                    result.shopifyFailed++;
                }
            } catch (shopifyErr: unknown) {
                await prisma.order.update({
                    where: { id: job.orderId },
                    data: {
                        codShopifySyncStatus: 'failed',
                        codShopifySyncError: getErrorMessage(shopifyErr),
                    },
                });
                result.shopifyFailed++;
            }
        };

        // Run with concurrency limit
        for (let i = 0; i < shopifyJobs.length; i += SHOPIFY_CONCURRENCY) {
            const batch = shopifyJobs.slice(i, i + SHOPIFY_CONCURRENCY);
            await Promise.all(batch.map(syncOne));
        }
    }

    return ordersProcessed;
}

// ============================================
// SCHEDULED SYNC (last N days)
// ============================================

async function runRemittanceSync(): Promise<SyncResult> {
    if (isRunning) {
        remittanceLogger.warn('Remittance sync already running, skipping');
        return lastSyncResult ?? { ...makeEmptyResult(), error: 'Already running' };
    }

    isRunning = true;
    const startTime = Date.now();
    const result = makeEmptyResult();

    try {
        remittanceLogger.info({ lookbackDays: ITHINK_REMITTANCE_LOOKBACK_DAYS }, 'Starting remittance sync');

        await ithinkClient.loadFromDatabase();
        await shopifyClient.loadFromDatabase();
        const shopifyReady = shopifyClient.isConfigured();

        const now = new Date();
        for (let d = 0; d < ITHINK_REMITTANCE_LOOKBACK_DAYS; d++) {
            const checkDate = new Date(now);
            checkDate.setDate(checkDate.getDate() - d);
            const dateStr = formatDateForApi(checkDate);
            result.daysChecked++;

            try {
                await processDate(dateStr, result, shopifyReady);
            } catch (dayErr: unknown) {
                remittanceLogger.error({ error: getErrorMessage(dayErr), date: dateStr }, 'Error fetching remittances for date');
                result.errors++;
            }
        }

        result.durationMs = Date.now() - startTime;
        lastSyncAt = new Date();
        lastSyncResult = result;

        remittanceLogger.info({
            durationMs: result.durationMs,
            remittancesNew: result.remittancesNew,
            ordersUpdated: result.ordersUpdated,
            shopifySynced: result.shopifySynced,
            errors: result.errors,
        }, 'Remittance sync completed');

        return result;
    } catch (error: unknown) {
        remittanceLogger.error({ error: getErrorMessage(error) }, 'Remittance sync failed');
        result.error = getErrorMessage(error);
        result.durationMs = Date.now() - startTime;
        lastSyncResult = result;
        return result;
    } finally {
        isRunning = false;
    }
}

// ============================================
// BACKFILL (date range, resumable)
// ============================================

/**
 * Backfill remittances for a date range. Most recent first.
 * downloadOnly=true: fetch from API and store, skip order matching (fast download).
 * downloadOnly=false: fetch + match orders + Shopify sync (full processing).
 * Resumable: skips dates whose remittances already exist in DB.
 */
async function runBackfill(startDate: string, endDate: string, downloadOnly = false): Promise<SyncResult> {
    if (isRunning) {
        remittanceLogger.warn('Remittance sync already running, skipping backfill');
        return lastSyncResult ?? { ...makeEmptyResult(), error: 'Already running' };
    }

    isRunning = true;
    const startTime = Date.now();
    const result = makeEmptyResult();

    try {
        const mode = downloadOnly ? 'download-only' : 'full';
        remittanceLogger.info({ startDate, endDate, mode }, 'Starting remittance backfill');

        await ithinkClient.loadFromDatabase();
        if (!downloadOnly) {
            await shopifyClient.loadFromDatabase();
        }
        const shopifyReady = downloadOnly ? false : shopifyClient.isConfigured();

        // Build date list: most recent first
        const end = new Date(endDate + 'T00:00:00Z');
        const start = new Date(startDate + 'T00:00:00Z');
        const dates: string[] = [];
        for (const d = new Date(end); d >= start; d.setUTCDate(d.getUTCDate() - 1)) {
            dates.push(formatDateForApi(d));
        }

        remittanceLogger.info({ totalDays: dates.length }, 'Backfill date range computed');

        for (const dateStr of dates) {
            result.daysChecked++;

            try {
                await processDate(dateStr, result, shopifyReady, downloadOnly);
            } catch (dayErr: unknown) {
                remittanceLogger.error({ error: getErrorMessage(dayErr), date: dateStr }, 'Error during backfill for date');
                result.errors++;
            }

            // Update result in-flight so sync-status shows progress
            result.durationMs = Date.now() - startTime;
            lastSyncResult = { ...result };
        }

        result.durationMs = Date.now() - startTime;
        lastSyncAt = new Date();
        lastSyncResult = result;

        remittanceLogger.info({
            startDate, endDate, mode,
            daysChecked: result.daysChecked,
            remittancesNew: result.remittancesNew,
            ordersUpdated: result.ordersUpdated,
            errors: result.errors,
            durationMs: result.durationMs,
        }, 'Remittance backfill completed');

        return result;
    } catch (error: unknown) {
        remittanceLogger.error({ error: getErrorMessage(error) }, 'Remittance backfill failed');
        result.error = getErrorMessage(error);
        result.durationMs = Date.now() - startTime;
        lastSyncResult = result;
        return result;
    } finally {
        isRunning = false;
    }
}

/**
 * Match orders for CodRemittance records that were downloaded but not yet matched.
 * Finds records with ordersProcessed=0 and orderDetails present, runs matching + Shopify sync.
 */
async function runMatchUnprocessed(): Promise<SyncResult> {
    if (isRunning) {
        remittanceLogger.warn('Remittance sync already running, skipping match');
        return lastSyncResult ?? { ...makeEmptyResult(), error: 'Already running' };
    }

    isRunning = true;
    const startTime = Date.now();
    const result = makeEmptyResult();

    try {
        remittanceLogger.info('Starting match for unprocessed remittances');

        await shopifyClient.loadFromDatabase();
        const shopifyReady = shopifyClient.isConfigured();

        // Find all download-only records (ordersProcessed=0, have orderDetails)
        const unprocessed = await prisma.codRemittance.findMany({
            where: { ordersProcessed: 0 },
            orderBy: { remittanceDate: 'desc' },
        });

        remittanceLogger.info({ count: unprocessed.length }, 'Unprocessed remittances found');
        result.daysChecked = unprocessed.length;

        for (const record of unprocessed) {
            try {
                const details = record.orderDetails as Array<{
                    order_no: string; netpayment: string; airway_bill_no: string;
                    delivered_date: string; remittance_id: string; created_date: string;
                }>;

                if (!Array.isArray(details) || details.length === 0) continue;

                result.remittancesFound++;
                result.remittancesNew++;

                const ordersProcessed = await matchOrdersForDetails(
                    details, record.remittanceDate, result, shopifyReady,
                    record.bankTransactionId,
                );

                // Update the record with match results
                await prisma.codRemittance.update({
                    where: { id: record.id },
                    data: { ordersProcessed },
                });
            } catch (recordErr: unknown) {
                remittanceLogger.error({ error: getErrorMessage(recordErr), remittanceId: record.remittanceId }, 'Error matching remittance orders');
                result.errors++;
            }

            // In-flight progress
            result.durationMs = Date.now() - startTime;
            lastSyncResult = { ...result };
        }

        result.durationMs = Date.now() - startTime;
        lastSyncAt = new Date();
        lastSyncResult = result;

        remittanceLogger.info({
            recordsProcessed: unprocessed.length,
            ordersUpdated: result.ordersUpdated,
            shopifySynced: result.shopifySynced,
            errors: result.errors,
            durationMs: result.durationMs,
        }, 'Match unprocessed completed');

        return result;
    } catch (error: unknown) {
        remittanceLogger.error({ error: getErrorMessage(error) }, 'Match unprocessed failed');
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
        remittanceLogger.debug('Remittance scheduler already running');
        return;
    }

    remittanceLogger.info({
        intervalHours: ITHINK_REMITTANCE_SYNC_INTERVAL_MS / 1000 / 60 / 60,
        startupDelayMin: ITHINK_REMITTANCE_STARTUP_DELAY_MS / 1000 / 60,
    }, 'Starting remittance sync scheduler');

    // Run after startup delay
    startupTimeout = setTimeout(() => {
        startupTimeout = null;
        trackWorkerRun('remittance_sync', runRemittanceSync, 'startup').catch(() => {});
    }, ITHINK_REMITTANCE_STARTUP_DELAY_MS);

    // Then run every 12 hours
    syncInterval = setInterval(() => {
        trackWorkerRun('remittance_sync', runRemittanceSync, 'scheduled').catch(() => {});
    }, ITHINK_REMITTANCE_SYNC_INTERVAL_MS);
}

function stop(): void {
    if (startupTimeout) {
        clearTimeout(startupTimeout);
        startupTimeout = null;
    }
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        remittanceLogger.info('Remittance scheduler stopped');
    }
}

function getStatus(): SyncStatus {
    return {
        isRunning,
        schedulerActive: !!syncInterval,
        intervalHours: ITHINK_REMITTANCE_SYNC_INTERVAL_MS / 1000 / 60 / 60,
        lastSyncAt,
        lastSyncResult,
    };
}

async function triggerSync(): Promise<SyncResult> {
    return trackWorkerRun('remittance_sync', runRemittanceSync, 'manual');
}

async function triggerBackfill(startDate: string, endDate: string, downloadOnly = false): Promise<SyncResult> {
    return trackWorkerRun('remittance_backfill', () => runBackfill(startDate, endDate, downloadOnly), 'manual');
}

async function triggerMatchUnprocessed(): Promise<SyncResult> {
    return trackWorkerRun('remittance_match', runMatchUnprocessed, 'manual');
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
    triggerMatchUnprocessed,
};
