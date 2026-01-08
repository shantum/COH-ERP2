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

        // Issue #3: Add status precondition check
        if (line.lineStatus !== 'pending') {
            return res.status(400).json({
                error: 'Line must be in pending status to allocate',
                currentStatus: line.lineStatus,
            });
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
            // Re-check status inside transaction to prevent race conditions
            const currentLine = await tx.orderLine.findUnique({
                where: { id: req.params.lineId },
                select: { lineStatus: true },
            });

            if (currentLine.lineStatus !== 'pending') {
                throw new Error('ALREADY_ALLOCATED');
            }

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
        if (error.message === 'ALREADY_ALLOCATED') {
            return res.status(409).json({ error: 'Line was already allocated by another request' });
        }
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
        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        // Issue #3: Add status precondition check
        if (line.lineStatus !== 'allocated') {
            return res.status(400).json({
                error: 'Line must be in allocated status to pick',
                currentStatus: line.lineStatus,
            });
        }

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
        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        // Issue #3: Add status precondition check
        if (line.lineStatus !== 'picked') {
            return res.status(400).json({
                error: 'Line must be in picked status to pack',
                currentStatus: line.lineStatus,
            });
        }

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

        // Issue #4: Deduplicate lineIds to prevent double-counting
        const uniqueLineIds = [...new Set(lineIds)];

        const timestamp = new Date();

        const updateData = { lineStatus: status };
        if (status === 'allocated') updateData.allocatedAt = timestamp;
        if (status === 'picked') updateData.pickedAt = timestamp;
        if (status === 'packed') updateData.packedAt = timestamp;
        if (status === 'shipped') updateData.shippedAt = timestamp;

        const result = await req.prisma.orderLine.updateMany({
            where: { id: { in: uniqueLineIds } },
            data: updateData,
        });

        res.json({ updated: result.count, requested: lineIds.length, deduplicated: uniqueLineIds.length });
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

        // Issue #1: Idempotency check - if already shipped, return success
        if (order.status === 'shipped') {
            return res.json({
                ...order,
                message: 'Order is already shipped',
            });
        }

        // Issue #11: Check for duplicate AWB number (if AWB provided)
        if (awbNumber) {
            const existingAwb = await req.prisma.order.findFirst({
                where: {
                    awbNumber,
                    id: { not: req.params.id },
                },
                select: { id: true, orderNumber: true },
            });

            if (existingAwb) {
                return res.status(400).json({
                    error: 'AWB number already assigned to another order',
                    existingOrderNumber: existingAwb.orderNumber,
                });
            }
        }

        // Issue #9: Validate all lines are packed before shipping
        const notPacked = order.orderLines.filter((l) => l.lineStatus !== 'packed');
        if (notPacked.length > 0) {
            return res.status(400).json({
                error: 'All lines must be packed before shipping',
                notPackedCount: notPacked.length,
                notPackedLines: notPacked.map(l => ({
                    id: l.id,
                    status: l.lineStatus,
                })),
            });
        }

        await req.prisma.$transaction(async (tx) => {
            // Issue #1: Re-check order status inside transaction to prevent race condition
            const currentOrder = await tx.order.findUnique({
                where: { id: req.params.id },
                select: { status: true },
            });

            if (currentOrder.status === 'shipped') {
                throw new Error('ALREADY_SHIPPED');
            }

            // Issue #11: Re-check AWB inside transaction
            if (awbNumber) {
                const existingAwb = await tx.order.findFirst({
                    where: {
                        awbNumber,
                        id: { not: req.params.id },
                    },
                    select: { id: true },
                });

                if (existingAwb) {
                    throw new Error('AWB_DUPLICATE');
                }
            }

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
        if (error.message === 'ALREADY_SHIPPED') {
            // Return success for idempotency
            const order = await req.prisma.order.findUnique({
                where: { id: req.params.id },
                include: { orderLines: true },
            });
            return res.json({ ...order, message: 'Order was already shipped' });
        }
        if (error.message === 'AWB_DUPLICATE') {
            return res.status(409).json({ error: 'AWB number was assigned to another order' });
        }
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
            // Issue #2: Re-check status inside transaction to prevent race condition
            const currentOrder = await tx.order.findUnique({
                where: { id: req.params.id },
                select: { status: true },
            });

            if (currentOrder.status !== 'shipped') {
                throw new Error('NOT_SHIPPED');
            }

            // Issue #2: Atomic inventory correction
            // First, delete all sale transactions for this order's lines
            for (const line of order.orderLines) {
                await deleteSaleTransactions(tx, line.id);
            }

            // Then create reserved transactions atomically
            for (const line of order.orderLines) {
                await createReservedTransaction(tx, {
                    skuId: line.skuId,
                    qty: line.qty,
                    orderLineId: line.id,
                    userId: req.user.id,
                });
            }

            // Update order status
            await tx.order.update({
                where: { id: req.params.id },
                data: {
                    status: 'open',
                    awbNumber: null,
                    courier: null,
                    shippedAt: null,
                },
            });

            // Revert line statuses to packed (ready to re-ship)
            await tx.orderLine.updateMany({
                where: { orderId: req.params.id },
                data: { lineStatus: 'packed', shippedAt: null },
            });
        });

        const updated = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        res.json(updated);
    } catch (error) {
        if (error.message === 'NOT_SHIPPED') {
            return res.status(400).json({ error: 'Order is no longer in shipped status' });
        }
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

// ============================================
// QUICK SHIP: Force ship order (skip allocate/pick/pack checks)
// TEMPORARY - For testing phase only
// ============================================

router.post('/:id/quick-ship', authenticateToken, async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status === 'shipped') {
            return res.json({ ...order, message: 'Order is already shipped' });
        }

        if (order.status !== 'open') {
            return res.status(400).json({ error: `Cannot ship order with status: ${order.status}` });
        }

        // Require AWB and courier
        if (!order.awbNumber || !order.courier) {
            return res.status(400).json({ error: 'AWB number and courier are required' });
        }

        const now = new Date();

        // Process each line - auto allocate/pick/pack/ship
        for (const line of order.orderLines) {
            if (line.lineStatus === 'shipped' || line.lineStatus === 'cancelled') continue;

            // If pending, try to allocate (create reserved then release)
            if (line.lineStatus === 'pending') {
                // Check inventory - skip allocation if insufficient (allow shipping without inventory for testing)
                const balance = await calculateInventoryBalance(req.prisma, line.skuId);
                if (balance.available >= line.qty) {
                    await createReservedTransaction(req.prisma, {
                        skuId: line.skuId,
                        qty: line.qty,
                        orderLineId: line.id,
                        userId: req.user.id,
                    });
                }
            }

            // Release any reserved inventory and create sale
            await releaseReservedInventory(req.prisma, line.id);
            await createSaleTransaction(req.prisma, {
                skuId: line.skuId,
                qty: line.qty,
                orderLineId: line.id,
                userId: req.user.id,
            });

            // Update line to shipped
            await req.prisma.orderLine.update({
                where: { id: line.id },
                data: {
                    lineStatus: 'shipped',
                    allocatedAt: line.allocatedAt || now,
                    pickedAt: line.pickedAt || now,
                    packedAt: line.packedAt || now,
                    shippedAt: now,
                },
            });
        }

        // Update order status
        const updated = await req.prisma.order.update({
            where: { id: order.id },
            data: {
                status: 'shipped',
                shippedAt: now,
                trackingStatus: 'in_transit',
            },
            include: { orderLines: true },
        });

        console.log(`[Quick Ship] Order ${order.orderNumber} shipped`);
        res.json(updated);
    } catch (error) {
        console.error('Quick ship error:', error);
        res.status(500).json({ error: 'Failed to quick ship order' });
    }
});

// ============================================
// BULK QUICK SHIP: Ship all eligible orders at once
// ============================================

router.post('/bulk-quick-ship', authenticateToken, async (req, res) => {
    try {
        // Find all open orders with AWB and courier set
        const eligibleOrders = await req.prisma.order.findMany({
            where: {
                status: 'open',
                isArchived: false,
                awbNumber: { not: null },
                courier: { not: null },
            },
            include: { orderLines: true },
        });

        if (eligibleOrders.length === 0) {
            return res.json({ shipped: [], failed: [], message: 'No eligible orders to quick ship' });
        }

        const results = { shipped: [], failed: [] };
        const now = new Date();

        for (const order of eligibleOrders) {
            try {
                // Process each line - auto allocate/pick/pack/ship
                for (const line of order.orderLines) {
                    if (line.lineStatus === 'shipped' || line.lineStatus === 'cancelled') continue;

                    // If pending, try to allocate
                    if (line.lineStatus === 'pending') {
                        const balance = await calculateInventoryBalance(req.prisma, line.skuId);
                        if (balance.available >= line.qty) {
                            await createReservedTransaction(req.prisma, {
                                skuId: line.skuId,
                                qty: line.qty,
                                orderLineId: line.id,
                                userId: req.user.id,
                            });
                        }
                    }

                    // Release reserved inventory and create sale
                    await releaseReservedInventory(req.prisma, line.id);
                    await createSaleTransaction(req.prisma, {
                        skuId: line.skuId,
                        qty: line.qty,
                        orderLineId: line.id,
                        userId: req.user.id,
                    });

                    // Update line to shipped
                    await req.prisma.orderLine.update({
                        where: { id: line.id },
                        data: {
                            lineStatus: 'shipped',
                            allocatedAt: line.allocatedAt || now,
                            pickedAt: line.pickedAt || now,
                            packedAt: line.packedAt || now,
                            shippedAt: now,
                        },
                    });
                }

                // Update order status
                await req.prisma.order.update({
                    where: { id: order.id },
                    data: {
                        status: 'shipped',
                        shippedAt: now,
                        trackingStatus: 'in_transit',
                    },
                });

                results.shipped.push({ id: order.id, orderNumber: order.orderNumber });
                console.log(`[Bulk Quick Ship] Order ${order.orderNumber} shipped`);
            } catch (orderError) {
                console.error(`[Bulk Quick Ship] Failed to ship order ${order.orderNumber}:`, orderError.message);
                results.failed.push({ id: order.id, orderNumber: order.orderNumber, error: orderError.message });
            }
        }

        res.json({
            ...results,
            message: `Shipped ${results.shipped.length} orders, ${results.failed.length} failed`,
        });
    } catch (error) {
        console.error('Bulk quick ship error:', error);
        res.status(500).json({ error: 'Failed to bulk quick ship orders' });
    }
});

export default router;
