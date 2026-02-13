/**
 * Tracking Sync Service (Line-Centric)
 *
 * Periodically fetches tracking updates from iThink Logistics for in-transit shipments.
 * Updates OrderLine tracking status (source of truth), and Order.status for terminal states.
 *
 * Line-centric architecture: OrderLine.awbNumber/trackingStatus are authoritative.
 * Order-level tracking fields are deprecated and will be removed.
 */

import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import ithinkClient from './ithinkLogistics.js';
import { recomputeOrderStatus } from '../utils/orderStatus.js';
import { updateCustomerTier } from '../utils/tierUtils.js';
import { trackingLogger } from '../utils/logger.js';
import { type TrackingStatus, type PaymentMethod } from '../config/types.js';
import type { IThinkRawTrackingResponse } from '../types/ithinkApi.js';
import { storeTrackingResponsesBatch } from './trackingResponseStorage.js';
import { trackWorkerRun } from '../utils/workerRunTracker.js';

// ============================================
// TYPES
// ============================================

/** Nullable tracking status for database fields */
type NullableTrackingStatus = TrackingStatus | null;

/** Order info for AWB mapping */
interface OrderInfo {
    orderId: string;
    orderNumber: string;
    paymentMethod: PaymentMethod;
    customerId: string | null;
    rtoInitiatedAt: Date | null;
    previousTrackingStatus: NullableTrackingStatus;
}

/** Last scan details from iThink API */
interface LastScanDetails {
    status: string;
    location: string;
    datetime: string;
    remark: string;
    reason: string;
}

/** Tracking data transformed from iThink API */
interface TrackingData {
    courier: string;
    statusCode: string;
    internalStatus: NullableTrackingStatus;
    expectedDeliveryDate: string | null;
    ofdCount: number;
    isRto: boolean;
    lastScan: LastScanDetails | null;
}

/** Line update data for Prisma */
interface LineUpdateData {
    trackingStatus: NullableTrackingStatus;
    lastTrackingUpdate: Date;
    deliveredAt?: Date;
    rtoInitiatedAt?: Date;
    rtoReceivedAt?: Date;
}

/** Result of line tracking update */
interface UpdateResult {
    lineUpdateData: LineUpdateData;
}

/** Sync result summary */
interface SyncResult {
    startedAt: string;
    awbsChecked: number;
    updated: number;
    delivered: number;
    archived: number;
    rto: number;
    errors: number;
    apiCalls: number;
    durationMs: number;
    error: string | null;
}

/** Sync status information */
interface SyncStatus {
    isRunning: boolean;
    schedulerActive: boolean;
    intervalMinutes: number;
    lastSyncAt: Date | null;
    lastSyncResult: SyncResult | null;
}

// RawTrackingData removed - using IThinkRawTrackingResponse from types/ithinkApi.ts

// ============================================
// CONSTANTS
// ============================================

/** Sync interval in milliseconds (30 minutes) */
const SYNC_INTERVAL_MS = 30 * 60 * 1000;

/** Batch size for tracking API calls (iThink API limit is 10 per request) */
const BATCH_SIZE = 10;

/**
 * Non-final tracking statuses that need updates
 * Include 'delivered' and 'rto_delivered' to allow re-evaluation of misclassified orders
 */
const SYNC_STATUSES: string[] = [
    'in_transit',
    'out_for_delivery',
    'delivery_delayed',
    'rto_initiated',
    'rto_in_transit',
    'rto_delivered',
    'manifested',
    'picked_up',
    'reached_destination',
    'undelivered',
    'not_picked',
    'delivered',
];

// ============================================
// STATE
// ============================================

let syncInterval: NodeJS.Timeout | null = null;
let isRunning = false;
let lastSyncAt: Date | null = null;
let lastSyncResult: SyncResult | null = null;

// ============================================
// FUNCTIONS
// ============================================

/**
 * Get all AWBs that need tracking updates (line-centric)
 *
 * Queries OrderLines with AWB that have non-final tracking status.
 * Groups by AWB to avoid duplicate API calls for multi-line shipments.
 */
async function getAwbsNeedingUpdate(): Promise<Map<string, OrderInfo>> {
    // Get distinct AWBs from lines that need tracking updates
    // Using raw SQL because Prisma doesn't support DISTINCT ON with relations well
    // Subquery ensures we process newest orders first (by orderDate DESC)
    const lines = await prisma.$queryRaw<Array<{
        id: string;
        awbNumber: string | null;
        trackingStatus: string | null;
        orderId: string;
        orderNumber: string;
        paymentMethod: string;
        customerId: string | null;
        rtoInitiatedAt: Date | null;
    }>>(Prisma.sql`
        SELECT * FROM (
            SELECT DISTINCT ON (ol."awbNumber")
                ol.id,
                ol."awbNumber",
                ol."trackingStatus",
                ol."orderId",
                o."orderNumber",
                o."paymentMethod",
                o."customerId",
                ol."rtoInitiatedAt",
                o."orderDate"
            FROM "OrderLine" ol
            INNER JOIN "Order" o ON ol."orderId" = o.id
            WHERE ol."awbNumber" IS NOT NULL
                AND o."isArchived" = false
                AND (ol."trackingStatus" IS NULL OR ol."trackingStatus" IN ('in_transit', 'out_for_delivery', 'delivery_delayed', 'rto_initiated', 'rto_in_transit', 'manifested', 'picked_up', 'reached_destination', 'undelivered', 'not_picked'))
            ORDER BY ol."awbNumber", o."orderDate" DESC
        ) sub
        ORDER BY "orderDate" DESC
    `);

    // Build AWB -> order info mapping
    const awbMap = new Map<string, OrderInfo>();
    for (const line of lines) {
        if (line.awbNumber && !awbMap.has(line.awbNumber)) {
            awbMap.set(line.awbNumber, {
                orderId: line.orderId,
                orderNumber: line.orderNumber,
                paymentMethod: line.paymentMethod as PaymentMethod,
                customerId: line.customerId,
                rtoInitiatedAt: line.rtoInitiatedAt,
                previousTrackingStatus: line.trackingStatus as TrackingStatus,
            });
        }
    }

    return awbMap;
}

/**
 * Update tracking for all lines with given AWB (line-centric)
 *
 * @param awbNumber - AWB number
 * @param trackingData - Tracking data from iThink
 * @param orderInfo - Order info for status updates
 */
async function updateLineTracking(
    awbNumber: string,
    trackingData: TrackingData,
    orderInfo: OrderInfo
): Promise<UpdateResult> {
    const lineUpdateData: LineUpdateData = {
        trackingStatus: trackingData.internalStatus,
        lastTrackingUpdate: new Date(),
    };

    // Set delivery timestamp
    if (trackingData.internalStatus === 'delivered') {
        lineUpdateData.deliveredAt = trackingData.lastScan?.datetime
            ? new Date(trackingData.lastScan.datetime)
            : new Date();
    }

    // Set RTO timestamps - use lastScan datetime from API, not current time
    // Only set rtoInitiatedAt if not already set (preserve original RTO initiation date)
    if ((trackingData.isRto || trackingData.internalStatus?.startsWith('rto_')) && !orderInfo.rtoInitiatedAt) {
        lineUpdateData.rtoInitiatedAt = trackingData.lastScan?.datetime
            ? new Date(trackingData.lastScan.datetime)
            : new Date();
    }
    if (trackingData.internalStatus === 'rto_delivered') {
        lineUpdateData.rtoReceivedAt = trackingData.lastScan?.datetime
            ? new Date(trackingData.lastScan.datetime)
            : new Date();
    }

    // Update all lines with this AWB
    await prisma.orderLine.updateMany({
        where: { awbNumber },
        data: lineUpdateData,
    });

    // Promote lineStatus to 'delivered' when tracking confirms delivery
    // Only promote lines that are currently 'shipped' (don't touch cancelled/pending lines)
    if (trackingData.internalStatus === 'delivered') {
        await prisma.orderLine.updateMany({
            where: {
                awbNumber,
                lineStatus: 'shipped',
            },
            data: {
                lineStatus: 'delivered',
                deliveredAt: lineUpdateData.deliveredAt || new Date(),
            },
        });
        trackingLogger.info({ orderNumber: orderInfo.orderNumber }, 'Promoted shipped lines to delivered');
    }

    // Increment customer RTO count on first RTO initiation
    if (lineUpdateData.rtoInitiatedAt && !orderInfo.rtoInitiatedAt && orderInfo.customerId) {
        await prisma.customer.update({
            where: { id: orderInfo.customerId },
            data: { rtoCount: { increment: 1 } },
        });
        trackingLogger.info({ customerId: orderInfo.customerId }, 'Incremented customer rtoCount');
    }

    // Always recompute order status from lines (single source of truth)
    await recomputeOrderStatus(orderInfo.orderId);

    // Update customer tier on RTO (order no longer counts toward LTV)
    const isNewRto = lineUpdateData.rtoInitiatedAt && !orderInfo.rtoInitiatedAt;
    if (isNewRto && orderInfo.customerId) {
        await updateCustomerTier(prisma, orderInfo.customerId);
    }

    return { lineUpdateData };
}

/**
 * Run the tracking sync
 */
async function runTrackingSync(): Promise<SyncResult | null> {
    if (isRunning) {
        trackingLogger.debug('Sync already in progress, skipping');
        return null;
    }

    isRunning = true;
    const startTime = Date.now();

    const result: SyncResult = {
        startedAt: new Date().toISOString(),
        awbsChecked: 0,
        updated: 0,
        delivered: 0,
        archived: 0,
        rto: 0,
        errors: 0,
        apiCalls: 0,
        durationMs: 0,
        error: null,
    };

    try {
        trackingLogger.info('Starting tracking sync (line-centric)');

        // Load iThink credentials
        await ithinkClient.loadFromDatabase();

        if (!ithinkClient.isConfigured()) {
            trackingLogger.warn('iThink Logistics not configured, skipping sync');
            result.error = 'iThink Logistics not configured';
            return result;
        }

        // Get AWBs needing update (line-centric query)
        const awbMap = await getAwbsNeedingUpdate();
        const awbNumbers = Array.from(awbMap.keys());
        result.awbsChecked = awbNumbers.length;

        if (awbNumbers.length === 0) {
            trackingLogger.debug('No AWBs need tracking updates');
            return result;
        }

        trackingLogger.info({ count: awbNumbers.length }, 'Found AWBs to check');

        // Process in batches
        for (let i = 0; i < awbNumbers.length; i += BATCH_SIZE) {
            const batch = awbNumbers.slice(i, i + BATCH_SIZE);
            result.apiCalls++;

            try {
                trackingLogger.debug({
                    batch: Math.floor(i / BATCH_SIZE) + 1,
                    totalBatches: Math.ceil(awbNumbers.length / BATCH_SIZE)
                }, 'Fetching batch');

                const trackingResults = await ithinkClient.trackShipments(batch);

                // Store raw responses for debugging (in background, don't await)
                const responsesToStore = Object.entries(trackingResults).map(([awb, data]) => ({
                    awbNumber: awb,
                    source: 'sync' as const,
                    statusCode: data.message === 'success' ? 200 : 404,
                    response: data,
                }));
                storeTrackingResponsesBatch(responsesToStore).catch(() => {});

                for (const [awb, rawData] of Object.entries(trackingResults)) {
                    const orderInfo = awbMap.get(awb);
                    if (!orderInfo) continue;

                    // Skip if API returned error - preserve existing data
                    if (!rawData || rawData.message !== 'success') {
                        // Just update lastTrackingUpdate on lines to show we tried
                        try {
                            await prisma.orderLine.updateMany({
                                where: { awbNumber: awb },
                                data: { lastTrackingUpdate: new Date() }
                            });
                        } catch (e) {
                            trackingLogger.warn({ awb, error: e instanceof Error ? e.message : String(e) }, 'Failed to update lastTrackingUpdate');
                        }
                        continue;
                    }

                    try {
                        // Transform iThink API response
                        const lastScanStatus = rawData.last_scan_details?.status || '';
                        const currentStatus = rawData.current_status || '';

                        // Determine internal status with improved logic:
                        // Priority 1: Check cancel_status field (most authoritative for cancellations)
                        // Priority 2: Use current_status text (more reliable than codes)
                        // Priority 3: Fall back to status code
                        let internalStatus: NullableTrackingStatus;

                        if (rawData.cancel_status?.toLowerCase() === 'approved') {
                            // iThink cancel_status: "Approved" means shipment is definitely cancelled
                            internalStatus = 'cancelled';
                            trackingLogger.debug({ awb, cancelStatus: rawData.cancel_status }, 'Detected cancelled shipment via cancel_status field');
                        } else {
                            // Use current_status text as PRIMARY source (most reliable)
                            // For RTO detection, also check last_scan_details status
                            const statusForMapping = lastScanStatus.toLowerCase().includes('rto')
                                ? lastScanStatus
                                : currentStatus;
                            internalStatus = ithinkClient.mapToInternalStatus(rawData.current_status_code, statusForMapping) as TrackingStatus;
                        }

                        const trackingData: TrackingData = {
                            courier: rawData.logistic,
                            statusCode: rawData.current_status_code,
                            internalStatus,
                            expectedDeliveryDate: rawData.expected_delivery_date,
                            ofdCount: parseInt(String(rawData.ofd_count)) || 0,
                            isRto: !!rawData.return_tracking_no || lastScanStatus.toLowerCase().includes('rto'),
                            lastScan: rawData.last_scan_details ? {
                                status: rawData.last_scan_details.status,
                                location: rawData.last_scan_details.scan_location,
                                datetime: rawData.last_scan_details.status_date_time,
                                remark: rawData.last_scan_details.remark,
                                reason: rawData.last_scan_details.reason,
                            } : null,
                        };

                        const previousStatus = orderInfo.previousTrackingStatus;
                        const newStatus = trackingData.internalStatus;

                        // Update lines (source of truth) and recompute order status
                        await updateLineTracking(awb, trackingData, orderInfo);
                        result.updated++;

                        // Track status transitions for logging
                        if (previousStatus !== newStatus) {
                            if (newStatus === 'delivered') {
                                result.delivered++;
                            }

                            if (newStatus?.startsWith('rto_')) {
                                result.rto++;
                                if (newStatus === 'rto_delivered') {
                                    trackingLogger.info({ awb, orderNumber: orderInfo.orderNumber }, 'RTO delivered');
                                } else if (newStatus === 'rto_in_transit') {
                                    trackingLogger.info({ awb, orderNumber: orderInfo.orderNumber }, 'RTO in transit');
                                }
                            }
                        }
                    } catch (err) {
                        const error = err as Error;
                        trackingLogger.error({ awb, error: error.message }, 'Failed to update AWB tracking');
                        result.errors++;
                    }
                }

                // Rate limiting
                if (i + BATCH_SIZE < awbNumbers.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (err) {
                const error = err as Error;
                trackingLogger.error({ error: error.message }, 'Error fetching batch');
                result.errors++;
            }
        }

        result.durationMs = Date.now() - startTime;
        lastSyncAt = new Date();
        lastSyncResult = result;

        trackingLogger.info({
            durationMs: result.durationMs,
            updated: result.updated,
            delivered: result.delivered,
            rto: result.rto,
            errors: result.errors
        }, 'Tracking sync completed');

        return result;
    } catch (error) {
        const err = error as Error;
        trackingLogger.error({ error: err.message }, 'Tracking sync failed');
        result.error = err.message;
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
function start(): void {
    if (syncInterval) {
        trackingLogger.debug('Scheduler already running');
        return;
    }

    trackingLogger.info({ intervalMinutes: SYNC_INTERVAL_MS / 1000 / 60 }, 'Starting scheduler');

    // Run 2 minutes after startup (let server stabilize)
    setTimeout(() => {
        trackWorkerRun('tracking_sync', runTrackingSync, 'startup').catch(() => {});
    }, 2 * 60 * 1000);

    // Then run every 30 minutes
    syncInterval = setInterval(() => {
        trackWorkerRun('tracking_sync', runTrackingSync, 'scheduled').catch(() => {});
    }, SYNC_INTERVAL_MS);
}

/**
 * Stop the scheduled sync
 */
function stop(): void {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        trackingLogger.info('Scheduler stopped');
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
        lastSyncAt,
        lastSyncResult,
    };
}

/**
 * Manually trigger a sync
 */
async function triggerSync(): Promise<SyncResult | null> {
    return trackWorkerRun('tracking_sync', runTrackingSync, 'manual');
}

// ============================================
// EXPORTS
// ============================================

export default {
    start,
    stop,
    getStatus,
    triggerSync,
    runTrackingSync,
};

export type {
    TrackingStatus,
    SyncResult,
    SyncStatus,
    TrackingData,
    OrderInfo,
};
