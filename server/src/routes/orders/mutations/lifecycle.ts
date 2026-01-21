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
import {
    NotFoundError,
    ConflictError,
    BusinessLogicError,
} from '../../../utils/errors.js';
import { updateCustomerTier } from '../../../utils/tierUtils.js';
import { orderLogger } from '../../../utils/logger.js';
import { broadcastOrderUpdate } from '../../sse.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

interface CancelOrderBody {
    reason?: string;
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
            // Restore order to open status
            await tx.order.update({
                where: { id: orderId },
                data: {
                    status: 'open',
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
// NOTE: Hold functionality has been removed from the schema.
// These endpoints are deprecated and will return errors.
// ============================================

// Hold entire order - DEPRECATED
router.put(
    '/:id/hold',
    authenticateToken,
    requirePermission('orders:hold'),
    asyncHandler(async (_req: Request, _res: Response): Promise<void> => {
        throw new BusinessLogicError(
            'Hold functionality has been removed. Orders cannot be placed on hold.',
            'FEATURE_REMOVED'
        );
    })
);

// Release order from hold - DEPRECATED
router.put(
    '/:id/release',
    authenticateToken,
    asyncHandler(async (_req: Request, _res: Response): Promise<void> => {
        throw new BusinessLogicError(
            'Hold functionality has been removed. Use release-to-shipped for releasing orders to shipped view.',
            'FEATURE_REMOVED'
        );
    })
);

// Hold a single order line - DEPRECATED
router.put(
    '/lines/:lineId/hold',
    authenticateToken,
    asyncHandler(async (_req: Request, _res: Response): Promise<void> => {
        throw new BusinessLogicError(
            'Hold functionality has been removed. Lines cannot be placed on hold.',
            'FEATURE_REMOVED'
        );
    })
);

// Release a single order line from hold - DEPRECATED
router.put(
    '/lines/:lineId/release',
    authenticateToken,
    asyncHandler(async (_req: Request, _res: Response): Promise<void> => {
        throw new BusinessLogicError(
            'Hold functionality has been removed.',
            'FEATURE_REMOVED'
        );
    })
);

export default router;
