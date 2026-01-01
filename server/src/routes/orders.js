import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// ============================================
// ORDERS LIST
// ============================================

// Get all orders (with filters)
router.get('/', async (req, res) => {
    try {
        const { status, channel, startDate, endDate, search, limit = 50, offset = 0 } = req.query;

        const where = {};
        if (status) where.status = status;
        if (channel) where.channel = channel;
        if (startDate || endDate) {
            where.orderDate = {};
            if (startDate) where.orderDate.gte = new Date(startDate);
            if (endDate) where.orderDate.lte = new Date(endDate);
        }
        if (search) {
            where.OR = [
                { orderNumber: { contains: search, mode: 'insensitive' } },
                { customerName: { contains: search, mode: 'insensitive' } },
                { customerEmail: { contains: search, mode: 'insensitive' } },
            ];
        }

        const orders = await req.prisma.order.findMany({
            where,
            include: {
                customer: true,
                orderLines: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true } },
                            },
                        },
                    },
                },
            },
            orderBy: { orderDate: 'desc' },
            take: Number(limit),
            skip: Number(offset),
        });

        res.json(orders);
    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// Get open orders with fulfillment status
router.get('/open', async (req, res) => {
    try {
        const orders = await req.prisma.order.findMany({
            where: { status: 'open' },
            include: {
                customer: true,
                orderLines: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true, fabric: true } },
                            },
                        },
                        productionBatch: true,
                    },
                },
            },
            orderBy: { orderDate: 'asc' },
        });

        // Enrich with fulfillment status
        const enrichedOrders = await Promise.all(
            orders.map(async (order) => {
                const lineStatuses = order.orderLines.map((l) => l.lineStatus);

                let fulfillmentStage = 'pending';
                if (lineStatuses.every((s) => s === 'packed')) {
                    fulfillmentStage = 'ready_to_ship';
                } else if (lineStatuses.some((s) => ['picked', 'packed'].includes(s))) {
                    fulfillmentStage = 'in_progress';
                } else if (lineStatuses.every((s) => s === 'allocated')) {
                    fulfillmentStage = 'allocated';
                }

                return {
                    ...order,
                    totalLines: order.orderLines.length,
                    pendingLines: lineStatuses.filter((s) => s === 'pending').length,
                    allocatedLines: lineStatuses.filter((s) => s === 'allocated').length,
                    pickedLines: lineStatuses.filter((s) => s === 'picked').length,
                    packedLines: lineStatuses.filter((s) => s === 'packed').length,
                    fulfillmentStage,
                };
            })
        );

        res.json(enrichedOrders);
    } catch (error) {
        console.error('Get open orders error:', error);
        res.status(500).json({ error: 'Failed to fetch open orders' });
    }
});

// Get shipped orders
router.get('/shipped', async (req, res) => {
    try {
        const orders = await req.prisma.order.findMany({
            where: { status: { in: ['shipped', 'delivered'] } },
            include: {
                customer: true,
                orderLines: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true, fabric: true } },
                            },
                        },
                        productionBatch: true,
                    },
                },
            },
            orderBy: { shippedAt: 'desc' },
        });

        const enriched = orders.map((order) => {
            const daysInTransit = order.shippedAt
                ? Math.floor((Date.now() - new Date(order.shippedAt).getTime()) / (1000 * 60 * 60 * 24))
                : 0;

            let trackingStatus = 'in_transit';
            if (order.status === 'delivered') {
                trackingStatus = 'completed';
            } else if (daysInTransit > 7) {
                trackingStatus = 'delivery_delayed';
            }

            return {
                ...order,
                daysInTransit,
                trackingStatus,
            };
        });

        res.json(enriched);
    } catch (error) {
        console.error('Get shipped orders error:', error);
        res.status(500).json({ error: 'Failed to fetch shipped orders' });
    }
});

// Get single order
router.get('/:id', async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: {
                customer: true,
                orderLines: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true, fabric: true } },
                            },
                        },
                        productionBatch: true,
                    },
                },
                returnRequests: true,
            },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json(order);
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({ error: 'Failed to fetch order' });
    }
});

// ============================================
// ORDER CREATION (Manual/Offline)
// ============================================

router.post('/', authenticateToken, async (req, res) => {
    try {
        const {
            orderNumber,
            channel = 'offline',
            customerName,
            customerEmail,
            customerPhone,
            shippingAddress,
            customerNotes,
            internalNotes,
            totalAmount,
            lines, // Array of { skuId, qty, unitPrice }
        } = req.body;

        // Find or create customer
        let customerId = null;
        if (customerEmail || customerPhone) {
            let customer = null;

            // Try to find by email first
            if (customerEmail) {
                customer = await req.prisma.customer.findUnique({ where: { email: customerEmail } });
            }

            // If no email or not found, try to find by phone
            if (!customer && customerPhone) {
                customer = await req.prisma.customer.findFirst({ where: { phone: customerPhone } });
            }

            // Create new customer if not found
            if (!customer) {
                // Use email if provided, otherwise generate one from phone
                const email = customerEmail || `${customerPhone.replace(/\D/g, '')}@phone.local`;
                customer = await req.prisma.customer.create({
                    data: {
                        email,
                        firstName: customerName?.split(' ')[0],
                        lastName: customerName?.split(' ').slice(1).join(' '),
                        phone: customerPhone,
                        defaultAddress: shippingAddress,
                    },
                });
            } else if (customerPhone && !customer.phone) {
                // Update phone if customer exists but doesn't have phone
                customer = await req.prisma.customer.update({
                    where: { id: customer.id },
                    data: { phone: customerPhone },
                });
            }

            customerId = customer.id;
        }

        const order = await req.prisma.order.create({
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

        res.status(201).json(order);
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ error: 'Failed to create order' });
    }
});

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

        // Check inventory (available = inward - outward - reserved)
        const balance = await calculateInventoryBalance(req.prisma, line.skuId);
        if (balance.availableBalance < line.qty) {
            return res.status(400).json({
                error: 'Insufficient stock',
                available: balance.availableBalance,
                requested: line.qty,
            });
        }

        // Create reserved transaction and update line in a transaction
        await req.prisma.$transaction(async (tx) => {
            // Create reserved inventory transaction
            await tx.inventoryTransaction.create({
                data: {
                    skuId: line.skuId,
                    txnType: 'reserved',
                    qty: line.qty,
                    reason: 'order_allocation',
                    referenceId: line.id,
                    notes: `Reserved for order ${line.order.orderNumber}`,
                    createdById: req.user.id,
                },
            });

            // Update order line status
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
            // Delete the reserved transaction
            await tx.inventoryTransaction.deleteMany({
                where: {
                    referenceId: line.id,
                    txnType: 'reserved',
                    reason: 'order_allocation',
                },
            });

            // Update order line status back to pending
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

router.post('/:id/ship', authenticateToken, async (req, res) => {
    try {
        const { awbNumber, courier } = req.body;

        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Check all lines are packed
        const notPacked = order.orderLines.filter((l) => l.lineStatus !== 'packed');
        if (notPacked.length > 0) {
            return res.status(400).json({
                error: 'Not all lines are packed',
                notPackedCount: notPacked.length,
            });
        }

        // Update order and lines
        await req.prisma.$transaction(async (tx) => {
            // Update order
            await tx.order.update({
                where: { id: req.params.id },
                data: {
                    status: 'shipped',
                    awbNumber,
                    courier,
                    shippedAt: new Date(),
                },
            });

            // Update all lines to shipped
            await tx.orderLine.updateMany({
                where: { orderId: req.params.id },
                data: { lineStatus: 'shipped', shippedAt: new Date() },
            });

            // Create inventory outward transactions for each line and remove reservations
            for (const line of order.orderLines) {
                // Delete the reserved transaction (allocation is now fulfilled)
                await tx.inventoryTransaction.deleteMany({
                    where: {
                        referenceId: line.id,
                        txnType: 'reserved',
                        reason: 'order_allocation',
                    },
                });

                // Create the actual outward transaction for the sale
                await tx.inventoryTransaction.create({
                    data: {
                        skuId: line.skuId,
                        txnType: 'outward',
                        qty: line.qty,
                        reason: 'sale',
                        referenceId: line.id,
                        notes: `Order ${order.orderNumber}`,
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
        console.error('Ship order error:', error);
        res.status(500).json({ error: 'Failed to ship order' });
    }
});

// Mark delivered
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

// Cancel order
router.post('/:id/cancel', authenticateToken, async (req, res) => {
    try {
        const { reason } = req.body;

        const updated = await req.prisma.order.update({
            where: { id: req.params.id },
            data: {
                status: 'cancelled',
                internalNotes: reason,
            },
        });

        res.json(updated);
    } catch (error) {
        console.error('Cancel order error:', error);
        res.status(500).json({ error: 'Failed to cancel order' });
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

        // Only allow deleting manually created orders (not synced from Shopify)
        if (order.shopifyOrderId) {
            return res.status(400).json({ error: 'Cannot delete orders synced from Shopify. Use cancel instead.' });
        }

        // Delete in transaction
        await req.prisma.$transaction(async (tx) => {
            // Unlink production batches from order lines
            for (const line of order.orderLines) {
                if (line.productionBatchId) {
                    await tx.productionBatch.update({
                        where: { id: line.productionBatchId },
                        data: { sourceOrderLineId: null }
                    });
                }

                // Release any reserved inventory
                if (line.lineStatus === 'allocated' || line.lineStatus === 'picked' || line.lineStatus === 'packed') {
                    await tx.inventoryTransaction.create({
                        data: {
                            skuId: line.skuId,
                            txnType: 'reserved',
                            qty: -line.qty, // Negative to release
                            reason: 'order_deleted',
                            referenceId: order.id,
                            notes: `Released from deleted order ${order.orderNumber}`,
                            createdById: req.user.id,
                        }
                    });
                }
            }

            // Delete order lines
            await tx.orderLine.deleteMany({ where: { orderId: order.id } });

            // Delete the order
            await tx.order.delete({ where: { id: order.id } });
        });

        res.json({ success: true, message: 'Order deleted successfully' });
    } catch (error) {
        console.error('Delete order error:', error);
        res.status(500).json({ error: 'Failed to delete order' });
    }
});

// ============================================
// HELPER
// ============================================

async function calculateInventoryBalance(prisma, skuId) {
    const result = await prisma.inventoryTransaction.groupBy({
        by: ['txnType'],
        where: { skuId },
        _sum: { qty: true },
    });

    let totalInward = 0;
    let totalOutward = 0;
    let totalReserved = 0;

    result.forEach((r) => {
        if (r.txnType === 'inward') totalInward = r._sum.qty || 0;
        else if (r.txnType === 'outward') totalOutward = r._sum.qty || 0;
        else if (r.txnType === 'reserved') totalReserved = r._sum.qty || 0;
    });

    const currentBalance = totalInward - totalOutward;
    const availableBalance = currentBalance - totalReserved;

    return { totalInward, totalOutward, totalReserved, currentBalance, availableBalance };
}

export default router;
