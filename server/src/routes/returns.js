import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getTierThresholds, calculateTier, getCustomerStatsMap } from '../utils/tierUtils.js';

const router = Router();

// ============================================
// RETURN REQUESTS (TICKETS)
// ============================================

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

        // Get customer stats for LTV and tier calculation
        const customerIds = [...new Set(requests.map((r) => r.customerId).filter(Boolean))];
        const [customerStats, thresholds] = await Promise.all([
            getCustomerStatsMap(req.prisma, customerIds),
            getTierThresholds(req.prisma),
        ]);

        const enriched = requests.map((r) => {
            const stats = customerStats[r.customerId] || { ltv: 0, orderCount: 0 };
            return {
                ...r,
                ageDays: r.originalOrder?.orderDate
                    ? Math.floor((Date.now() - new Date(r.originalOrder.orderDate).getTime()) / (1000 * 60 * 60 * 24))
                    : Math.floor((Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
                customerLtv: stats.ltv,
                customerOrderCount: stats.orderCount,
                customerTier: calculateTier(stats.ltv, thresholds),
            };
        });

        res.json(enriched);
    } catch (error) {
        console.error('Get return requests error:', error);
        res.status(500).json({ error: 'Failed to fetch return requests' });
    }
});

// Get pending tickets (awaiting receipt)
router.get('/pending', authenticateToken, async (req, res) => {
    try {
        const requests = await req.prisma.returnRequest.findMany({
            where: {
                status: { in: ['requested', 'reverse_initiated', 'in_transit'] },
            },
            include: {
                originalOrder: true,
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
                shipping: { where: { direction: 'reverse' } },
            },
            orderBy: { createdAt: 'desc' },
        });

        const enriched = requests.map((r) => ({
            ...r,
            ageDays: r.originalOrder?.orderDate
                ? Math.floor((Date.now() - new Date(r.originalOrder.orderDate).getTime()) / (1000 * 60 * 60 * 24))
                : Math.floor((Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
            reverseShipping: r.shipping?.[0] || null,
        }));

        res.json(enriched);
    } catch (error) {
        console.error('Get pending returns error:', error);
        res.status(500).json({ error: 'Failed to fetch pending returns' });
    }
});

// Find pending tickets by SKU code or barcode
router.get('/pending/by-sku', authenticateToken, async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) {
            return res.status(400).json({ error: 'SKU code or barcode is required' });
        }

        // First find the SKU (skuCode serves as barcode for scanning)
        const sku = await req.prisma.sku.findFirst({
            where: { skuCode: code },
            include: {
                variation: { include: { product: true } },
            },
        });

        if (!sku) {
            return res.status(404).json({ error: 'SKU not found' });
        }

        // Find pending tickets containing this SKU
        const requests = await req.prisma.returnRequest.findMany({
            where: {
                status: { in: ['requested', 'reverse_initiated', 'in_transit'] },
                lines: {
                    some: {
                        skuId: sku.id,
                        itemCondition: null, // Not yet received
                    },
                },
            },
            include: {
                originalOrder: true,
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
                shipping: { where: { direction: 'reverse' } },
            },
            orderBy: { createdAt: 'desc' },
        });

        const enriched = requests.map((r) => ({
            ...r,
            ageDays: r.originalOrder?.orderDate
                ? Math.floor((Date.now() - new Date(r.originalOrder.orderDate).getTime()) / (1000 * 60 * 60 * 24))
                : Math.floor((Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
            reverseShipping: r.shipping?.[0] || null,
            // Highlight the matching line
            matchingLine: r.lines.find((l) => l.skuId === sku.id && !l.itemCondition),
        }));

        res.json({
            sku: {
                id: sku.id,
                skuCode: sku.skuCode,
                barcode: sku.barcode,
                productName: sku.variation?.product?.name,
                colorName: sku.variation?.colorName,
                size: sku.size,
                imageUrl: sku.variation?.imageUrl || sku.variation?.product?.imageUrl,
            },
            tickets: enriched,
        });
    } catch (error) {
        console.error('Find tickets by SKU error:', error);
        res.status(500).json({ error: 'Failed to find tickets' });
    }
});

// Get order details for creating a return
router.get('/order/:orderId', authenticateToken, async (req, res) => {
    try {
        const { orderId } = req.params;

        // Try to find by ID first, then by order number
        let order = await req.prisma.order.findUnique({
            where: { id: orderId },
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
        });

        // If not found by ID, try by order number
        if (!order) {
            order = await req.prisma.order.findFirst({
                where: {
                    OR: [
                        { orderNumber: orderId },
                        { shopifyOrderId: orderId },
                    ],
                },
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
            });
        }

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const items = order.orderLines.map((line) => ({
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
            shippedAt: order.shippedAt,
            deliveredAt: order.deliveredAt,
            customer: order.customer ? {
                id: order.customer.id,
                name: order.customer.name,
                email: order.customer.email,
                phone: order.customer.phone,
            } : null,
            items,
        });
    } catch (error) {
        console.error('Get order for return error:', error);
        res.status(500).json({ error: 'Failed to fetch order details' });
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
                lines: {
                    include: {
                        sku: { include: { variation: { include: { product: true } } } },
                        exchangeSku: true,
                    },
                },
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

// Create return request (ticket)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const {
            requestType, // 'return' or 'exchange'
            originalOrderId,
            reasonCategory,
            reasonDetails,
            lines, // [{ skuId, qty, exchangeSkuId? }]
            courier,
            awbNumber,
        } = req.body;

        // Validate order
        const order = await req.prisma.order.findUnique({
            where: { id: originalOrderId },
            include: { customer: true },
        });
        if (!order) return res.status(404).json({ error: 'Order not found' });

        // Validate lines
        if (!lines || lines.length === 0) {
            return res.status(400).json({ error: 'At least one item is required' });
        }

        // Check for duplicate items - items from this order already in an active ticket
        const skuIds = lines.map((l) => l.skuId);
        const existingTickets = await req.prisma.returnRequest.findMany({
            where: {
                originalOrderId,
                status: { notIn: ['cancelled', 'resolved'] }, // Active tickets only
                lines: {
                    some: {
                        skuId: { in: skuIds },
                    },
                },
            },
            include: {
                lines: {
                    where: { skuId: { in: skuIds } },
                    include: { sku: true },
                },
            },
        });

        if (existingTickets.length > 0) {
            // Build list of SKUs already in tickets
            const duplicateSkus = [];
            for (const ticket of existingTickets) {
                for (const line of ticket.lines) {
                    duplicateSkus.push({
                        skuCode: line.sku.skuCode,
                        ticketNumber: ticket.requestNumber,
                        ticketId: ticket.id,
                    });
                }
            }
            return res.status(400).json({
                error: 'Some items are already in an active return ticket',
                duplicates: duplicateSkus,
            });
        }

        const count = await req.prisma.returnRequest.count();
        const requestNumber = `RET-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

        // Determine initial status
        const hasShipping = courier && awbNumber;
        const initialStatus = hasShipping ? 'reverse_initiated' : 'requested';

        const request = await req.prisma.$transaction(async (tx) => {
            // Create return request
            const returnRequest = await tx.returnRequest.create({
                data: {
                    requestNumber,
                    requestType,
                    originalOrderId,
                    customerId: order.customerId,
                    reasonCategory,
                    reasonDetails,
                    status: initialStatus,
                    lines: {
                        create: lines.map((l) => ({
                            skuId: l.skuId,
                            qty: l.qty || 1,
                            exchangeSkuId: l.exchangeSkuId || null,
                        })),
                    },
                },
                include: {
                    lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
                    originalOrder: true,
                    customer: true,
                },
            });

            // Create reverse shipping if AWB provided
            if (hasShipping) {
                await tx.returnShipping.create({
                    data: {
                        requestId: returnRequest.id,
                        direction: 'reverse',
                        courier,
                        awbNumber,
                        status: 'scheduled',
                    },
                });
            }

            // Add status history
            await tx.returnStatusHistory.create({
                data: {
                    requestId: returnRequest.id,
                    fromStatus: 'new',
                    toStatus: initialStatus,
                    changedById: req.user.id,
                    notes: hasShipping ? `Created with reverse pickup AWB: ${awbNumber}` : 'Created - awaiting reverse pickup',
                },
            });

            return returnRequest;
        }, { timeout: 15000 }); // 15 second timeout

        res.status(201).json(request);
    } catch (error) {
        console.error('Create return request error:', error);
        res.status(500).json({ error: 'Failed to create return request' });
    }
});

// Update return request (add/update shipping info)
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { courier, awbNumber, reasonCategory, reasonDetails } = req.body;

        const request = await req.prisma.returnRequest.findUnique({
            where: { id: req.params.id },
            include: { shipping: true },
        });

        if (!request) {
            return res.status(404).json({ error: 'Return request not found' });
        }

        await req.prisma.$transaction(async (tx) => {
            // Update request details
            const updateData = {};
            if (reasonCategory) updateData.reasonCategory = reasonCategory;
            if (reasonDetails !== undefined) updateData.reasonDetails = reasonDetails;

            if (Object.keys(updateData).length > 0) {
                await tx.returnRequest.update({
                    where: { id: req.params.id },
                    data: updateData,
                });
            }

            // Handle shipping info
            if (courier || awbNumber) {
                const existingShipping = request.shipping.find((s) => s.direction === 'reverse');

                if (existingShipping) {
                    await tx.returnShipping.update({
                        where: { id: existingShipping.id },
                        data: {
                            courier: courier || existingShipping.courier,
                            awbNumber: awbNumber || existingShipping.awbNumber,
                        },
                    });
                } else {
                    await tx.returnShipping.create({
                        data: {
                            requestId: req.params.id,
                            direction: 'reverse',
                            courier,
                            awbNumber,
                            status: 'scheduled',
                        },
                    });
                }

                // Update status if not already advanced
                if (request.status === 'requested') {
                    await tx.returnRequest.update({
                        where: { id: req.params.id },
                        data: { status: 'reverse_initiated' },
                    });

                    await tx.returnStatusHistory.create({
                        data: {
                            requestId: req.params.id,
                            fromStatus: request.status,
                            toStatus: 'reverse_initiated',
                            changedById: req.user.id,
                            notes: `Reverse pickup AWB added: ${awbNumber}`,
                        },
                    });
                }
            }
        });

        // Fetch updated request
        const updated = await req.prisma.returnRequest.findUnique({
            where: { id: req.params.id },
            include: {
                originalOrder: true,
                customer: true,
                lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
                shipping: true,
            },
        });

        res.json(updated);
    } catch (error) {
        console.error('Update return request error:', error);
        res.status(500).json({ error: 'Failed to update return request' });
    }
});

// Delete return request (only if not yet received)
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const request = await req.prisma.returnRequest.findUnique({
            where: { id: req.params.id },
            include: {
                lines: true,
                shipping: true,
                statusHistory: true,
            },
        });

        if (!request) {
            return res.status(404).json({ error: 'Return request not found' });
        }

        // Only allow deletion if no items have been received yet
        const hasReceivedItems = request.lines.some((l) => l.itemCondition !== null);
        if (hasReceivedItems) {
            return res.status(400).json({
                error: 'Cannot delete - some items have already been received. Cancel the request instead.',
            });
        }

        // Don't allow deletion of resolved tickets
        if (request.status === 'resolved') {
            return res.status(400).json({
                error: 'Cannot delete a resolved return request',
            });
        }

        // Delete in transaction (cascade delete related records)
        await req.prisma.$transaction(async (tx) => {
            // Delete status history
            await tx.returnStatusHistory.deleteMany({
                where: { requestId: request.id },
            });

            // Delete shipping records
            await tx.returnShipping.deleteMany({
                where: { requestId: request.id },
            });

            // Delete lines
            await tx.returnRequestLine.deleteMany({
                where: { requestId: request.id },
            });

            // Delete the request
            await tx.returnRequest.delete({
                where: { id: request.id },
            });
        });

        res.json({ success: true, message: `Return request ${request.requestNumber} deleted` });
    } catch (error) {
        console.error('Delete return request error:', error);
        res.status(500).json({ error: 'Failed to delete return request' });
    }
});

// Add item to return request (from original order)
router.post('/:id/add-item', authenticateToken, async (req, res) => {
    try {
        const { skuId, qty = 1 } = req.body;

        if (!skuId) {
            return res.status(400).json({ error: 'skuId is required' });
        }

        const request = await req.prisma.returnRequest.findUnique({
            where: { id: req.params.id },
            include: {
                lines: true,
                originalOrder: {
                    include: {
                        lines: {
                            include: {
                                sku: true,
                            },
                        },
                    },
                },
            },
        });

        if (!request) {
            return res.status(404).json({ error: 'Return request not found' });
        }

        // Check if request is in a modifiable state
        if (['resolved', 'cancelled'].includes(request.status)) {
            return res.status(400).json({
                error: 'Cannot modify a resolved or cancelled return request',
            });
        }

        // Check if SKU is from the original order
        const orderLine = request.originalOrder?.lines.find((l) => l.skuId === skuId);
        if (!orderLine) {
            return res.status(400).json({
                error: 'This SKU is not from the original order',
            });
        }

        // Check if item is already in the return request
        const existingLine = request.lines.find((l) => l.skuId === skuId);
        if (existingLine) {
            return res.status(400).json({
                error: 'This item is already in the return request',
            });
        }

        // Add the item
        const newLine = await req.prisma.returnRequestLine.create({
            data: {
                requestId: request.id,
                skuId,
                qty,
            },
            include: {
                sku: {
                    include: {
                        variation: {
                            include: {
                                product: true,
                            },
                        },
                    },
                },
            },
        });

        res.json(newLine);
    } catch (error) {
        console.error('Add item to return request error:', error);
        res.status(500).json({ error: 'Failed to add item to return request' });
    }
});

// Remove item from return request
router.delete('/:id/items/:lineId', authenticateToken, async (req, res) => {
    try {
        const { id, lineId } = req.params;

        const request = await req.prisma.returnRequest.findUnique({
            where: { id },
            include: {
                lines: true,
            },
        });

        if (!request) {
            return res.status(404).json({ error: 'Return request not found' });
        }

        // Check if request is in a modifiable state
        if (['resolved', 'cancelled'].includes(request.status)) {
            return res.status(400).json({
                error: 'Cannot modify a resolved or cancelled return request',
            });
        }

        // Find the line to delete
        const lineToDelete = request.lines.find((l) => l.id === lineId);
        if (!lineToDelete) {
            return res.status(404).json({ error: 'Item not found in return request' });
        }

        // Check if item has been received
        if (lineToDelete.itemCondition) {
            return res.status(400).json({
                error: 'Cannot remove an item that has already been received',
            });
        }

        // Don't allow removing the last item
        if (request.lines.length <= 1) {
            return res.status(400).json({
                error: 'Cannot remove the last item. Delete the entire return request instead.',
            });
        }

        // Delete the line
        await req.prisma.returnRequestLine.delete({
            where: { id: lineId },
        });

        res.json({ success: true, message: 'Item removed from return request' });
    } catch (error) {
        console.error('Remove item from return request error:', error);
        res.status(500).json({ error: 'Failed to remove item from return request' });
    }
});

// Cancel return request (soft cancel - keeps record but marks as cancelled)
router.post('/:id/cancel', authenticateToken, async (req, res) => {
    try {
        const { reason } = req.body;

        const request = await req.prisma.returnRequest.findUnique({
            where: { id: req.params.id },
        });

        if (!request) {
            return res.status(404).json({ error: 'Return request not found' });
        }

        if (request.status === 'resolved' || request.status === 'cancelled') {
            return res.status(400).json({
                error: `Cannot cancel - request is already ${request.status}`,
            });
        }

        await req.prisma.$transaction(async (tx) => {
            await tx.returnRequest.update({
                where: { id: request.id },
                data: { status: 'cancelled' },
            });

            await tx.returnStatusHistory.create({
                data: {
                    requestId: request.id,
                    fromStatus: request.status,
                    toStatus: 'cancelled',
                    changedById: req.user.id,
                    notes: reason || 'Request cancelled',
                },
            });
        });

        const updated = await req.prisma.returnRequest.findUnique({
            where: { id: request.id },
            include: {
                originalOrder: true,
                customer: true,
                lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
                shipping: true,
                statusHistory: { include: { changedBy: { select: { name: true } } } },
            },
        });

        res.json(updated);
    } catch (error) {
        console.error('Cancel return request error:', error);
        res.status(500).json({ error: 'Failed to cancel return request' });
    }
});

// ============================================
// RECEIVE ITEMS (Return Inward)
// ============================================

// Receive a specific line item from a ticket
router.post('/:id/receive-item', authenticateToken, async (req, res) => {
    try {
        const { lineId, condition } = req.body;

        // Validate condition
        const validConditions = ['good', 'used', 'damaged', 'wrong_product'];
        if (!validConditions.includes(condition)) {
            return res.status(400).json({ error: 'Invalid condition. Must be: good, used, damaged, or wrong_product' });
        }

        const request = await req.prisma.returnRequest.findUnique({
            where: { id: req.params.id },
            include: {
                lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
                customer: true,
                originalOrder: true,
            },
        });

        if (!request) {
            return res.status(404).json({ error: 'Return request not found' });
        }

        const line = request.lines.find((l) => l.id === lineId);
        if (!line) {
            return res.status(404).json({ error: 'Return line not found' });
        }

        if (line.itemCondition) {
            return res.status(400).json({ error: 'Item already received' });
        }

        const result = await req.prisma.$transaction(async (tx) => {
            // Update line with condition
            await tx.returnRequestLine.update({
                where: { id: lineId },
                data: { itemCondition: condition },
            });

            // Add to repacking queue
            const repackingItem = await tx.repackingQueueItem.create({
                data: {
                    skuId: line.skuId,
                    qty: line.qty,
                    condition,
                    returnRequestId: request.id,
                    returnLineId: line.id,
                    inspectionNotes: `Received from ticket ${request.requestNumber}`,
                    status: 'pending',
                },
            });

            // Check if all lines are now received
            const allLinesReceived = request.lines.every((l) =>
                l.id === lineId ? true : l.itemCondition !== null
            );

            if (allLinesReceived) {
                await tx.returnRequest.update({
                    where: { id: request.id },
                    data: { status: 'received' },
                });

                await tx.returnStatusHistory.create({
                    data: {
                        requestId: request.id,
                        fromStatus: request.status,
                        toStatus: 'received',
                        changedById: req.user.id,
                        notes: 'All items received',
                    },
                });

                // Update shipping status
                await tx.returnShipping.updateMany({
                    where: { requestId: request.id, direction: 'reverse' },
                    data: { status: 'delivered', receivedAt: new Date() },
                });
            }

            // Update customer stats
            if (request.customer) {
                if (request.requestType === 'return') {
                    await tx.customer.update({
                        where: { id: request.customer.id },
                        data: { returnCount: { increment: 1 } },
                    });
                } else {
                    await tx.customer.update({
                        where: { id: request.customer.id },
                        data: { exchangeCount: { increment: 1 } },
                    });
                }
            }

            // Update SKU/product stats
            const sku = line.sku;
            if (request.requestType === 'return') {
                await tx.sku.update({
                    where: { id: sku.id },
                    data: { returnCount: { increment: line.qty } },
                });
                if (sku.variation?.product?.id) {
                    await tx.product.update({
                        where: { id: sku.variation.product.id },
                        data: { returnCount: { increment: line.qty } },
                    });
                }
            } else {
                await tx.sku.update({
                    where: { id: sku.id },
                    data: { exchangeCount: { increment: line.qty } },
                });
                if (sku.variation?.product?.id) {
                    await tx.product.update({
                        where: { id: sku.variation.product.id },
                        data: { exchangeCount: { increment: line.qty } },
                    });
                }
            }

            return { repackingItem, allReceived: allLinesReceived };
        });

        res.json({
            success: true,
            message: `${line.sku.skuCode} received and added to QC queue`,
            repackingItem: result.repackingItem,
            allItemsReceived: result.allReceived,
            sku: {
                id: line.sku.id,
                skuCode: line.sku.skuCode,
                productName: line.sku.variation?.product?.name,
                colorName: line.sku.variation?.colorName,
                size: line.sku.size,
            },
        });
    } catch (error) {
        console.error('Receive item error:', error);
        res.status(500).json({ error: 'Failed to receive item' });
    }
});

// Undo receive - remove item from QC queue and clear received status
router.post('/:id/undo-receive', authenticateToken, async (req, res) => {
    try {
        const { lineId } = req.body;

        const request = await req.prisma.returnRequest.findUnique({
            where: { id: req.params.id },
            include: {
                lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
                customer: true,
            },
        });

        if (!request) {
            return res.status(404).json({ error: 'Return request not found' });
        }

        const line = request.lines.find((l) => l.id === lineId);
        if (!line) {
            return res.status(404).json({ error: 'Return line not found' });
        }

        if (!line.itemCondition) {
            return res.status(400).json({ error: 'Item has not been received yet' });
        }

        // Find the repacking queue item for this line
        const repackingItem = await req.prisma.repackingQueueItem.findFirst({
            where: { returnLineId: lineId },
        });

        if (repackingItem && (repackingItem.status === 'ready' || repackingItem.status === 'write_off')) {
            return res.status(400).json({
                error: 'Cannot undo - item has already been processed (added to stock or written off)',
            });
        }

        await req.prisma.$transaction(async (tx) => {
            // Delete repacking queue item if it exists
            if (repackingItem) {
                await tx.repackingQueueItem.delete({
                    where: { id: repackingItem.id },
                });
            }

            // Clear the item condition on the line
            await tx.returnRequestLine.update({
                where: { id: lineId },
                data: { itemCondition: null },
            });

            // If ticket status is "received", revert it to previous status
            if (request.status === 'received') {
                // Check shipping to determine appropriate status
                const shipping = await tx.returnShipping.findFirst({
                    where: { requestId: request.id, direction: 'reverse' },
                });

                let newStatus = 'requested';
                if (shipping?.awbNumber) {
                    newStatus = 'reverse_initiated';
                }

                await tx.returnRequest.update({
                    where: { id: request.id },
                    data: { status: newStatus },
                });

                await tx.returnStatusHistory.create({
                    data: {
                        requestId: request.id,
                        fromStatus: 'received',
                        toStatus: newStatus,
                        changedById: req.user.id,
                        notes: `Undid receive for ${line.sku.skuCode}`,
                    },
                });

                // Revert shipping status
                if (shipping) {
                    await tx.returnShipping.update({
                        where: { id: shipping.id },
                        data: { status: 'in_transit', receivedAt: null },
                    });
                }
            }

            // Decrement customer stats
            if (request.customer) {
                if (request.requestType === 'return') {
                    await tx.customer.update({
                        where: { id: request.customer.id },
                        data: { returnCount: { decrement: 1 } },
                    });
                } else {
                    await tx.customer.update({
                        where: { id: request.customer.id },
                        data: { exchangeCount: { decrement: 1 } },
                    });
                }
            }

            // Decrement SKU/product stats
            const sku = line.sku;
            if (request.requestType === 'return') {
                await tx.sku.update({
                    where: { id: sku.id },
                    data: { returnCount: { decrement: line.qty } },
                });
                if (sku.variation?.product?.id) {
                    await tx.product.update({
                        where: { id: sku.variation.product.id },
                        data: { returnCount: { decrement: line.qty } },
                    });
                }
            } else {
                await tx.sku.update({
                    where: { id: sku.id },
                    data: { exchangeCount: { decrement: line.qty } },
                });
                if (sku.variation?.product?.id) {
                    await tx.product.update({
                        where: { id: sku.variation.product.id },
                        data: { exchangeCount: { decrement: line.qty } },
                    });
                }
            }
        });

        // Fetch updated request
        const updated = await req.prisma.returnRequest.findUnique({
            where: { id: request.id },
            include: {
                lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
                originalOrder: true,
                customer: true,
                shipping: true,
            },
        });

        res.json({
            success: true,
            message: `Undid receive for ${line.sku.skuCode}`,
            request: updated,
        });
    } catch (error) {
        console.error('Undo receive error:', error);
        res.status(500).json({ error: 'Failed to undo receive' });
    }
});

// ============================================
// STATUS UPDATES
// ============================================

router.post('/:id/initiate-reverse', authenticateToken, async (req, res) => {
    try {
        const { courier, awbNumber, pickupScheduledAt } = req.body;
        await req.prisma.returnShipping.create({
            data: {
                requestId: req.params.id,
                direction: 'reverse',
                courier,
                awbNumber,
                pickupScheduledAt: pickupScheduledAt ? new Date(pickupScheduledAt) : null,
                status: 'scheduled',
            },
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
        await req.prisma.returnShipping.updateMany({
            where: { requestId: req.params.id, direction: 'reverse' },
            data: { status: 'delivered', receivedAt: new Date() },
        });
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
        const request = await req.prisma.returnRequest.findUnique({
            where: { id: req.params.id },
            include: { lines: true },
        });

        await req.prisma.$transaction(async (tx) => {
            await tx.returnRequest.update({
                where: { id: req.params.id },
                data: { status: 'resolved', resolutionType, resolutionNotes },
            });
            for (const line of request.lines) {
                if (line.itemCondition !== 'damaged') {
                    await tx.inventoryTransaction.create({
                        data: {
                            skuId: line.skuId,
                            txnType: 'inward',
                            qty: line.qty,
                            reason: 'return_receipt',
                            referenceId: request.id,
                            createdById: req.user.id,
                        },
                    });
                }
            }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Resolve return error:', error);
        res.status(500).json({ error: 'Failed to resolve return' });
    }
});

router.post('/:id/cancel', authenticateToken, async (req, res) => {
    try {
        const { reason } = req.body;
        await updateStatus(req.prisma, req.params.id, 'cancelled', req.user.id, reason);
        res.json({ success: true });
    } catch (error) {
        console.error('Cancel return error:', error);
        res.status(500).json({ error: 'Failed to cancel return' });
    }
});

// ============================================
// ANALYTICS
// ============================================

router.get('/analytics/by-product', authenticateToken, async (req, res) => {
    try {
        const returnLines = await req.prisma.returnRequestLine.findMany({
            include: {
                sku: { include: { variation: { include: { product: true } } } },
                request: true,
            },
        });
        const orderLines = await req.prisma.orderLine.findMany({
            include: { sku: { include: { variation: { include: { product: true } } } } },
        });

        const productStats = {};
        orderLines.forEach((ol) => {
            const pId = ol.sku.variation.product.id;
            if (!productStats[pId]) {
                productStats[pId] = { name: ol.sku.variation.product.name, sold: 0, returned: 0 };
            }
            productStats[pId].sold++;
        });
        returnLines.forEach((rl) => {
            const pId = rl.sku.variation.product.id;
            if (productStats[pId] && rl.request.requestType === 'return') {
                productStats[pId].returned++;
            }
        });

        const result = Object.entries(productStats).map(([id, s]) => ({
            productId: id,
            ...s,
            returnRate: s.sold > 0 ? ((s.returned / s.sold) * 100).toFixed(1) : 0,
        }));
        res.json(result.sort((a, b) => b.returnRate - a.returnRate));
    } catch (error) {
        console.error('Return analytics error:', error);
        res.status(500).json({ error: 'Failed to get return analytics' });
    }
});

// ============================================
// HELPERS
// ============================================

async function updateStatus(prisma, requestId, newStatus, userId, notes = null) {
    const request = await prisma.returnRequest.findUnique({ where: { id: requestId } });
    await prisma.returnRequest.update({ where: { id: requestId }, data: { status: newStatus } });
    await prisma.returnStatusHistory.create({
        data: { requestId, fromStatus: request.status, toStatus: newStatus, changedById: userId, notes },
    });
}

export default router;
