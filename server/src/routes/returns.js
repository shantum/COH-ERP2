import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Get all return requests
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { status, requestType, limit = 50 } = req.query;
        const where = {};
        if (status) where.status = status;
        if (requestType) where.requestType = requestType;

        const requests = await req.prisma.returnRequest.findMany({
            where,
            include: {
                originalOrder: true,
                customer: true,
                lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
                shipping: true,
            },
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
        });

        const enriched = requests.map((r) => ({
            ...r,
            ageDays: Math.floor((Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
        }));

        res.json(enriched);
    } catch (error) {
        console.error('Get return requests error:', error);
        res.status(500).json({ error: 'Failed to fetch return requests' });
    }
});

// Get single request
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const request = await req.prisma.returnRequest.findUnique({
            where: { id: req.params.id },
            include: {
                originalOrder: true,
                customer: true,
                lines: { include: { sku: true, exchangeSku: true } },
                shipping: true,
                statusHistory: { include: { changedBy: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
            },
        });
        if (!request) return res.status(404).json({ error: 'Not found' });
        res.json(request);
    } catch (error) {
        console.error('Get return request error:', error);
        res.status(500).json({ error: 'Failed to fetch request' });
    }
});

// Create return request
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { requestType, originalOrderId, reasonCategory, reasonDetails, lines } = req.body;
        const order = await req.prisma.order.findUnique({ where: { id: originalOrderId } });
        if (!order) return res.status(404).json({ error: 'Order not found' });

        const count = await req.prisma.returnRequest.count();
        const requestNumber = `RET-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

        const request = await req.prisma.returnRequest.create({
            data: {
                requestNumber, requestType, originalOrderId, customerId: order.customerId,
                reasonCategory, reasonDetails, status: 'requested',
                lines: { create: lines.map((l) => ({ skuId: l.skuId, qty: l.qty, exchangeSkuId: l.exchangeSkuId })) },
            },
            include: { lines: true },
        });

        await req.prisma.returnStatusHistory.create({
            data: { requestId: request.id, fromStatus: 'requested', toStatus: 'requested', changedById: req.user.id },
        });

        res.status(201).json(request);
    } catch (error) {
        console.error('Create return request error:', error);
        res.status(500).json({ error: 'Failed to create return request' });
    }
});

// Status updates
router.post('/:id/initiate-reverse', authenticateToken, async (req, res) => {
    try {
        const { courier, awbNumber, pickupScheduledAt } = req.body;
        await req.prisma.returnShipping.create({
            data: { requestId: req.params.id, direction: 'reverse', courier, awbNumber, pickupScheduledAt: pickupScheduledAt ? new Date(pickupScheduledAt) : null, status: 'scheduled' },
        });
        await updateStatus(req.prisma, req.params.id, 'reverse_initiated', req.user.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Initiate reverse shipping error:', error);
        res.status(500).json({ error: 'Failed to initiate reverse shipping' });
    }
});

router.post('/:id/mark-received', authenticateToken, async (req, res) => {
    try {
        await req.prisma.returnShipping.updateMany({ where: { requestId: req.params.id, direction: 'reverse' }, data: { status: 'delivered', receivedAt: new Date() } });
        await updateStatus(req.prisma, req.params.id, 'received', req.user.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Mark received error:', error);
        res.status(500).json({ error: 'Failed to mark as received' });
    }
});

router.post('/:id/resolve', authenticateToken, async (req, res) => {
    try {
        const { resolutionType, resolutionNotes } = req.body;
        const request = await req.prisma.returnRequest.findUnique({ where: { id: req.params.id }, include: { lines: true } });

        await req.prisma.$transaction(async (tx) => {
            await tx.returnRequest.update({ where: { id: req.params.id }, data: { status: 'resolved', resolutionType, resolutionNotes } });
            for (const line of request.lines) {
                if (line.itemCondition !== 'damaged') {
                    await tx.inventoryTransaction.create({ data: { skuId: line.skuId, txnType: 'inward', qty: line.qty, reason: 'return_receipt', referenceId: request.id, createdById: req.user.id } });
                }
            }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Resolve return error:', error);
        res.status(500).json({ error: 'Failed to resolve return' });
    }
});

// ============================================
// RETURN INWARD - Receive returns into repacking queue
// ============================================

// Get order details with line items for return inward
router.get('/inward/order/:orderId', authenticateToken, async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: {
                customer: true,
                lines: {
                    include: {
                        sku: {
                            include: {
                                variation: {
                                    include: { product: true },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Format response with order items
        const items = order.lines.map((line) => ({
            orderLineId: line.id,
            skuId: line.sku.id,
            skuCode: line.sku.skuCode,
            barcode: line.sku.barcode,
            productName: line.sku.variation?.product?.name,
            colorName: line.sku.variation?.colorName,
            size: line.sku.size,
            qty: line.qty,
            imageUrl: line.sku.variation?.imageUrl || line.sku.variation?.product?.imageUrl,
        }));

        res.json({
            id: order.id,
            orderNumber: order.orderNumber,
            shopifyOrderNumber: order.shopifyOrderNumber,
            orderDate: order.orderDate,
            customer: order.customer ? {
                id: order.customer.id,
                name: order.customer.name,
                email: order.customer.email,
            } : null,
            items,
        });
    } catch (error) {
        console.error('Get order for return error:', error);
        res.status(500).json({ error: 'Failed to fetch order details' });
    }
});

router.post('/inward', authenticateToken, async (req, res) => {
    try {
        const {
            skuId,
            orderLineId,
            qty = 1,
            condition, // correct_product, incorrect_product, damaged_product
            requestType = 'return', // return or exchange
            reasonCategory,
            originalOrderId,
        } = req.body;

        // Validate required fields
        if (!originalOrderId) {
            return res.status(400).json({ error: 'Order is required for return inward' });
        }

        if (!skuId) {
            return res.status(400).json({ error: 'SKU is required' });
        }

        if (!condition) {
            return res.status(400).json({ error: 'Condition is required' });
        }

        // Fetch the order with lines to verify
        const order = await req.prisma.order.findUnique({
            where: { id: originalOrderId },
            include: {
                customer: true,
                lines: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true } },
                            },
                        },
                    },
                },
            },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Verify SKU is in the order (unless marked as incorrect product)
        const orderLine = order.lines.find((line) => line.skuId === skuId);
        if (!orderLine && condition !== 'incorrect_product') {
            return res.status(400).json({
                error: 'This SKU is not in the selected order. If this is a different product than ordered, select "Received incorrect product".',
            });
        }

        // Get the SKU details
        const sku = await req.prisma.sku.findUnique({
            where: { id: skuId },
            include: { variation: { include: { product: true } } },
        });

        if (!sku) {
            return res.status(404).json({ error: 'SKU not found' });
        }

        const customer = order.customer;

        // Map condition to internal values
        const conditionMap = {
            correct_product: 'used', // Will be inspected further in repacking queue
            incorrect_product: 'wrong_product',
            damaged_product: 'damaged',
        };
        const internalCondition = conditionMap[condition] || 'used';

        // Create return request and add to repacking queue in a transaction
        const result = await req.prisma.$transaction(async (prisma) => {
            // Generate return request number
            const count = await prisma.returnRequest.count();
            const requestNumber = `RET-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

            // Create return request
            const returnRequest = await prisma.returnRequest.create({
                data: {
                    requestNumber,
                    requestType,
                    originalOrderId: order.id,
                    customerId: customer?.id,
                    reasonCategory: reasonCategory || (condition === 'incorrect_product' ? 'wrong_item' : condition === 'damaged_product' ? 'damaged_in_transit' : 'other'),
                    status: 'received',
                    lines: {
                        create: [{
                            skuId: sku.id,
                            originalOrderLineId: orderLine?.id || null,
                            qty,
                            itemCondition: internalCondition,
                        }],
                    },
                },
                include: { lines: true },
            });

            // Add status history
            await prisma.returnStatusHistory.create({
                data: {
                    requestId: returnRequest.id,
                    fromStatus: 'requested',
                    toStatus: 'received',
                    changedById: req.user.id,
                    notes: `Received via return inward - ${condition.replace(/_/g, ' ')}`,
                },
            });

            // Add to repacking queue
            const repackingItem = await prisma.repackingQueueItem.create({
                data: {
                    skuId: sku.id,
                    qty,
                    condition: internalCondition,
                    returnRequestId: returnRequest.id,
                    returnLineId: returnRequest.lines[0].id,
                    inspectionNotes: `Initial condition: ${condition.replace(/_/g, ' ')}`,
                    status: 'pending',
                },
            });

            // Update customer stats
            if (customer) {
                if (requestType === 'return') {
                    await prisma.customer.update({
                        where: { id: customer.id },
                        data: { returnCount: { increment: 1 } },
                    });
                } else if (requestType === 'exchange') {
                    await prisma.customer.update({
                        where: { id: customer.id },
                        data: { exchangeCount: { increment: 1 } },
                    });
                }
            }

            // Update SKU stats
            if (requestType === 'return') {
                await prisma.sku.update({
                    where: { id: sku.id },
                    data: { returnCount: { increment: qty } },
                });
                if (sku.variation?.product?.id) {
                    await prisma.product.update({
                        where: { id: sku.variation.product.id },
                        data: { returnCount: { increment: qty } },
                    });
                }
            } else if (requestType === 'exchange') {
                await prisma.sku.update({
                    where: { id: sku.id },
                    data: { exchangeCount: { increment: qty } },
                });
                if (sku.variation?.product?.id) {
                    await prisma.product.update({
                        where: { id: sku.variation.product.id },
                        data: { exchangeCount: { increment: qty } },
                    });
                }
            }

            return {
                returnRequest,
                repackingItem,
            };
        });

        res.status(201).json({
            success: true,
            message: `${qty} ${sku.skuCode} added to repacking queue`,
            returnRequest: result.returnRequest,
            repackingItem: result.repackingItem,
            sku: {
                id: sku.id,
                skuCode: sku.skuCode,
                productName: sku.variation?.product?.name,
                colorName: sku.variation?.colorName,
                size: sku.size,
            },
            linkedOrder: {
                id: order.id,
                orderNumber: order.orderNumber,
                customerName: customer?.name,
            },
        });
    } catch (error) {
        console.error('Return inward error:', error);
        res.status(500).json({ error: 'Failed to process return inward' });
    }
});

// Analytics
router.get('/analytics/by-product', authenticateToken, async (req, res) => {
    try {
        const returnLines = await req.prisma.returnRequestLine.findMany({ include: { sku: { include: { variation: { include: { product: true } } } }, request: true } });
        const orderLines = await req.prisma.orderLine.findMany({ include: { sku: { include: { variation: { include: { product: true } } } } } });

        const productStats = {};
        orderLines.forEach((ol) => {
            const pId = ol.sku.variation.product.id;
            if (!productStats[pId]) productStats[pId] = { name: ol.sku.variation.product.name, sold: 0, returned: 0 };
            productStats[pId].sold++;
        });
        returnLines.forEach((rl) => {
            const pId = rl.sku.variation.product.id;
            if (productStats[pId] && rl.request.requestType === 'return') productStats[pId].returned++;
        });

        const result = Object.entries(productStats).map(([id, s]) => ({ productId: id, ...s, returnRate: s.sold > 0 ? ((s.returned / s.sold) * 100).toFixed(1) : 0 }));
        res.json(result.sort((a, b) => b.returnRate - a.returnRate));
    } catch (error) {
        console.error('Return analytics error:', error);
        res.status(500).json({ error: 'Failed to get return analytics' });
    }
});

async function updateStatus(prisma, requestId, newStatus, userId, notes = null) {
    const request = await prisma.returnRequest.findUnique({ where: { id: requestId } });
    await prisma.returnRequest.update({ where: { id: requestId }, data: { status: newStatus } });
    await prisma.returnStatusHistory.create({ data: { requestId, fromStatus: request.status, toStatus: newStatus, changedById: userId, notes } });
}

export default router;
