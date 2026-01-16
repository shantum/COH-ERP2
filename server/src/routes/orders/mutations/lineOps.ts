/**
 * Order Line Operations
 * Cancel, uncancel, update, and add lines
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { authenticateToken } from '../../../middleware/auth.js';
import { asyncHandler } from '../../../middleware/asyncHandler.js';
import { TXN_TYPE, TXN_REASON } from '../../../utils/queryPatterns.js';
import { hasAllocatedInventory, type LineStatus } from '../../../utils/orderStateMachine.js';
import { inventoryBalanceCache } from '../../../services/inventoryBalanceCache.js';
import { NotFoundError, BusinessLogicError } from '../../../utils/errors.js';
import { adjustCustomerLtv } from '../../../utils/tierUtils.js';
import { broadcastOrderUpdate } from '../../sse.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

interface UpdateLineBody {
    qty?: number;
    unitPrice?: number;
    notes?: string;
}

interface AddLineBody {
    skuId: string;
    qty: number;
    unitPrice: number;
}

// ============================================
// HELPER FUNCTION
// ============================================

function getParamString(param: string | string[] | undefined): string {
    if (Array.isArray(param)) return param[0];
    return param ?? '';
}

// ============================================
// ORDER LINE OPERATIONS
// ============================================

// Cancel a single order line - LEAN: just update status + reverse inventory if needed
router.post(
    '/lines/:lineId/cancel',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);

        // Single query to get line with minimal fields
        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            select: { id: true, lineStatus: true, qty: true, unitPrice: true, order: { select: { customerId: true } } },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }
        if (line.lineStatus === 'shipped') {
            throw new BusinessLogicError('Cannot cancel shipped line', 'CANNOT_CANCEL_SHIPPED');
        }
        if (line.lineStatus === 'cancelled') {
            res.json({ id: lineId, lineStatus: 'cancelled' }); // Already cancelled, just return
            return;
        }

        // If allocated, reverse inventory (important for stock accuracy)
        if (hasAllocatedInventory(line.lineStatus as LineStatus)) {
            const txn = await req.prisma.inventoryTransaction.findFirst({
                where: { referenceId: lineId, txnType: TXN_TYPE.OUTWARD, reason: TXN_REASON.ORDER_ALLOCATION },
                select: { id: true, skuId: true },
            });
            if (txn) {
                await req.prisma.inventoryTransaction.delete({ where: { id: txn.id } });
                inventoryBalanceCache.invalidate([txn.skuId]);
            }
        }

        // Update line status
        await req.prisma.orderLine.update({
            where: { id: lineId },
            data: { lineStatus: 'cancelled' },
        });

        // Background: adjust LTV (fire and forget)
        if (line.order?.customerId) {
            const lineAmount = line.qty * line.unitPrice;
            adjustCustomerLtv(req.prisma, line.order.customerId, -lineAmount).catch(() => {});
        }

        // Broadcast SSE update to other users
        broadcastOrderUpdate({
            type: 'line_status',
            view: 'open',
            lineId,
            changes: { lineStatus: 'cancelled' },
        }, req.user?.id);

        res.json({ id: lineId, lineStatus: 'cancelled' });
    })
);

// Uncancel a single order line - LEAN: just update status
router.post(
    '/lines/:lineId/uncancel',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);

        // Single query with minimal fields
        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            select: { id: true, lineStatus: true, qty: true, unitPrice: true, order: { select: { customerId: true } } },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }
        if (line.lineStatus !== 'cancelled') {
            res.json({ id: lineId, lineStatus: line.lineStatus }); // Not cancelled, just return current status
            return;
        }

        // Update line status
        await req.prisma.orderLine.update({
            where: { id: lineId },
            data: { lineStatus: 'pending' },
        });

        // Background: adjust LTV (fire and forget)
        if (line.order?.customerId) {
            const lineAmount = line.qty * line.unitPrice;
            adjustCustomerLtv(req.prisma, line.order.customerId, lineAmount).catch(() => {});
        }

        // Broadcast SSE update to other users
        broadcastOrderUpdate({
            type: 'line_status',
            view: 'open',
            lineId,
            changes: { lineStatus: 'pending' },
        }, req.user?.id);

        res.json({ id: lineId, lineStatus: 'pending' });
    })
);

// Update order line (change qty, unitPrice, or notes)
router.put(
    '/lines/:lineId',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);
        const { qty, unitPrice, notes } = req.body as UpdateLineBody;
        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { order: true },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }

        // Notes can be updated regardless of line status
        // qty/unitPrice require pending status
        const hasQtyOrPrice = qty !== undefined || unitPrice !== undefined;
        if (hasQtyOrPrice && line.lineStatus !== 'pending') {
            throw new BusinessLogicError(
                `Can only edit qty/price on pending lines (current: ${line.lineStatus})`,
                'INVALID_STATUS_FOR_EDIT'
            );
        }

        const updateData: Prisma.OrderLineUpdateInput = {};
        if (qty !== undefined) updateData.qty = qty;
        if (unitPrice !== undefined) updateData.unitPrice = unitPrice;
        if (notes !== undefined) updateData.notes = notes;

        // If only updating notes, simple update without transaction
        if (!hasQtyOrPrice) {
            const updated = await req.prisma.orderLine.update({
                where: { id: lineId },
                data: updateData,
            });
            res.json(updated);
            return;
        }

        // qty/unitPrice changes need transaction to update order total
        await req.prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: lineId },
                data: updateData,
            });

            const allLines = await tx.orderLine.findMany({
                where: { orderId: line.orderId },
            });
            const newTotal = allLines.reduce((sum, l) => {
                const lineQty = l.id === lineId ? (qty ?? l.qty) : l.qty;
                const linePrice = l.id === lineId ? (unitPrice ?? l.unitPrice) : l.unitPrice;
                return sum + lineQty * linePrice;
            }, 0);
            await tx.order.update({
                where: { id: line.orderId },
                data: { totalAmount: newTotal },
            });
        });

        const updated = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
        });

        res.json(updated);
    })
);

// Add line to order
router.post(
    '/:id/lines',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const { skuId, qty, unitPrice } = req.body as AddLineBody;

        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        if (order.status !== 'open') {
            throw new BusinessLogicError(
                `Can only add lines to open orders (current: ${order.status})`,
                'INVALID_STATUS_FOR_ADD_LINE'
            );
        }

        await req.prisma.$transaction(async (tx) => {
            await tx.orderLine.create({
                data: {
                    orderId,
                    skuId,
                    qty,
                    unitPrice,
                    lineStatus: 'pending',
                },
            });

            const allLines = await tx.orderLine.findMany({
                where: { orderId },
            });
            const newTotal = allLines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
            await tx.order.update({
                where: { id: orderId },
                data: { totalAmount: newTotal },
            });
        });

        const updated = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: {
                orderLines: {
                    include: {
                        sku: { include: { variation: { include: { product: true } } } },
                    },
                },
            },
        });

        res.json(updated);
    })
);

export default router;
