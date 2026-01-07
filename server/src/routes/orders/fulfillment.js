/**
 * Fulfillment Router
 * Order line status updates and shipping operations
 */

import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import {
    calculateInventoryBalance,
    TXN_TYPE,
    TXN_REASON,
    releaseReservedInventory,
    createReservedTransaction,
    createSaleTransaction,
    deleteSaleTransactions,
} from '../../utils/queryPatterns.js';
import { validate, ShipOrderSchema } from '../../utils/validation.js';

const router = Router();

// ============================================
// ORDER LINE STATUS UPDATES
// ============================================

// Allocate order line (reserve inventory)
router.post('/lines/:lineId/allocate', authenticateToken, async (req, res) => {
    try {
        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
            include: { sku: true, order: true },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        const balance = await calculateInventoryBalance(req.prisma, line.skuId);
        if (balance.availableBalance < line.qty) {
            return res.status(400).json({
                error: 'Insufficient stock',
                available: balance.availableBalance,
                requested: line.qty,
            });
        }

        await req.prisma.$transaction(async (tx) => {
            await createReservedTransaction(tx, {
                skuId: line.skuId,
                qty: line.qty,
                orderLineId: line.id,
                userId: req.user.id,
            });

            await tx.orderLine.update({
                where: { id: req.params.lineId },
                data: { lineStatus: 'allocated', allocatedAt: new Date() },
            });
        });

        const updated = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
        });

        res.json(updated);
    } catch (error) {
        console.error('Allocate line error:', error);
        res.status(500).json({ error: 'Failed to allocate line' });
    }
});

// Unallocate order line (release reserved inventory)
router.post('/lines/:lineId/unallocate', authenticateToken, async (req, res) => {
    try {
        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        if (line.lineStatus !== 'allocated') {
            return res.status(400).json({ error: 'Line is not allocated' });
        }

        await req.prisma.$transaction(async (tx) => {
            await releaseReservedInventory(tx, line.id);

            await tx.orderLine.update({
                where: { id: req.params.lineId },
                data: { lineStatus: 'pending', allocatedAt: null },
            });
        });

        const updated = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
        });

        res.json(updated);
    } catch (error) {
        console.error('Unallocate line error:', error);
        res.status(500).json({ error: 'Failed to unallocate line' });
    }
});

// Pick order line
router.post('/lines/:lineId/pick', authenticateToken, async (req, res) => {
    try {
        const updated = await req.prisma.orderLine.update({
            where: { id: req.params.lineId },
            data: { lineStatus: 'picked', pickedAt: new Date() },
        });
        res.json(updated);
    } catch (error) {
        console.error('Pick line error:', error);
        res.status(500).json({ error: 'Failed to pick line' });
    }
});

// Unpick order line (revert to allocated)
router.post('/lines/:lineId/unpick', authenticateToken, async (req, res) => {
    try {
        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        if (line.lineStatus !== 'picked') {
            return res.status(400).json({ error: 'Line is not in picked status' });
        }

        const updated = await req.prisma.orderLine.update({
            where: { id: req.params.lineId },
            data: { lineStatus: 'allocated', pickedAt: null },
        });

        res.json(updated);
    } catch (error) {
        console.error('Unpick line error:', error);
        res.status(500).json({ error: 'Failed to unpick line' });
    }
});

// Pack order line
router.post('/lines/:lineId/pack', authenticateToken, async (req, res) => {
    try {
        const updated = await req.prisma.orderLine.update({
            where: { id: req.params.lineId },
            data: { lineStatus: 'packed', packedAt: new Date() },
        });
        res.json(updated);
    } catch (error) {
        console.error('Pack line error:', error);
        res.status(500).json({ error: 'Failed to pack line' });
    }
});

// Unpack order line (revert to picked)
router.post('/lines/:lineId/unpack', authenticateToken, async (req, res) => {
    try {
        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        if (line.lineStatus !== 'packed') {
            return res.status(400).json({ error: 'Line is not in packed status' });
        }

        const updated = await req.prisma.orderLine.update({
            where: { id: req.params.lineId },
            data: { lineStatus: 'picked', packedAt: null },
        });

        res.json(updated);
    } catch (error) {
        console.error('Unpack line error:', error);
        res.status(500).json({ error: 'Failed to unpack line' });
    }
});

// Bulk update line statuses
router.post('/lines/bulk-update', authenticateToken, async (req, res) => {
    try {
        const { lineIds, status } = req.body;
        const timestamp = new Date();

        const updateData = { lineStatus: status };
        if (status === 'allocated') updateData.allocatedAt = timestamp;
        if (status === 'picked') updateData.pickedAt = timestamp;
        if (status === 'packed') updateData.packedAt = timestamp;
        if (status === 'shipped') updateData.shippedAt = timestamp;

        await req.prisma.orderLine.updateMany({
            where: { id: { in: lineIds } },
            data: updateData,
        });

        res.json({ updated: lineIds.length });
    } catch (error) {
        console.error('Bulk update error:', error);
        res.status(500).json({ error: 'Failed to bulk update' });
    }
});

// ============================================
// SHIP ORDER
// ============================================

router.post('/:id/ship', authenticateToken, validate(ShipOrderSchema), async (req, res) => {
    try {
        const { awbNumber, courier } = req.validatedBody;

        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const validStatuses = ['allocated', 'picked', 'packed'];
        const notReady = order.orderLines.filter((l) => !validStatuses.includes(l.lineStatus));
        if (notReady.length > 0) {
            return res.status(400).json({
                error: 'Not all lines are allocated',
                notReadyCount: notReady.length,
            });
        }

        await req.prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: req.params.id },
                data: {
                    status: 'shipped',
                    awbNumber,
                    courier,
                    shippedAt: new Date(),
                },
            });

            await tx.orderLine.updateMany({
                where: { orderId: req.params.id },
                data: { lineStatus: 'shipped', shippedAt: new Date() },
            });

            for (const line of order.orderLines) {
                await releaseReservedInventory(tx, line.id);

                await createSaleTransaction(tx, {
                    skuId: line.skuId,
                    qty: line.qty,
                    orderLineId: line.id,
                    userId: req.user.id,
                });
            }
        });

        const updated = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        res.json(updated);
    } catch (error) {
        console.error('Ship order error:', error);
        res.status(500).json({ error: 'Failed to ship order' });
    }
});

// Unship order (move back to open)
router.post('/:id/unship', authenticateToken, async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'shipped') {
            return res.status(400).json({ error: 'Order is not shipped' });
        }

        await req.prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: req.params.id },
                data: {
                    status: 'open',
                    awbNumber: null,
                    courier: null,
                    shippedAt: null,
                },
            });

            await tx.orderLine.updateMany({
                where: { orderId: req.params.id },
                data: { lineStatus: 'allocated', shippedAt: null },
            });

            for (const line of order.orderLines) {
                await deleteSaleTransactions(tx, line.id);

                await createReservedTransaction(tx, {
                    skuId: line.skuId,
                    qty: line.qty,
                    orderLineId: line.id,
                    userId: req.user.id,
                });
            }
        });

        const updated = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        res.json(updated);
    } catch (error) {
        console.error('Unship order error:', error);
        res.status(500).json({ error: 'Failed to unship order' });
    }
});

// Mark delivered (simple version)
router.post('/:id/deliver', authenticateToken, async (req, res) => {
    try {
        const updated = await req.prisma.order.update({
            where: { id: req.params.id },
            data: { status: 'delivered', deliveredAt: new Date() },
        });
        res.json(updated);
    } catch (error) {
        console.error('Deliver order error:', error);
        res.status(500).json({ error: 'Failed to mark delivered' });
    }
});

// Mark order as delivered (with validation)
router.post('/:id/mark-delivered', authenticateToken, async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'shipped') {
            return res.status(400).json({ error: 'Order must be shipped to mark as delivered' });
        }

        const updated = await req.prisma.order.update({
            where: { id: req.params.id },
            data: {
                status: 'delivered',
                deliveredAt: new Date(),
            },
        });

        res.json(updated);
    } catch (error) {
        console.error('Mark delivered error:', error);
        res.status(500).json({ error: 'Failed to mark order as delivered' });
    }
});

// Initiate RTO for order
router.post('/:id/mark-rto', authenticateToken, async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'shipped') {
            return res.status(400).json({ error: 'Order must be shipped to initiate RTO' });
        }

        const updated = await req.prisma.order.update({
            where: { id: req.params.id },
            data: {
                rtoInitiatedAt: new Date(),
            },
        });

        res.json(updated);
    } catch (error) {
        console.error('Mark RTO error:', error);
        res.status(500).json({ error: 'Failed to initiate RTO' });
    }
});

// Receive RTO package (creates inventory inward)
router.post('/:id/receive-rto', authenticateToken, async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (!order.rtoInitiatedAt) {
            return res.status(400).json({ error: 'RTO must be initiated first' });
        }

        if (order.rtoReceivedAt) {
            return res.status(400).json({ error: 'RTO already received' });
        }

        await req.prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: req.params.id },
                data: { rtoReceivedAt: new Date() },
            });

            for (const line of order.orderLines) {
                await tx.inventoryTransaction.create({
                    data: {
                        skuId: line.skuId,
                        txnType: TXN_TYPE.INWARD,
                        qty: line.qty,
                        reason: TXN_REASON.RTO_RECEIVED,
                        referenceId: line.id,
                        createdById: req.user.id,
                    },
                });
            }
        });

        const updated = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        res.json(updated);
    } catch (error) {
        console.error('Receive RTO error:', error);
        res.status(500).json({ error: 'Failed to receive RTO' });
    }
});

export default router;
