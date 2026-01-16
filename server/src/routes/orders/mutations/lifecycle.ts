/**
 * Order Lifecycle Operations
 * Cancel, uncancel, hold, release orders and lines
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../../middleware/auth.js';
import { asyncHandler } from '../../../middleware/asyncHandler.js';
import { requirePermission } from '../../../middleware/permissions.js';
import { deprecated } from '../../../middleware/deprecation.js';
import { releaseReservedInventory } from '../../../utils/queryPatterns.js';
import { recomputeOrderStatus } from '../../../utils/orderStatus.js';
import {
    NotFoundError,
    ConflictError,
    BusinessLogicError,
} from '../../../utils/errors.js';
import { updateCustomerTier } from '../../../utils/tierUtils.js';
import { orderLogger } from '../../../utils/logger.js';
import { broadcastOrderUpdate } from '../../sse.js';
import { enforceRulesInExpress } from '../../../rules/index.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

interface CancelOrderBody {
    reason?: string;
}

interface HoldOrderBody {
    reason: string;
    notes?: string;
}

interface HoldLineBody {
    reason: string;
    notes?: string;
}

// ============================================
// HELPER FUNCTION
// ============================================

function getParamString(param: string | string[] | undefined): string {
    if (Array.isArray(param)) return param[0];
    return param ?? '';
}

// ============================================
// CANCEL / UNCANCEL
// ============================================

// Cancel order
router.post(
    '/:id/cancel',
    authenticateToken,
    requirePermission('orders:cancel'),
    deprecated({
        endpoint: 'POST /orders/:id/cancel',
        trpcAlternative: 'orders.cancelOrder',
        deprecatedSince: '2026-01-16',
    }),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const { reason } = req.body as CancelOrderBody;

        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        if (order.status === 'cancelled') {
            throw new BusinessLogicError('Order is already cancelled', 'ALREADY_CANCELLED');
        }

        if (order.status === 'shipped' || order.status === 'delivered') {
            throw new BusinessLogicError('Cannot cancel shipped or delivered orders', 'CANNOT_CANCEL_SHIPPED');
        }

        await req.prisma.$transaction(async (tx) => {
            // Re-check status inside transaction to prevent race condition
            const currentOrder = await tx.order.findUnique({
                where: { id: orderId },
                select: { status: true },
            });

            if (currentOrder?.status === 'shipped' || currentOrder?.status === 'delivered') {
                throw new ConflictError(
                    'Order was shipped by another request and cannot be cancelled',
                    'RACE_CONDITION'
                );
            }

            if (currentOrder?.status === 'cancelled') {
                throw new ConflictError('Order was already cancelled by another request', 'RACE_CONDITION');
            }

            for (const line of order.orderLines) {
                if (['allocated', 'picked', 'packed'].includes(line.lineStatus)) {
                    await releaseReservedInventory(tx, line.id);
                }
            }

            await tx.orderLine.updateMany({
                where: { orderId },
                data: { lineStatus: 'cancelled' },
            });

            await tx.order.update({
                where: { id: orderId },
                data: {
                    status: 'cancelled',
                    terminalStatus: 'cancelled',
                    terminalAt: new Date(),
                    internalNotes: reason
                        ? order.internalNotes
                            ? `${order.internalNotes}\n\nCancelled: ${reason}`
                            : `Cancelled: ${reason}`
                        : order.internalNotes,
                },
            });
        });

        // Update customer tier - cancelled orders no longer count toward LTV
        if (order.customerId) {
            await updateCustomerTier(req.prisma, order.customerId);
        }

        // Broadcast SSE update to other users
        broadcastOrderUpdate({
            type: 'order_updated',
            view: 'open',
            orderId,
            changes: { status: 'cancelled', lineStatus: 'cancelled' },
        }, req.user?.id);

        const updated = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        res.json(updated);
    })
);

// Uncancel order (restore to open)
router.post(
    '/:id/uncancel',
    authenticateToken,
    deprecated({
        endpoint: 'POST /orders/:id/uncancel',
        trpcAlternative: 'orders.uncancelOrder',
        deprecatedSince: '2026-01-16',
    }),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: { include: { sku: true } } },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        if (order.status !== 'cancelled') {
            throw new BusinessLogicError('Order is not cancelled', 'NOT_CANCELLED');
        }

        await req.prisma.$transaction(async (tx) => {
            // Restore order to open status and clear terminal status
            await tx.order.update({
                where: { id: orderId },
                data: {
                    status: 'open',
                    terminalStatus: null,
                    terminalAt: null,
                },
            });

            // Restore all lines to pending status
            await tx.orderLine.updateMany({
                where: { orderId },
                data: { lineStatus: 'pending' },
            });
        });

        // Update customer tier - restored order now counts toward LTV again
        if (order.customerId) {
            await updateCustomerTier(req.prisma, order.customerId);
        }

        // Broadcast SSE update to other users
        broadcastOrderUpdate({
            type: 'order_updated',
            view: 'open',
            orderId,
            changes: { status: 'open', lineStatus: 'pending' },
        }, req.user?.id);

        const updated = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        res.json(updated);
    })
);

// ============================================
// HOLD / RELEASE OPERATIONS
// ============================================

// Hold entire order (blocks all lines from fulfillment)
router.put(
    '/:id/hold',
    authenticateToken,
    requirePermission('orders:hold'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const { reason, notes } = req.body as HoldOrderBody;

        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        // Enforce hold rules using rules engine
        await enforceRulesInExpress('holdOrder', req, {
            data: { order, reason },
            phase: 'pre',
        });

        const updated = await req.prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: {
                    isOnHold: true,
                    holdReason: reason,
                    holdNotes: notes || null,
                    holdAt: new Date(),
                },
                include: { orderLines: true },
            });

            // Recompute order status
            await recomputeOrderStatus(orderId, tx);

            return tx.order.findUnique({
                where: { id: orderId },
                include: { orderLines: true },
            });
        });

        orderLogger.info({ orderNumber: order.orderNumber, reason }, 'Order placed on hold');
        res.json(updated);
    })
);

// Release order from hold
router.put(
    '/:id/release',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        // Enforce release rules using rules engine
        await enforceRulesInExpress('releaseOrderHold', req, {
            data: { order },
            phase: 'pre',
        });

        const updated = await req.prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: {
                    isOnHold: false,
                    holdReason: null,
                    holdNotes: null,
                    holdAt: null,
                },
            });

            // Recompute order status
            await recomputeOrderStatus(orderId, tx);

            return tx.order.findUnique({
                where: { id: orderId },
                include: { orderLines: true },
            });
        });

        orderLogger.info({ orderNumber: order.orderNumber }, 'Order released from hold');
        res.json(updated);
    })
);

// Hold a single order line
router.put(
    '/lines/:lineId/hold',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);
        const { reason, notes } = req.body as HoldLineBody;

        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { order: true },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }

        // Enforce hold line rules using rules engine
        await enforceRulesInExpress('holdLine', req, {
            data: { line, order: line.order, reason },
            phase: 'pre',
        });

        const updated = await req.prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    isOnHold: true,
                    holdReason: reason,
                    holdNotes: notes || null,
                    holdAt: new Date(),
                },
            });

            // Recompute order status
            await recomputeOrderStatus(line.orderId, tx);

            return tx.orderLine.findUnique({
                where: { id: lineId },
                include: { order: true },
            });
        });

        orderLogger.info({ lineId, reason }, 'Line placed on hold');
        res.json(updated);
    })
);

// Release a single order line from hold
router.put(
    '/lines/:lineId/release',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);
        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { order: true },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }

        // Enforce release line rules using rules engine
        await enforceRulesInExpress('releaseLineHold', req, {
            data: { line },
            phase: 'pre',
        });

        const updated = await req.prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    isOnHold: false,
                    holdReason: null,
                    holdNotes: null,
                    holdAt: null,
                },
            });

            // Recompute order status
            await recomputeOrderStatus(line.orderId, tx);

            return tx.orderLine.findUnique({
                where: { id: lineId },
                include: { order: true },
            });
        });

        orderLogger.info({ lineId }, 'Line released from hold');
        res.json(updated);
    })
);

export default router;
