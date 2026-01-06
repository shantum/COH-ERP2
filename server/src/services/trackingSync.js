/**
 * Tracking Sync Service
 *
 * Periodically fetches tracking updates from iThink Logistics for in-transit orders.
 * Updates order tracking status, detects deliveries and RTOs automatically.
 */

import prisma from '../lib/prisma.js';
import ithinkClient from './ithinkLogistics.js';

// Sync interval in milliseconds (30 minutes)
const SYNC_INTERVAL_MS = 30 * 60 * 1000;

// Batch size for tracking API calls (iThink API limit is 10 per request)
const BATCH_SIZE = 10;

let syncInterval = null;
let isRunning = false;
let lastSyncAt = null;
let lastSyncResult = null;

/**
 * Get all orders that need tracking updates
 *
 * Criteria: Any order with AWB + courier that has a non-final tracking status
 * - trackingStatus is null (never synced) OR in SYNC_STATUSES (in progress)
 * - NOT archived
 *
 * Note: We don't filter by order.status because orders may be marked 'delivered'
 * in ERP before iThink confirms delivery (data inconsistency). We sync based on
 * trackingStatus (iThink status) not status (ERP workflow status).
 */
async function getInTransitOrders() {
    // Non-final tracking statuses that need updates
    const SYNC_STATUSES = [
        'in_transit',
        'out_for_delivery',
        'delivery_delayed',
        'rto_initiated',
        'rto_in_transit',
        'manifested',
        'picked_up',
        'reached_destination',
        'undelivered',
        'not_picked',
    ];

    // Get all orders with AWB that have non-final tracking status
    // Don't filter by order.status - sync based on trackingStatus instead
    const orders = await prisma.order.findMany({
        where: {
            NOT: { isArchived: true },
            awbNumber: { not: null },
            courier: { not: null },
            OR: [
                { trackingStatus: null },
                { trackingStatus: { in: SYNC_STATUSES } },
            ],
        },
        select: {
            id: true,
            orderNumber: true,
            awbNumber: true,
            shippedAt: true,
            trackingStatus: true,
            paymentMethod: true,
            status: true,
        },
        orderBy: { shippedAt: 'desc' },
    });

    return orders;
}

/**
 * Update order tracking status based on iThink response
 * @param {string} orderId - Order ID
 * @param {object} trackingData - Tracking data from iThink
 * @param {object} orderInfo - Additional order info (paymentMethod, shopifyFulfillmentStatus)
 */
async function updateOrderTracking(orderId, trackingData, orderInfo = {}) {
    const updateData = {
        trackingStatus: trackingData.internalStatus,
        courierStatusCode: trackingData.statusCode || null,
        deliveryAttempts: trackingData.ofdCount || 0,
        lastTrackingUpdate: new Date(),
    };

    // Expected delivery date
    if (trackingData.expectedDeliveryDate && trackingData.expectedDeliveryDate !== '0000-00-00') {
        try {
            updateData.expectedDeliveryDate = new Date(trackingData.expectedDeliveryDate);
        } catch (e) {
            // Invalid date, skip
        }
    }

    // Last scan details
    if (trackingData.lastScan) {
        updateData.lastScanStatus = trackingData.lastScan.status || null;
        updateData.lastScanLocation = trackingData.lastScan.location || null;
        if (trackingData.lastScan.datetime) {
            try {
                updateData.lastScanAt = new Date(trackingData.lastScan.datetime);
            } catch (e) {
                // Invalid date, skip
            }
        }
    }

    // If delivered, update delivery date
    if (trackingData.internalStatus === 'delivered') {
        updateData.deliveredAt = trackingData.lastScan?.datetime
            ? new Date(trackingData.lastScan.datetime)
            : new Date();

        // Auto-archive prepaid orders that are delivered
        // Prepaid orders don't need COD collection verification
        const isPrepaid = orderInfo.paymentMethod === 'Prepaid' ||
                          orderInfo.paymentMethod === 'prepaid';

        if (isPrepaid) {
            updateData.status = 'archived';
            console.log(`[Tracking Sync] Auto-archived prepaid order (delivered)`);
        }
    }

    // If RTO initiated
    if (trackingData.isRto) {
        updateData.rtoInitiatedAt = new Date();
        updateData.trackingStatus = 'rto_initiated';
    }

    // Update courier name if available
    if (trackingData.courier) {
        updateData.courier = trackingData.courier;
    }

    await prisma.order.update({
        where: { id: orderId },
        data: updateData,
    });

    return updateData;
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
        ordersChecked: 0,
        updated: 0,
        delivered: 0,
        archived: 0,  // Auto-archived prepaid orders
        rto: 0,
        errors: 0,
        apiCalls: 0,
        durationMs: 0,
        error: null,
    };

    try {
        console.log('[Tracking Sync] Starting tracking sync...');

        // Load iThink credentials
        await ithinkClient.loadFromDatabase();

        if (!ithinkClient.isConfigured()) {
            console.log('[Tracking Sync] iThink Logistics not configured, skipping sync');
            result.error = 'iThink Logistics not configured';
            return result;
        }

        // Get all in-transit orders
        const orders = await getInTransitOrders();
        result.ordersChecked = orders.length;

        if (orders.length === 0) {
            console.log('[Tracking Sync] No in-transit orders to check');
            return result;
        }

        console.log(`[Tracking Sync] Found ${orders.length} orders to check`);

        // Create AWB to order mapping
        const awbToOrder = new Map();
        for (const order of orders) {
            if (order.awbNumber) {
                awbToOrder.set(order.awbNumber, order);
            }
        }

        // Process in batches
        const awbNumbers = Array.from(awbToOrder.keys());

        for (let i = 0; i < awbNumbers.length; i += BATCH_SIZE) {
            const batch = awbNumbers.slice(i, i + BATCH_SIZE);
            result.apiCalls++;

            try {
                console.log(`[Tracking Sync] Fetching batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(awbNumbers.length / BATCH_SIZE)}`);

                const trackingResults = await ithinkClient.trackShipments(batch);

                for (const [awb, rawData] of Object.entries(trackingResults)) {
                    const order = awbToOrder.get(awb);
                    if (!order) continue;

                    // Skip if tracking data indicates failure
                    if (!rawData || rawData.message !== 'success') continue;

                    try {
                        // Transform raw iThink API response to our format
                        // Use correct field names from iThink API
                        // Pass both status code AND status text for smarter mapping
                        const trackingData = {
                            courier: rawData.logistic,
                            statusCode: rawData.current_status_code,
                            internalStatus: ithinkClient.mapToInternalStatus(rawData.current_status_code, rawData.current_status),
                            expectedDeliveryDate: rawData.expected_delivery_date,
                            ofdCount: parseInt(rawData.ofd_count) || 0,
                            isRto: !!rawData.return_tracking_no,
                            lastScan: rawData.last_scan_details ? {
                                status: rawData.last_scan_details.status,
                                location: rawData.last_scan_details.scan_location,
                                datetime: rawData.last_scan_details.status_date_time,
                                remark: rawData.last_scan_details.remark,
                                reason: rawData.last_scan_details.reason,
                            } : null,
                        };

                        const currentStatus = order.trackingStatus;
                        const newStatus = trackingData.internalStatus;

                        // Always update tracking data to keep it fresh
                        // Pass order info for auto-archive logic
                        const updateResult = await updateOrderTracking(order.id, trackingData, {
                            paymentMethod: order.paymentMethod,
                        });
                        result.updated++;

                        // Track status transitions for logging
                        if (currentStatus !== newStatus) {
                            if (updateResult.trackingStatus === 'delivered') {
                                result.delivered++;
                                if (updateResult.status === 'archived') {
                                    result.archived++;
                                    console.log(`[Tracking Sync] Order ${order.orderNumber} delivered & auto-archived (prepaid)`);
                                } else {
                                    console.log(`[Tracking Sync] Order ${order.orderNumber} marked as delivered (COD - manual archive needed)`);
                                }
                            }

                            if (trackingData.isRto) {
                                result.rto++;
                                console.log(`[Tracking Sync] Order ${order.orderNumber} marked as RTO`);
                            }
                        }
                    } catch (err) {
                        console.error(`[Tracking Sync] Error updating ${order.orderNumber}:`, err.message);
                        result.errors++;
                    }
                }

                // Rate limiting: wait 1 second between batches
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
