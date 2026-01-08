/**
 * Mutations Router
 * Create, update, delete, cancel, and archive operations
 */

import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { releaseReservedInventory, createReservedTransaction, calculateInventoryBalance, recalculateOrderStatus, createCustomSku, removeCustomization } from '../../utils/queryPatterns.js';
import { findOrCreateCustomerByContact } from '../../utils/customerUtils.js';
import { validate, CreateOrderSchema, UpdateOrderSchema, CustomizeLineSchema } from '../../utils/validation.js';
import { recomputeOrderStatus } from '../../utils/orderStatus.js';

const router = Router();

// ============================================
// ORDER CREATION (Manual/Offline)
// ============================================

router.post('/', authenticateToken, validate(CreateOrderSchema), async (req, res) => {
    try {
        const {
            orderNumber,
            channel,
            customerName,
            customerEmail,
            customerPhone,
            shippingAddress,
            customerNotes,
            internalNotes,
            totalAmount,
            lines,
        } = req.validatedBody;

        // Issue #5: Wrap entire order + lines creation in single Prisma transaction
        const order = await req.prisma.$transaction(async (tx) => {
            // Find or create customer within transaction
            let customerId = null;
            if (customerEmail || customerPhone) {
                const customer = await findOrCreateCustomerByContact(tx, {
                    email: customerEmail,
                    phone: customerPhone,
                    firstName: customerName?.split(' ')[0],
                    lastName: customerName?.split(' ').slice(1).join(' '),
                    defaultAddress: shippingAddress,
                });
                customerId = customer.id;
            }

            // Create order with lines in same transaction
            const createdOrder = await tx.order.create({
                data: {
                    orderNumber,
                    channel,
                    customerId,
                    customerName,
                    customerEmail,
                    customerPhone,
                    shippingAddress,
                    customerNotes,
                    internalNotes,
                    totalAmount,
                    orderLines: {
                        create: lines.map((line) => ({
                            skuId: line.skuId,
                            qty: line.qty,
                            unitPrice: line.unitPrice,
                            lineStatus: 'pending',
                        })),
                    },
                },
                include: {
                    orderLines: {
                        include: {
                            sku: { include: { variation: { include: { product: true } } } },
                        },
                    },
                },
            });

            return createdOrder;
        });

        res.status(201).json(order);
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ error: 'Failed to create order' });
    }
});

// Update order details
router.put('/:id', authenticateToken, validate(UpdateOrderSchema), async (req, res) => {
    try {
        const {
            customerName,
            customerEmail,
            customerPhone,
            shippingAddress,
            internalNotes,
        } = req.validatedBody;

        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const updateData = {};
        if (customerName !== undefined) updateData.customerName = customerName;
        if (customerEmail !== undefined) updateData.customerEmail = customerEmail;
        if (customerPhone !== undefined) updateData.customerPhone = customerPhone;
        if (shippingAddress !== undefined) updateData.shippingAddress = shippingAddress;
        if (internalNotes !== undefined) updateData.internalNotes = internalNotes;

        const updated = await req.prisma.order.update({
            where: { id: req.params.id },
            data: updateData,
            include: {
                orderLines: {
                    include: {
                        sku: { include: { variation: { include: { product: true } } } },
                    },
                },
            },
        });

        res.json(updated);
    } catch (error) {
        console.error('Update order error:', error);
        res.status(500).json({ error: 'Failed to update order' });
    }
});

// Delete order (only for manually created orders)
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true }
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.shopifyOrderId && order.orderLines.length > 0) {
            return res.status(400).json({ error: 'Cannot delete Shopify orders with line items. Use cancel instead.' });
        }

        await req.prisma.$transaction(async (tx) => {
            for (const line of order.orderLines) {
                if (line.productionBatchId) {
                    await tx.productionBatch.update({
                        where: { id: line.productionBatchId },
                        data: { sourceOrderLineId: null }
                    });
                }

                if (line.lineStatus === 'allocated' || line.lineStatus === 'picked' || line.lineStatus === 'packed') {
                    // Properly release reserved inventory by deleting the reservation transaction
                    await releaseReservedInventory(tx, line.id);
                }
            }

            await tx.orderLine.deleteMany({ where: { orderId: order.id } });
            await tx.order.delete({ where: { id: order.id } });
        });

        res.json({ success: true, message: 'Order deleted successfully' });
    } catch (error) {
        console.error('Delete order error:', error);
        res.status(500).json({ error: 'Failed to delete order' });
    }
});

// ============================================
// CANCEL / UNCANCEL
// ============================================

// Cancel order
router.post('/:id/cancel', authenticateToken, async (req, res) => {
    try {
        const { reason } = req.body;

        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status === 'cancelled') {
            return res.status(400).json({ error: 'Order is already cancelled' });
        }

        if (order.status === 'shipped' || order.status === 'delivered') {
            return res.status(400).json({ error: 'Cannot cancel shipped or delivered orders' });
        }

        await req.prisma.$transaction(async (tx) => {
            // Issue #7: Re-check status inside transaction to prevent race condition
            const currentOrder = await tx.order.findUnique({
                where: { id: req.params.id },
                select: { status: true },
            });

            // Prevent canceling if status changed during request
            if (currentOrder.status === 'shipped' || currentOrder.status === 'delivered') {
                throw new Error('CANNOT_CANCEL_SHIPPED');
            }

            if (currentOrder.status === 'cancelled') {
                throw new Error('ALREADY_CANCELLED');
            }

            for (const line of order.orderLines) {
                if (['allocated', 'picked', 'packed'].includes(line.lineStatus)) {
                    await releaseReservedInventory(tx, line.id);
                }
            }

            await tx.orderLine.updateMany({
                where: { orderId: req.params.id },
                data: { lineStatus: 'cancelled' },
            });

            await tx.order.update({
                where: { id: req.params.id },
                data: {
                    status: 'cancelled',
                    internalNotes: reason
                        ? (order.internalNotes ? `${order.internalNotes}\n\nCancelled: ${reason}` : `Cancelled: ${reason}`)
                        : order.internalNotes,
                },
            });
        });

        const updated = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        res.json(updated);
    } catch (error) {
        if (error.message === 'CANNOT_CANCEL_SHIPPED') {
            return res.status(409).json({ error: 'Order was shipped by another request and cannot be cancelled' });
        }
        if (error.message === 'ALREADY_CANCELLED') {
            return res.status(409).json({ error: 'Order was already cancelled by another request' });
        }
        console.error('Cancel order error:', error);
        res.status(500).json({ error: 'Failed to cancel order' });
    }
});

// Uncancel order (restore to open)
router.post('/:id/uncancel', authenticateToken, async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: { include: { sku: true } } },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'cancelled') {
            return res.status(400).json({ error: 'Order is not cancelled' });
        }

        // Issue #8: Uncancel needs to restore line statuses to pending
        // Note: We don't auto-allocate on uncancel - that requires manual allocation
        await req.prisma.$transaction(async (tx) => {
            // Restore order to open status
            await tx.order.update({
                where: { id: req.params.id },
                data: { status: 'open' },
            });

            // Restore all lines to pending status
            await tx.orderLine.updateMany({
                where: { orderId: req.params.id },
                data: { lineStatus: 'pending' },
            });
        });

        const updated = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        res.json(updated);
    } catch (error) {
        console.error('Uncancel order error:', error);
        res.status(500).json({ error: 'Failed to restore order' });
    }
});

// ============================================
// HOLD / RELEASE OPERATIONS
// ============================================

// Hold entire order (blocks all lines from fulfillment)
router.put('/:id/hold', authenticateToken, async (req, res) => {
    try {
        const { reason, notes } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Hold reason is required' });
        }

        const validReasons = ['fraud_review', 'address_issue', 'payment_issue', 'customer_request', 'other'];
        if (!validReasons.includes(reason)) {
            return res.status(400).json({
                error: 'Invalid hold reason',
                validReasons
            });
        }

        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true }
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.isOnHold) {
            return res.status(400).json({ error: 'Order is already on hold' });
        }

        if (order.isArchived) {
            return res.status(400).json({ error: 'Cannot hold archived orders' });
        }

        if (['shipped', 'delivered', 'cancelled'].includes(order.status)) {
            return res.status(400).json({
                error: `Cannot hold order in ${order.status} status`
            });
        }

        const updated = await req.prisma.$transaction(async (tx) => {
            const result = await tx.order.update({
                where: { id: req.params.id },
                data: {
                    isOnHold: true,
                    holdReason: reason,
                    holdNotes: notes || null,
                    holdAt: new Date()
                },
                include: { orderLines: true }
            });

            // Recompute order status
            await recomputeOrderStatus(req.params.id, tx);

            return tx.order.findUnique({
                where: { id: req.params.id },
                include: { orderLines: true }
            });
        });

        console.log(`[Hold] Order ${order.orderNumber} placed on hold: ${reason}`);
        res.json(updated);
    } catch (error) {
        console.error('Hold order error:', error);
        res.status(500).json({ error: 'Failed to hold order' });
    }
});

// Release order from hold
router.put('/:id/release', authenticateToken, async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true }
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (!order.isOnHold) {
            return res.status(400).json({ error: 'Order is not on hold' });
        }

        const updated = await req.prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: req.params.id },
                data: {
                    isOnHold: false,
                    holdReason: null,
                    holdNotes: null,
                    holdAt: null
                }
            });

            // Recompute order status
            await recomputeOrderStatus(req.params.id, tx);

            return tx.order.findUnique({
                where: { id: req.params.id },
                include: { orderLines: true }
            });
        });

        console.log(`[Release] Order ${order.orderNumber} released from hold`);
        res.json(updated);
    } catch (error) {
        console.error('Release order error:', error);
        res.status(500).json({ error: 'Failed to release order' });
    }
});

// Hold a single order line
router.put('/lines/:lineId/hold', authenticateToken, async (req, res) => {
    try {
        const { reason, notes } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Hold reason is required' });
        }

        const validReasons = ['size_confirmation', 'stock_issue', 'customization', 'customer_request', 'other'];
        if (!validReasons.includes(reason)) {
            return res.status(400).json({
                error: 'Invalid hold reason',
                validReasons
            });
        }

        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
            include: { order: true }
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        if (line.isOnHold) {
            return res.status(400).json({ error: 'Line is already on hold' });
        }

        if (['shipped', 'cancelled'].includes(line.lineStatus)) {
            return res.status(400).json({
                error: `Cannot hold line in ${line.lineStatus} status`
            });
        }

        if (line.order.isArchived) {
            return res.status(400).json({ error: 'Cannot hold lines in archived orders' });
        }

        const updated = await req.prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: req.params.lineId },
                data: {
                    isOnHold: true,
                    holdReason: reason,
                    holdNotes: notes || null,
                    holdAt: new Date()
                }
            });

            // Recompute order status
            await recomputeOrderStatus(line.orderId, tx);

            return tx.orderLine.findUnique({
                where: { id: req.params.lineId },
                include: { order: true }
            });
        });

        console.log(`[Hold] Line ${req.params.lineId} placed on hold: ${reason}`);
        res.json(updated);
    } catch (error) {
        console.error('Hold line error:', error);
        res.status(500).json({ error: 'Failed to hold line' });
    }
});

// Release a single order line from hold
router.put('/lines/:lineId/release', authenticateToken, async (req, res) => {
    try {
        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
            include: { order: true }
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        if (!line.isOnHold) {
            return res.status(400).json({ error: 'Line is not on hold' });
        }

        const updated = await req.prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: req.params.lineId },
                data: {
                    isOnHold: false,
                    holdReason: null,
                    holdNotes: null,
                    holdAt: null
                }
            });

            // Recompute order status
            await recomputeOrderStatus(line.orderId, tx);

            return tx.orderLine.findUnique({
                where: { id: req.params.lineId },
                include: { order: true }
            });
        });

        console.log(`[Release] Line ${req.params.lineId} released from hold`);
        res.json(updated);
    } catch (error) {
        console.error('Release line error:', error);
        res.status(500).json({ error: 'Failed to release line' });
    }
});

// ============================================
// ARCHIVE OPERATIONS
// ============================================

// Archive order
router.post('/:id/archive', authenticateToken, async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            select: { id: true, orderNumber: true, isArchived: true, status: true },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.isArchived) {
            return res.status(400).json({ error: 'Order is already archived' });
        }

        // Issue #6: Add status validation before archiving
        // Only terminal states can be archived
        const terminalStatuses = ['shipped', 'delivered', 'cancelled'];
        if (!terminalStatuses.includes(order.status)) {
            return res.status(400).json({
                error: 'Order must be in a terminal state to archive',
                currentStatus: order.status,
                allowedStatuses: terminalStatuses,
            });
        }

        const updated = await req.prisma.order.update({
            where: { id: req.params.id },
            data: {
                status: 'archived',
                isArchived: true,
                archivedAt: new Date(),
            },
            include: { orderLines: true },
        });

        console.log(`[Manual Archive] Order ${order.orderNumber} archived`);
        res.json(updated);
    } catch (error) {
        console.error('Archive order error:', error);
        res.status(500).json({ error: 'Failed to archive order' });
    }
});

// Unarchive order
router.post('/:id/unarchive', authenticateToken, async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (!order.isArchived) {
            return res.status(400).json({ error: 'Order is not archived' });
        }

        const updated = await req.prisma.order.update({
            where: { id: req.params.id },
            data: {
                isArchived: false,
                archivedAt: null,
            },
            include: { orderLines: true },
        });

        res.json(updated);
    } catch (error) {
        console.error('Unarchive order error:', error);
        res.status(500).json({ error: 'Failed to unarchive order' });
    }
});

// Auto-archive shipped orders older than 90 days
export async function autoArchiveOldOrders(prisma) {
    try {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        const result = await prisma.order.updateMany({
            where: {
                status: 'shipped',
                isArchived: false,
                shippedAt: { lt: ninetyDaysAgo },
            },
            data: {
                isArchived: true,
                archivedAt: new Date(),
            },
        });

        if (result.count > 0) {
            console.log(`Auto-archived ${result.count} shipped orders older than 90 days`);
        }
        return result.count;
    } catch (error) {
        console.error('Auto-archive error:', error);
        return 0;
    }
}

// Manual trigger for auto-archive (admin endpoint)
router.post('/auto-archive', authenticateToken, async (req, res) => {
    try {
        const count = await autoArchiveOldOrders(req.prisma);
        res.json({ message: `Archived ${count} orders`, count });
    } catch (error) {
        console.error('Auto-archive endpoint error:', error);
        res.status(500).json({ error: 'Failed to auto-archive orders' });
    }
});

// Archive orders before a specific date
router.post('/archive-before-date', authenticateToken, async (req, res) => {
    try {
        const { beforeDate, status } = req.body;
        if (!beforeDate) {
            return res.status(400).json({ error: 'beforeDate is required (ISO format)' });
        }

        const cutoffDate = new Date(beforeDate);

        const where = {
            orderDate: { lt: cutoffDate },
            isArchived: false
        };

        if (status) {
            where.status = status;
        }

        const result = await req.prisma.order.updateMany({
            where,
            data: {
                isArchived: true,
                status: 'archived',
                archivedAt: new Date()
            }
        });

        res.json({ message: `Archived ${result.count} orders before ${beforeDate}`, count: result.count });
    } catch (error) {
        console.error('Archive before date error:', error);
        res.status(500).json({ error: 'Failed to archive orders' });
    }
});

// Archive delivered orders (prepaid and paid COD)
router.post('/archive-delivered-prepaid', authenticateToken, async (req, res) => {
    try {
        const prepaidOrders = await req.prisma.order.findMany({
            where: {
                trackingStatus: 'delivered',
                paymentMethod: 'Prepaid',
                status: { in: ['shipped', 'delivered'] },
                isArchived: false,
            },
            select: {
                id: true,
                orderNumber: true,
                paymentMethod: true,
                deliveredAt: true,
                shippedAt: true,
            },
        });

        const codOrders = await req.prisma.order.findMany({
            where: {
                trackingStatus: 'delivered',
                paymentMethod: 'COD',
                codRemittedAt: { not: null },
                status: { in: ['shipped', 'delivered'] },
                isArchived: false,
            },
            select: {
                id: true,
                orderNumber: true,
                paymentMethod: true,
                deliveredAt: true,
                shippedAt: true,
                codRemittedAt: true,
            },
        });

        const ordersToArchive = [...prepaidOrders, ...codOrders];

        if (ordersToArchive.length === 0) {
            return res.json({
                message: 'No delivered orders ready to archive',
                archived: 0,
                prepaid: 0,
                cod: 0,
            });
        }

        const result = await req.prisma.order.updateMany({
            where: {
                id: { in: ordersToArchive.map(o => o.id) },
            },
            data: {
                status: 'archived',
                isArchived: true,
                archivedAt: new Date(),
            },
        });

        const deliveryStats = ordersToArchive
            .filter(o => o.deliveredAt && o.shippedAt)
            .map(o => {
                const daysToDeliver = Math.ceil(
                    (new Date(o.deliveredAt) - new Date(o.shippedAt)) / (1000 * 60 * 60 * 24)
                );
                return { orderNumber: o.orderNumber, paymentMethod: o.paymentMethod, daysToDeliver };
            });

        const avgDaysToDeliver = deliveryStats.length > 0
            ? (deliveryStats.reduce((sum, s) => sum + s.daysToDeliver, 0) / deliveryStats.length).toFixed(1)
            : null;

        console.log(`[Auto-Archive] Archived ${result.count} orders (${prepaidOrders.length} prepaid, ${codOrders.length} COD). Avg delivery time: ${avgDaysToDeliver} days`);

        res.json({
            message: `Archived ${result.count} delivered orders`,
            archived: result.count,
            prepaid: prepaidOrders.length,
            cod: codOrders.length,
            avgDaysToDeliver,
            deliveryStats: deliveryStats.slice(0, 10),
        });
    } catch (error) {
        console.error('Archive delivered orders error:', error);
        res.status(500).json({ error: 'Failed to archive orders' });
    }
});

// ============================================
// ORDER LINE OPERATIONS
// ============================================

// Cancel a single order line
router.post('/lines/:lineId/cancel', authenticateToken, async (req, res) => {
    try {
        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
            include: { order: true },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        if (line.lineStatus === 'shipped') {
            return res.status(400).json({ error: 'Cannot cancel shipped line' });
        }

        if (line.lineStatus === 'cancelled') {
            return res.status(400).json({ error: 'Line is already cancelled' });
        }

        await req.prisma.$transaction(async (tx) => {
            if (['allocated', 'picked', 'packed'].includes(line.lineStatus)) {
                await releaseReservedInventory(tx, line.id);
            }

            await tx.orderLine.update({
                where: { id: req.params.lineId },
                data: { lineStatus: 'cancelled' },
            });

            const allLines = await tx.orderLine.findMany({
                where: { orderId: line.orderId },
            });
            const activeLines = allLines.filter(l => l.id === req.params.lineId ? false : l.lineStatus !== 'cancelled');

            if (activeLines.length === 0) {
                await tx.order.update({
                    where: { id: line.orderId },
                    data: { status: 'cancelled', totalAmount: 0 },
                });
            } else {
                const newTotal = activeLines.reduce((sum, l) => sum + (l.qty * l.unitPrice), 0);
                await tx.order.update({
                    where: { id: line.orderId },
                    data: { totalAmount: newTotal },
                });
            }
        });

        const updated = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
        });

        res.json(updated);
    } catch (error) {
        console.error('Cancel line error:', error);
        res.status(500).json({ error: 'Failed to cancel line' });
    }
});

// Uncancel a single order line
router.post('/lines/:lineId/uncancel', authenticateToken, async (req, res) => {
    try {
        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
            include: { order: true },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        if (line.lineStatus !== 'cancelled') {
            return res.status(400).json({ error: 'Line is not cancelled' });
        }

        await req.prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: req.params.lineId },
                data: { lineStatus: 'pending' },
            });

            const newTotal = (line.order.totalAmount || 0) + (line.qty * line.unitPrice);

            const updateData = { totalAmount: newTotal };
            if (line.order.status === 'cancelled') {
                updateData.status = 'open';
            }

            await tx.order.update({
                where: { id: line.orderId },
                data: updateData,
            });
        });

        const updated = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
        });

        res.json(updated);
    } catch (error) {
        console.error('Uncancel line error:', error);
        res.status(500).json({ error: 'Failed to restore line' });
    }
});

// Update order line (change qty, unitPrice, or notes)
router.put('/lines/:lineId', authenticateToken, async (req, res) => {
    try {
        const { qty, unitPrice, notes } = req.body;
        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
            include: { order: true },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        // Notes can be updated regardless of line status
        // qty/unitPrice require pending status
        const hasQtyOrPrice = qty !== undefined || unitPrice !== undefined;
        if (hasQtyOrPrice && line.lineStatus !== 'pending') {
            return res.status(400).json({ error: 'Can only edit qty/price on pending lines' });
        }

        const updateData = {};
        if (qty !== undefined) updateData.qty = qty;
        if (unitPrice !== undefined) updateData.unitPrice = unitPrice;
        if (notes !== undefined) updateData.notes = notes;

        // If only updating notes, simple update without transaction
        if (!hasQtyOrPrice) {
            const updated = await req.prisma.orderLine.update({
                where: { id: req.params.lineId },
                data: updateData,
            });
            return res.json(updated);
        }

        // qty/unitPrice changes need transaction to update order total
        await req.prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: req.params.lineId },
                data: updateData,
            });

            const allLines = await tx.orderLine.findMany({
                where: { orderId: line.orderId },
            });
            const newTotal = allLines.reduce((sum, l) => {
                const lineQty = l.id === req.params.lineId ? (qty ?? l.qty) : l.qty;
                const linePrice = l.id === req.params.lineId ? (unitPrice ?? l.unitPrice) : l.unitPrice;
                return sum + (lineQty * linePrice);
            }, 0);
            await tx.order.update({
                where: { id: line.orderId },
                data: { totalAmount: newTotal },
            });
        });

        const updated = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
        });

        res.json(updated);
    } catch (error) {
        console.error('Update line error:', error);
        res.status(500).json({ error: 'Failed to update line' });
    }
});

// Add line to order
router.post('/:id/lines', authenticateToken, async (req, res) => {
    try {
        const { skuId, qty, unitPrice } = req.body;

        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'open') {
            return res.status(400).json({ error: 'Can only add lines to open orders' });
        }

        await req.prisma.$transaction(async (tx) => {
            await tx.orderLine.create({
                data: {
                    orderId: req.params.id,
                    skuId,
                    qty,
                    unitPrice,
                    lineStatus: 'pending',
                },
            });

            const allLines = await tx.orderLine.findMany({
                where: { orderId: req.params.id },
            });
            const newTotal = allLines.reduce((sum, l) => sum + (l.qty * l.unitPrice), 0);
            await tx.order.update({
                where: { id: req.params.id },
                data: { totalAmount: newTotal },
            });
        });

        const updated = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: {
                orderLines: {
                    include: {
                        sku: { include: { variation: { include: { product: true } } } },
                    },
                },
            },
        });

        res.json(updated);
    } catch (error) {
        console.error('Add line error:', error);
        res.status(500).json({ error: 'Failed to add line' });
    }
});

// ============================================
// ORDER LINE CUSTOMIZATION
// ============================================

/**
 * Customize an order line - create custom SKU
 * POST /lines/:lineId/customize
 *
 * Creates a custom SKU for the order line with customization details.
 * Line must be in 'pending' status and not already customized.
 * The custom SKU code is generated as {BASE_SKU}-C{XX}.
 */
router.post('/lines/:lineId/customize', authenticateToken, validate(CustomizeLineSchema), async (req, res) => {
    try {
        const { lineId } = req.params;
        const customizationData = req.validatedBody;
        const userId = req.user.id;

        // Get order line to find the base SKU
        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { sku: true, order: { select: { orderNumber: true, status: true } } },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        // Use the current SKU as the base SKU
        const baseSkuId = line.skuId;

        const result = await createCustomSku(
            req.prisma,
            baseSkuId,
            customizationData,
            lineId,
            userId
        );

        console.log(`[Customize] Order ${result.orderLine.order.orderNumber}: Created custom SKU ${result.customSku.skuCode} for line ${lineId}`);

        res.json({
            id: result.orderLine.id,
            customSkuCode: result.customSku.skuCode,
            customSkuId: result.customSku.id,
            isCustomized: true,
            isNonReturnable: true,
            originalSkuCode: result.originalSkuCode,
            qty: result.orderLine.qty,
            customizationType: result.customSku.customizationType,
            customizationValue: result.customSku.customizationValue,
            customizationNotes: result.customSku.customizationNotes,
        });
    } catch (error) {
        // Handle specific error codes from createCustomSku
        if (error.message === 'ORDER_LINE_NOT_FOUND') {
            return res.status(404).json({ error: 'Order line not found' });
        }
        if (error.message === 'LINE_NOT_PENDING') {
            return res.status(400).json({
                error: 'Cannot customize an allocated/picked/packed line. Unallocate first.',
                code: 'LINE_NOT_PENDING',
            });
        }
        if (error.message === 'ALREADY_CUSTOMIZED') {
            return res.status(400).json({
                error: 'Order line is already customized',
                code: 'ALREADY_CUSTOMIZED',
            });
        }

        console.error('Customize line error:', error);
        res.status(500).json({ error: 'Failed to customize order line' });
    }
});

/**
 * Remove customization from an order line
 * DELETE /lines/:lineId/customize
 *
 * Reverts the order line to the original SKU and deletes the custom SKU.
 * Only allowed if no inventory transactions or production batches exist.
 */
router.delete('/lines/:lineId/customize', authenticateToken, async (req, res) => {
    try {
        const { lineId } = req.params;

        const result = await removeCustomization(req.prisma, lineId);

        console.log(`[Uncustomize] Order ${result.orderLine.order.orderNumber}: Removed custom SKU ${result.deletedCustomSkuCode} from line ${lineId}`);

        res.json({
            id: result.orderLine.id,
            skuCode: result.orderLine.sku.skuCode,
            skuId: result.orderLine.sku.id,
            isCustomized: false,
            deletedCustomSkuCode: result.deletedCustomSkuCode,
        });
    } catch (error) {
        // Handle specific error codes from removeCustomization
        if (error.message === 'ORDER_LINE_NOT_FOUND') {
            return res.status(404).json({ error: 'Order line not found' });
        }
        if (error.message === 'NOT_CUSTOMIZED') {
            return res.status(400).json({
                error: 'Order line is not customized',
                code: 'NOT_CUSTOMIZED',
            });
        }
        if (error.message === 'CANNOT_UNDO_HAS_INVENTORY') {
            return res.status(400).json({
                error: 'Cannot undo customization - inventory transactions exist for custom SKU',
                code: 'CANNOT_UNDO_HAS_INVENTORY',
            });
        }
        if (error.message === 'CANNOT_UNDO_HAS_PRODUCTION') {
            return res.status(400).json({
                error: 'Cannot undo customization - production batch exists for custom SKU',
                code: 'CANNOT_UNDO_HAS_PRODUCTION',
            });
        }

        console.error('Uncustomize line error:', error);
        res.status(500).json({ error: 'Failed to remove customization' });
    }
});

// ============================================
// DATA MIGRATION: Copy order tracking to lines
// One-time migration for line-centric architecture
// ============================================

/**
 * Migrate tracking data from Order to OrderLines
 * This is a one-time migration to support multi-AWB shipping
 */
router.post('/migrate-tracking-to-lines', authenticateToken, async (req, res) => {
    try {
        // Find all shipped/delivered orders that have AWB on order but not on lines
        const ordersToMigrate = await req.prisma.order.findMany({
            where: {
                awbNumber: { not: null },
                orderLines: {
                    some: {
                        awbNumber: null,
                        lineStatus: { in: ['shipped', 'delivered'] }
                    }
                }
            },
            include: {
                orderLines: {
                    where: {
                        awbNumber: null,
                        lineStatus: { in: ['shipped', 'delivered'] }
                    }
                }
            }
        });

        if (ordersToMigrate.length === 0) {
            return res.json({
                message: 'No orders need migration',
                migrated: 0
            });
        }

        let migratedOrders = 0;
        let migratedLines = 0;

        for (const order of ordersToMigrate) {
            await req.prisma.orderLine.updateMany({
                where: {
                    orderId: order.id,
                    awbNumber: null,
                    lineStatus: { in: ['shipped', 'delivered'] }
                },
                data: {
                    awbNumber: order.awbNumber,
                    courier: order.courier,
                    trackingStatus: order.trackingStatus,
                    deliveredAt: order.deliveredAt,
                    rtoInitiatedAt: order.rtoInitiatedAt,
                    rtoReceivedAt: order.rtoReceivedAt,
                    lastTrackingUpdate: order.lastTrackingUpdate
                }
            });

            migratedOrders++;
            migratedLines += order.orderLines.length;
        }

        console.log(`[Migration] Migrated tracking data for ${migratedOrders} orders (${migratedLines} lines)`);

        res.json({
            message: 'Migration completed',
            migratedOrders,
            migratedLines
        });
    } catch (error) {
        console.error('Migration error:', error);
        res.status(500).json({ error: 'Failed to migrate tracking data' });
    }
});

export default router;
