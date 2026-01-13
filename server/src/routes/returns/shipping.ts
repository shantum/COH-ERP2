/**
 * @module routes/returns/shipping
 * Reverse and forward shipping operations for returns and exchanges
 *
 * Endpoints:
 * - POST /:id/initiate-reverse: Initiate reverse pickup
 * - POST /:id/mark-received: Mark reverse shipment as received (legacy)
 * - POST /:id/cancel-simple: Cancel return request (legacy)
 * - PUT /:id/link-exchange-order: Link exchange ticket to replacement order
 * - PUT /:id/unlink-exchange-order: Unlink exchange order (undo)
 * - PUT /:id/mark-reverse-received: Mark reverse shipment received (for exchanges)
 * - PUT /:id/unmark-reverse-received: Unmark reverse received (undo)
 * - PUT /:id/mark-forward-delivered: Mark forward shipment delivered
 * - PUT /:id/unmark-forward-delivered: Unmark forward delivered (undo)
 * - PUT /:id/mark-reverse-in-transit: Mark reverse shipment as in-transit (enables early shipping)
 * - PUT /:id/ship-replacement: Ship replacement (for exchanges)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import {
    NotFoundError,
    ValidationError,
    BusinessLogicError,
    ConflictError,
} from '../../utils/errors.js';
import type { ShipReplacementBody } from './types.js';
import { updateStatus, checkAutoResolve } from './types.js';

const router: Router = Router();

// ============================================
// LEGACY STATUS UPDATES
// ============================================

router.post('/:id/initiate-reverse', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { courier, awbNumber, pickupScheduledAt } = req.body as {
        courier: string;
        awbNumber: string;
        pickupScheduledAt?: string;
    };
    await req.prisma.returnShipping.create({
        data: {
            requestId: id,
            direction: 'reverse',
            courier,
            awbNumber,
            pickupScheduledAt: pickupScheduledAt ? new Date(pickupScheduledAt) : null,
            status: 'scheduled',
        },
    });
    await updateStatus(req.prisma, id, 'reverse_initiated', req.user!.id);
    res.json({ success: true });
}));

router.post('/:id/mark-received', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    await req.prisma.returnShipping.updateMany({
        where: { requestId: id, direction: 'reverse' },
        data: { status: 'delivered', receivedAt: new Date() },
    });
    await updateStatus(req.prisma, id, 'received', req.user!.id);
    res.json({ success: true });
}));

router.post('/:id/cancel-simple', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { reason } = req.body as { reason?: string };
    await updateStatus(req.prisma, id, 'cancelled', req.user!.id, reason);
    res.json({ success: true });
}));

// ============================================
// EXCHANGE ORDER LINKING
// ============================================

// Link exchange ticket to replacement order
router.put('/:id/link-exchange-order', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { orderId } = req.body as { orderId?: string };

    if (!orderId) {
        throw new ValidationError('orderId is required');
    }

    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    if (request.requestType !== 'exchange') {
        throw new BusinessLogicError('Only exchange requests can be linked to orders', 'NOT_EXCHANGE');
    }

    // Verify order exists
    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    // Check if order is already linked to another exchange
    const existingLink = await req.prisma.returnRequest.findFirst({
        where: {
            exchangeOrderId: orderId,
            id: { not: id },
        },
    });

    if (existingLink) {
        throw new ConflictError(
            `This order is already linked to exchange ${existingLink.requestNumber}`,
            'ALREADY_LINKED'
        );
    }

    await req.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({
            where: { id },
            data: { exchangeOrderId: orderId },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: id,
                fromStatus: request.status,
                toStatus: request.status,
                changedById: req.user!.id,
                notes: `Linked to exchange order ${order.orderNumber}`,
            },
        });
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
            shipping: true,
        },
    });

    res.json(updated);
}));

// Unlink exchange order (undo)
router.put('/:id/unlink-exchange-order', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: { exchangeOrder: true },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    if (!request.exchangeOrderId) {
        throw new BusinessLogicError('No exchange order linked', 'NO_LINKED_ORDER');
    }

    const orderNumber = request.exchangeOrder?.orderNumber;

    await req.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({
            where: { id },
            data: { exchangeOrderId: null },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: id,
                fromStatus: request.status,
                toStatus: request.status,
                changedById: req.user!.id,
                notes: `Unlinked exchange order ${orderNumber}`,
            },
        });
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            originalOrder: true,
            customer: true,
            lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
            shipping: true,
        },
    });

    res.json(updated);
}));

// ============================================
// EXCHANGE SHIPMENT TRACKING
// ============================================

// Mark reverse shipment received
router.put('/:id/mark-reverse-received', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    if (request.reverseReceived) {
        throw new BusinessLogicError('Reverse shipment already marked as received', 'ALREADY_RECEIVED');
    }

    let autoResolved = false;
    await req.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({
            where: { id },
            data: {
                reverseReceived: true,
                reverseReceivedAt: new Date(),
            },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: id,
                fromStatus: request.status,
                toStatus: request.status,
                changedById: req.user!.id,
                notes: 'Marked reverse shipment as received',
            },
        });

        autoResolved = await checkAutoResolve(tx, id, req.user!.id);
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            shipping: true,
        },
    });

    res.json({ ...updated, autoResolved });
}));

// Unmark reverse received (undo)
router.put('/:id/unmark-reverse-received', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    if (!request.reverseReceived) {
        throw new BusinessLogicError('Reverse shipment not marked as received', 'NOT_RECEIVED');
    }

    // If already resolved, need to un-resolve
    const wasResolved = request.status === 'resolved';

    await req.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({
            where: { id },
            data: {
                reverseReceived: false,
                reverseReceivedAt: null,
                status: wasResolved ? 'in_transit' : request.status,
            },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: id,
                fromStatus: request.status,
                toStatus: wasResolved ? 'in_transit' : request.status,
                changedById: req.user!.id,
                notes: 'Undo: unmarked reverse shipment as received',
            },
        });
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            shipping: true,
        },
    });

    res.json(updated);
}));

// Mark forward shipment delivered
router.put('/:id/mark-forward-delivered', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    if (request.requestType !== 'exchange') {
        throw new BusinessLogicError('Only exchange requests can have forward delivery', 'NOT_EXCHANGE');
    }

    if (request.forwardDelivered) {
        throw new BusinessLogicError('Forward shipment already marked as delivered', 'ALREADY_DELIVERED');
    }

    let autoResolved = false;
    await req.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({
            where: { id },
            data: {
                forwardDelivered: true,
                forwardDeliveredAt: new Date(),
            },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: id,
                fromStatus: request.status,
                toStatus: request.status,
                changedById: req.user!.id,
                notes: 'Marked forward shipment as delivered',
            },
        });

        autoResolved = await checkAutoResolve(tx, id, req.user!.id);
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            shipping: true,
        },
    });

    res.json({ ...updated, autoResolved });
}));

// Unmark forward delivered (undo)
router.put('/:id/unmark-forward-delivered', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    if (!request.forwardDelivered) {
        throw new BusinessLogicError('Forward shipment not marked as delivered', 'NOT_DELIVERED');
    }

    // If already resolved, need to un-resolve
    const wasResolved = request.status === 'resolved';

    await req.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({
            where: { id },
            data: {
                forwardDelivered: false,
                forwardDeliveredAt: null,
                status: wasResolved ? 'in_transit' : request.status,
            },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: id,
                fromStatus: request.status,
                toStatus: wasResolved ? 'in_transit' : request.status,
                changedById: req.user!.id,
                notes: 'Undo: unmarked forward shipment as delivered',
            },
        });
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            shipping: true,
        },
    });

    res.json(updated);
}));

// ============================================
// EARLY-SHIP LOGIC FOR EXCHANGES
// ============================================

// Mark reverse shipment as in-transit (enables early shipping of replacement)
router.put('/:id/mark-reverse-in-transit', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: { shipping: true },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    if (request.reverseInTransitAt) {
        throw new BusinessLogicError('Reverse shipment already marked as in-transit', 'ALREADY_IN_TRANSIT');
    }

    // Check if there's a reverse shipping record with AWB
    const reverseShipping = request.shipping?.find((s) => s.direction === 'reverse' && s.awbNumber);
    if (!reverseShipping) {
        throw new BusinessLogicError('No reverse pickup AWB found. Add reverse shipping details first.', 'NO_REVERSE_AWB');
    }

    await req.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({
            where: { id },
            data: {
                reverseInTransitAt: new Date(),
                status: 'in_transit',
            },
        });

        // Update shipping status
        await tx.returnShipping.update({
            where: { id: reverseShipping.id },
            data: { status: 'in_transit' },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: id,
                fromStatus: request.status,
                toStatus: 'in_transit',
                changedById: req.user!.id,
                notes: 'Reverse pickup confirmed in-transit. Exchange replacement can now be shipped.',
            },
        });
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            shipping: true,
        },
    });

    res.json(updated);
}));

// Ship replacement (for exchanges - can be done when reverse is in-transit)
router.put('/:id/ship-replacement', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { courier, awbNumber, notes } = req.body as ShipReplacementBody;

    if (!courier || !awbNumber) {
        throw new ValidationError('Courier and AWB number are required');
    }

    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: { shipping: true },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    // Check if this is an exchange
    const isExchange = request.resolution?.startsWith('exchange') || request.requestType === 'exchange';
    if (!isExchange) {
        throw new BusinessLogicError('This is not an exchange request', 'NOT_EXCHANGE');
    }

    // Check if replacement already shipped
    if (request.forwardShippedAt) {
        throw new BusinessLogicError('Replacement has already been shipped', 'ALREADY_SHIPPED');
    }

    // Check if reverse is at least in-transit (allows early shipping)
    const reverseInTransit = request.reverseInTransitAt || request.status === 'in_transit';
    if (!reverseInTransit) {
        throw new BusinessLogicError('Reverse pickup must be confirmed in-transit before shipping replacement', 'REVERSE_NOT_IN_TRANSIT');
    }

    await req.prisma.$transaction(async (tx) => {
        // Create forward shipping record
        await tx.returnShipping.create({
            data: {
                requestId: id,
                direction: 'forward',
                courier,
                awbNumber,
                status: 'shipped',
                shippedAt: new Date(),
            },
        });

        // Update request with forward shipped timestamp
        await tx.returnRequest.update({
            where: { id },
            data: {
                forwardShippedAt: new Date(),
            },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: id,
                fromStatus: request.status,
                toStatus: request.status,
                changedById: req.user!.id,
                notes: notes || `Replacement shipped via ${courier} (AWB: ${awbNumber})`,
            },
        });
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            shipping: true,
        },
    });

    res.json(updated);
}));

export default router;
