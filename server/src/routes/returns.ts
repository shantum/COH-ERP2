/**
 * Returns API Routes
 *
 * Handles return-related operations that require Express endpoints,
 * specifically for integrating with external logistics APIs.
 *
 * AUTO-GROUPING: When scheduling a pickup for one line, we automatically
 * include all other lines from the same order that have returnStatus='requested'.
 * This clubs returns together so they share one AWB and pickup.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import ithinkLogistics from '../services/ithinkLogistics/index.js';
import type { ProductInfo, ShipmentDimensions } from '../services/ithinkLogistics/index.js';
import { shippingLogger } from '../utils/logger.js';

const router: Router = Router();

// ============================================================================
// Configuration
// ============================================================================

/**
 * Auto-group returns from same order into one pickup.
 * When true, scheduling pickup for one line will include all sibling lines
 * with returnStatus='requested' from the same order.
 */
const AUTO_GROUP_RETURNS_BY_ORDER = true;

/**
 * Default shipment dimensions for apparel returns.
 * These scale based on number of items.
 */
const BASE_DIMENSIONS = {
    length: 25,  // cm
    width: 20,   // cm
    height: 5,   // cm per item
    weight: 0.3, // kg per item
};

// ============================================================================
// Input Validation Schemas
// ============================================================================

const SchedulePickupSchema = z.object({
    orderLineId: z.string().uuid(),
});

const CheckServiceabilitySchema = z.object({
    pincode: z.string().min(6).max(6),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /api/returns/check-serviceability
 *
 * Check if a pincode supports reverse pickup
 */
router.post('/check-serviceability', authenticateToken, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const parseResult = CheckServiceabilitySchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(400).json({
                success: false,
                error: 'Invalid pincode',
                details: parseResult.error.issues,
            });
            return;
        }

        const { pincode } = parseResult.data;
        const result = await ithinkLogistics.checkReversePickupServiceability(pincode);

        res.json({
            success: true,
            data: result,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        shippingLogger.error({ error: message }, 'Serviceability check failed');
        res.status(500).json({
            success: false,
            error: message,
        });
    }
}));

/**
 * POST /api/returns/schedule-pickup
 *
 * Schedule a reverse pickup with iThink Logistics.
 *
 * AUTO-GROUPING BEHAVIOR:
 * When a line has a returnBatchNumber, ALL lines in that batch with status='requested'
 * are included in the same pickup and share the AWB number.
 */
router.post('/schedule-pickup', authenticateToken, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const parseResult = SchedulePickupSchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(400).json({
                success: false,
                error: 'Invalid request',
                details: parseResult.error.issues,
            });
            return;
        }

        const { orderLineId } = parseResult.data;
        const prisma = req.prisma;

        // Fetch the trigger line with order and customer data
        const triggerLine = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            include: {
                order: {
                    include: {
                        customer: true,
                    },
                },
                sku: {
                    include: {
                        variation: {
                            include: {
                                product: true,
                            },
                        },
                    },
                },
            },
        });

        if (!triggerLine) {
            res.status(404).json({
                success: false,
                error: 'Order line not found',
            });
            return;
        }

        if (triggerLine.returnStatus !== 'requested') {
            res.status(400).json({
                success: false,
                error: `Cannot schedule pickup: current status is '${triggerLine.returnStatus}'`,
            });
            return;
        }

        // =====================================================================
        // AUTO-GROUPING: Find all lines in the same batch with status='requested'
        // =====================================================================
        let batchLines: typeof triggerLine[] = [triggerLine];

        if (AUTO_GROUP_RETURNS_BY_ORDER && triggerLine.returnBatchNumber) {
            const siblingLines = await prisma.orderLine.findMany({
                where: {
                    returnBatchNumber: triggerLine.returnBatchNumber,
                    returnStatus: 'requested',
                    id: { not: triggerLine.id }, // exclude trigger line (already fetched)
                },
                include: {
                    order: {
                        include: {
                            customer: true,
                        },
                    },
                    sku: {
                        include: {
                            variation: {
                                include: {
                                    product: true,
                                },
                            },
                        },
                    },
                },
            });
            batchLines = [triggerLine, ...siblingLines];
        }

        const { order } = triggerLine;
        const customer = order.customer;

        // Parse shipping address
        type AddressFields = {
            address1?: string;
            address2?: string;
            city?: string;
            province?: string;
            zip?: string;
            name?: string;
            phone?: string;
        };
        let shippingAddr: AddressFields = {};
        if (order.shippingAddress) {
            try {
                shippingAddr = typeof order.shippingAddress === 'string'
                    ? JSON.parse(order.shippingAddress)
                    : order.shippingAddress as AddressFields;
            } catch {
                shippingAddr = { address1: order.shippingAddress };
            }
        }

        const pincode = shippingAddr.zip || '';
        if (!pincode) {
            res.status(400).json({
                success: false,
                error: 'Order has no pincode in shipping address',
            });
            return;
        }

        // Check pincode serviceability
        const serviceability = await ithinkLogistics.checkReversePickupServiceability(pincode);
        if (!serviceability.serviceable) {
            res.status(400).json({
                success: false,
                error: serviceability.message || 'Pincode not serviceable for reverse pickup',
            });
            return;
        }

        // =====================================================================
        // Build combined product list from all batch lines
        // =====================================================================
        const products: ProductInfo[] = batchLines.map(line => ({
            name: line.sku?.variation?.product?.name || 'Product',
            sku: line.sku?.skuCode || line.skuId,
            quantity: line.returnQty || line.qty,
            price: line.unitPrice,
        }));

        // Calculate dimensions based on number of items
        const totalQty = batchLines.reduce((sum, line) => sum + (line.returnQty || line.qty), 0);
        const dimensions: ShipmentDimensions = {
            length: BASE_DIMENSIONS.length,
            width: BASE_DIMENSIONS.width,
            height: Math.max(BASE_DIMENSIONS.height, BASE_DIMENSIONS.height * Math.ceil(totalQty / 2)),
            weight: Math.max(0.5, BASE_DIMENSIONS.weight * totalQty),
        };

        // Build customer info
        const customerName = customer
            ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') || order.customerName
            : order.customerName;

        const customerInfo = {
            name: shippingAddr.name || customerName || 'Customer',
            phone: shippingAddr.phone || order.customerPhone || customer?.phone || '',
            address: shippingAddr.address1 || '',
            address2: shippingAddr.address2 || '',
            city: shippingAddr.city || '',
            state: shippingAddr.province || '',
            pincode: pincode,
            email: customer?.email || '',
        };

        // Use batch number in order reference if available
        const orderRef = triggerLine.returnBatchNumber
            ? `RET-${triggerLine.returnBatchNumber}`
            : `RET-${order.orderNumber}`;

        // Create reverse pickup with iThink
        const pickupResult = await ithinkLogistics.createReversePickup({
            orderNumber: orderRef,
            orderDate: order.orderDate || new Date(),
            customer: customerInfo,
            products,
            dimensions,
            returnReason: triggerLine.returnReasonCategory || undefined,
            originalAwbNumber: triggerLine.awbNumber || undefined,
        });

        // =====================================================================
        // Update ALL batch lines with the same AWB
        // =====================================================================
        const now = new Date();
        const lineIds = batchLines.map(l => l.id);

        await prisma.orderLine.updateMany({
            where: { id: { in: lineIds } },
            data: {
                returnStatus: 'approved',
                returnPickupType: 'arranged_by_us',
                returnCourier: pickupResult.logistics,
                returnAwbNumber: pickupResult.awbNumber,
                returnPickupScheduledAt: now,
            },
        });

        shippingLogger.info({
            batchNumber: triggerLine.returnBatchNumber,
            lineIds,
            lineCount: batchLines.length,
            orderNumber: order.orderNumber,
            awbNumber: pickupResult.awbNumber,
        }, 'Reverse pickup scheduled for batch');

        res.json({
            success: true,
            data: {
                orderLineId,
                orderLineIds: lineIds,
                lineCount: batchLines.length,
                batchNumber: triggerLine.returnBatchNumber,
                awbNumber: pickupResult.awbNumber,
                courier: pickupResult.logistics,
                estimatedPickupDate: pickupResult.estimatedPickupDate,
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        shippingLogger.error({ error: message }, 'Schedule pickup failed');
        res.status(500).json({
            success: false,
            error: message,
        });
    }
}));

/**
 * POST /api/returns/tracking/batch
 *
 * Batch fetch tracking status for multiple AWBs (max 50).
 * iThink API supports 10 per call, so we chunk internally.
 * Returns: Record<awbNumber, TrackingData>
 */
router.post('/tracking/batch', authenticateToken, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { awbNumbers } = req.body as { awbNumbers?: string[] };

    if (!awbNumbers || !Array.isArray(awbNumbers) || awbNumbers.length === 0) {
        res.status(400).json({ success: false, error: 'awbNumbers array required' });
        return;
    }

    // Dedupe and limit
    const unique = [...new Set(awbNumbers)].slice(0, 50);

    try {
        const results: Record<string, ReturnType<typeof ithinkLogistics.getTrackingStatus> extends Promise<infer T> ? T : never> = {};

        // iThink API supports 10 per call — chunk
        const chunks: string[][] = [];
        for (let i = 0; i < unique.length; i += 10) {
            chunks.push(unique.slice(i, i + 10));
        }

        await Promise.all(chunks.map(async (chunk) => {
            const rawData = await ithinkLogistics.trackShipments(chunk);
            for (const awb of chunk) {
                const tracking = rawData[awb];
                if (tracking && tracking.message === 'success') {
                    results[awb] = {
                        awbNumber: tracking.awb_no,
                        courier: tracking.logistic,
                        currentStatus: tracking.current_status,
                        statusCode: tracking.current_status_code,
                        expectedDeliveryDate: tracking.expected_delivery_date,
                        promiseDeliveryDate: tracking.promise_delivery_date,
                        ofdCount: parseInt(String(tracking.ofd_count)) || 0,
                        isRto: tracking.return_tracking_no ? true : false,
                        rtoAwb: tracking.return_tracking_no || null,
                        orderType: tracking.order_type || null,
                        cancelStatus: tracking.cancel_status || null,
                        lastScan: tracking.last_scan_details ? {
                            status: tracking.last_scan_details.status,
                            statusCode: tracking.last_scan_details.status_code,
                            location: tracking.last_scan_details.scan_location,
                            datetime: tracking.last_scan_details.status_date_time,
                            remark: tracking.last_scan_details.remark,
                            reason: tracking.last_scan_details.reason,
                        } : null,
                        orderDetails: tracking.order_details ? {
                            orderNumber: tracking.order_details.order_number,
                            subOrderNumber: tracking.order_details.sub_order_number,
                            orderType: tracking.order_details.order_type,
                            weight: tracking.order_details.phy_weight,
                            length: tracking.order_details.ship_length,
                            breadth: tracking.order_details.ship_width,
                            height: tracking.order_details.ship_height,
                            netPayment: tracking.order_details.net_payment,
                        } : null,
                        customerDetails: tracking.customer_details ? {
                            name: tracking.customer_details.customer_name,
                            phone: tracking.customer_details.customer_mobile || tracking.customer_details.customer_phone || '',
                            address1: tracking.customer_details.customer_address1,
                            address2: tracking.customer_details.customer_address2,
                            city: tracking.customer_details.customer_city,
                            state: tracking.customer_details.customer_state,
                            country: tracking.customer_details.customer_country,
                            pincode: tracking.customer_details.customer_pincode,
                        } : null,
                        scanHistory: (tracking.scan_details || []).map((scan) => ({
                            status: scan.status,
                            statusCode: scan.status_code,
                            location: scan.status_location,
                            datetime: scan.status_date_time,
                            remark: scan.status_remark,
                            reason: scan.status_reason,
                        })),
                    };
                }
            }
        }));

        res.json(results);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        shippingLogger.error({ error: message }, 'Batch tracking fetch failed');
        res.status(500).json({ success: false, error: message });
    }
}));

/**
 * GET /api/returns/tracking/:awbNumber
 *
 * Get tracking status for a return shipment AWB
 */
router.get('/tracking/:awbNumber', authenticateToken, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const awbNumber = req.params.awbNumber as string;

    if (!awbNumber) {
        res.status(400).json({
            success: false,
            error: 'AWB number is required',
        });
        return;
    }

    try {
        const trackingData = await ithinkLogistics.getTrackingStatus(awbNumber);

        if (!trackingData) {
            res.status(404).json({
                success: false,
                error: 'Tracking data not found',
            });
            return;
        }

        res.json(trackingData);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        shippingLogger.error({ error: message, awbNumber }, 'Tracking fetch failed');
        res.status(500).json({
            success: false,
            error: message,
        });
    }
}));

export default router;
