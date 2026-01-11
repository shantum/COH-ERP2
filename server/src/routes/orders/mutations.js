/**
 * Mutations Router
 * Create, update, delete, cancel, and archive operations
 */

import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requirePermission } from '../../middleware/permissions.js';
import { releaseReservedInventory, createReservedTransaction, calculateInventoryBalance, recalculateOrderStatus, createCustomSku, removeCustomization } from '../../utils/queryPatterns.js';
import { findOrCreateCustomerByContact } from '../../utils/customerUtils.js';
import { validate, CreateOrderSchema, UpdateOrderSchema, CustomizeLineSchema } from '../../utils/validation.js';
import { recomputeOrderStatus } from '../../utils/orderStatus.js';
import {
    NotFoundError,
    ValidationError,
    ConflictError,
    BusinessLogicError,
} from '../../utils/errors.js';

const router = Router();

// ============================================
// ORDER CREATION (Manual/Offline)
// ============================================

router.post('/', authenticateToken, validate(CreateOrderSchema), asyncHandler(async (req, res) => {
    const {
        orderNumber: providedOrderNumber,
        channel,
        customerName,
        customerEmail,
        customerPhone,
        customerId: providedCustomerId, // Existing customer link from frontend
        shippingAddress,
        customerNotes,
        internalNotes,
        totalAmount,
        lines,
        // Exchange order fields
        isExchange,
        originalOrderId,
        // Optional ship by date
        shipByDate,
    } = req.validatedBody;

    // Validate originalOrderId exists if provided
    if (originalOrderId) {
        const originalOrder = await req.prisma.order.findUnique({
            where: { id: originalOrderId },
            select: { id: true, orderNumber: true },
        });
        if (!originalOrder) {
            throw new NotFoundError('Original order not found', 'Order', originalOrderId);
        }
    }

    // Generate order number with EXC- prefix for exchanges
    const orderNumber = providedOrderNumber ||
        (isExchange ? `EXC-${Date.now().toString().slice(-8)}` : `COH-${Date.now().toString().slice(-8)}`);

    // Use provided customerId if given, otherwise find or create based on contact info
    let customerId = providedCustomerId || null;
    if (!customerId && (customerEmail || customerPhone)) {
        const customer = await findOrCreateCustomerByContact(req.prisma, {
            email: customerEmail,
            phone: customerPhone,
            firstName: customerName?.split(' ')[0],
            lastName: customerName?.split(' ').slice(1).join(' '),
            defaultAddress: shippingAddress,
        });
        customerId = customer.id;
    }

    // Create order with lines in transaction (now fast, just the create)
    const order = await req.prisma.$transaction(async (tx) => {
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
                // Exchange order fields
                isExchange: isExchange || false,
                originalOrderId: originalOrderId || null,
                // Optional ship by date
                shipByDate: shipByDate ? new Date(shipByDate) : null,
                orderLines: {
                    create: lines.map((line) => ({
                        skuId: line.skuId,
                        qty: line.qty,
                        unitPrice: line.unitPrice,
                        lineStatus: 'pending',
                        // Line-level address, or fall back to order-level address
                        shippingAddress: line.shippingAddress || shippingAddress || null,
                    })),
                },
            },
            include: {
                orderLines: {
                    include: {
                        sku: { include: { variation: { include: { product: true } } } },
                    },
                },
                originalOrder: { select: { id: true, orderNumber: true } },
            },
        });

        return createdOrder;
    });

    res.status(201).json(order);
}));

// Update order details
router.put('/:id', authenticateToken, validate(UpdateOrderSchema), asyncHandler(async (req, res) => {
    const {
        customerName,
        customerEmail,
        customerPhone,
        shippingAddress,
        internalNotes,
        shipByDate,
        isExchange,
    } = req.validatedBody;

    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    const updateData = {};
    if (customerName !== undefined) updateData.customerName = customerName;
    if (customerEmail !== undefined) updateData.customerEmail = customerEmail;
    if (customerPhone !== undefined) updateData.customerPhone = customerPhone;
    if (shippingAddress !== undefined) updateData.shippingAddress = shippingAddress;
    if (internalNotes !== undefined) updateData.internalNotes = internalNotes;
    if (shipByDate !== undefined) updateData.shipByDate = shipByDate ? new Date(shipByDate) : null;
    if (isExchange !== undefined) updateData.isExchange = isExchange;

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
}));

// Delete order (only for manually created orders)
router.delete('/:id', authenticateToken, asyncHandler(async (req, res) => {
    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
        include: { orderLines: true }
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    if (order.shopifyOrderId && order.orderLines.length > 0) {
        throw new BusinessLogicError(
            'Cannot delete Shopify orders with line items. Use cancel instead.',
            'CANNOT_DELETE_SHOPIFY_ORDER'
        );
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
}));

// ============================================
// CANCEL / UNCANCEL
// ============================================

// Cancel order
router.post('/:id/cancel', authenticateToken, requirePermission('orders:cancel'), asyncHandler(async (req, res) => {
    const { reason } = req.body;

    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
        include: { orderLines: true },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    if (order.status === 'cancelled') {
        throw new BusinessLogicError('Order is already cancelled', 'ALREADY_CANCELLED');
    }

    if (order.status === 'shipped' || order.status === 'delivered') {
        throw new BusinessLogicError('Cannot cancel shipped or delivered orders', 'CANNOT_CANCEL_SHIPPED');
    }

    await req.prisma.$transaction(async (tx) => {
        // Issue #7: Re-check status inside transaction to prevent race condition
        const currentOrder = await tx.order.findUnique({
            where: { id: req.params.id },
            select: { status: true },
        });

        // Prevent canceling if status changed during request
        if (currentOrder.status === 'shipped' || currentOrder.status === 'delivered') {
            throw new ConflictError('Order was shipped by another request and cannot be cancelled', 'RACE_CONDITION');
        }

        if (currentOrder.status === 'cancelled') {
            throw new ConflictError('Order was already cancelled by another request', 'RACE_CONDITION');
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
                terminalStatus: 'cancelled',
                terminalAt: new Date(),
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
}));

// Uncancel order (restore to open)
router.post('/:id/uncancel', authenticateToken, asyncHandler(async (req, res) => {
    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
        include: { orderLines: { include: { sku: true } } },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    if (order.status !== 'cancelled') {
        throw new BusinessLogicError('Order is not cancelled', 'NOT_CANCELLED');
    }

    // Issue #8: Uncancel needs to restore line statuses to pending
    // Note: We don't auto-allocate on uncancel - that requires manual allocation
    await req.prisma.$transaction(async (tx) => {
        // Restore order to open status and clear terminal status
        await tx.order.update({
            where: { id: req.params.id },
            data: {
                status: 'open',
                terminalStatus: null,
                terminalAt: null,
            },
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
}));

// ============================================
// HOLD / RELEASE OPERATIONS
// ============================================

// Hold entire order (blocks all lines from fulfillment)
router.put('/:id/hold', authenticateToken, requirePermission('orders:hold'), asyncHandler(async (req, res) => {
    const { reason, notes } = req.body;

    if (!reason) {
        throw new ValidationError('Hold reason is required');
    }

    const validReasons = ['fraud_review', 'address_issue', 'payment_issue', 'customer_request', 'other'];
    if (!validReasons.includes(reason)) {
        throw new ValidationError(`Invalid hold reason. Valid options: ${validReasons.join(', ')}`);
    }

    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
        include: { orderLines: true }
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    if (order.isOnHold) {
        throw new BusinessLogicError('Order is already on hold', 'ALREADY_ON_HOLD');
    }

    if (order.isArchived) {
        throw new BusinessLogicError('Cannot hold archived orders', 'CANNOT_HOLD_ARCHIVED');
    }

    if (['shipped', 'delivered', 'cancelled'].includes(order.status)) {
        throw new BusinessLogicError(
            `Cannot hold order in ${order.status} status`,
            'INVALID_STATUS_FOR_HOLD'
        );
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
}));

// Release order from hold
router.put('/:id/release', authenticateToken, asyncHandler(async (req, res) => {
    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
        include: { orderLines: true }
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    if (!order.isOnHold) {
        throw new BusinessLogicError('Order is not on hold', 'NOT_ON_HOLD');
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
}));

// Hold a single order line
router.put('/lines/:lineId/hold', authenticateToken, asyncHandler(async (req, res) => {
    const { reason, notes } = req.body;

    if (!reason) {
        throw new ValidationError('Hold reason is required');
    }

    const validReasons = ['size_confirmation', 'stock_issue', 'customization', 'customer_request', 'other'];
    if (!validReasons.includes(reason)) {
        throw new ValidationError(`Invalid hold reason. Valid options: ${validReasons.join(', ')}`);
    }

    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
        include: { order: true }
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    if (line.isOnHold) {
        throw new BusinessLogicError('Line is already on hold', 'ALREADY_ON_HOLD');
    }

    if (['shipped', 'cancelled'].includes(line.lineStatus)) {
        throw new BusinessLogicError(
            `Cannot hold line in ${line.lineStatus} status`,
            'INVALID_STATUS_FOR_HOLD'
        );
    }

    if (line.order.isArchived) {
        throw new BusinessLogicError('Cannot hold lines in archived orders', 'CANNOT_HOLD_ARCHIVED');
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
}));

// Release a single order line from hold
router.put('/lines/:lineId/release', authenticateToken, asyncHandler(async (req, res) => {
    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
        include: { order: true }
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    if (!line.isOnHold) {
        throw new BusinessLogicError('Line is not on hold', 'NOT_ON_HOLD');
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
}));

// ============================================
// ARCHIVE OPERATIONS
// ============================================

// Archive order
router.post('/:id/archive', authenticateToken, asyncHandler(async (req, res) => {
    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
        select: { id: true, orderNumber: true, isArchived: true, status: true },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    if (order.isArchived) {
        throw new BusinessLogicError('Order is already archived', 'ALREADY_ARCHIVED');
    }

    // Issue #6: Add status validation before archiving
    // Only terminal states can be archived
    const terminalStatuses = ['shipped', 'delivered', 'cancelled'];
    if (!terminalStatuses.includes(order.status)) {
        throw new BusinessLogicError(
            `Order must be in a terminal state to archive (current: ${order.status})`,
            'INVALID_STATUS_FOR_ARCHIVE'
        );
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
}));

// Unarchive order
router.post('/:id/unarchive', authenticateToken, asyncHandler(async (req, res) => {
    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    if (!order.isArchived) {
        throw new BusinessLogicError('Order is not archived', 'NOT_ARCHIVED');
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
}));

/**
 * Auto-archive orders based on terminal status (Zen Philosophy)
 *
 * Rules:
 * - Prepaid delivered: Archive after 15 days from terminalAt
 * - COD delivered: Archive after 15 days from terminalAt (only if remitted)
 * - RTO received: Archive after 15 days from terminalAt
 * - Cancelled: Archive after 1 day from terminalAt
 * - Legacy: Also archive shipped orders >90 days (backward compat)
 */
export async function autoArchiveOldOrders(prisma) {
    try {
        const fifteenDaysAgo = new Date();
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        const now = new Date();
        let totalArchived = 0;

        // 1. Archive delivered prepaid orders (15 days)
        const prepaidResult = await prisma.order.updateMany({
            where: {
                terminalStatus: 'delivered',
                paymentMethod: { not: 'COD' },
                terminalAt: { lt: fifteenDaysAgo },
                isArchived: false,
            },
            data: {
                isArchived: true,
                archivedAt: now,
            },
        });
        totalArchived += prepaidResult.count;

        // 2. Archive delivered COD orders (15 days, only if remitted)
        const codResult = await prisma.order.updateMany({
            where: {
                terminalStatus: 'delivered',
                paymentMethod: 'COD',
                codRemittedAt: { not: null },
                terminalAt: { lt: fifteenDaysAgo },
                isArchived: false,
            },
            data: {
                isArchived: true,
                archivedAt: now,
            },
        });
        totalArchived += codResult.count;

        // 3. Archive RTO received orders (15 days)
        const rtoResult = await prisma.order.updateMany({
            where: {
                terminalStatus: 'rto_received',
                terminalAt: { lt: fifteenDaysAgo },
                isArchived: false,
            },
            data: {
                isArchived: true,
                archivedAt: now,
            },
        });
        totalArchived += rtoResult.count;

        // 4. Archive cancelled orders (1 day grace)
        const cancelledResult = await prisma.order.updateMany({
            where: {
                terminalStatus: 'cancelled',
                terminalAt: { lt: oneDayAgo },
                isArchived: false,
            },
            data: {
                isArchived: true,
                archivedAt: now,
            },
        });
        totalArchived += cancelledResult.count;

        // 5. Legacy: Archive shipped orders >90 days (backward compat for orders without terminalStatus)
        const legacyResult = await prisma.order.updateMany({
            where: {
                status: 'shipped',
                terminalStatus: null,
                isArchived: false,
                shippedAt: { lt: ninetyDaysAgo },
            },
            data: {
                isArchived: true,
                archivedAt: now,
            },
        });
        totalArchived += legacyResult.count;

        if (totalArchived > 0) {
            console.log(`[Auto-Archive] Archived ${totalArchived} orders: ` +
                `${prepaidResult.count} prepaid, ${codResult.count} COD, ` +
                `${rtoResult.count} RTO, ${cancelledResult.count} cancelled, ` +
                `${legacyResult.count} legacy`);
        }

        return totalArchived;
    } catch (error) {
        console.error('Auto-archive error:', error);
        return 0;
    }
}

// Manual trigger for auto-archive (admin endpoint)
router.post('/auto-archive', authenticateToken, asyncHandler(async (req, res) => {
    const count = await autoArchiveOldOrders(req.prisma);
    res.json({ message: `Archived ${count} orders`, count });
}));

// Archive orders before a specific date
router.post('/archive-before-date', authenticateToken, asyncHandler(async (req, res) => {
    const { beforeDate, status } = req.body;
    if (!beforeDate) {
        throw new ValidationError('beforeDate is required (ISO format)');
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
}));

// Archive delivered orders (prepaid and paid COD)
router.post('/archive-delivered-prepaid', authenticateToken, asyncHandler(async (req, res) => {
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
}));

// ============================================
// ORDER LINE OPERATIONS
// ============================================

// Cancel a single order line
router.post('/lines/:lineId/cancel', authenticateToken, asyncHandler(async (req, res) => {
    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
        include: { order: true },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    if (line.lineStatus === 'shipped') {
        throw new BusinessLogicError('Cannot cancel shipped line', 'CANNOT_CANCEL_SHIPPED');
    }

    if (line.lineStatus === 'cancelled') {
        throw new BusinessLogicError('Line is already cancelled', 'ALREADY_CANCELLED');
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
            // All lines cancelled - mark order as fully cancelled
            await tx.order.update({
                where: { id: line.orderId },
                data: {
                    status: 'cancelled',
                    terminalStatus: 'cancelled',
                    terminalAt: new Date(),
                    totalAmount: 0,
                    partiallyCancelled: false, // Fully cancelled, not partial
                },
            });
        } else {
            // Some lines still active - mark as partially cancelled
            const newTotal = activeLines.reduce((sum, l) => sum + (l.qty * l.unitPrice), 0);
            await tx.order.update({
                where: { id: line.orderId },
                data: {
                    totalAmount: newTotal,
                    partiallyCancelled: true,
                },
            });
        }
    });

    const updated = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
    });

    res.json(updated);
}));

// Uncancel a single order line
router.post('/lines/:lineId/uncancel', authenticateToken, asyncHandler(async (req, res) => {
    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
        include: { order: true },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    if (line.lineStatus !== 'cancelled') {
        throw new BusinessLogicError('Line is not cancelled', 'NOT_CANCELLED');
    }

    await req.prisma.$transaction(async (tx) => {
        await tx.orderLine.update({
            where: { id: req.params.lineId },
            data: { lineStatus: 'pending' },
        });

        // Get all lines to check if any cancelled lines remain
        const allLines = await tx.orderLine.findMany({
            where: { orderId: line.orderId },
        });

        // Calculate new total from all non-cancelled lines (including the one we just restored)
        const activeLines = allLines.filter(l =>
            l.id === req.params.lineId || l.lineStatus !== 'cancelled'
        );
        const newTotal = activeLines.reduce((sum, l) => sum + (l.qty * l.unitPrice), 0);

        // Check if any cancelled lines remain (excluding the one we just restored)
        const remainingCancelledLines = allLines.filter(l =>
            l.id !== req.params.lineId && l.lineStatus === 'cancelled'
        );

        const updateData = {
            totalAmount: newTotal,
            partiallyCancelled: remainingCancelledLines.length > 0,
        };

        if (line.order.status === 'cancelled') {
            updateData.status = 'open';
            updateData.terminalStatus = null;
            updateData.terminalAt = null;
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
}));

// Update order line (change qty, unitPrice, or notes)
router.put('/lines/:lineId', authenticateToken, asyncHandler(async (req, res) => {
    const { qty, unitPrice, notes } = req.body;
    const line = await req.prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
        include: { order: true },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', req.params.lineId);
    }

    // Notes can be updated regardless of line status
    // qty/unitPrice require pending status
    const hasQtyOrPrice = qty !== undefined || unitPrice !== undefined;
    if (hasQtyOrPrice && line.lineStatus !== 'pending') {
        throw new BusinessLogicError(
            `Can only edit qty/price on pending lines (current: ${line.lineStatus})`,
            'INVALID_STATUS_FOR_EDIT'
        );
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
}));

// Add line to order
router.post('/:id/lines', authenticateToken, asyncHandler(async (req, res) => {
    const { skuId, qty, unitPrice } = req.body;

    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    if (order.status !== 'open') {
        throw new BusinessLogicError(
            `Can only add lines to open orders (current: ${order.status})`,
            'INVALID_STATUS_FOR_ADD_LINE'
        );
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
}));

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
router.post('/lines/:lineId/customize', authenticateToken, validate(CustomizeLineSchema), asyncHandler(async (req, res) => {
    const { lineId } = req.params;
    const customizationData = req.validatedBody;
    const userId = req.user.id;

    // Get order line to find the base SKU
    const line = await req.prisma.orderLine.findUnique({
        where: { id: lineId },
        include: { sku: true, order: { select: { orderNumber: true, status: true } } },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', lineId);
    }

    // Use the current SKU as the base SKU
    const baseSkuId = line.skuId;

    try {
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
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }
        if (error.message === 'LINE_NOT_PENDING') {
            throw new BusinessLogicError(
                'Cannot customize an allocated/picked/packed line. Unallocate first.',
                'LINE_NOT_PENDING'
            );
        }
        if (error.message === 'ALREADY_CUSTOMIZED') {
            throw new BusinessLogicError('Order line is already customized', 'ALREADY_CUSTOMIZED');
        }
        throw error;
    }
}));

/**
 * Remove customization from an order line
 * DELETE /lines/:lineId/customize?force=true
 *
 * Reverts the order line to the original SKU and deletes the custom SKU.
 * Only allowed if no inventory transactions or production batches exist.
 * Pass force=true to delete any existing inventory transactions and production batches.
 */
router.delete('/lines/:lineId/customize', authenticateToken, asyncHandler(async (req, res) => {
    const { lineId } = req.params;
    const force = req.query.force === 'true';

    try {
        const result = await removeCustomization(req.prisma, lineId, { force });

        const forceMsg = result.forcedCleanup
            ? ` (force-deleted ${result.deletedTransactions} inventory txns, ${result.deletedBatches} batches)`
            : '';
        console.log(`[Uncustomize] Order ${result.orderLine.order.orderNumber}: Removed custom SKU ${result.deletedCustomSkuCode} from line ${lineId}${forceMsg}`);

        res.json({
            id: result.orderLine.id,
            skuCode: result.orderLine.sku.skuCode,
            skuId: result.orderLine.sku.id,
            isCustomized: false,
            deletedCustomSkuCode: result.deletedCustomSkuCode,
            forcedCleanup: result.forcedCleanup,
            deletedTransactions: result.deletedTransactions,
            deletedBatches: result.deletedBatches,
        });
    } catch (error) {
        // Handle specific error codes from removeCustomization
        if (error.message === 'ORDER_LINE_NOT_FOUND') {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }
        if (error.message === 'NOT_CUSTOMIZED') {
            throw new BusinessLogicError('Order line is not customized', 'NOT_CUSTOMIZED');
        }
        if (error.message === 'CANNOT_UNDO_HAS_INVENTORY') {
            throw new BusinessLogicError(
                'Cannot undo customization - inventory transactions exist for custom SKU',
                'CANNOT_UNDO_HAS_INVENTORY'
            );
        }
        if (error.message === 'CANNOT_UNDO_HAS_PRODUCTION') {
            throw new BusinessLogicError(
                'Cannot undo customization - production batch exists for custom SKU',
                'CANNOT_UNDO_HAS_PRODUCTION'
            );
        }
        throw error;
    }
}));

// ============================================
// DATA MIGRATION: Copy order tracking to lines
// One-time migration for line-centric architecture
// ============================================

/**
 * Migrate tracking data from Order to OrderLines
 * This is a one-time migration to support multi-AWB shipping
 */
router.post('/migrate-tracking-to-lines', authenticateToken, asyncHandler(async (req, res) => {
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
}));

export default router;
