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
import ithinkClient from './ithinkLogistics.js';
import shopifyClient from './shopify.js';
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
 * Parse iThink date string ("20 Apr 2021") to Date
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

        // Load API and Shopify credentials once before the loop
        await ithinkClient.loadFromDatabase();
        await shopifyClient.loadFromDatabase();
        const shopifyReady = shopifyClient.isConfigured();

        // For each of the last N days
        const now = new Date();
        for (let d = 0; d < ITHINK_REMITTANCE_LOOKBACK_DAYS; d++) {
            const checkDate = new Date(now);
            checkDate.setDate(checkDate.getDate() - d);
            const dateStr = formatDateForApi(checkDate);
            result.daysChecked++;

            try {
                // 1. Fetch summaries for this date
                const summaries = await ithinkClient.getRemittances(dateStr);
                if (!summaries || summaries.length === 0) continue;

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

                    // API returns remittance_id as number — coerce to string for DB
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

                if (newSummaries.length === 0) continue;

                // 2. Fetch per-order details ONCE per date (not per summary)
                const details = await ithinkClient.getRemittanceDetails(dateStr);

                // 3. Process each new summary
                for (const { summary, remittanceDate, remittanceId } of newSummaries) {
                    result.remittancesNew++;

                    let ordersProcessed = 0;
                    for (const detail of details) {
                        try {
                            const orderNumber = detail.order_no.replace(/^#/, '');
                            const amount = parseFloat(detail.netpayment) || 0;

                            // Find order by orderNumber (try with and without # prefix)
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

                            // Skip if already marked as paid (idempotent)
                            if (order.codRemittedAt) {
                                result.ordersAlreadyPaid++;
                                continue;
                            }

                            // Validate amount within 5% tolerance
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

                            // Atomic update — only if NOT already remitted
                            const updated = await prisma.order.updateMany({
                                where: {
                                    id: order.id,
                                    codRemittedAt: null,
                                },
                                data: {
                                    codRemittedAt: remittanceDate,
                                    codRemittedAmount: amount || null,
                                    codShopifySyncStatus: syncStatus,
                                    codShopifySyncError: syncError,
                                },
                            });

                            if (updated.count === 0) {
                                result.ordersAlreadyPaid++;
                                continue;
                            }

                            result.ordersUpdated++;
                            ordersProcessed++;

                            // Trigger Shopify sync if applicable
                            if (order.shopifyOrderId && syncStatus === 'pending' && shopifyReady) {
                                try {
                                    const shopifyResult = await shopifyClient.markOrderAsPaid(
                                        order.shopifyOrderId,
                                        amount || order.totalAmount,
                                        '',
                                        remittanceDate,
                                    );

                                    if (shopifyResult.success) {
                                        await prisma.order.update({
                                            where: { id: order.id },
                                            data: {
                                                codShopifySyncStatus: 'synced',
                                                codShopifySyncedAt: new Date(),
                                                codShopifySyncError: null,
                                            },
                                        });
                                        result.shopifySynced++;
                                    } else {
                                        await prisma.order.update({
                                            where: { id: order.id },
                                            data: {
                                                codShopifySyncStatus: 'failed',
                                                codShopifySyncError: shopifyResult.error,
                                            },
                                        });
                                        result.shopifyFailed++;
                                    }
                                } catch (shopifyErr: unknown) {
                                    await prisma.order.update({
                                        where: { id: order.id },
                                        data: {
                                            codShopifySyncStatus: 'failed',
                                            codShopifySyncError: getErrorMessage(shopifyErr),
                                        },
                                    });
                                    result.shopifyFailed++;
                                }
                            }
                        } catch (orderErr: unknown) {
                            remittanceLogger.error({ error: getErrorMessage(orderErr), orderNo: detail.order_no }, 'Error processing remittance order');
                            result.errors++;
                        }
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

// ============================================
// EXPORTS
// ============================================

export default {
    start,
    stop,
    getStatus,
    triggerSync,
};
