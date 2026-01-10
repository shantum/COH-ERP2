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
        const { accessToken, secretKey, pickupAddressId, returnAddressId, defaultLogistics } = req.body;

        // At minimum need tokens if updating credentials
        if (accessToken !== undefined || secretKey !== undefined) {
            if (!accessToken || !secretKey) {
                return res.status(400).json({ error: 'Both access token and secret key are required' });
            }
        }

        await ithinkLogistics.updateConfig({
            accessToken,
            secretKey,
            pickupAddressId,
            returnAddressId,
            defaultLogistics,
        });

        res.json({
            message: 'iThink Logistics configuration updated',
            config: ithinkLogistics.getConfig(),
        });
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

// ============================================
// ORDER CREATION (Book shipment with iThink)
// ============================================

/**
 * Create a shipment with iThink Logistics and get AWB
 * POST /api/tracking/create-shipment
 * Body: { orderId: "uuid" } or direct order data
 */
router.post('/create-shipment', authenticateToken, async (req, res) => {
    try {
        await ithinkLogistics.loadFromDatabase();

        if (!ithinkLogistics.isFullyConfigured()) {
            return res.status(400).json({
                error: 'iThink Logistics not fully configured',
                details: 'Need access_token, secret_key, pickup_address_id, and return_address_id',
                config: ithinkLogistics.getConfig(),
            });
        }

        const { orderId, logistics } = req.body;

        if (!orderId) {
            return res.status(400).json({ error: 'orderId is required' });
        }

        // Fetch order with customer, shopify cache, and line items
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: {
                customer: true,
                shopifyCache: true,
                orderLines: {
                    include: {
                        sku: {
                            include: {
                                variation: {
                                    include: { product: true }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.awbNumber) {
            return res.status(400).json({
                error: 'Order already has an AWB number',
                awbNumber: order.awbNumber,
            });
        }

        // Parse Shopify raw data if available
        let shopifyShippingAddress = null;
        let shopifyPhone = null;
        if (order.shopifyCache?.rawData) {
            try {
                const rawData = typeof order.shopifyCache.rawData === 'string'
                    ? JSON.parse(order.shopifyCache.rawData)
                    : order.shopifyCache.rawData;
                shopifyShippingAddress = rawData.shipping_address || rawData.billing_address;
                shopifyPhone = rawData.phone || rawData.billing_address?.phone || rawData.shipping_address?.phone;
            } catch (e) {
                console.error('Failed to parse shopify rawData:', e.message);
            }
        }

        // Build customer address from order or customer record
        const customerData = {
            name: order.customerName || `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim() || 'Customer',
            phone: shopifyPhone || order.customer?.phone || '9999999999',
            email: order.customer?.email || order.shopifyCache?.email || '',
            address: shopifyShippingAddress?.address1 || order.customer?.address || '',
            address2: shopifyShippingAddress?.address2 || '',
            city: shopifyShippingAddress?.city || order.shopifyCache?.shippingCity || order.customer?.city || '',
            state: shopifyShippingAddress?.province || order.shopifyCache?.shippingState || order.customer?.state || '',
            pincode: shopifyShippingAddress?.zip || order.customer?.pincode || '',
        };

        // Validate required fields
        if (!customerData.address || !customerData.pincode || !customerData.phone) {
            return res.status(400).json({
                error: 'Missing required address information',
                details: {
                    hasAddress: !!customerData.address,
                    hasPincode: !!customerData.pincode,
                    hasPhone: !!customerData.phone,
                },
            });
        }

        // Build products array from order lines - exclude cancelled lines
        const activeLines = order.orderLines.filter(line => line.status !== 'cancelled');
        const products = activeLines.map(line => ({
            name: line.sku?.variation?.product?.name || line.productName || 'Product',
            sku: line.sku?.skuCode || '',
            quantity: line.quantity || 1,
            price: line.unitPrice || line.price || 0,
        }));

        // Validate products - must have at least one active line
        if (products.length === 0) {
            return res.status(400).json({ error: 'Order has no active line items (all lines may be cancelled)' });
        }

        // Calculate active order value (excluding cancelled lines)
        const activeOrderValue = activeLines.reduce((sum, line) => {
            return sum + ((line.unitPrice || line.price || 0) * (line.quantity || 1));
        }, 0);

        console.log(`[Create Shipment] Order ${order.orderNumber} - ${products.length} products:`, JSON.stringify(products));

        // Default dimensions (can be made configurable later)
        const dimensions = {
            length: 20, // cm
            width: 15,  // cm
            height: 10, // cm
            weight: 0.5, // kg
        };

        // Determine payment mode and COD amount (use active order value, not original total)
        const paymentMode = order.paymentStatus === 'cod_pending' || order.shopifyCache?.financialStatus === 'pending' ? 'COD' : 'Prepaid';
        const codAmount = paymentMode === 'COD' ? activeOrderValue : 0;

        // Create shipment with iThink
        const result = await ithinkLogistics.createOrder({
            orderNumber: order.orderNumber,
            orderDate: order.orderDate || new Date(),
            totalAmount: activeOrderValue, // Use active lines value, not original total
            customer: customerData,
            products,
            dimensions,
            paymentMode,
            codAmount,
            logistics: logistics || undefined,
        });

        // Update order with AWB number
        await req.prisma.order.update({
            where: { id: orderId },
            data: {
                awbNumber: result.awbNumber,
                courier: result.logistics,
                trackingStatus: 'manifested',
            }
        });

        res.json({
            success: true,
            message: 'Shipment created successfully',
            awbNumber: result.awbNumber,
            logistics: result.logistics,
            orderId: result.orderId,
        });
    } catch (error) {
        console.error('Create shipment error:', error);
        res.status(500).json({ error: error.message || 'Failed to create shipment' });
    }
});

/**
 * Cancel a shipment by AWB number
 * POST /api/tracking/cancel-shipment
 * Body: { awbNumber: "AWB123" } or { awbNumbers: ["AWB1", "AWB2"] } or { orderId: "uuid" }
 */
router.post('/cancel-shipment', authenticateToken, async (req, res) => {
    try {
        await ithinkLogistics.loadFromDatabase();

        if (!ithinkLogistics.isConfigured()) {
            return res.status(400).json({ error: 'iThink Logistics not configured' });
        }

        const { awbNumber, awbNumbers, orderId } = req.body;

        let awbsToCancel = [];

        // Option 1: Single AWB
        if (awbNumber) {
            awbsToCancel = [awbNumber];
        }
        // Option 2: Multiple AWBs
        else if (awbNumbers && Array.isArray(awbNumbers)) {
            awbsToCancel = awbNumbers;
        }
        // Option 3: By order ID - lookup AWB from order
        else if (orderId) {
            const order = await req.prisma.order.findUnique({
                where: { id: orderId },
                select: { id: true, orderNumber: true, awbNumber: true }
            });

            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }

            if (!order.awbNumber) {
                return res.status(400).json({ error: 'Order has no AWB number to cancel' });
            }

            awbsToCancel = [order.awbNumber];
        } else {
            return res.status(400).json({ error: 'awbNumber, awbNumbers, or orderId is required' });
        }

        // Call iThink cancel API
        const result = await ithinkLogistics.cancelShipment(awbsToCancel);

        // If cancelling by order ID, update the order status
        if (orderId && result.results) {
            const awb = awbsToCancel[0];
            const cancelResult = result.results[awb];

            if (cancelResult?.success) {
                await req.prisma.order.update({
                    where: { id: orderId },
                    data: {
                        trackingStatus: 'cancelled',
                    }
                });
            }
        }

        res.json({
            success: true,
            message: 'Cancellation request processed',
            results: result.results,
        });
    } catch (error) {
        console.error('Cancel shipment error:', error);
        res.status(500).json({ error: error.message || 'Failed to cancel shipment' });
    }
});

// ============================================
// SHIPPING LABELS
// ============================================

/**
 * Get shipping label PDF for AWB number(s)
 * POST /api/tracking/label
 * Body: { awbNumber: "AWB123" } or { awbNumbers: ["AWB1", "AWB2"] } or { orderId: "uuid" }
 * Optional: pageSize ("A4" or "A6"), displayCodPrepaid, displayShipperMobile, displayShipperAddress
 */
router.post('/label', authenticateToken, async (req, res) => {
    try {
        await ithinkLogistics.loadFromDatabase();

        if (!ithinkLogistics.isConfigured()) {
            return res.status(400).json({ error: 'iThink Logistics not configured' });
        }

        const {
            awbNumber,
            awbNumbers,
            orderId,
            pageSize,
            displayCodPrepaid,
            displayShipperMobile,
            displayShipperAddress,
        } = req.body;

        let awbsForLabel = [];

        // Option 1: Single AWB
        if (awbNumber) {
            awbsForLabel = [awbNumber];
        }
        // Option 2: Multiple AWBs
        else if (awbNumbers && Array.isArray(awbNumbers)) {
            awbsForLabel = awbNumbers;
        }
        // Option 3: By order ID - lookup AWB from order
        else if (orderId) {
            const order = await req.prisma.order.findUnique({
                where: { id: orderId },
                select: { id: true, orderNumber: true, awbNumber: true }
            });

            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }

            if (!order.awbNumber) {
                return res.status(400).json({ error: 'Order has no AWB number' });
            }

            awbsForLabel = [order.awbNumber];
        } else {
            return res.status(400).json({ error: 'awbNumber, awbNumbers, or orderId is required' });
        }

        const result = await ithinkLogistics.getShippingLabel(awbsForLabel, {
            pageSize,
            displayCodPrepaid,
            displayShipperMobile,
            displayShipperAddress,
        });

        res.json(result);
    } catch (error) {
        console.error('Get shipping label error:', error);
        res.status(500).json({ error: error.message || 'Failed to get shipping label' });
    }
});

// ============================================
// PINCODE & RATE CHECK
// ============================================

/**
 * Check pincode serviceability
 * GET /api/tracking/pincode/:pincode
 */
router.get('/pincode/:pincode', authenticateToken, async (req, res) => {
    try {
        await ithinkLogistics.loadFromDatabase();

        if (!ithinkLogistics.isConfigured()) {
            return res.status(400).json({ error: 'iThink Logistics not configured' });
        }

        const { pincode } = req.params;

        if (!pincode || pincode.length !== 6) {
            return res.status(400).json({ error: 'Valid 6-digit pincode is required' });
        }

        const result = await ithinkLogistics.checkPincode(pincode);
        res.json(result);
    } catch (error) {
        console.error('Check pincode error:', error);
        res.status(500).json({ error: error.message || 'Failed to check pincode' });
    }
});

/**
 * Get shipping rates from logistics providers
 * POST /api/tracking/rates
 * Body: { fromPincode, toPincode, length?, width?, height?, weight?, paymentMethod?, productMrp? }
 */
router.post('/rates', authenticateToken, async (req, res) => {
    try {
        await ithinkLogistics.loadFromDatabase();

        if (!ithinkLogistics.isConfigured()) {
            return res.status(400).json({ error: 'iThink Logistics not configured' });
        }

        const {
            fromPincode,
            toPincode,
            length,
            width,
            height,
            weight,
            orderType,
            paymentMethod,
            productMrp,
        } = req.body;

        if (!fromPincode || !toPincode) {
            return res.status(400).json({ error: 'fromPincode and toPincode are required' });
        }

        const result = await ithinkLogistics.getRates({
            fromPincode,
            toPincode,
            length,
            width,
            height,
            weight,
            orderType,
            paymentMethod,
            productMrp,
        });

        res.json(result);
    } catch (error) {
        console.error('Get rates error:', error);
        res.status(500).json({ error: error.message || 'Failed to get rates' });
    }
});

/**
 * Test order creation with sample data (for testing API connection)
 * POST /api/tracking/test-create
 */
router.post('/test-create', authenticateToken, async (req, res) => {
    try {
        await ithinkLogistics.loadFromDatabase();

        if (!ithinkLogistics.isFullyConfigured()) {
            return res.status(400).json({
                error: 'iThink Logistics not fully configured',
                config: ithinkLogistics.getConfig(),
            });
        }

        // Use test data
        const testOrderNumber = `TEST-${Date.now()}`;
        const testData = {
            orderNumber: testOrderNumber,
            orderDate: new Date(),
            totalAmount: 999,
            customer: {
                name: 'Test Customer',
                phone: '9876543210',
                email: 'test@example.com',
                address: '123 Test Street',
                address2: 'Test Area',
                city: 'Mumbai',
                state: 'Maharashtra',
                pincode: '400001',
            },
            products: [
                { name: 'Test Product', sku: 'TEST-001', quantity: 1, price: 999 }
            ],
            dimensions: { length: 10, width: 10, height: 5, weight: 0.5 },
            paymentMode: 'Prepaid',
            codAmount: 0,
            logistics: req.body.logistics || undefined,
        };

        const result = await ithinkLogistics.createOrder(testData);

        res.json({
            success: true,
            message: 'Test shipment created successfully',
            testOrderNumber,
            awbNumber: result.awbNumber,
            logistics: result.logistics,
            note: 'This is a test order. You may want to cancel it in iThink dashboard.',
        });
    } catch (error) {
        console.error('Test create error:', error);
        res.status(500).json({ error: error.message || 'Failed to create test shipment' });
    }
});

export default router;
