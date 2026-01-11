/**
 * Fulfillment Router
 * Order line status updates and shipping operations
 *
 * ORDER LINE STATUS FLOW:
 * pending → allocated → picked → packed → [mark-shipped*] → shipped
 *   ↓ (allocate)     ↓              ↓
 * [creates reserve]  [unpick]     [unpack, clear AWB]
 *   ↓ (unallocate)
 * [releases reserve]
 *
 * * mark-shipped: Visual-only status (part of spreadsheet shipping workflow)
 *   Converted to shipped via process-marked-shipped batch endpoint
 *
 * INVENTORY MECHANICS:
 * - Allocate: Creates RESERVED transaction (holds stock, not deducted from balance)
 * - Unallocate: Deletes RESERVED transaction
 * - Ship: Releases RESERVED, creates OUTWARD (deducts from balance)
 * - Unship: Reverses OUTWARD, recreates RESERVED
 *
 * RACE CONDITION PREVENTION:
 * - Pre-checks before transaction (status, stock, AWB)
 * - Re-checks inside transaction before updates
 * - ConflictError if concurrent requests detected
 *
 * @module routes/orders/fulfillment
 */

import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requirePermission } from '../../middleware/permissions.js';
import {
    NotFoundError,
    ValidationError,
    ConflictError,
    BusinessLogicError,
    ForbiddenError,
} from '../../utils/errors.js';
import {
    calculateInventoryBalance,
    TXN_TYPE,
    TXN_REASON,
    releaseReservedInventory,
    createReservedTransaction,
    createSaleTransaction,
    deleteSaleTransactions,
    validateOutwardTransaction,
} from '../../utils/queryPatterns.js';
import { validate, ShipOrderSchema } from '../../utils/validation.js';

const router = Router();

// ============================================
// ORDER LINE STATUS UPDATES
// ============================================

/**
 * POST /lines/:lineId/allocate
 * Reserve inventory for an order line (pending → allocated)
 *
 * WHAT HAPPENS:
 * - Creates RESERVED transaction (holds stock, available = balance - reserved)
 * - Updates lineStatus to 'allocated'
 * - Sets allocatedAt timestamp
 *
 * VALIDATION:
 * - Line must be in 'pending' status
 * - Available stock must >= qty requested
 * - Re-checks inside transaction to prevent race conditions
 *
 * @param {string} req.params.lineId - Order line ID
 * @returns {Object} Updated orderLine record
 *
 * @example
 * POST /fulfillment/lines/abc123/allocate
 * // Returns: { id, lineStatus: 'allocated', allocatedAt: '2025-01-11T...' }
 */
router.post('/lines/:lineId/allocate', authenticateToken, requirePermission('orders:allocate'), asyncHandler(async (req, res) => {
    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
        include: { sku: true, order: true },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    // Status precondition check
    if (line.lineStatus !== 'pending') {
        throw new BusinessLogicError(
            `Line must be in pending status to allocate (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    const balance = await calculateInventoryBalance(req.prisma, line.skuId);
    if (balance.availableBalance < line.qty) {
        throw new BusinessLogicError(
            `Insufficient stock: ${balance.availableBalance} available, ${line.qty} requested`,
            'INSUFFICIENT_STOCK'
        );
    }

    await req.prisma.$transaction(async (tx) => {
        // Re-check status inside transaction to prevent race conditions
        const currentLine = await tx.orderLine.findUnique({
            where: { id: req.params.lineId },
            select: { lineStatus: true },
        });

        if (currentLine.lineStatus !== 'pending') {
            throw new ConflictError('Line was already allocated by another request', 'RACE_CONDITION');
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
}));

/**
 * POST /lines/:lineId/unallocate
 * Release reserved inventory for an order line (allocated → pending)
 *
 * WHAT HAPPENS:
 * - Deletes RESERVED transaction (releases hold, adds back to available)
 * - Updates lineStatus to 'pending'
 * - Clears allocatedAt timestamp
 *
 * VALIDATION:
 * - Line must be in 'allocated' status
 *
 * @param {string} req.params.lineId - Order line ID
 * @returns {Object} Updated orderLine record
 *
 * @example
 * POST /fulfillment/lines/abc123/unallocate
 * // Returns: { id, lineStatus: 'pending', allocatedAt: null }
 */
router.post('/lines/:lineId/unallocate', authenticateToken, asyncHandler(async (req, res) => {
    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    if (line.lineStatus !== 'allocated') {
        throw new BusinessLogicError(
            `Line must be in allocated status to unallocate (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
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
}));

/**
 * POST /lines/:lineId/pick
 * Mark order line as picked (allocated → picked)
 *
 * WHAT HAPPENS:
 * - Updates lineStatus to 'picked'
 * - Sets pickedAt timestamp
 * - No inventory changes (just status tracking)
 *
 * VALIDATION:
 * - Line must be in 'allocated' status
 *
 * @param {string} req.params.lineId - Order line ID
 * @returns {Object} Updated orderLine record
 *
 * @example
 * POST /fulfillment/lines/abc123/pick
 * // Returns: { id, lineStatus: 'picked', pickedAt: '2025-01-11T...' }
 */
router.post('/lines/:lineId/pick', authenticateToken, asyncHandler(async (req, res) => {
    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    if (line.lineStatus !== 'allocated') {
        throw new BusinessLogicError(
            `Line must be in allocated status to pick (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    const updated = await req.prisma.orderLine.update({
        where: { id: req.params.lineId },
        data: { lineStatus: 'picked', pickedAt: new Date() },
    });

    res.json(updated);
}));

// Unpick order line (revert to allocated)
router.post('/lines/:lineId/unpick', authenticateToken, asyncHandler(async (req, res) => {
    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    if (line.lineStatus !== 'picked') {
        throw new BusinessLogicError(
            `Line must be in picked status to unpick (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    const updated = await req.prisma.orderLine.update({
        where: { id: req.params.lineId },
        data: { lineStatus: 'allocated', pickedAt: null },
    });

    res.json(updated);
}));

/**
 * POST /lines/:lineId/pack
 * Mark order line as packed (picked → packed)
 *
 * WHAT HAPPENS:
 * - Updates lineStatus to 'packed'
 * - Sets packedAt timestamp
 * - No inventory changes (just status tracking)
 *
 * VALIDATION:
 * - Line must be in 'picked' status
 *
 * @param {string} req.params.lineId - Order line ID
 * @returns {Object} Updated orderLine record
 *
 * @example
 * POST /fulfillment/lines/abc123/pack
 * // Returns: { id, lineStatus: 'packed', packedAt: '2025-01-11T...' }
 */
router.post('/lines/:lineId/pack', authenticateToken, asyncHandler(async (req, res) => {
    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    if (line.lineStatus !== 'picked') {
        throw new BusinessLogicError(
            `Line must be in picked status to pack (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    const updated = await req.prisma.orderLine.update({
        where: { id: req.params.lineId },
        data: { lineStatus: 'packed', packedAt: new Date() },
    });

    res.json(updated);
}));

// Unpack order line (revert to picked)
router.post('/lines/:lineId/unpack', authenticateToken, asyncHandler(async (req, res) => {
    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    if (line.lineStatus !== 'packed') {
        throw new BusinessLogicError(
            `Line must be in packed status to unpack (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
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
}));

// ============================================
// MARK SHIPPED (Visual Only - No Side Effects)
// Part of spreadsheet-style shipping workflow
// ============================================

// Mark order line as shipped (visual only - no inventory release)
router.post('/lines/:lineId/mark-shipped', authenticateToken, asyncHandler(async (req, res) => {
    const { awbNumber, courier } = req.body || {};

    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    if (line.lineStatus !== 'packed') {
        throw new BusinessLogicError(
            `Line must be in packed status to mark as shipped (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    const updated = await req.prisma.orderLine.update({
        where: { id: req.params.lineId },
        data: {
            lineStatus: 'marked_shipped',
            ...(awbNumber && { awbNumber: awbNumber.trim() }),
            ...(courier && { courier: courier.trim() }),
        },
    });

    res.json(updated);
}));

// Unmark shipped line (revert to packed)
router.post('/lines/:lineId/unmark-shipped', authenticateToken, asyncHandler(async (req, res) => {
    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    if (line.lineStatus !== 'marked_shipped') {
        throw new BusinessLogicError(
            `Line must be in marked_shipped status to unmark (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    const updated = await req.prisma.orderLine.update({
        where: { id: req.params.lineId },
        data: { lineStatus: 'packed' },
    });

    res.json(updated);
}));

// Update line tracking info (AWB/courier)
router.patch('/lines/:lineId/tracking', authenticateToken, asyncHandler(async (req, res) => {
    const { awbNumber, courier } = req.body;

    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    if (!['packed', 'marked_shipped'].includes(line.lineStatus)) {
        throw new BusinessLogicError(
            `Can only update tracking on packed or marked_shipped lines (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    const updateData = {};
    if (awbNumber !== undefined) {
        updateData.awbNumber = awbNumber?.trim() || null;
    }
    if (courier !== undefined) {
        updateData.courier = courier?.trim() || null;
    }

    if (Object.keys(updateData).length === 0) {
        throw new ValidationError('No tracking data provided');
    }

    const updated = await req.prisma.orderLine.update({
        where: { id: req.params.lineId },
        data: updateData,
    });

    res.json(updated);
}));

// Bulk update line statuses
router.post('/lines/bulk-update', authenticateToken, asyncHandler(async (req, res) => {
    const { lineIds, status } = req.body;

    if (!lineIds?.length) {
        throw new ValidationError('lineIds array is required');
    }

    if (!status) {
        throw new ValidationError('status is required');
    }

    // Deduplicate lineIds to prevent double-counting
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
}));

// ============================================
// SHIP ORDER
// ============================================

/**
 * POST /:id/ship
 * Ship entire order (all lines packed → shipped)
 *
 * INVENTORY OPERATIONS (in transaction):
 * 1. Release RESERVED transactions for all lines
 * 2. Create OUTWARD (SALE) transactions for all lines
 * 3. Update order status to 'shipped'
 * 4. Update all lines to 'shipped' with tracking info
 *
 * VALIDATIONS:
 * - All non-cancelled lines must be 'packed'
 * - No line can have negative balance (data integrity check)
 * - AWB uniqueness enforced (no duplicate AWBs across orders)
 * - Race condition protection via transaction re-check
 *
 * @param {string} req.params.id - Order ID
 * @param {string} req.body.awbNumber - AWB/tracking number (required)
 * @param {string} req.body.courier - Courier name (required)
 * @returns {Object} Updated order with orderLines
 *
 * @example
 * POST /fulfillment/123/ship
 * Body: { awbNumber: "DL12345", courier: "Delhivery" }
 */
router.post('/:id/ship', authenticateToken, requirePermission('orders:ship'), validate(ShipOrderSchema), asyncHandler(async (req, res) => {
    const { awbNumber, courier } = req.validatedBody;

    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
        include: { orderLines: true },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    // Idempotency check - if already shipped, return success
    if (order.status === 'shipped') {
        return res.json({
            ...order,
            message: 'Order is already shipped',
        });
    }

    // Check for duplicate AWB number (if AWB provided)
    if (awbNumber) {
        const existingAwb = await req.prisma.orderLine.findFirst({
            where: {
                awbNumber,
                orderId: { not: req.params.id },
            },
            select: { id: true, order: { select: { orderNumber: true } } },
        });

        if (existingAwb) {
            throw new ConflictError(
                `AWB number already assigned to order ${existingAwb.order?.orderNumber}`,
                'DUPLICATE_AWB'
            );
        }
    }

    // Validate all non-cancelled lines are packed before shipping
    const unshippableLines = order.orderLines.filter(
        l => l.lineStatus !== 'packed' && l.lineStatus !== 'cancelled'
    );
    if (unshippableLines.length > 0) {
        throw new BusinessLogicError(
            `All non-cancelled lines must be packed before shipping (${unshippableLines.length} not packed)`,
            'LINES_NOT_PACKED'
        );
    }

    // Validate no lines have negative inventory (data integrity check)
    const negativeBalanceLines = [];
    for (const line of order.orderLines) {
        const balance = await calculateInventoryBalance(req.prisma, line.skuId);
        if (balance.currentBalance < 0) {
            negativeBalanceLines.push({
                lineId: line.id,
                skuCode: line.sku?.skuCode,
                currentBalance: balance.currentBalance,
            });
        }
    }

    if (negativeBalanceLines.length > 0) {
        throw new BusinessLogicError(
            'Cannot ship: some items have negative inventory balance. Fix data integrity issues first.',
            'NEGATIVE_INVENTORY'
        );
    }

    await req.prisma.$transaction(async (tx) => {
        // Re-check order status inside transaction to prevent race condition
        const currentOrder = await tx.order.findUnique({
            where: { id: req.params.id },
            select: { status: true },
        });

        if (currentOrder.status === 'shipped') {
            throw new ConflictError('Order was already shipped by another request', 'RACE_CONDITION');
        }

        // Re-check AWB inside transaction
        if (awbNumber) {
            const existingAwb = await tx.orderLine.findFirst({
                where: {
                    awbNumber,
                    orderId: { not: req.params.id },
                },
                select: { id: true },
            });

            if (existingAwb) {
                throw new ConflictError('AWB number was assigned to another order', 'DUPLICATE_AWB');
            }
        }

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
}));

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
router.post('/:id/ship-lines', authenticateToken, requirePermission('orders:ship'), asyncHandler(async (req, res) => {
    const { lineIds, awbNumber, courier } = req.body;

    // Validate required fields
    if (!lineIds?.length) {
        throw new ValidationError('lineIds array is required');
    }
    if (!awbNumber?.trim()) {
        throw new ValidationError('awbNumber is required');
    }
    if (!courier?.trim()) {
        throw new ValidationError('courier is required');
    }

    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
        include: { orderLines: true },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    // Validate all requested lines exist and belong to this order
    const linesToShip = order.orderLines.filter(l => lineIds.includes(l.id));
    if (linesToShip.length !== lineIds.length) {
        throw new ValidationError(
            `Some lineIds not found in this order (found ${linesToShip.length} of ${lineIds.length})`
        );
    }

    // Add cancelled line validation
    const cancelledLines = linesToShip.filter(l => l.lineStatus === 'cancelled');
    if (cancelledLines.length > 0) {
        throw new BusinessLogicError(
            `Cannot ship cancelled lines (${cancelledLines.length} cancelled)`,
            'LINES_CANCELLED'
        );
    }

    // Validate all lines are packed (ready to ship)
    const notPacked = linesToShip.filter(l => l.lineStatus !== 'packed');
    if (notPacked.length > 0) {
        throw new BusinessLogicError(
            `All lines must be packed before shipping (${notPacked.length} not packed)`,
            'LINES_NOT_PACKED'
        );
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
        throw new ConflictError(
            `AWB number already used on order ${existingAwb.order?.orderNumber}`,
            'DUPLICATE_AWB'
        );
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
}));

// ============================================
// PROCESS MARKED SHIPPED (Batch Clear)
// Final step of spreadsheet-style shipping workflow
// Releases inventory and creates sale transactions
// ============================================

router.post('/process-marked-shipped', authenticateToken, requirePermission('orders:ship'), asyncHandler(async (req, res) => {
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
        const lineIds = linesToProcess.map(l => l.line.id);

        // 1. Release reserved inventory
        await tx.inventoryTransaction.deleteMany({
            where: {
                referenceId: { in: lineIds },
                txnType: TXN_TYPE.RESERVED,
                reason: TXN_REASON.ORDER_ALLOCATION,
            },
        });

        // 2. Create sale transactions
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

        // 4. Update order status where all lines are shipped
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
}));

// Unship order (move back to open)
router.post('/:id/unship', authenticateToken, asyncHandler(async (req, res) => {
    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
        include: { orderLines: true },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    if (order.status !== 'shipped') {
        throw new BusinessLogicError(
            `Order must be shipped to unship (current: ${order.status})`,
            'INVALID_STATUS'
        );
    }

    await req.prisma.$transaction(async (tx) => {
        // Re-check status inside transaction to prevent race condition
        const currentOrder = await tx.order.findUnique({
            where: { id: req.params.id },
            select: { status: true },
        });

        if (currentOrder.status !== 'shipped') {
            throw new ConflictError('Order status changed by another request', 'RACE_CONDITION');
        }

        // Atomic inventory correction
        // First, delete all sale transactions for this order's lines
        for (const line of order.orderLines) {
            await deleteSaleTransactions(tx, line.id);
        }

        // Then create reserved transactions atomically
        for (const line of order.orderLines) {
            // Skip cancelled lines - they shouldn't get reserved inventory
            if (line.lineStatus === 'cancelled') continue;

            await createReservedTransaction(tx, {
                skuId: line.skuId,
                qty: line.qty,
                orderLineId: line.id,
                userId: req.user.id,
            });
        }

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
}));

// Mark delivered (simple version)
router.post('/:id/deliver', authenticateToken, asyncHandler(async (req, res) => {
    const updated = await req.prisma.order.update({
        where: { id: req.params.id },
        data: { status: 'delivered', deliveredAt: new Date() },
    });
    res.json(updated);
}));

// Mark order as delivered (with validation)
router.post('/:id/mark-delivered', authenticateToken, asyncHandler(async (req, res) => {
    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    if (order.status !== 'shipped') {
        throw new BusinessLogicError(
            `Order must be shipped to mark as delivered (current: ${order.status})`,
            'INVALID_STATUS'
        );
    }

    const updated = await req.prisma.order.update({
        where: { id: req.params.id },
        data: {
            status: 'delivered',
            deliveredAt: new Date(),
        },
    });

    res.json(updated);
}));

// Initiate RTO for order
router.post('/:id/mark-rto', authenticateToken, asyncHandler(async (req, res) => {
    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true, customerId: true, rtoInitiatedAt: true },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    if (order.status !== 'shipped') {
        throw new BusinessLogicError(
            `Order must be shipped to initiate RTO (current: ${order.status})`,
            'INVALID_STATUS'
        );
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
}));

// Receive RTO package (creates inventory inward)
router.post('/:id/receive-rto', authenticateToken, asyncHandler(async (req, res) => {
    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
        include: { orderLines: true },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    if (!order.rtoInitiatedAt) {
        throw new BusinessLogicError('RTO must be initiated first', 'RTO_NOT_INITIATED');
    }

    if (order.rtoReceivedAt) {
        throw new ConflictError('RTO already received', 'RTO_ALREADY_RECEIVED');
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
}));

// ============================================
// QUICK SHIP: Force ship order (skip allocate/pick/pack checks)
// TEMPORARY - For testing phase only
// ============================================

router.post('/:id/quick-ship', authenticateToken, asyncHandler(async (req, res) => {
    // WARNING: This endpoint bypasses normal inventory validation
    // Should only be used in testing/emergency scenarios
    if (process.env.NODE_ENV === 'production') {
        // Add strict admin check in production
        if (!req.user?.role === 'admin') {
            throw new ForbiddenError('Quick-ship is restricted to admin users in production');
        }
    }

    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
        include: { orderLines: true },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    // Idempotency check
    if (order.status === 'shipped') {
        return res.json({ ...order, message: 'Order is already shipped' });
    }

    if (order.status !== 'open') {
        throw new BusinessLogicError(
            `Cannot ship order with status: ${order.status}`,
            'INVALID_STATUS'
        );
    }

    // Require AWB and courier
    if (!order.awbNumber || !order.courier) {
        throw new ValidationError('AWB number and courier are required');
    }

    const now = new Date();

    // Wrap all operations in a transaction to ensure atomicity
    await req.prisma.$transaction(async (tx) => {
        // Re-check order status inside transaction to prevent race conditions
        const currentOrder = await tx.order.findUnique({
            where: { id: req.params.id },
            select: { status: true },
        });

        if (currentOrder.status === 'shipped') {
            throw new ConflictError('Order was already shipped by another request', 'RACE_CONDITION');
        }

        // Process each line - auto allocate/pick/pack/ship
        for (const line of order.orderLines) {
            if (line.lineStatus === 'shipped' || line.lineStatus === 'cancelled') continue;

            // If pending, try to allocate (create reserved then release)
            if (line.lineStatus === 'pending') {
                const balance = await calculateInventoryBalance(tx, line.skuId);
                if (balance.available >= line.qty) {
                    await createReservedTransaction(tx, {
                        skuId: line.skuId,
                        qty: line.qty,
                        orderLineId: line.id,
                        userId: req.user.id,
                    });
                }
            }

            // Release any reserved inventory and create sale
            await releaseReservedInventory(tx, line.id);
            await createSaleTransaction(tx, {
                skuId: line.skuId,
                qty: line.qty,
                orderLineId: line.id,
                userId: req.user.id,
            });

            // Update line to shipped with tracking
            await tx.orderLine.update({
                where: { id: line.id },
                data: {
                    lineStatus: 'shipped',
                    allocatedAt: line.allocatedAt || now,
                    pickedAt: line.pickedAt || now,
                    packedAt: line.packedAt || now,
                    shippedAt: now,
                    awbNumber: order.awbNumber,
                    courier: order.courier,
                    trackingStatus: 'in_transit',
                },
            });
        }

        await tx.order.update({
            where: { id: order.id },
            data: {
                status: 'shipped',
            },
        });
    });

    const updated = await req.prisma.order.findUnique({
        where: { id: req.params.id },
        include: { orderLines: true },
    });

    console.log(`[Quick Ship] Order ${order.orderNumber} shipped`);
    res.json(updated);
}));

// ============================================
// BULK QUICK SHIP: Ship all eligible orders at once
// Optimized with batched database operations
// ============================================

router.post('/bulk-quick-ship', authenticateToken, asyncHandler(async (req, res) => {
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

    // Execute all operations in a transaction for atomicity
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

        // 3. Update order lines to shipped per order
        for (const [orderId, orderData] of orderLineMap) {
            await tx.orderLine.updateMany({
                where: { id: { in: orderData.lineIds } },
                data: {
                    lineStatus: 'shipped',
                    shippedAt: now,
                    awbNumber: orderData.awbNumber,
                    courier: orderData.courier,
                    trackingStatus: 'in_transit',
                },
            });
        }

        // Set timestamps for lines that don't have them
        if (lineIdsToShip.length > 0) {
            await tx.orderLine.updateMany({
                where: { id: { in: lineIdsToShip }, allocatedAt: null },
                data: { allocatedAt: now },
            });
            await tx.orderLine.updateMany({
                where: { id: { in: lineIdsToShip }, pickedAt: null },
                data: { pickedAt: now },
            });
            await tx.orderLine.updateMany({
                where: { id: { in: lineIdsToShip }, packedAt: null },
                data: { packedAt: now },
            });
        }

        // 4. Update order statuses
        await tx.order.updateMany({
            where: { id: { in: orderIds } },
            data: { status: 'shipped' },
        });
    });

    const shippedOrders = eligibleOrders.map(o => ({ id: o.id, orderNumber: o.orderNumber }));
    console.log(`[Bulk Quick Ship] Shipped ${shippedOrders.length} orders in batch`);

    res.json({
        shipped: shippedOrders,
        failed: [],
        message: `Shipped ${shippedOrders.length} orders`,
    });
}));

export default router;
