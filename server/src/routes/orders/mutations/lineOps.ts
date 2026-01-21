/**
 * Order Line Operations
 * Cancel, uncancel, update, and add lines
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { authenticateToken } from '../../../middleware/auth.js';
import { asyncHandler } from '../../../middleware/asyncHandler.js';
import { hasAllocatedInventory, type LineStatus } from '../../../utils/orderStateMachine.js';
import { inventoryBalanceCache } from '../../../services/inventoryBalanceCache.js';
import { NotFoundError, BusinessLogicError } from '../../../utils/errors.js';
import { adjustCustomerLtv } from '../../../utils/tierUtils.js';
import { broadcastOrderUpdate } from '../../sse.js';
import { enforceRulesInExpress } from '../../../rules/index.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

interface UpdateLineBody {
    qty?: number;
    unitPrice?: number;
    notes?: string;
    awbNumber?: string;
    courier?: string;
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

// Cancel a single order line - uses Prisma
router.post(
    '/lines/:lineId/cancel',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);

        // Fetch line data for rules engine and LTV adjustment
        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            select: { id: true, lineStatus: true, qty: true, unitPrice: true, skuId: true, order: { select: { customerId: true } } },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }

        // Soft return for already cancelled (preserve existing behavior)
        if (line.lineStatus === 'cancelled') {
            res.json({ id: lineId, lineStatus: 'cancelled' });
            return;
        }

        // Enforce cancel line rules using rules engine (checks shipped status)
        await enforceRulesInExpress('cancelLine', req, {
            data: { line },
            phase: 'pre',
        });

        // Check if line has allocated inventory (allocated, picked, packed)
        const statusesWithInventory = ['allocated', 'picked', 'packed'];
        const hasInventory = statusesWithInventory.includes(line.lineStatus || '');
        let inventoryReleased = false;

        // Update line status to cancelled and release inventory if needed
        await req.prisma.$transaction(async (tx) => {
            // Update line status
            await tx.orderLine.update({
                where: { id: lineId },
                data: { lineStatus: 'cancelled', productionBatchId: null },
            });

            // Release inventory if allocated
            if (hasInventory && line.skuId) {
                await tx.inventoryTransaction.deleteMany({
                    where: {
                        referenceId: lineId,
                        txnType: 'outward',
                        reason: 'order_allocation',
                    },
                });
                inventoryReleased = true;
            }
        });

        // Invalidate inventory cache if inventory was released
        if (inventoryReleased && line.skuId) {
            inventoryBalanceCache.invalidate([line.skuId]);
        }

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

        // Soft return for not cancelled (preserve existing behavior)
        if (line.lineStatus !== 'cancelled') {
            res.json({ id: lineId, lineStatus: line.lineStatus });
            return;
        }

        // Enforce uncancel line rules using rules engine
        await enforceRulesInExpress('uncancelLine', req, {
            data: { line },
            phase: 'pre',
        });

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
        const { qty, unitPrice, notes, awbNumber, courier } = req.body as UpdateLineBody;
        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { order: true },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }

        // Enforce rules for line editing
        const hasQtyOrPrice = qty !== undefined || unitPrice !== undefined;
        await enforceRulesInExpress('editLine', req, {
            data: {
                line: { id: line.id, lineStatus: line.lineStatus },
                hasQtyOrPriceChange: hasQtyOrPrice,
            },
            phase: 'pre',
        });

        const updateData: Prisma.OrderLineUpdateInput = {};
        if (qty !== undefined) updateData.qty = qty;
        if (unitPrice !== undefined) updateData.unitPrice = unitPrice;
        if (notes !== undefined) updateData.notes = notes;
        if (awbNumber !== undefined) updateData.awbNumber = awbNumber || null;
        if (courier !== undefined) updateData.courier = courier || null;

        // If only updating simple fields (notes, awbNumber, courier), no transaction needed
        if (!hasQtyOrPrice) {
            const updated = await req.prisma.orderLine.update({
                where: { id: lineId },
                data: updateData,
            });
            res.json(updated);
            return;
        }

        // Check if line has allocated inventory AND qty is changing
        const hasInventory = hasAllocatedInventory(line.lineStatus as LineStatus);
        const qtyIsChanging = qty !== undefined && qty !== line.qty;
        let inventoryAdjusted = false;

        // Use Prisma transaction for all updates
        await req.prisma.$transaction(async (tx) => {
            // Update line
            await tx.orderLine.update({
                where: { id: lineId },
                data: updateData,
            });

            // Adjust inventory if line has inventory and qty is changing
            if (hasInventory && qtyIsChanging && line.skuId) {
                // Delete existing outward transaction
                await tx.inventoryTransaction.deleteMany({
                    where: {
                        referenceId: lineId,
                        txnType: 'outward',
                        reason: 'order_allocation',
                    },
                });

                // Create new outward transaction with updated qty
                await tx.inventoryTransaction.create({
                    data: {
                        skuId: line.skuId,
                        txnType: 'outward',
                        qty: qty!,
                        reason: 'order_allocation',
                        referenceId: lineId,
                        createdById: req.user?.id || 'system',
                    },
                });
                inventoryAdjusted = true;
            }

            // Recalculate order total
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

        // Invalidate inventory cache if inventory was adjusted
        if (inventoryAdjusted && line.skuId) {
            inventoryBalanceCache.invalidate([line.skuId]);
        }

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

        // Enforce rules for adding lines
        await enforceRulesInExpress('addLine', req, {
            data: { order: { id: order.id, status: order.status } },
            phase: 'pre',
        });

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
