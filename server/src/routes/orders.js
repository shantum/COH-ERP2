import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
    calculateInventoryBalance,
    ORDER_FULL_INCLUDE,
    TXN_TYPE,
    TXN_REASON,
    releaseReservedInventory,
    createReservedTransaction,
    createSaleTransaction,
    deleteSaleTransactions,
    findOrCreateCustomer,
} from '../utils/queryPatterns.js';
import { getCustomerLtvMap, getTierThresholds, calculateTier } from '../utils/tierUtils.js';

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
            where: { status: 'open', isArchived: false },
            select: {
                id: true,
                orderNumber: true,
                shopifyOrderId: true,
                channel: true,
                customerId: true,
                customerName: true,
                customerEmail: true,
                customerPhone: true,
                shippingAddress: true,
                orderDate: true,
                customerNotes: true,
                internalNotes: true,
                status: true,
                awbNumber: true,
                courier: true,
                shippedAt: true,
                deliveredAt: true,
                totalAmount: true,
                createdAt: true,
                shopifyFulfillmentStatus: true,
                paymentMethod: true,
                // Exclude shopifyData to reduce payload size
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

        // Get customer LTV data for all orders
        const customerIds = [...new Set(orders.map(o => o.customerId).filter(Boolean))];
        const [customerLtvMap, thresholds] = await Promise.all([
            getCustomerLtvMap(req.prisma, customerIds),
            getTierThresholds(req.prisma)
        ]);

        // Enrich with fulfillment status and customer LTV
        const enrichedOrders = orders.map((order) => {
            const lineStatuses = order.orderLines.map((l) => l.lineStatus);

            let fulfillmentStage = 'pending';
            if (lineStatuses.every((s) => s === 'packed')) {
                fulfillmentStage = 'ready_to_ship';
            } else if (lineStatuses.some((s) => ['picked', 'packed'].includes(s))) {
                fulfillmentStage = 'in_progress';
            } else if (lineStatuses.every((s) => s === 'allocated')) {
                fulfillmentStage = 'allocated';
            }

            const customerLtv = customerLtvMap[order.customerId] || 0;

            return {
                ...order,
                totalLines: order.orderLines.length,
                pendingLines: lineStatuses.filter((s) => s === 'pending').length,
                allocatedLines: lineStatuses.filter((s) => s === 'allocated').length,
                pickedLines: lineStatuses.filter((s) => s === 'picked').length,
                packedLines: lineStatuses.filter((s) => s === 'packed').length,
                fulfillmentStage,
                customerLtv,
                customerTier: calculateTier(customerLtv, thresholds),
            };
        });

        res.json(enrichedOrders);
    } catch (error) {
        console.error('Get open orders error:', error);
        res.status(500).json({ error: 'Failed to fetch open orders' });
    }
});

// Get shipped orders
router.get('/shipped', async (req, res) => {
    try {
        const { limit = 1000, offset = 0, days = 30 } = req.query;

        // Filter to recent orders by default (last 30 days)
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - Number(days));

        const orders = await req.prisma.order.findMany({
            where: {
                status: { in: ['shipped', 'delivered'] },
                shippedAt: { gte: sinceDate }
            },
            select: {
                id: true,
                orderNumber: true,
                shopifyOrderId: true,
                channel: true,
                customerId: true,
                customerName: true,
                customerEmail: true,
                customerPhone: true,
                shippingAddress: true,
                orderDate: true,
                customerNotes: true,
                internalNotes: true,
                status: true,
                awbNumber: true,
                courier: true,
                shippedAt: true,
                deliveredAt: true,
                totalAmount: true,
                createdAt: true,
                shopifyFulfillmentStatus: true,
                paymentMethod: true,
                // Exclude shopifyData to reduce payload size
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
            take: Number(limit),
            skip: Number(offset),
        });

        // Get customer LTV data for all orders
        const customerIds = [...new Set(orders.map(o => o.customerId).filter(Boolean))];
        const [customerLtvMap, thresholds] = await Promise.all([
            getCustomerLtvMap(req.prisma, customerIds),
            getTierThresholds(req.prisma)
        ]);

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

            const customerLtv = customerLtvMap[order.customerId] || 0;

            return {
                ...order,
                daysInTransit,
                trackingStatus,
                customerLtv,
                customerTier: calculateTier(customerLtv, thresholds),
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
            const customer = await findOrCreateCustomer(req.prisma, {
                email: customerEmail,
                phone: customerPhone,
                firstName: customerName?.split(' ')[0],
                lastName: customerName?.split(' ').slice(1).join(' '),
                defaultAddress: shippingAddress,
            });
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
            await createReservedTransaction(tx, {
                skuId: line.skuId,
                qty: line.qty,
                orderLineId: line.id,
                userId: req.user.id,
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
            // Release reserved inventory
            await releaseReservedInventory(tx, line.id);

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

        // Check all lines are at least allocated (allow skipping pick/pack steps)
        const validStatuses = ['allocated', 'picked', 'packed'];
        const notReady = order.orderLines.filter((l) => !validStatuses.includes(l.lineStatus));
        if (notReady.length > 0) {
            return res.status(400).json({
                error: 'Not all lines are allocated',
                notReadyCount: notReady.length,
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
                // Release reserved inventory (allocation is now fulfilled)
                await releaseReservedInventory(tx, line.id);

                // Create the actual outward transaction for the sale
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

// Update order details
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const {
            customerName,
            customerEmail,
            customerPhone,
            shippingAddress,
            internalNotes,
        } = req.body;

        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Build update data - only include fields that are provided
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
            // Update order back to open
            await tx.order.update({
                where: { id: req.params.id },
                data: {
                    status: 'open',
                    awbNumber: null,
                    courier: null,
                    shippedAt: null,
                },
            });

            // Update all lines back to allocated
            await tx.orderLine.updateMany({
                where: { orderId: req.params.id },
                data: { lineStatus: 'allocated', shippedAt: null },
            });

            // Reverse inventory transactions for each line
            for (const line of order.orderLines) {
                // Delete the sale outward transaction
                await deleteSaleTransactions(tx, line.id);

                // Re-create the reserved transaction (allocation)
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
            // Release reserved inventory for allocated lines
            for (const line of order.orderLines) {
                if (['allocated', 'picked', 'packed'].includes(line.lineStatus)) {
                    await releaseReservedInventory(tx, line.id);
                }
            }

            // Update all lines to cancelled
            await tx.orderLine.updateMany({
                where: { orderId: req.params.id },
                data: { lineStatus: 'pending' },
            });

            // Update order status
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
        console.error('Cancel order error:', error);
        res.status(500).json({ error: 'Failed to cancel order' });
    }
});

// Uncancel order (restore to open)
router.post('/:id/uncancel', authenticateToken, async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'cancelled') {
            return res.status(400).json({ error: 'Order is not cancelled' });
        }

        await req.prisma.order.update({
            where: { id: req.params.id },
            data: { status: 'open' },
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

// Get archived orders
router.get('/status/archived', async (req, res) => {
    try {
        const orders = await req.prisma.order.findMany({
            where: { isArchived: true },
            include: {
                customer: true,
                orderLines: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true, fabric: true } },
                            },
                        },
                    },
                },
            },
            orderBy: { archivedAt: 'desc' },
        });

        res.json(orders);
    } catch (error) {
        console.error('Get archived orders error:', error);
        res.status(500).json({ error: 'Failed to fetch archived orders' });
    }
});

// Get cancelled orders
router.get('/status/cancelled', async (req, res) => {
    try {
        const orders = await req.prisma.order.findMany({
            where: { status: 'cancelled', isArchived: false },
            include: {
                customer: true,
                orderLines: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true, fabric: true } },
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json(orders);
    } catch (error) {
        console.error('Get cancelled orders error:', error);
        res.status(500).json({ error: 'Failed to fetch cancelled orders' });
    }
});

// Archive order
router.post('/:id/archive', authenticateToken, async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.isArchived) {
            return res.status(400).json({ error: 'Order is already archived' });
        }

        const updated = await req.prisma.order.update({
            where: { id: req.params.id },
            data: {
                isArchived: true,
                archivedAt: new Date(),
            },
            include: { orderLines: true },
        });

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

// Cancel a single order line (keeps line visible but marked as cancelled)
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
            // Release reserved inventory if allocated
            if (['allocated', 'picked', 'packed'].includes(line.lineStatus)) {
                await releaseReservedInventory(tx, line.id);
            }

            // Mark line as cancelled (don't delete)
            await tx.orderLine.update({
                where: { id: req.params.lineId },
                data: { lineStatus: 'cancelled' },
            });

            // Check if all lines are now cancelled
            const allLines = await tx.orderLine.findMany({
                where: { orderId: line.orderId },
            });
            const activeLines = allLines.filter(l => l.id === req.params.lineId ? false : l.lineStatus !== 'cancelled');

            if (activeLines.length === 0) {
                // All lines cancelled - cancel the entire order
                await tx.order.update({
                    where: { id: line.orderId },
                    data: { status: 'cancelled', totalAmount: 0 },
                });
            } else {
                // Recalculate order total (excluding cancelled lines)
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

// Uncancel a single order line (restore to pending)
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
            // Restore line to pending
            await tx.orderLine.update({
                where: { id: req.params.lineId },
                data: { lineStatus: 'pending' },
            });

            // Recalculate order total (include this line now)
            const newTotal = (line.order.totalAmount || 0) + (line.qty * line.unitPrice);

            // If order was cancelled, restore it to open
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

// Update order line (change qty)
router.put('/lines/:lineId', authenticateToken, async (req, res) => {
    try {
        const { qty, unitPrice } = req.body;
        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
            include: { order: true },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        if (line.lineStatus !== 'pending') {
            return res.status(400).json({ error: 'Can only edit pending lines' });
        }

        const updateData = {};
        if (qty !== undefined) updateData.qty = qty;
        if (unitPrice !== undefined) updateData.unitPrice = unitPrice;

        await req.prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: req.params.lineId },
                data: updateData,
            });

            // Recalculate order total
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

            // Recalculate order total
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

export default router;
