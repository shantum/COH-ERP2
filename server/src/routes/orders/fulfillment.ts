/**
 * Fulfillment Router
 * Shipping operations for orders
 *
 * NOTE: Line status changes (allocate/pick/pack) are handled by the unified
 * endpoint in lineStatus.ts. This router handles shipping and delivery operations.
 *
 * @module routes/orders/fulfillment
 */

import { Router } from 'express';
import type { Request, Response, RequestHandler } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requirePermission } from '../../middleware/permissions.js';
import { deprecated } from '../../middleware/deprecation.js';
import {
    NotFoundError,
    ValidationError,
    ConflictError,
    BusinessLogicError,
    ForbiddenError,
} from '../../utils/errors.js';
import {
    TXN_TYPE,
    TXN_REASON,
} from '../../utils/queryPatterns.js';
import { validate } from '../../utils/validation.js';
import { ShipOrderSchema } from '@coh/shared';
import { shipOrderLines, shipOrder } from '../../services/shipOrderService.js';
import { adminShipOrderLines } from '../../services/adminShipService.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

interface OrderLine {
    id: string;
    skuId: string;
    qty: number;
    lineStatus: string;
    awbNumber: string | null;
    courier: string | null;
    allocatedAt: Date | null;
}

interface OrderWithLines {
    id: string;
    orderNumber: string;
    status: string;
    customerId: string | null;
    orderLines: OrderLine[];
}

interface EligibleOrder {
    id: string;
    orderNumber: string;
    orderLines: Array<{ id: string }>;
    shopifyCache: {
        trackingNumber: string;
        trackingCompany: string;
    };
}

// ============================================
// SHIP ORDER
// ============================================

/**
 * POST /:id/ship
 * Ship entire order (all lines packed -> shipped)
 *
 * Uses ShipOrderService which handles:
 * - Release RESERVED transactions for all lines
 * - Create OUTWARD (SALE) transactions for all lines
 * - Update order status to 'shipped'
 * - Update all lines to 'shipped' with tracking info
 *
 * VALIDATIONS:
 * - AWB and courier are required
 * - Service validates packed status and handles race conditions
 *
 * @param {string} req.params.id - Order ID
 * @param {string} req.body.awbNumber - AWB/tracking number (required)
 * @param {string} req.body.courier - Courier name (required)
 * @returns {Object} Updated order with orderLines
 *
 * @example
 * POST /fulfillment/123/ship
 * Body: { awbNumber: "DL12345", courier: "Delhivery" }
 */
router.post('/:id/ship', authenticateToken, requirePermission('orders:ship'), deprecated({
    endpoint: 'POST /orders/:id/ship',
    alternative: 'orders.ship',
    deprecatedSince: '2026-01-16',
}), validate(ShipOrderSchema) as RequestHandler, asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.id as string;
    const { awbNumber, courier } = req.validatedBody as { awbNumber: string; courier: string };

    // Validate required fields
    if (!awbNumber?.trim()) {
        throw new ValidationError('awbNumber is required');
    }
    if (!courier?.trim()) {
        throw new ValidationError('courier is required');
    }

    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    }) as OrderWithLines | null;

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    // Idempotency check - if already shipped, return success
    if (order.status === 'shipped') {
        return res.json({
            ...order,
            message: 'Order is already shipped',
        });
    }

    // Ship using the service
    const result = await req.prisma.$transaction(async (tx) => {
        return await shipOrder(tx, {
            orderId,
            awbNumber: awbNumber.trim(),
            courier: courier.trim(),
            userId: req.user!.id,
        });
    });

    // Check for errors in the result
    if (result.errors && result.errors.length > 0) {
        const errorCodes = result.errors.map(e => e.code);

        // Throw appropriate error based on the error codes
        if (errorCodes.includes('INVALID_STATUS')) {
            throw new BusinessLogicError(
                result.errors[0].error,
                'INVALID_STATUS'
            );
        } else if (errorCodes.includes('DUPLICATE_AWB')) {
            throw new ConflictError(
                result.errors[0].error,
                'DUPLICATE_AWB'
            );
        } else {
            throw new BusinessLogicError(
                result.errors[0].error,
                result.errors[0].code
            );
        }
    }

    // Fetch updated order
    const updated = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    });

    res.json(updated);
}));

// ============================================
// SHIP SPECIFIC LINES (Partial Shipment Support)
// ============================================

/**
 * Ship specific order lines with a given AWB
 * Enables partial shipments - different lines can ship at different times with different AWBs
 *
 * Uses ShipOrderService which handles inventory transactions and status updates.
 *
 * POST /orders/:id/ship-lines
 * Body: { lineIds: string[], awbNumber: string, courier: string }
 */
router.post('/:id/ship-lines', authenticateToken, requirePermission('orders:ship'), deprecated({
    endpoint: 'POST /orders/:id/ship-lines',
    alternative: 'orders.ship',
    deprecatedSince: '2026-01-16',
}), asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.id as string;
    const { lineIds, awbNumber, courier } = req.body as { lineIds?: string[]; awbNumber?: string; courier?: string };

    // Validate required fields
    if (!lineIds?.length) {
        throw new ValidationError('lineIds array is required');
    }
    if (!awbNumber?.trim()) {
        throw new ValidationError('awbNumber is required');
    }
    if (!courier?.trim()) {
        throw new ValidationError('courier is required');
    }

    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    }) as OrderWithLines | null;

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    // Validate all requested lines exist and belong to this order
    const linesToShip = order.orderLines.filter(l => lineIds.includes(l.id));
    if (linesToShip.length !== lineIds.length) {
        throw new ValidationError(
            `Some lineIds not found in this order (found ${linesToShip.length} of ${lineIds.length})`
        );
    }

    // Ship using the service
    const result = await req.prisma.$transaction(async (tx) => {
        return await shipOrderLines(tx, {
            orderLineIds: lineIds,
            awbNumber: awbNumber.trim(),
            courier: courier.trim(),
            userId: req.user!.id,
        });
    });

    // Check for errors in the result
    if (result.errors && result.errors.length > 0) {
        const errorCodes = result.errors.map(e => e.code);

        // Throw appropriate error based on the error codes
        if (errorCodes.includes('LINE_CANCELLED')) {
            throw new BusinessLogicError(
                result.errors[0].error,
                'LINES_CANCELLED'
            );
        } else if (errorCodes.includes('INVALID_STATUS')) {
            throw new BusinessLogicError(
                result.errors[0].error,
                'LINES_NOT_PACKED'
            );
        } else if (errorCodes.includes('DUPLICATE_AWB')) {
            throw new ConflictError(
                result.errors[0].error,
                'DUPLICATE_AWB'
            );
        } else {
            throw new BusinessLogicError(
                result.errors[0].error,
                result.errors[0].code
            );
        }
    }

    // Fetch updated order
    const updated = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    }) as OrderWithLines | null;

    res.json({
        ...updated,
        linesShipped: result.shipped.length,
        allShipped: updated?.status === 'shipped',
    });
}));

// ============================================
// MIGRATE SHOPIFY FULFILLED (Onboarding)
// One-click migration for orders fulfilled on Shopify
// Marks as shipped without inventory transactions
// ============================================

router.post('/migrate-shopify-fulfilled', authenticateToken, requirePermission('orders:ship'), asyncHandler(async (req: Request, res: Response) => {
    // Admin only for safety
    if (req.user!.role !== 'admin') {
        throw new ForbiddenError('Migration requires admin role');
    }

    // Batch limit - process in chunks to avoid timeout (default 50, max 500)
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);

    // Only migrate OPEN orders (not delivered, archived, etc.)
    const whereClause = {
        status: 'open',
        shopifyCache: {
            fulfillmentStatus: 'fulfilled',
            trackingNumber: { not: null },
            trackingCompany: { not: null },
        },
    };

    // Count total eligible first
    const totalEligible = await req.prisma.order.count({ where: whereClause });

    if (totalEligible === 0) {
        return res.json({
            migrated: 0,
            remaining: 0,
            message: 'No eligible open orders found - migration complete!',
        });
    }

    console.log(`[Migrate Shopify Fulfilled] Starting batch: ${limit} of ${totalEligible} eligible open orders`);

    // Fetch batch of eligible orders (oldest first for consistent ordering)
    const eligibleOrders = await req.prisma.order.findMany({
        where: whereClause,
        include: {
            orderLines: { select: { id: true } },
            shopifyCache: {
                select: { trackingNumber: true, trackingCompany: true },
            },
        },
        orderBy: { orderDate: 'asc' },
        take: limit,
    }) as unknown as EligibleOrder[];

    // Process each order in its own transaction (avoids timeout)
    interface MigrationResults {
        migrated: Array<{ orderNumber: string; linesShipped: number }>;
        skipped: Array<{ orderNumber: string; reason: string }>;
        errors: Array<{ orderNumber: string; error: string }>;
    }
    const results: MigrationResults = { migrated: [], skipped: [], errors: [] };

    for (const order of eligibleOrders) {
        try {
            const lineIds = order.orderLines.map(l => l.id);
            const awb = order.shopifyCache.trackingNumber;
            const courier = order.shopifyCache.trackingCompany;

            // Each order gets its own transaction
            const result = await req.prisma.$transaction(async (tx) => {
                return await shipOrderLines(tx, {
                    orderLineIds: lineIds,
                    awbNumber: awb,
                    courier: courier,
                    userId: req.user!.id,
                    skipStatusValidation: true,
                    skipInventory: true,
                });
            });

            if (result.shipped.length > 0) {
                results.migrated.push({
                    orderNumber: order.orderNumber,
                    linesShipped: result.shipped.length,
                });
            } else if (result.skipped.length > 0) {
                results.skipped.push({
                    orderNumber: order.orderNumber,
                    reason: result.skipped[0]?.reason || 'Already shipped',
                });
            }
        } catch (error) {
            results.errors.push({
                orderNumber: order.orderNumber,
                error: (error as Error).message,
            });
        }
    }

    const remaining = totalEligible - results.migrated.length;
    console.log(`[Migrate Shopify Fulfilled] Batch complete: migrated ${results.migrated.length}, skipped ${results.skipped.length}, errors ${results.errors.length}, remaining ~${remaining}`);

    res.json({
        migrated: results.migrated.length,
        skipped: results.skipped.length,
        remaining: remaining,
        errors: results.errors.length > 0 ? results.errors : undefined,
        message: remaining > 0
            ? `Migrated ${results.migrated.length} orders. ${remaining} remaining - click again to continue.`
            : `Migrated ${results.migrated.length} orders. Migration complete!`,
    });
}));

// Unship order (move back to open)
router.post('/:id/unship', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.id as string;

    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    }) as OrderWithLines | null;

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    if (order.status !== 'shipped') {
        throw new BusinessLogicError(
            `Order must be shipped to unship (current: ${order.status})`,
            'INVALID_STATUS'
        );
    }

    await req.prisma.$transaction(async (tx) => {
        // Re-check status inside transaction to prevent race condition
        const currentOrder = await tx.order.findUnique({
            where: { id: orderId },
            select: { status: true },
        });

        if (!currentOrder) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        if (currentOrder.status !== 'shipped') {
            throw new ConflictError('Order status changed by another request', 'RACE_CONDITION');
        }

        // Note: No inventory action needed on unship
        // In the simplified model, OUTWARD is created at allocation and stays
        // Unshipping only affects status/visibility, not inventory

        await tx.order.update({
            where: { id: orderId },
            data: {
                status: 'open',
            },
        });

        // Revert line statuses and clear tracking fields
        await tx.orderLine.updateMany({
            where: { orderId },
            data: {
                lineStatus: 'packed',
                shippedAt: null,
                awbNumber: null,
                courier: null,
                trackingStatus: null,
            },
        });
    });

    const updated = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    });

    res.json(updated);
}));

/**
 * POST /:id/migration-ship
 * @deprecated Use tRPC orders.adminShip instead
 *
 * Migration endpoint: Mark order as shipped bypassing status validation.
 * Admin only - uses adminShipService for authorization and feature flag check.
 *
 * @param {string} req.params.id - Order ID
 * @param {string} req.body.awbNumber - AWB/tracking number (required)
 * @param {string} req.body.courier - Courier name (required)
 * @returns {Object} Shipping result from adminShipOrderLines service
 */
router.post('/:id/migration-ship',
    authenticateToken,
    requirePermission('orders:ship'),
    deprecated({
        endpoint: 'POST /orders/:id/migration-ship',
        alternative: 'orders.adminShip',
        deprecatedSince: '2026-01-16',
    }),
    asyncHandler(async (req: Request, res: Response) => {
        const orderId = req.params.id as string;
        const { awbNumber, courier } = req.body as { awbNumber?: string; courier?: string };

        // Validate required fields
        if (!awbNumber?.trim()) {
            throw new ValidationError('awbNumber is required');
        }
        if (!courier?.trim()) {
            throw new ValidationError('courier is required');
        }

        // Get order and all its lines
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: { select: { id: true } } },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        // Use adminShipOrderLines service (handles auth + feature flag)
        const result = await req.prisma.$transaction(async (tx) => {
            const lineIds = order.orderLines.map((l: { id: string }) => l.id);
            return await adminShipOrderLines(tx, {
                orderLineIds: lineIds,
                awbNumber: awbNumber.trim(),
                courier: courier.trim(),
                userId: req.user!.id,
                userRole: req.user!.role,
            });
        });

        res.json(result);
    })
);

// Mark order as delivered (with validation)
// NOTE: deliveredAt is now on OrderLine, not Order. This endpoint marks all lines as delivered.
router.post('/:id/mark-delivered', authenticateToken, deprecated({
    endpoint: 'POST /orders/:id/mark-delivered',
    alternative: 'orders.markDelivered',
    deprecatedSince: '2026-01-16',
}), asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.id as string;

    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    if (order.status !== 'shipped') {
        throw new BusinessLogicError(
            `Order must be shipped to mark as delivered (current: ${order.status})`,
            'INVALID_STATUS'
        );
    }

    const now = new Date();

    // Mark all shipped lines as delivered
    await req.prisma.$transaction(async (tx) => {
        await tx.orderLine.updateMany({
            where: {
                orderId,
                lineStatus: 'shipped',
            },
            data: {
                deliveredAt: now,
                trackingStatus: 'delivered',
            },
        });

        await tx.order.update({
            where: { id: orderId },
            data: {
                status: 'delivered',
            },
        });
    });

    const updated = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    });

    res.json(updated);
}));

// Initiate RTO for order
// NOTE: rtoInitiatedAt is now on OrderLine, not Order. This endpoint marks all shipped lines as RTO initiated.
router.post('/:id/mark-rto', authenticateToken, deprecated({
    endpoint: 'POST /orders/:id/mark-rto',
    alternative: 'orders.markRto',
    deprecatedSince: '2026-01-16',
}), asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.id as string;

    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: {
            orderLines: {
                select: { id: true, lineStatus: true, rtoInitiatedAt: true },
            },
        },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    if (order.status !== 'shipped') {
        throw new BusinessLogicError(
            `Order must be shipped to initiate RTO (current: ${order.status})`,
            'INVALID_STATUS'
        );
    }

    const now = new Date();
    // Check if any lines already have RTO initiated
    const hasExistingRto = order.orderLines.some(l => l.rtoInitiatedAt !== null);

    const updated = await req.prisma.$transaction(async (tx) => {
        // Mark all shipped lines as RTO initiated
        await tx.orderLine.updateMany({
            where: {
                orderId,
                lineStatus: 'shipped',
                rtoInitiatedAt: null,
            },
            data: {
                rtoInitiatedAt: now,
                trackingStatus: 'rto_initiated',
            },
        });

        // Increment customer RTO count on first RTO initiation for this order
        if (!hasExistingRto && order.customerId) {
            await tx.customer.update({
                where: { id: order.customerId },
                data: { rtoCount: { increment: 1 } },
            });
        }

        return tx.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });
    });

    res.json(updated);
}));

// Receive RTO package (creates inventory inward)
// NOTE: rtoInitiatedAt and rtoReceivedAt are now on OrderLine, not Order.
router.post('/:id/receive-rto', authenticateToken, deprecated({
    endpoint: 'POST /orders/:id/receive-rto',
    alternative: 'orders.receiveRto',
    deprecatedSince: '2026-01-16',
}), asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.id as string;

    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    }) as OrderWithLines | null;

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    // Check if any line has RTO initiated
    const rtoLines = order.orderLines.filter(l => l.lineStatus === 'shipped');
    if (rtoLines.length === 0) {
        throw new BusinessLogicError('No shipped lines found for RTO', 'NO_RTO_LINES');
    }

    const now = new Date();

    await req.prisma.$transaction(async (tx) => {
        // Mark lines as RTO received and create inventory inward
        for (const line of rtoLines) {
            await tx.orderLine.update({
                where: { id: line.id },
                data: {
                    rtoReceivedAt: now,
                    trackingStatus: 'rto_delivered',
                },
            });

            await tx.inventoryTransaction.create({
                data: {
                    skuId: line.skuId,
                    txnType: TXN_TYPE.INWARD,
                    qty: line.qty,
                    reason: TXN_REASON.RTO_RECEIVED,
                    referenceId: line.id,
                    createdById: req.user!.id,
                },
            });
        }
    });

    const updated = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    });

    res.json(updated);
}));

export default router;
