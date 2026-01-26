/**
 * Returns API Routes
 *
 * Handles return-related operations that require Express endpoints,
 * specifically for integrating with external logistics APIs.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import ithinkLogistics from '../services/ithinkLogistics.js';
import type { ProductInfo, ShipmentDimensions } from '../services/ithinkLogistics.js';
import { shippingLogger } from '../utils/logger.js';

const router: Router = Router();

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
router.post('/check-serviceability', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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
});

/**
 * POST /api/returns/schedule-pickup
 *
 * Schedule a reverse pickup with iThink Logistics
 * This books a pickup with the courier and returns an AWB number
 */
router.post('/schedule-pickup', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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

        // Fetch order line with order and customer data
        const orderLine = await prisma.orderLine.findUnique({
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

        if (!orderLine) {
            res.status(404).json({
                success: false,
                error: 'Order line not found',
            });
            return;
        }

        // Validate return status
        if (orderLine.returnStatus !== 'requested') {
            res.status(400).json({
                success: false,
                error: `Cannot schedule pickup: current status is '${orderLine.returnStatus}'`,
            });
            return;
        }

        const { order, sku } = orderLine;
        const customer = order.customer;

        // Parse shipping address (stored as JSON string)
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
                // If not JSON, treat as plain address string
                shippingAddr = { address1: order.shippingAddress };
            }
        }

        // Extract pincode from address
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

        // Build product info
        const productName = sku?.variation?.product?.name || 'Product';
        const products: ProductInfo[] = [{
            name: productName,
            sku: sku?.skuCode || orderLine.skuId,
            quantity: orderLine.returnQty || orderLine.qty,
            price: orderLine.unitPrice,
        }];

        // Default dimensions for apparel
        const dimensions: ShipmentDimensions = {
            length: 25,
            width: 20,
            height: 5,
            weight: 0.5,
        };

        // Build customer name from customer record or shipping address
        const customerName = customer
            ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') || order.customerName
            : order.customerName;

        // Build customer info for pickup
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

        // Create reverse pickup with iThink
        const pickupResult = await ithinkLogistics.createReversePickup({
            orderNumber: `RET-${order.orderNumber}`,
            orderDate: order.orderDate || new Date(),
            customer: customerInfo,
            products,
            dimensions,
            returnReason: orderLine.returnReasonCategory || undefined,
            originalAwbNumber: orderLine.awbNumber || undefined,
        });

        // Update order line with AWB and status
        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: {
                returnStatus: 'pickup_scheduled',
                returnPickupType: 'arranged_by_us',
                returnCourier: pickupResult.logistics,
                returnAwbNumber: pickupResult.awbNumber,
                returnPickupScheduledAt: new Date(),
            },
        });

        shippingLogger.info({
            orderLineId,
            orderNumber: order.orderNumber,
            awbNumber: pickupResult.awbNumber,
        }, 'Reverse pickup scheduled successfully');

        res.json({
            success: true,
            data: {
                orderLineId,
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
});

export default router;
