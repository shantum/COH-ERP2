/**
 * @module routes/tracking
 * @description iThink Logistics tracking integration
 *
 * Provides AWB tracking, shipment creation, and background sync for delivery status.
 *
 * Status Mapping (iThink → Internal):
 * - '6'/'delivered' → 'delivered'
 * - '7'/'rto_*' → 'rto_initiated'/'rto_in_transit'/'rto_delivered'
 * - '36'/'cancelled' → 'cancelled'
 * - '11'/'lost' → 'lost'
 * - Other codes → 'in_transit'/'out_for_delivery'
 *
 * Background Sync: trackingSync service updates shipped orders every 30min (configurable).
 * RTO Detection: return_tracking_no field presence triggers rtoInitiatedAt timestamp and customer.rtoCount increment.
 *
 * @see services/ithinkLogistics.js - API wrapper with status mapping
 * @see services/trackingSync.js - Background sync scheduler
 */

import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
    NotFoundError,
    ValidationError,
    BusinessLogicError,
    ExternalServiceError,
} from '../utils/errors.js';
import ithinkLogistics from '../services/ithinkLogistics.js';
import { updateCustomerTier } from '../utils/tierUtils.js';
import trackingSync from '../services/trackingSync.js';

const router = Router();

// ============================================
// CONFIGURATION
// ============================================

/**
 * Get iThink Logistics configuration (credentials masked)
 * @route GET /api/tracking/config
 * @returns {Object} config - { accessToken: '***', secretKey: '***', pickupAddressId, returnAddressId, defaultLogistics }
 */
router.get('/config', authenticateToken, asyncHandler(async (req, res) => {
    await ithinkLogistics.loadFromDatabase();
    res.json(ithinkLogistics.getConfig());
}));

/**
 * Update iThink Logistics credentials (stored in SystemSetting table)
 * @route PUT /api/tracking/config
 * @param {Object} body.accessToken - iThink API access token
 * @param {Object} body.secretKey - iThink API secret key
 * @param {string} [body.pickupAddressId] - Default pickup location
 * @param {string} [body.returnAddressId] - Default return location
 * @param {string} [body.defaultLogistics] - Preferred courier (e.g., 'Delhivery')
 */
router.put('/config', authenticateToken, asyncHandler(async (req, res) => {
    const { accessToken, secretKey, pickupAddressId, returnAddressId, defaultLogistics } = req.body;

    // At minimum need tokens if updating credentials
    if (accessToken !== undefined || secretKey !== undefined) {
        if (!accessToken || !secretKey) {
            throw new ValidationError('Both access token and secret key are required');
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
}));

/**
 * Test iThink API credentials (uses dummy AWB to validate auth)
 * @route POST /api/tracking/test-connection
 * @returns {Object} { success: boolean, message: string }
 */
router.post('/test-connection', authenticateToken, asyncHandler(async (req, res) => {
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
}));

// ============================================
// TRACKING
// ============================================

/**
 * Track single AWB number with full details
 * @route GET /api/tracking/awb/:awbNumber
 * @param {string} awbNumber - AWB to track
 * @returns {Object} tracking - { awbNumber, courier, currentStatus, statusCode, expectedDeliveryDate, isRto, lastScan, scanHistory }
 * @example GET /api/tracking/awb/ABC123456789
 */
router.get('/awb/:awbNumber', authenticateToken, asyncHandler(async (req, res) => {
    await ithinkLogistics.loadFromDatabase();

    const { awbNumber } = req.params;

    try {
        const tracking = await ithinkLogistics.getTrackingStatus(awbNumber);

        if (!tracking) {
            throw new NotFoundError('AWB not found or tracking unavailable', 'AWB', awbNumber);
        }

        res.json(tracking);
    } catch (error) {
        if (error.name === 'NotFoundError') {
            throw error;
        }
        throw new ExternalServiceError(
            `Failed to fetch tracking for AWB ${awbNumber}: ${error.message}`,
            'iThink Logistics'
        );
    }
}));

/**
 * Batch track multiple AWBs (max 10 per request, rate-limited by iThink)
 * @route POST /api/tracking/batch
 * @param {string[]} body.awbNumbers - Array of AWB numbers (max 10)
 * @returns {Object} results - Map of awbNumber → { success, courier, currentStatus, statusCode, isRto, lastScan } | { success: false, error }
 * @example POST /api/tracking/batch { "awbNumbers": ["AWB1", "AWB2"] }
 */
router.post('/batch', authenticateToken, asyncHandler(async (req, res) => {
    await ithinkLogistics.loadFromDatabase();

    const { awbNumbers } = req.body;

    if (!awbNumbers || !Array.isArray(awbNumbers) || awbNumbers.length === 0) {
        throw new ValidationError('awbNumbers array is required');
    }

    if (awbNumbers.length > 10) {
        throw new ValidationError('Maximum 10 AWB numbers per request');
    }

    try {
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
        throw new ExternalServiceError(
            `Failed to fetch batch tracking: ${error.message}`,
            'iThink Logistics'
        );
    }
}));

/**
 * Track orders by order UUIDs (lookup AWB from DB, then fetch tracking)
 * @route POST /api/tracking/orders
 * @param {string[]} body.orderIds - Array of order UUIDs
 * @returns {Object} { results: { orderId → trackingData } }
 * @example POST /api/tracking/orders { "orderIds": ["uuid1", "uuid2"] }
 */
router.post('/orders', authenticateToken, asyncHandler(async (req, res) => {
    await ithinkLogistics.loadFromDatabase();

    const { orderIds } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        throw new ValidationError('orderIds array is required');
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

    try {
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
        throw new ExternalServiceError(
            `Failed to fetch order tracking: ${error.message}`,
            'iThink Logistics'
        );
    }
}));

/**
 * Get full scan history timeline for AWB
 * @route GET /api/tracking/history/:awbNumber
 * @param {string} awbNumber - AWB to fetch history for
 * @returns {Object} { awbNumber, courier, currentStatus, statusCode, history: [{ status, location, datetime, remark }] }
 */
router.get('/history/:awbNumber', authenticateToken, asyncHandler(async (req, res) => {
    await ithinkLogistics.loadFromDatabase();

    const { awbNumber } = req.params;

    try {
        const tracking = await ithinkLogistics.getTrackingStatus(awbNumber);

        if (!tracking) {
            throw new NotFoundError('AWB not found or tracking unavailable', 'AWB', awbNumber);
        }

        res.json({
            awbNumber: tracking.awbNumber,
            courier: tracking.courier,
            currentStatus: tracking.currentStatus,
            statusCode: tracking.statusCode,
            history: tracking.scanHistory,
        });
    } catch (error) {
        if (error.name === 'NotFoundError') {
            throw error;
        }
        throw new ExternalServiceError(
            `Failed to fetch tracking history for AWB ${awbNumber}: ${error.message}`,
            'iThink Logistics'
        );
    }
}));

// ============================================
// SYNC
// ============================================

/**
 * Get background tracking sync status
 * @route GET /api/tracking/sync/status
 * @returns {Object} { schedulerActive, isRunning, intervalMinutes, lastSyncAt, lastSyncResult }
 */
router.get('/sync/status', authenticateToken, asyncHandler(async (req, res) => {
    const status = trackingSync.getStatus();
    res.json(status);
}));

/**
 * Manually trigger background sync (updates all shipped orders)
 * @route POST /api/tracking/sync/trigger
 * @returns {Object} { ordersProcessed, updated, errors }
 */
router.post('/sync/trigger', authenticateToken, asyncHandler(async (req, res) => {
    const result = await trackingSync.triggerSync();
    res.json(result);
}));

/**
 * One-time backfill of tracking data for old shipped orders
 * @route POST /api/tracking/sync/backfill?days=30&limit=100
 * @param {number} [query.days=30] - How far back to fetch orders
 * @param {number} [query.limit=100] - Max orders to process
 * @returns {Object} { ordersFound, updated, errors, apiCalls }
 * @description Updates trackingStatus, courierStatusCode, deliveredAt, and detects RTOs. Rate-limited (1s delay between batches).
 */
router.post('/sync/backfill', authenticateToken, asyncHandler(async (req, res) => {
    await ithinkLogistics.loadFromDatabase();

    if (!ithinkLogistics.isConfigured()) {
        throw new ValidationError('iThink Logistics not configured');
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

                    // Delivery date and tier update
                    const isNewDelivery = updateData.trackingStatus === 'delivered' && !order.deliveredAt;
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

                    // Update customer tier on new delivery
                    if (isNewDelivery && order.customerId) {
                        await updateCustomerTier(req.prisma, order.customerId);
                    }
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
}));

// ============================================
// ORDER CREATION (Book shipment with iThink)
// ============================================

/**
 * Create shipment and generate AWB (books order with iThink)
 * @route POST /api/tracking/create-shipment
 * @param {string} body.orderId - Order UUID to create shipment for
 * @param {string} [body.logistics] - Preferred courier (overrides default)
 * @returns {Object} { success, awbNumber, logistics, orderId }
 * @description Fetches order data (customer, lines), validates address, calculates COD amount (active lines only), and calls iThink createOrder API.
 * @throws {ValidationError} If order missing AWB number already exists or address fields missing
 * @example POST /api/tracking/create-shipment { "orderId": "uuid", "logistics": "Delhivery" }
 */
router.post('/create-shipment', authenticateToken, asyncHandler(async (req, res) => {
    await ithinkLogistics.loadFromDatabase();

    if (!ithinkLogistics.isFullyConfigured()) {
        throw new ValidationError(
            'iThink Logistics not fully configured. Need access_token, secret_key, pickup_address_id, and return_address_id'
        );
    }

    const { orderId, logistics } = req.body;

    if (!orderId) {
        throw new ValidationError('orderId is required');
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
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    if (order.awbNumber) {
        throw new BusinessLogicError(
            `Order already has an AWB number: ${order.awbNumber}`,
            'duplicate_awb'
        );
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
        throw new ValidationError(
            `Missing required address information: ${!customerData.address ? 'address ' : ''}${!customerData.pincode ? 'pincode ' : ''}${!customerData.phone ? 'phone' : ''}`
        );
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
        throw new ValidationError('Order has no active line items (all lines may be cancelled)');
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

    try {
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
        throw new ExternalServiceError(
            `Failed to create shipment with iThink Logistics: ${error.message}`,
            'iThink Logistics'
        );
    }
}));

/**
 * Cancel shipment with iThink (sets trackingStatus='cancelled' if successful)
 * @route POST /api/tracking/cancel-shipment
 * @param {string} [body.awbNumber] - Single AWB to cancel
 * @param {string[]} [body.awbNumbers] - Multiple AWBs to cancel
 * @param {string} [body.orderId] - Order UUID (looks up AWB from DB)
 * @returns {Object} { success, message, results: { awb → { success, message } } }
 */
router.post('/cancel-shipment', authenticateToken, asyncHandler(async (req, res) => {
    await ithinkLogistics.loadFromDatabase();

    if (!ithinkLogistics.isConfigured()) {
        throw new ValidationError('iThink Logistics not configured');
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
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        if (!order.awbNumber) {
            throw new BusinessLogicError('Order has no AWB number to cancel', 'no_awb');
        }

        awbsToCancel = [order.awbNumber];
    } else {
        throw new ValidationError('awbNumber, awbNumbers, or orderId is required');
    }

    try {
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
        throw new ExternalServiceError(
            `Failed to cancel shipment: ${error.message}`,
            'iThink Logistics'
        );
    }
}));

// ============================================
// SHIPPING LABELS
// ============================================

/**
 * Get shipping label PDF URL(s) from iThink
 * @route POST /api/tracking/label
 * @param {string} [body.awbNumber] - Single AWB
 * @param {string[]} [body.awbNumbers] - Multiple AWBs
 * @param {string} [body.orderId] - Order UUID (looks up AWB)
 * @param {string} [body.pageSize='A4'] - 'A4' or 'A6'
 * @param {boolean} [body.displayCodPrepaid] - Show COD/Prepaid on label
 * @param {boolean} [body.displayShipperMobile] - Show shipper phone
 * @param {boolean} [body.displayShipperAddress] - Show return address
 * @returns {Object} { labelUrl: string }
 */
router.post('/label', authenticateToken, asyncHandler(async (req, res) => {
    await ithinkLogistics.loadFromDatabase();

    if (!ithinkLogistics.isConfigured()) {
        throw new ValidationError('iThink Logistics not configured');
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
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        if (!order.awbNumber) {
            throw new BusinessLogicError('Order has no AWB number', 'no_awb');
        }

        awbsForLabel = [order.awbNumber];
    } else {
        throw new ValidationError('awbNumber, awbNumbers, or orderId is required');
    }

    try {
        const result = await ithinkLogistics.getShippingLabel(awbsForLabel, {
            pageSize,
            displayCodPrepaid,
            displayShipperMobile,
            displayShipperAddress,
        });

        res.json(result);
    } catch (error) {
        throw new ExternalServiceError(
            `Failed to get shipping label: ${error.message}`,
            'iThink Logistics'
        );
    }
}));

// ============================================
// PINCODE & RATE CHECK
// ============================================

/**
 * Check pincode serviceability via iThink API
 * @route GET /api/tracking/pincode/:pincode
 * @param {string} pincode - 6-digit Indian pincode
 * @returns {Object} { serviceable: boolean, city, state, courierList }
 */
router.get('/pincode/:pincode', authenticateToken, asyncHandler(async (req, res) => {
    await ithinkLogistics.loadFromDatabase();

    if (!ithinkLogistics.isConfigured()) {
        throw new ValidationError('iThink Logistics not configured');
    }

    const { pincode } = req.params;

    if (!pincode || pincode.length !== 6) {
        throw new ValidationError('Valid 6-digit pincode is required');
    }

    try {
        const result = await ithinkLogistics.checkPincode(pincode);
        res.json(result);
    } catch (error) {
        throw new ExternalServiceError(
            `Failed to check pincode serviceability: ${error.message}`,
            'iThink Logistics'
        );
    }
}));

/**
 * Get shipping rate quotes from available couriers
 * @route POST /api/tracking/rates
 * @param {string} body.fromPincode - Origin pincode
 * @param {string} body.toPincode - Destination pincode
 * @param {number} [body.length] - Package length (cm)
 * @param {number} [body.width] - Package width (cm)
 * @param {number} [body.height] - Package height (cm)
 * @param {number} [body.weight] - Package weight (kg)
 * @param {string} [body.paymentMethod] - 'COD' or 'Prepaid'
 * @param {number} [body.productMrp] - Product value for insurance
 * @returns {Object[]} rates - [{ courier, rate, estimatedDays }]
 */
router.post('/rates', authenticateToken, asyncHandler(async (req, res) => {
    await ithinkLogistics.loadFromDatabase();

    if (!ithinkLogistics.isConfigured()) {
        throw new ValidationError('iThink Logistics not configured');
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
        throw new ValidationError('fromPincode and toPincode are required');
    }

    try {
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
        throw new ExternalServiceError(
            `Failed to get shipping rates: ${error.message}`,
            'iThink Logistics'
        );
    }
}));

/**
 * Test shipment creation with dummy data (validates API credentials)
 * @route POST /api/tracking/test-create
 * @param {string} [body.logistics] - Test with specific courier
 * @returns {Object} { success, testOrderNumber, awbNumber, logistics, note }
 * @description Creates TEST-{timestamp} order to Mumbai. Cancel in iThink dashboard after testing.
 */
router.post('/test-create', authenticateToken, asyncHandler(async (req, res) => {
    await ithinkLogistics.loadFromDatabase();

    if (!ithinkLogistics.isFullyConfigured()) {
        throw new ValidationError(
            'iThink Logistics not fully configured. Need access_token, secret_key, pickup_address_id, and return_address_id'
        );
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

    try {
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
        throw new ExternalServiceError(
            `Failed to create test shipment: ${error.message}`,
            'iThink Logistics'
        );
    }
}));

export default router;
