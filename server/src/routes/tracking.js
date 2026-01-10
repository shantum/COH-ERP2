/**
 * Tracking Routes
 * Integration with logistics providers for real-time shipment tracking
 */

import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import ithinkLogistics from '../services/ithinkLogistics.js';
import trackingSync from '../services/trackingSync.js';

const router = Router();

// ============================================
// CONFIGURATION
// ============================================

router.get('/config', authenticateToken, async (req, res) => {
    try {
        await ithinkLogistics.loadFromDatabase();
        res.json(ithinkLogistics.getConfig());
    } catch (error) {
        console.error('Get tracking config error:', error);
        res.status(500).json({ error: 'Failed to get configuration' });
    }
});

router.put('/config', authenticateToken, async (req, res) => {
    try {
        const { accessToken, secretKey } = req.body;

        if (!accessToken || !secretKey) {
            return res.status(400).json({ error: 'Access token and secret key are required' });
        }

        await ithinkLogistics.updateConfig(accessToken, secretKey);

        res.json({ message: 'iThink Logistics configuration updated' });
    } catch (error) {
        console.error('Update tracking config error:', error);
        res.status(500).json({ error: 'Failed to update configuration' });
    }
});

router.post('/test-connection', authenticateToken, async (req, res) => {
    try {
        await ithinkLogistics.loadFromDatabase();

        if (!ithinkLogistics.isConfigured()) {
            return res.json({
                success: false,
                message: 'iThink Logistics credentials not configured',
            });
        }

        // Test with a dummy AWB to verify credentials work
        // The API will return an error for invalid AWB but credentials will be validated
        try {
            await ithinkLogistics.trackShipments('TEST123');
            res.json({ success: true, message: 'Connection successful' });
        } catch (apiError) {
            // If it's an auth error, credentials are wrong
            if (apiError.message.includes('auth') || apiError.message.includes('token')) {
                res.json({ success: false, message: 'Invalid credentials' });
            } else {
                // Other errors mean connection worked but AWB was invalid (expected)
                res.json({ success: true, message: 'Connection successful' });
            }
        }
    } catch (error) {
        console.error('Test tracking connection error:', error);
        res.json({ success: false, message: error.message });
    }
});

// ============================================
// TRACKING
// ============================================

/**
 * Track a single AWB
 * GET /api/tracking/awb/:awbNumber
 */
router.get('/awb/:awbNumber', authenticateToken, async (req, res) => {
    try {
        await ithinkLogistics.loadFromDatabase();

        const { awbNumber } = req.params;
        const tracking = await ithinkLogistics.getTrackingStatus(awbNumber);

        if (!tracking) {
            return res.status(404).json({ error: 'AWB not found or tracking unavailable' });
        }

        res.json(tracking);
    } catch (error) {
        console.error('Track AWB error:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch tracking' });
    }
});

/**
 * Track multiple AWBs (max 10)
 * POST /api/tracking/batch
 * Body: { awbNumbers: ["AWB1", "AWB2", ...] }
 */
router.post('/batch', authenticateToken, async (req, res) => {
    try {
        await ithinkLogistics.loadFromDatabase();

        const { awbNumbers } = req.body;

        if (!awbNumbers || !Array.isArray(awbNumbers) || awbNumbers.length === 0) {
            return res.status(400).json({ error: 'awbNumbers array is required' });
        }

        if (awbNumbers.length > 10) {
            return res.status(400).json({ error: 'Maximum 10 AWB numbers per request' });
        }

        const rawData = await ithinkLogistics.trackShipments(awbNumbers);

        // Transform each AWB's data
        const results = {};
        for (const awb of awbNumbers) {
            const data = rawData[awb];
            if (data && data.message === 'success') {
                results[awb] = {
                    success: true,
                    awbNumber: data.awb_no,
                    courier: data.logistic,
                    currentStatus: data.current_status,
                    statusCode: data.current_status_code,
                    expectedDeliveryDate: data.expected_delivery_date,
                    ofdCount: parseInt(data.ofd_count) || 0,
                    isRto: !!data.return_tracking_no,
                    lastScan: data.last_scan_details ? {
                        status: data.last_scan_details.status,
                        location: data.last_scan_details.location,
                        datetime: data.last_scan_details.date_time,
                    } : null,
                };
            } else {
                results[awb] = {
                    success: false,
                    error: data?.message || 'Not found',
                };
            }
        }

        res.json(results);
    } catch (error) {
        console.error('Batch track error:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch tracking' });
    }
});

/**
 * Track orders by order IDs - looks up AWB from order and fetches tracking
 * POST /api/tracking/orders
 * Body: { orderIds: ["uuid1", "uuid2", ...] }
 */
router.post('/orders', authenticateToken, async (req, res) => {
    try {
        await ithinkLogistics.loadFromDatabase();

        const { orderIds } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({ error: 'orderIds array is required' });
        }

        // Fetch orders with AWB numbers
        const orders = await req.prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: {
                id: true,
                orderNumber: true,
                awbNumber: true,
            }
        });

        // Collect AWBs to track (filter out nulls)
        const awbToOrderMap = {};
        const awbsToTrack = [];

        for (const order of orders) {
            if (order.awbNumber) {
                awbToOrderMap[order.awbNumber] = order;
                awbsToTrack.push(order.awbNumber);
            }
        }

        if (awbsToTrack.length === 0) {
            return res.json({
                message: 'No AWB numbers found for these orders',
                results: {}
            });
        }

        // Track in batches of 10
        const results = {};
        for (let i = 0; i < awbsToTrack.length; i += 10) {
            const batch = awbsToTrack.slice(i, i + 10);
            const trackingData = await ithinkLogistics.trackShipments(batch);

            for (const awb of batch) {
                const order = awbToOrderMap[awb];
                const data = trackingData[awb];

                if (data && data.message === 'success') {
                    results[order.id] = {
                        orderId: order.id,
                        orderNumber: order.orderNumber,
                        awbNumber: awb,
                        courier: data.logistic,
                        currentStatus: data.current_status,
                        statusCode: data.current_status_code,
                        internalStatus: ithinkLogistics.mapToInternalStatus(data.current_status_code, data.current_status),
                        expectedDeliveryDate: data.expected_delivery_date,
                        ofdCount: parseInt(data.ofd_count) || 0,
                        isRto: !!data.return_tracking_no,
                        rtoAwb: data.return_tracking_no || null,
                        lastScan: data.last_scan_details ? {
                            status: data.last_scan_details.status,
                            location: data.last_scan_details.scan_location,
                            datetime: data.last_scan_details.status_date_time,
                            remark: data.last_scan_details.remark,
                        } : null,
                    };
                } else {
                    results[order.id] = {
                        orderId: order.id,
                        orderNumber: order.orderNumber,
                        awbNumber: awb,
                        error: data?.message || 'Tracking not available',
                    };
                }
            }
        }

        res.json({ results });
    } catch (error) {
        console.error('Track orders error:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch tracking' });
    }
});

/**
 * Get full tracking history for an AWB
 * GET /api/tracking/history/:awbNumber
 */
router.get('/history/:awbNumber', authenticateToken, async (req, res) => {
    try {
        await ithinkLogistics.loadFromDatabase();

        const { awbNumber } = req.params;
        const tracking = await ithinkLogistics.getTrackingStatus(awbNumber);

        if (!tracking) {
            return res.status(404).json({ error: 'AWB not found or tracking unavailable' });
        }

        res.json({
            awbNumber: tracking.awbNumber,
            courier: tracking.courier,
            currentStatus: tracking.currentStatus,
            statusCode: tracking.statusCode,
            history: tracking.scanHistory,
        });
    } catch (error) {
        console.error('Get tracking history error:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch tracking history' });
    }
});

// ============================================
// SYNC
// ============================================

/**
 * Get tracking sync status
 * GET /api/tracking/sync/status
 */
router.get('/sync/status', authenticateToken, async (req, res) => {
    try {
        const status = trackingSync.getStatus();
        res.json(status);
    } catch (error) {
        console.error('Get tracking sync status error:', error);
        res.status(500).json({ error: 'Failed to get sync status' });
    }
});

/**
 * Trigger tracking sync manually
 * POST /api/tracking/sync/trigger
 */
router.post('/sync/trigger', authenticateToken, async (req, res) => {
    try {
        const result = await trackingSync.triggerSync();
        res.json(result);
    } catch (error) {
        console.error('Trigger tracking sync error:', error);
        res.status(500).json({ error: 'Failed to trigger sync' });
    }
});

/**
 * Backfill shipped orders with tracking data (one-time)
 * POST /api/tracking/sync/backfill
 * Query: days=30 (optional), limit=100 (optional, max orders to process)
 */
router.post('/sync/backfill', authenticateToken, async (req, res) => {
    try {
        await ithinkLogistics.loadFromDatabase();

        if (!ithinkLogistics.isConfigured()) {
            return res.status(400).json({ error: 'iThink Logistics not configured' });
        }

        const days = parseInt(req.query.days) || 30;
        const limit = parseInt(req.query.limit) || 100;
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);

        // Get shipped orders with AWB from last N days, newest first
        const orders = await req.prisma.order.findMany({
            where: {
                status: { in: ['shipped', 'delivered'] },
                awbNumber: { not: null },
                shippedAt: { gte: sinceDate },
            },
            select: {
                id: true,
                orderNumber: true,
                awbNumber: true,
                customerId: true,
                rtoInitiatedAt: true,
            },
            orderBy: { shippedAt: 'desc' },
            take: limit,
        });

        const result = {
            ordersFound: orders.length,
            updated: 0,
            errors: 0,
            apiCalls: 0,
        };

        // Create AWB to order mapping
        const awbToOrder = new Map();
        for (const order of orders) {
            if (order.awbNumber) {
                awbToOrder.set(order.awbNumber, order);
            }
        }

        const awbNumbers = Array.from(awbToOrder.keys());

        // Process in batches of 10
        for (let i = 0; i < awbNumbers.length; i += 10) {
            const batch = awbNumbers.slice(i, i + 10);
            result.apiCalls++;

            try {
                const trackingResults = await ithinkLogistics.trackShipments(batch);

                for (const [awb, rawData] of Object.entries(trackingResults)) {
                    const order = awbToOrder.get(awb);
                    if (!order) continue;
                    if (!rawData || rawData.message !== 'success') continue;

                    try {
                        // Pass both status code AND status text for smarter mapping
                        const updateData = {
                            trackingStatus: ithinkLogistics.mapToInternalStatus(rawData.current_status_code, rawData.current_status),
                            courierStatusCode: rawData.current_status_code || null,
                            courier: rawData.logistic || null,
                            deliveryAttempts: parseInt(rawData.ofd_count) || 0,
                            lastTrackingUpdate: new Date(),
                        };

                        // Expected delivery date
                        if (rawData.expected_delivery_date && rawData.expected_delivery_date !== '0000-00-00') {
                            try {
                                updateData.expectedDeliveryDate = new Date(rawData.expected_delivery_date);
                            } catch (e) {}
                        }

                        // Last scan details - use correct field names from iThink API
                        if (rawData.last_scan_details) {
                            updateData.lastScanStatus = rawData.last_scan_details.status || null;
                            updateData.lastScanLocation = rawData.last_scan_details.scan_location || null;  // Fixed: was 'location'
                            if (rawData.last_scan_details.status_date_time) {  // Fixed: was 'date_time'
                                try {
                                    updateData.lastScanAt = new Date(rawData.last_scan_details.status_date_time);
                                } catch (e) {}
                            }
                        }

                        // Delivery date
                        if (updateData.trackingStatus === 'delivered' && rawData.last_scan_details?.status_date_time) {
                            updateData.deliveredAt = new Date(rawData.last_scan_details.status_date_time);
                        }

                        // RTO
                        if (rawData.return_tracking_no) {
                            updateData.rtoInitiatedAt = new Date();

                            // Increment customer RTO count on first RTO initiation
                            if (!order.rtoInitiatedAt && order.customerId) {
                                await req.prisma.customer.update({
                                    where: { id: order.customerId },
                                    data: { rtoCount: { increment: 1 } },
                                });
                            }
                        }

                        await req.prisma.order.update({
                            where: { id: order.id },
                            data: updateData,
                        });
                        result.updated++;
                    } catch (err) {
                        result.errors++;
                    }
                }

                // Rate limiting
                if (i + 10 < awbNumbers.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (err) {
                console.error('Backfill batch error:', err.message);
                result.errors++;
            }
        }

        res.json(result);
    } catch (error) {
        console.error('Backfill tracking error:', error);
        res.status(500).json({ error: 'Failed to backfill tracking data' });
    }
});

export default router;
