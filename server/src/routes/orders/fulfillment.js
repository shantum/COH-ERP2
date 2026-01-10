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
            data: {
                lineStatus: 'picked',
                packedAt: null,
                // Clear manual AWB and courier when unpacking
                awbNumber: null,
                courier: null,
            },
        });

        res.json(updated);
    } catch (error) {
        console.error('Unpack line error:', error);
        res.status(500).json({ error: 'Failed to unpack line' });
    }
});

// ============================================
// MARK SHIPPED (Visual Only - No Side Effects)
// Part of spreadsheet-style shipping workflow
// ============================================

// Mark order line as shipped (visual only - no inventory release)
router.post('/lines/:lineId/mark-shipped', authenticateToken, async (req, res) => {
    try {
        const { awbNumber, courier } = req.body || {};

        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        if (line.lineStatus !== 'packed') {
            return res.status(400).json({
                error: 'Line must be in packed status to mark as shipped',
                currentStatus: line.lineStatus,
            });
        }

        const updated = await req.prisma.orderLine.update({
            where: { id: req.params.lineId },
            data: {
                lineStatus: 'marked_shipped',
                // Optionally set AWB/courier if provided
                ...(awbNumber && { awbNumber: awbNumber.trim() }),
                ...(courier && { courier: courier.trim() }),
            },
        });

        res.json(updated);
    } catch (error) {
        console.error('Mark shipped error:', error);
        res.status(500).json({ error: 'Failed to mark line as shipped' });
    }
});

// Unmark shipped line (revert to packed)
router.post('/lines/:lineId/unmark-shipped', authenticateToken, async (req, res) => {
    try {
        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        if (line.lineStatus !== 'marked_shipped') {
            return res.status(400).json({
                error: 'Line is not in marked_shipped status',
                currentStatus: line.lineStatus,
            });
        }

        const updated = await req.prisma.orderLine.update({
            where: { id: req.params.lineId },
            data: { lineStatus: 'packed' },
        });

        res.json(updated);
    } catch (error) {
        console.error('Unmark shipped error:', error);
        res.status(500).json({ error: 'Failed to unmark shipped line' });
    }
});

// Update line tracking info (AWB/courier)
router.patch('/lines/:lineId/tracking', authenticateToken, async (req, res) => {
    try {
        const { awbNumber, courier } = req.body;

        const line = await req.prisma.orderLine.findUnique({
            where: { id: req.params.lineId },
        });

        if (!line) {
            return res.status(404).json({ error: 'Order line not found' });
        }

        // Only allow updating tracking on packed or marked_shipped lines
        if (!['packed', 'marked_shipped'].includes(line.lineStatus)) {
            return res.status(400).json({
                error: 'Can only update tracking on packed or marked_shipped lines',
                currentStatus: line.lineStatus,
            });
        }

        const updateData = {};
        if (awbNumber !== undefined) {
            updateData.awbNumber = awbNumber?.trim() || null;
        }
        if (courier !== undefined) {
            updateData.courier = courier?.trim() || null;
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'No tracking data provided' });
        }

        const updated = await req.prisma.orderLine.update({
            where: { id: req.params.lineId },
            data: updateData,
        });

        res.json(updated);
    } catch (error) {
        console.error('Update tracking error:', error);
        res.status(500).json({ error: 'Failed to update tracking info' });
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

            // Only update Order.status - tracking fields are on lines
            await tx.order.update({
                where: { id: req.params.id },
                data: {
                    status: 'shipped',
                },
            });

            await tx.orderLine.updateMany({
                where: { orderId: req.params.id },
                data: {
                    lineStatus: 'shipped',
                    shippedAt: new Date(),
                    // Line-level tracking (source of truth)
                    awbNumber,
                    courier,
                    trackingStatus: 'in_transit',
                },
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

// ============================================
// SHIP SPECIFIC LINES (Partial Shipment Support)
// ============================================

/**
 * Ship specific order lines with a given AWB
 * Enables partial shipments - different lines can ship at different times with different AWBs
 *
 * POST /orders/:id/ship-lines
 * Body: { lineIds: string[], awbNumber: string, courier: string }
 */
router.post('/:id/ship-lines', authenticateToken, async (req, res) => {
    try {
        const { lineIds, awbNumber, courier } = req.body;

        // Validate required fields
        if (!lineIds?.length) {
            return res.status(400).json({ error: 'lineIds array required' });
        }
        if (!awbNumber?.trim()) {
            return res.status(400).json({ error: 'awbNumber required' });
        }
        if (!courier?.trim()) {
            return res.status(400).json({ error: 'courier required' });
        }

        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Validate all requested lines exist and belong to this order
        const linesToShip = order.orderLines.filter(l => lineIds.includes(l.id));
        if (linesToShip.length !== lineIds.length) {
            return res.status(400).json({
                error: 'Some lineIds not found in this order',
                found: linesToShip.length,
                requested: lineIds.length,
            });
        }

        // Validate all lines are packed (ready to ship)
        const notPacked = linesToShip.filter(l => l.lineStatus !== 'packed');
        if (notPacked.length > 0) {
            return res.status(400).json({
                error: 'All lines must be packed before shipping',
                notPackedLines: notPacked.map(l => ({
                    id: l.id,
                    status: l.lineStatus,
                })),
            });
        }

        // Check for duplicate AWB on other orders
        const existingAwb = await req.prisma.orderLine.findFirst({
            where: {
                awbNumber: awbNumber.trim(),
                orderId: { not: req.params.id },
            },
            select: { id: true, orderId: true, order: { select: { orderNumber: true } } },
        });

        if (existingAwb) {
            return res.status(400).json({
                error: 'AWB number already used on another order',
                existingOrderNumber: existingAwb.order?.orderNumber,
            });
        }

        await req.prisma.$transaction(async (tx) => {
            // Update selected lines with shipping info
            await tx.orderLine.updateMany({
                where: { id: { in: lineIds } },
                data: {
                    lineStatus: 'shipped',
                    shippedAt: new Date(),
                    awbNumber: awbNumber.trim(),
                    courier: courier.trim(),
                    trackingStatus: 'in_transit',
                },
            });

            // Release inventory and create sale transactions for shipped lines
            for (const line of linesToShip) {
                await releaseReservedInventory(tx, line.id);
                await createSaleTransaction(tx, {
                    skuId: line.skuId,
                    qty: line.qty,
                    orderLineId: line.id,
                    userId: req.user.id,
                });
            }

            // Check if ALL non-cancelled lines are now shipped
            const remainingLines = await tx.orderLine.findMany({
                where: {
                    orderId: req.params.id,
                    lineStatus: { notIn: ['cancelled', 'shipped'] },
                },
            });

            // Update order status only when all lines are shipped
            if (remainingLines.length === 0) {
                await tx.order.update({
                    where: { id: req.params.id },
                    data: { status: 'shipped' },
                });
            }
        });

        const updated = await req.prisma.order.findUnique({
            where: { id: req.params.id },
            include: { orderLines: true },
        });

        res.json({
            ...updated,
            linesShipped: linesToShip.length,
            allShipped: updated.status === 'shipped',
        });
    } catch (error) {
        console.error('Ship lines error:', error);
        res.status(500).json({ error: 'Failed to ship lines' });
    }
});

// ============================================
// PROCESS MARKED SHIPPED (Batch Clear)
// Final step of spreadsheet-style shipping workflow
// Releases inventory and creates sale transactions
// ============================================

router.post('/process-marked-shipped', authenticateToken, async (req, res) => {
    try {
        const { comment } = req.body || {};

        // Find all orders with marked_shipped lines
        const ordersWithMarkedLines = await req.prisma.order.findMany({
            where: {
                status: 'open',
                isArchived: false,
                orderLines: {
                    some: { lineStatus: 'marked_shipped' },
                },
            },
            include: {
                orderLines: true,
                shopifyCache: {
                    select: { trackingNumber: true },
                },
            },
        });

        if (ordersWithMarkedLines.length === 0) {
            return res.json({
                processed: 0,
                orders: [],
                message: 'No marked shipped lines to process',
            });
        }

        // Collect all marked_shipped lines and validate
        const linesToProcess = [];
        const validationIssues = [];

        for (const order of ordersWithMarkedLines) {
            const expectedAwb = order.shopifyCache?.trackingNumber || null;

            for (const line of order.orderLines) {
                if (line.lineStatus !== 'marked_shipped') continue;

                linesToProcess.push({
                    line,
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    expectedAwb,
                });

                // Track validation issues for reporting
                if (!line.awbNumber) {
                    validationIssues.push({
                        lineId: line.id,
                        orderNumber: order.orderNumber,
                        issue: 'missing_awb',
                    });
                } else if (expectedAwb && line.awbNumber.toLowerCase() !== expectedAwb.toLowerCase()) {
                    validationIssues.push({
                        lineId: line.id,
                        orderNumber: order.orderNumber,
                        issue: 'awb_mismatch',
                        expected: expectedAwb,
                        actual: line.awbNumber,
                    });
                }

                if (!line.courier) {
                    validationIssues.push({
                        lineId: line.id,
                        orderNumber: order.orderNumber,
                        issue: 'missing_courier',
                    });
                }
            }
        }

        const now = new Date();

        // Process all lines in a transaction
        await req.prisma.$transaction(async (tx) => {
            // 1. Release reserved inventory for all lines
            const lineIds = linesToProcess.map(l => l.line.id);
            await tx.inventoryTransaction.deleteMany({
                where: {
                    referenceId: { in: lineIds },
                    txnType: TXN_TYPE.RESERVED,
                    reason: TXN_REASON.ORDER_ALLOCATION,
                },
            });

            // 2. Create sale transactions for all lines
            const saleTransactions = linesToProcess.map(l => ({
                skuId: l.line.skuId,
                txnType: TXN_TYPE.OUTWARD,
                qty: l.line.qty,
                reason: TXN_REASON.SALE,
                referenceId: l.line.id,
                createdById: req.user.id,
                notes: comment || null,
            }));
            await tx.inventoryTransaction.createMany({ data: saleTransactions });

            // 3. Update all lines to shipped status
            await tx.orderLine.updateMany({
                where: { id: { in: lineIds } },
                data: {
                    lineStatus: 'shipped',
                    shippedAt: now,
                    trackingStatus: 'in_transit',
                },
            });

            // 4. Check each order - if all non-cancelled lines are shipped, update order status
            for (const order of ordersWithMarkedLines) {
                const remainingLines = await tx.orderLine.findMany({
                    where: {
                        orderId: order.id,
                        lineStatus: { notIn: ['cancelled', 'shipped'] },
                    },
                });

                if (remainingLines.length === 0) {
                    await tx.order.update({
                        where: { id: order.id },
                        data: { status: 'shipped' },
                    });
                }
            }
        });

        // Build response summary
        const orderSummary = ordersWithMarkedLines.map(o => ({
            id: o.id,
            orderNumber: o.orderNumber,
            linesProcessed: o.orderLines.filter(l => l.lineStatus === 'marked_shipped').length,
        }));

        console.log(`[Process Marked Shipped] Processed ${linesToProcess.length} lines across ${ordersWithMarkedLines.length} orders`);

        res.json({
            processed: linesToProcess.length,
            orders: orderSummary,
            validationIssues: validationIssues.length > 0 ? validationIssues : undefined,
            message: `Processed ${linesToProcess.length} lines across ${ordersWithMarkedLines.length} orders`,
        });
    } catch (error) {
        console.error('Process marked shipped error:', error);
        res.status(500).json({ error: 'Failed to process marked shipped lines' });
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

            // Only update Order.status - tracking fields are on lines
            await tx.order.update({
                where: { id: req.params.id },
                data: {
                    status: 'open',
                },
            });

            // Revert line statuses and clear tracking fields
            await tx.orderLine.updateMany({
                where: { orderId: req.params.id },
                data: {
                    lineStatus: 'packed',
                    shippedAt: null,
                    awbNumber: null,
                    courier: null,
                    trackingStatus: null,
                },
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
            select: { id: true, status: true, customerId: true, rtoInitiatedAt: true },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'shipped') {
            return res.status(400).json({ error: 'Order must be shipped to initiate RTO' });
        }

        const updated = await req.prisma.$transaction(async (tx) => {
            const updatedOrder = await tx.order.update({
                where: { id: req.params.id },
                data: {
                    rtoInitiatedAt: new Date(),
                },
            });

            // Increment customer RTO count on first RTO initiation
            if (!order.rtoInitiatedAt && order.customerId) {
                await tx.customer.update({
                    where: { id: order.customerId },
                    data: { rtoCount: { increment: 1 } },
                });
            }

            return updatedOrder;
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

            // Update line to shipped with tracking
            await req.prisma.orderLine.update({
                where: { id: line.id },
                data: {
                    lineStatus: 'shipped',
                    allocatedAt: line.allocatedAt || now,
                    pickedAt: line.pickedAt || now,
                    packedAt: line.packedAt || now,
                    shippedAt: now,
                    // Line-level tracking (source of truth)
                    awbNumber: order.awbNumber,
                    courier: order.courier,
                    trackingStatus: 'in_transit',
                },
            });
        }

        // Only update Order.status - tracking fields are on lines
        const updated = await req.prisma.order.update({
            where: { id: order.id },
            data: {
                status: 'shipped',
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
// Optimized with batched database operations
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

        const now = new Date();

        // Collect all data for batch operations
        const orderIds = [];
        const lineIdsToShip = [];
        const saleTransactions = [];
        // Map orderId -> { awbNumber, courier, lineIds } for per-order line updates
        const orderLineMap = new Map();

        for (const order of eligibleOrders) {
            orderIds.push(order.id);
            const orderLineIds = [];
            for (const line of order.orderLines) {
                if (line.lineStatus === 'shipped' || line.lineStatus === 'cancelled') continue;
                lineIdsToShip.push(line.id);
                orderLineIds.push(line.id);
                saleTransactions.push({
                    skuId: line.skuId,
                    txnType: TXN_TYPE.OUTWARD,
                    qty: line.qty,
                    reason: TXN_REASON.SALE,
                    referenceId: line.id,
                    createdById: req.user.id,
                });
            }
            if (orderLineIds.length > 0) {
                orderLineMap.set(order.id, {
                    awbNumber: order.awbNumber,
                    courier: order.courier,
                    lineIds: orderLineIds
                });
            }
        }

        // Execute all operations in a transaction for atomicity and speed
        await req.prisma.$transaction(async (tx) => {
            // 1. Release all reserved inventory in one batch
            if (lineIdsToShip.length > 0) {
                await tx.inventoryTransaction.deleteMany({
                    where: {
                        referenceId: { in: lineIdsToShip },
                        txnType: TXN_TYPE.RESERVED,
                        reason: TXN_REASON.ORDER_ALLOCATION,
                    },
                });
            }

            // 2. Create all sale transactions in one batch
            if (saleTransactions.length > 0) {
                await tx.inventoryTransaction.createMany({
                    data: saleTransactions,
                });
            }

            // 3. Update order lines to shipped per order (to set correct AWB/courier)
            for (const [orderId, orderData] of orderLineMap) {
                await tx.orderLine.updateMany({
                    where: { id: { in: orderData.lineIds } },
                    data: {
                        lineStatus: 'shipped',
                        shippedAt: now,
                        // Line-level tracking (source of truth)
                        awbNumber: orderData.awbNumber,
                        courier: orderData.courier,
                        trackingStatus: 'in_transit',
                    },
                });
            }

            // Set timestamps for lines that don't have them (separate query needed for conditional update)
            if (lineIdsToShip.length > 0) {
                await tx.orderLine.updateMany({
                    where: {
                        id: { in: lineIdsToShip },
                        allocatedAt: null,
                    },
                    data: { allocatedAt: now },
                });
                await tx.orderLine.updateMany({
                    where: {
                        id: { in: lineIdsToShip },
                        pickedAt: null,
                    },
                    data: { pickedAt: now },
                });
                await tx.orderLine.updateMany({
                    where: {
                        id: { in: lineIdsToShip },
                        packedAt: null,
                    },
                    data: { packedAt: now },
                });
            }

            // 4. Only update Order.status - tracking fields are on lines
            await tx.order.updateMany({
                where: { id: { in: orderIds } },
                data: {
                    status: 'shipped',
                },
            });
        });

        const shippedOrders = eligibleOrders.map(o => ({ id: o.id, orderNumber: o.orderNumber }));
        console.log(`[Bulk Quick Ship] Shipped ${shippedOrders.length} orders in batch`);

        res.json({
            shipped: shippedOrders,
            failed: [],
            message: `Shipped ${shippedOrders.length} orders`,
        });
    } catch (error) {
        console.error('Bulk quick ship error:', error);
        res.status(500).json({ error: 'Failed to bulk quick ship orders' });
    }
});

export default router;
