/**
 * Tracking Sync Service (Line-Centric)
 *
 * Periodically fetches tracking updates from iThink Logistics for in-transit shipments.
 * Updates OrderLine tracking status (source of truth), and Order.status for terminal states.
 *
 * Line-centric architecture: OrderLine.awbNumber/trackingStatus are authoritative.
 * Order-level tracking fields are deprecated and will be removed.
 */

import prisma from '../lib/prisma.js';
import ithinkClient from './ithinkLogistics.js';
import { recomputeOrderStatus } from '../utils/orderStatus.js';

// Sync interval in milliseconds (30 minutes)
const SYNC_INTERVAL_MS = 30 * 60 * 1000;

// Batch size for tracking API calls (iThink API limit is 10 per request)
const BATCH_SIZE = 10;

let syncInterval = null;
let isRunning = false;
let lastSyncAt = null;
let lastSyncResult = null;

/**
 * Non-final tracking statuses that need updates
 * Include 'delivered' and 'rto_delivered' to allow re-evaluation of misclassified orders
 */
const SYNC_STATUSES = [
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

/**
 * Get all AWBs that need tracking updates (line-centric)
 *
 * Queries OrderLines with AWB that have non-final tracking status.
 * Groups by AWB to avoid duplicate API calls for multi-line shipments.
 */
async function getAwbsNeedingUpdate() {
    // Get distinct AWBs from lines that need tracking updates
    const lines = await prisma.orderLine.findMany({
        where: {
            awbNumber: { not: null },
            order: {
                isArchived: false,
            },
            OR: [
                { trackingStatus: null },
                { trackingStatus: { in: SYNC_STATUSES } },
            ],
        },
        select: {
            id: true,
            awbNumber: true,
            trackingStatus: true,
            orderId: true,
            order: {
                select: {
                    id: true,
                    orderNumber: true,
                    status: true,
                    paymentMethod: true,
                    customerId: true,
                    rtoInitiatedAt: true,
                }
            }
        },
        distinct: ['awbNumber'],
    });

    // Build AWB -> order info mapping
    const awbMap = new Map();
    for (const line of lines) {
        if (line.awbNumber && !awbMap.has(line.awbNumber)) {
            awbMap.set(line.awbNumber, {
                orderId: line.orderId,
                orderNumber: line.order.orderNumber,
                orderStatus: line.order.status,
                paymentMethod: line.order.paymentMethod,
                customerId: line.order.customerId,
                rtoInitiatedAt: line.order.rtoInitiatedAt,
                previousTrackingStatus: line.trackingStatus,
            });
        }
    }

    return awbMap;
}

/**
 * Update tracking for all lines with given AWB (line-centric)
 *
 * @param {string} awbNumber - AWB number
 * @param {object} trackingData - Tracking data from iThink
 * @param {object} orderInfo - Order info for status updates
 */
async function updateLineTracking(awbNumber, trackingData, orderInfo) {
    const lineUpdateData = {
        trackingStatus: trackingData.internalStatus,
        lastTrackingUpdate: new Date(),
    };

    // Set delivery timestamp
    if (trackingData.internalStatus === 'delivered') {
        lineUpdateData.deliveredAt = trackingData.lastScan?.datetime
            ? new Date(trackingData.lastScan.datetime)
            : new Date();
    }

    // Set RTO timestamps
    if (trackingData.isRto || trackingData.internalStatus?.startsWith('rto_')) {
        lineUpdateData.rtoInitiatedAt = new Date();
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

    // Update Order.status for terminal states (delivered, RTO, cancelled)
    // This is the ONLY Order update - no tracking fields
    const orderUpdateData = {};
    let statusChanged = false;

    if (trackingData.internalStatus === 'delivered') {
        // Set terminal status for delivered orders
        orderUpdateData.terminalStatus = 'delivered';
        orderUpdateData.terminalAt = lineUpdateData.deliveredAt || new Date();
        console.log(`[Tracking Sync] Order ${orderInfo.orderNumber} terminal status -> delivered`);
    }

    if (trackingData.internalStatus === 'rto_delivered') {
        if (orderInfo.orderStatus === 'shipped' || orderInfo.orderStatus === 'delivered') {
            orderUpdateData.status = 'returned';
            statusChanged = true;
            console.log(`[Tracking Sync] Order ${orderInfo.orderNumber} status -> returned (RTO delivered)`);
        }
    }

    if (trackingData.internalStatus === 'cancelled') {
        if (orderInfo.orderStatus === 'shipped') {
            orderUpdateData.status = 'cancelled';
            statusChanged = true;
            console.log(`[Tracking Sync] Order ${orderInfo.orderNumber} status -> cancelled`);
        }
    }

    // Also update Order.trackingStatus as denormalized cache (for query compatibility)
    // This maintains backward compatibility with existing queries while lines are source of truth
    orderUpdateData.trackingStatus = trackingData.internalStatus;
    if (trackingData.internalStatus === 'delivered') {
        orderUpdateData.deliveredAt = lineUpdateData.deliveredAt;
    }
    if (lineUpdateData.rtoInitiatedAt) {
        orderUpdateData.rtoInitiatedAt = lineUpdateData.rtoInitiatedAt;

        // Increment customer RTO count on first RTO initiation
        if (!orderInfo.rtoInitiatedAt && orderInfo.customerId) {
            await prisma.customer.update({
                where: { id: orderInfo.customerId },
                data: { rtoCount: { increment: 1 } },
            });
            console.log(`[Tracking Sync] Incremented rtoCount for customer ${orderInfo.customerId}`);
        }
    }
    if (lineUpdateData.rtoReceivedAt) {
        orderUpdateData.rtoReceivedAt = lineUpdateData.rtoReceivedAt;
    }

    // Apply Order updates
    await prisma.order.update({
        where: { id: orderInfo.orderId },
        data: orderUpdateData,
    });

    // Also recompute order status from lines
    if (!statusChanged) {
        await recomputeOrderStatus(orderInfo.orderId);
    }

    return { lineUpdateData, orderUpdateData, statusChanged };
}

/**
 * Run the tracking sync
 */
async function runTrackingSync() {
    if (isRunning) {
        console.log('[Tracking Sync] Sync already in progress, skipping...');
        return null;
    }

    isRunning = true;
    const startTime = Date.now();

    const result = {
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
        console.log('[Tracking Sync] Starting tracking sync (line-centric)...');

        // Load iThink credentials
        await ithinkClient.loadFromDatabase();

        if (!ithinkClient.isConfigured()) {
            console.log('[Tracking Sync] iThink Logistics not configured, skipping sync');
            result.error = 'iThink Logistics not configured';
            return result;
        }

        // Get AWBs needing update (line-centric query)
        const awbMap = await getAwbsNeedingUpdate();
        const awbNumbers = Array.from(awbMap.keys());
        result.awbsChecked = awbNumbers.length;

        if (awbNumbers.length === 0) {
            console.log('[Tracking Sync] No AWBs need tracking updates');
            return result;
        }

        console.log(`[Tracking Sync] Found ${awbNumbers.length} AWBs to check`);

        // Process in batches
        for (let i = 0; i < awbNumbers.length; i += BATCH_SIZE) {
            const batch = awbNumbers.slice(i, i + BATCH_SIZE);
            result.apiCalls++;

            try {
                console.log(`[Tracking Sync] Fetching batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(awbNumbers.length / BATCH_SIZE)}`);

                const trackingResults = await ithinkClient.trackShipments(batch);

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
                            // Ignore
                        }
                        continue;
                    }

                    try {
                        // Transform iThink API response
                        const lastScanStatus = rawData.last_scan_details?.status || '';
                        const currentStatus = rawData.current_status || '';
                        const statusForMapping = lastScanStatus.toLowerCase().includes('rto')
                            ? lastScanStatus
                            : currentStatus;

                        const trackingData = {
                            courier: rawData.logistic,
                            statusCode: rawData.current_status_code,
                            internalStatus: ithinkClient.mapToInternalStatus(rawData.current_status_code, statusForMapping),
                            expectedDeliveryDate: rawData.expected_delivery_date,
                            ofdCount: parseInt(rawData.ofd_count) || 0,
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

                        // Update lines (source of truth)
                        const updateResult = await updateLineTracking(awb, trackingData, orderInfo);
                        result.updated++;

                        // Track status transitions for logging
                        if (previousStatus !== newStatus) {
                            if (newStatus === 'delivered') {
                                result.delivered++;
                                if (updateResult.orderUpdateData?.status === 'archived') {
                                    result.archived++;
                                }
                            }

                            if (newStatus?.startsWith('rto_')) {
                                result.rto++;
                                if (newStatus === 'rto_delivered') {
                                    console.log(`[Tracking Sync] AWB ${awb} (Order ${orderInfo.orderNumber}) RTO delivered`);
                                } else if (newStatus === 'rto_in_transit') {
                                    console.log(`[Tracking Sync] AWB ${awb} (Order ${orderInfo.orderNumber}) RTO in transit`);
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`[Tracking Sync] Error updating AWB ${awb}:`, err.message);
                        result.errors++;
                    }
                }

                // Rate limiting
                if (i + BATCH_SIZE < awbNumbers.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (err) {
                console.error(`[Tracking Sync] Error fetching batch:`, err.message);
                result.errors++;
            }
        }

        result.durationMs = Date.now() - startTime;
        lastSyncAt = new Date();
        lastSyncResult = result;

        console.log(`[Tracking Sync] Completed in ${Math.round(result.durationMs / 1000)}s - ` +
            `${result.updated} updated, ${result.delivered} delivered, ${result.rto} RTO`);

        return result;
    } catch (error) {
        console.error('[Tracking Sync] Error:', error);
        result.error = error.message;
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
function start() {
    if (syncInterval) {
        console.log('[Tracking Sync] Already running');
        return;
    }

    console.log(`[Tracking Sync] Starting scheduler (every ${SYNC_INTERVAL_MS / 1000 / 60} minutes)`);

    // Run 2 minutes after startup (let server stabilize)
    setTimeout(() => {
        runTrackingSync();
    }, 2 * 60 * 1000);

    // Then run every 30 minutes
    syncInterval = setInterval(runTrackingSync, SYNC_INTERVAL_MS);
}

/**
 * Stop the scheduled sync
 */
function stop() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        console.log('[Tracking Sync] Stopped');
    }
}

/**
 * Get sync status
 */
function getStatus() {
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
async function triggerSync() {
    return runTrackingSync();
}

export default {
    start,
    stop,
    getStatus,
    triggerSync,
    runTrackingSync,
};
