/**
 * Mutations Router
 * Create, update, delete, cancel, and archive operations
 */

import { Router } from 'express';
import type { Request, Response, RequestHandler } from 'express';
import type { PrismaClient, Prisma } from '@prisma/client';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requirePermission } from '../../middleware/permissions.js';
import {
    createCustomSku,
    removeCustomization,
    releaseReservedInventory,
    TXN_TYPE,
    TXN_REASON,
} from '../../utils/queryPatterns.js';
import { inventoryBalanceCache } from '../../services/inventoryBalanceCache.js';
import type { CreateCustomSkuResult, RemoveCustomizationResult } from '../../utils/queryPatterns.js';
import { findOrCreateCustomerByContact } from '../../utils/customerUtils.js';
import { validate } from '../../utils/validation.js';
import {
    CreateOrderSchema,
    UpdateOrderSchema,
    CustomizeLineSchema,
} from '@coh/shared';
import { recomputeOrderStatus } from '../../utils/orderStatus.js';
import {
    NotFoundError,
    ValidationError,
    ConflictError,
    BusinessLogicError,
} from '../../utils/errors.js';
import { updateCustomerTier, adjustCustomerLtv, recalculateAllCustomerLtvs } from '../../utils/tierUtils.js';
import { orderLogger } from '../../utils/logger.js';

const router: Router = Router();

// Cast validate to return RequestHandler to satisfy TypeScript
const validateMiddleware = validate as (schema: unknown) => RequestHandler;

// ============================================
// TYPE DEFINITIONS
// ============================================

/** Request body for creating an order */
interface CreateOrderBody {
    orderNumber?: string;
    channel?: string;
    customerName: string;
    customerEmail?: string | null;
    customerPhone?: string | null;
    customerId?: string | null;
    shippingAddress?: string | null;
    internalNotes?: string | null;
    totalAmount?: number;
    lines: Array<{
        skuId: string;
        qty: number;
        unitPrice?: number;
        shippingAddress?: string | null;
    }>;
    isExchange?: boolean;
    originalOrderId?: string | null;
    shipByDate?: string | null;
}

/** Request body for updating an order */
interface UpdateOrderBody {
    customerName?: string;
    customerEmail?: string | null;
    customerPhone?: string | null;
    shippingAddress?: string | null;
    internalNotes?: string | null;
    shipByDate?: string | null;
    isExchange?: boolean;
}

/** Request body for canceling an order */
interface CancelOrderBody {
    reason?: string;
}

/** Request body for holding an order */
interface HoldOrderBody {
    reason: string;
    notes?: string;
}

/** Request body for holding a line */
interface HoldLineBody {
    reason: string;
    notes?: string;
}

/** Request body for updating a line */
interface UpdateLineBody {
    qty?: number;
    unitPrice?: number;
    notes?: string;
}

/** Request body for adding a line to an order */
interface AddLineBody {
    skuId: string;
    qty: number;
    unitPrice: number;
}

/** Request body for customizing a line */
interface CustomizeLineBody {
    type: 'length' | 'size' | 'measurements' | 'other';
    value: string;
    notes?: string;
}

/** Request body for archive-before-date endpoint */
interface ArchiveBeforeDateBody {
    beforeDate: string;
    status?: string;
}

/** Order update data type */
type OrderUpdateData = Prisma.OrderUpdateInput;

// ============================================
// HELPER FUNCTION
// ============================================

/** Helper to extract string param from req.params */
function getParamString(param: string | string[] | undefined): string {
    if (Array.isArray(param)) return param[0];
    return param ?? '';
}

// ============================================
// ORDER CREATION (Manual/Offline)
// ============================================

router.post(
    '/',
    authenticateToken,
    validateMiddleware(CreateOrderSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const {
            orderNumber: providedOrderNumber,
            channel,
            customerName,
            customerEmail,
            customerPhone,
            customerId: providedCustomerId,
            shippingAddress,
            internalNotes,
            totalAmount,
            lines,
            isExchange,
            originalOrderId,
            shipByDate,
        } = req.validatedBody as unknown as CreateOrderBody;

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
        const orderNumber =
            providedOrderNumber ||
            (isExchange
                ? `EXC-${Date.now().toString().slice(-8)}`
                : `COH-${Date.now().toString().slice(-8)}`);

        // Use provided customerId if given, otherwise find or create based on contact info
        let customerId = providedCustomerId || null;
        if (!customerId && (customerEmail || customerPhone)) {
            const customerData = {
                email: customerEmail ?? undefined,
                phone: customerPhone ?? undefined,
                firstName: customerName?.split(' ')[0],
                lastName: customerName?.split(' ').slice(1).join(' '),
                defaultAddress: shippingAddress ?? undefined,
            };
            // Type assertion needed because customerUtils.js expects required strings but handles undefined internally
            const customer = await findOrCreateCustomerByContact(
                req.prisma,
                customerData as unknown as { email: string; phone: string; firstName: string; lastName: string; defaultAddress: string }
            ) as { id: string };
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
                    internalNotes,
                    totalAmount: totalAmount ?? 0,
                    isExchange: isExchange || false,
                    originalOrderId: originalOrderId || null,
                    shipByDate: shipByDate ? new Date(shipByDate) : null,
                    orderLines: {
                        create: lines.map((line) => ({
                            sku: { connect: { id: line.skuId } },
                            qty: line.qty,
                            unitPrice: line.unitPrice ?? 0,
                            lineStatus: 'pending',
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

        // Update customer tier based on new order
        if (order.customerId && totalAmount && totalAmount > 0) {
            await updateCustomerTier(req.prisma, order.customerId);
        }

        res.status(201).json(order);
    })
);

// Update order details
router.put(
    '/:id',
    authenticateToken,
    validateMiddleware(UpdateOrderSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const {
            customerName,
            customerEmail,
            customerPhone,
            shippingAddress,
            internalNotes,
            shipByDate,
            isExchange,
        } = req.validatedBody as unknown as UpdateOrderBody;

        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        const updateData: OrderUpdateData = {};
        if (customerName !== undefined) updateData.customerName = customerName;
        if (customerEmail !== undefined) updateData.customerEmail = customerEmail;
        if (customerPhone !== undefined) updateData.customerPhone = customerPhone;
        if (shippingAddress !== undefined) updateData.shippingAddress = shippingAddress;
        if (internalNotes !== undefined) updateData.internalNotes = internalNotes;
        if (shipByDate !== undefined) updateData.shipByDate = shipByDate ? new Date(shipByDate) : null;
        if (isExchange !== undefined) updateData.isExchange = isExchange;

        const updated = await req.prisma.order.update({
            where: { id: orderId },
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
    })
);

// Delete order (only for manually created orders)
router.delete(
    '/:id',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
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
                        data: { sourceOrderLineId: null },
                    });
                }

                if (
                    line.lineStatus === 'allocated' ||
                    line.lineStatus === 'picked' ||
                    line.lineStatus === 'packed'
                ) {
                    await releaseReservedInventory(tx, line.id);
                }
            }

            await tx.orderLine.deleteMany({ where: { orderId: order.id } });
            await tx.order.delete({ where: { id: order.id } });
        });

        res.json({ success: true, message: 'Order deleted successfully' });
    })
);

// ============================================
// CANCEL / UNCANCEL
// ============================================

// Cancel order
router.post(
    '/:id/cancel',
    authenticateToken,
    requirePermission('orders:cancel'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const { reason } = req.body as CancelOrderBody;

        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
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
                where: { id: orderId },
                select: { status: true },
            });

            // Prevent canceling if status changed during request
            if (currentOrder?.status === 'shipped' || currentOrder?.status === 'delivered') {
                throw new ConflictError(
                    'Order was shipped by another request and cannot be cancelled',
                    'RACE_CONDITION'
                );
            }

            if (currentOrder?.status === 'cancelled') {
                throw new ConflictError('Order was already cancelled by another request', 'RACE_CONDITION');
            }

            for (const line of order.orderLines) {
                if (['allocated', 'picked', 'packed'].includes(line.lineStatus)) {
                    await releaseReservedInventory(tx, line.id);
                }
            }

            await tx.orderLine.updateMany({
                where: { orderId },
                data: { lineStatus: 'cancelled' },
            });

            await tx.order.update({
                where: { id: orderId },
                data: {
                    status: 'cancelled',
                    terminalStatus: 'cancelled',
                    terminalAt: new Date(),
                    internalNotes: reason
                        ? order.internalNotes
                            ? `${order.internalNotes}\n\nCancelled: ${reason}`
                            : `Cancelled: ${reason}`
                        : order.internalNotes,
                },
            });
        });

        // Update customer tier - cancelled orders no longer count toward LTV
        if (order.customerId) {
            await updateCustomerTier(req.prisma, order.customerId);
        }

        const updated = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        res.json(updated);
    })
);

// Uncancel order (restore to open)
router.post(
    '/:id/uncancel',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: { include: { sku: true } } },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        if (order.status !== 'cancelled') {
            throw new BusinessLogicError('Order is not cancelled', 'NOT_CANCELLED');
        }

        // Issue #8: Uncancel needs to restore line statuses to pending
        // Note: We don't auto-allocate on uncancel - that requires manual allocation
        await req.prisma.$transaction(async (tx) => {
            // Restore order to open status and clear terminal status
            await tx.order.update({
                where: { id: orderId },
                data: {
                    status: 'open',
                    terminalStatus: null,
                    terminalAt: null,
                },
            });

            // Restore all lines to pending status
            await tx.orderLine.updateMany({
                where: { orderId },
                data: { lineStatus: 'pending' },
            });
        });

        // Update customer tier - restored order now counts toward LTV again
        if (order.customerId) {
            await updateCustomerTier(req.prisma, order.customerId);
        }

        const updated = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        res.json(updated);
    })
);

// ============================================
// HOLD / RELEASE OPERATIONS
// ============================================

// Hold entire order (blocks all lines from fulfillment)
router.put(
    '/:id/hold',
    authenticateToken,
    requirePermission('orders:hold'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const { reason, notes } = req.body as HoldOrderBody;

        if (!reason) {
            throw new ValidationError('Hold reason is required');
        }

        const validReasons = ['fraud_review', 'address_issue', 'payment_issue', 'customer_request', 'other'];
        if (!validReasons.includes(reason)) {
            throw new ValidationError(`Invalid hold reason. Valid options: ${validReasons.join(', ')}`);
        }

        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
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
            await tx.order.update({
                where: { id: orderId },
                data: {
                    isOnHold: true,
                    holdReason: reason,
                    holdNotes: notes || null,
                    holdAt: new Date(),
                },
                include: { orderLines: true },
            });

            // Recompute order status
            await recomputeOrderStatus(orderId, tx);

            return tx.order.findUnique({
                where: { id: orderId },
                include: { orderLines: true },
            });
        });

        orderLogger.info({ orderNumber: order.orderNumber, reason }, 'Order placed on hold');
        res.json(updated);
    })
);

// Release order from hold
router.put(
    '/:id/release',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        if (!order.isOnHold) {
            throw new BusinessLogicError('Order is not on hold', 'NOT_ON_HOLD');
        }

        const updated = await req.prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: {
                    isOnHold: false,
                    holdReason: null,
                    holdNotes: null,
                    holdAt: null,
                },
            });

            // Recompute order status
            await recomputeOrderStatus(orderId, tx);

            return tx.order.findUnique({
                where: { id: orderId },
                include: { orderLines: true },
            });
        });

        orderLogger.info({ orderNumber: order.orderNumber }, 'Order released from hold');
        res.json(updated);
    })
);

// Hold a single order line
router.put(
    '/lines/:lineId/hold',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);
        const { reason, notes } = req.body as HoldLineBody;

        if (!reason) {
            throw new ValidationError('Hold reason is required');
        }

        const validReasons = ['size_confirmation', 'stock_issue', 'customization', 'customer_request', 'other'];
        if (!validReasons.includes(reason)) {
            throw new ValidationError(`Invalid hold reason. Valid options: ${validReasons.join(', ')}`);
        }

        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { order: true },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
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
                where: { id: lineId },
                data: {
                    isOnHold: true,
                    holdReason: reason,
                    holdNotes: notes || null,
                    holdAt: new Date(),
                },
            });

            // Recompute order status
            await recomputeOrderStatus(line.orderId, tx);

            return tx.orderLine.findUnique({
                where: { id: lineId },
                include: { order: true },
            });
        });

        orderLogger.info({ lineId, reason }, 'Line placed on hold');
        res.json(updated);
    })
);

// Release a single order line from hold
router.put(
    '/lines/:lineId/release',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);
        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { order: true },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }

        if (!line.isOnHold) {
            throw new BusinessLogicError('Line is not on hold', 'NOT_ON_HOLD');
        }

        const updated = await req.prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    isOnHold: false,
                    holdReason: null,
                    holdNotes: null,
                    holdAt: null,
                },
            });

            // Recompute order status
            await recomputeOrderStatus(line.orderId, tx);

            return tx.orderLine.findUnique({
                where: { id: lineId },
                include: { order: true },
            });
        });

        orderLogger.info({ lineId }, 'Line released from hold');
        res.json(updated);
    })
);

// ============================================
// ARCHIVE OPERATIONS
// ============================================

// Archive order
router.post(
    '/:id/archive',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true, orderNumber: true, isArchived: true, status: true },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
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
            where: { id: orderId },
            data: {
                status: 'archived',
                isArchived: true,
                archivedAt: new Date(),
            },
            include: { orderLines: true },
        });

        orderLogger.info({ orderNumber: order.orderNumber }, 'Order manually archived');
        res.json(updated);
    })
);

// Unarchive order
router.post(
    '/:id/unarchive',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        if (!order.isArchived) {
            throw new BusinessLogicError('Order is not archived', 'NOT_ARCHIVED');
        }

        const updated = await req.prisma.order.update({
            where: { id: orderId },
            data: {
                isArchived: false,
                archivedAt: null,
            },
            include: { orderLines: true },
        });

        res.json(updated);
    })
);

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
export async function autoArchiveOldOrders(prisma: PrismaClient): Promise<number> {
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
            orderLogger.info({
                total: totalArchived,
                prepaid: prepaidResult.count,
                cod: codResult.count,
                rto: rtoResult.count,
                cancelled: cancelledResult.count,
                legacy: legacyResult.count
            }, 'Auto-archive completed');
        }

        return totalArchived;
    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Auto-archive error');
        return 0;
    }
}

// Manual trigger for auto-archive (admin endpoint)
router.post(
    '/auto-archive',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const count = await autoArchiveOldOrders(req.prisma);
        res.json({ message: `Archived ${count} orders`, count });
    })
);

// Archive orders before a specific date
router.post(
    '/archive-before-date',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const { beforeDate, status } = req.body as ArchiveBeforeDateBody;
        if (!beforeDate) {
            throw new ValidationError('beforeDate is required (ISO format)');
        }

        const cutoffDate = new Date(beforeDate);

        const where: Prisma.OrderWhereInput = {
            orderDate: { lt: cutoffDate },
            isArchived: false,
        };

        if (status) {
            where.status = status;
        }

        const result = await req.prisma.order.updateMany({
            where,
            data: {
                isArchived: true,
                status: 'archived',
                archivedAt: new Date(),
            },
        });

        res.json({
            message: `Archived ${result.count} orders before ${beforeDate}`,
            count: result.count,
        });
    })
);

// Archive delivered orders (prepaid and paid COD)
router.post(
    '/archive-delivered-prepaid',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
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
            res.json({
                message: 'No delivered orders ready to archive',
                archived: 0,
                prepaid: 0,
                cod: 0,
            });
            return;
        }

        const result = await req.prisma.order.updateMany({
            where: {
                id: { in: ordersToArchive.map((o) => o.id) },
            },
            data: {
                status: 'archived',
                isArchived: true,
                archivedAt: new Date(),
            },
        });

        const deliveryStats = ordersToArchive
            .filter((o) => o.deliveredAt && o.shippedAt)
            .map((o) => {
                const daysToDeliver = Math.ceil(
                    (new Date(o.deliveredAt!).getTime() - new Date(o.shippedAt!).getTime()) /
                    (1000 * 60 * 60 * 24)
                );
                return { orderNumber: o.orderNumber, paymentMethod: o.paymentMethod, daysToDeliver };
            });

        const avgDaysToDeliver =
            deliveryStats.length > 0
                ? (deliveryStats.reduce((sum, s) => sum + s.daysToDeliver, 0) / deliveryStats.length).toFixed(
                    1
                )
                : null;

        orderLogger.info({
            archived: result.count,
            prepaid: prepaidOrders.length,
            cod: codOrders.length,
            avgDaysToDeliver
        }, 'Auto-archive before-date completed');

        res.json({
            message: `Archived ${result.count} delivered orders`,
            archived: result.count,
            prepaid: prepaidOrders.length,
            cod: codOrders.length,
            avgDaysToDeliver,
            deliveryStats: deliveryStats.slice(0, 10),
        });
    })
);

/**
 * Release shipped orders to the shipped view
 * Shipped orders stay in open view until explicitly released
 */
router.post(
    '/release-to-shipped',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const { orderIds } = req.body as { orderIds?: string[] };

        // Build where clause - either specific orders or all unreleased shipped orders
        const whereClause: any = {
            releasedToShipped: false,
            // Only release orders where all non-cancelled lines are shipped
            NOT: {
                orderLines: {
                    some: {
                        lineStatus: { notIn: ['shipped', 'cancelled'] },
                    },
                },
            },
            // Must have at least one shipped line
            orderLines: {
                some: { lineStatus: 'shipped' },
            },
        };

        if (orderIds && orderIds.length > 0) {
            whereClause.id = { in: orderIds };
        }

        const result = await req.prisma.order.updateMany({
            where: whereClause,
            data: { releasedToShipped: true },
        });

        orderLogger.info({ orderIds, count: result.count }, 'Released orders to shipped');
        res.json({
            message: `Released ${result.count} orders to shipped view`,
            count: result.count,
        });
    })
);

/**
 * Release cancelled orders to the cancelled view
 * Cancelled orders stay in open view until explicitly released
 */
router.post(
    '/release-to-cancelled',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const { orderIds } = req.body as { orderIds?: string[] };

        // Build where clause - either specific orders or all unreleased cancelled orders
        const whereClause: any = {
            releasedToCancelled: false,
            // Only release orders where all lines are cancelled
            NOT: {
                orderLines: {
                    some: {
                        lineStatus: { not: 'cancelled' },
                    },
                },
            },
            // Must have at least one cancelled line
            orderLines: {
                some: { lineStatus: 'cancelled' },
            },
        };

        if (orderIds && orderIds.length > 0) {
            whereClause.id = { in: orderIds };
        }

        const result = await req.prisma.order.updateMany({
            where: whereClause,
            data: { releasedToCancelled: true },
        });

        orderLogger.info({ orderIds, count: result.count }, 'Released orders to cancelled');
        res.json({
            message: `Released ${result.count} orders to cancelled view`,
            count: result.count,
        });
    })
);

/**
 * Fix orders incorrectly marked as cancelled
 * Restores orders with status='cancelled' back to 'open' status
 * so they appear in the open orders view again
 */
router.post(
    '/fix-cancelled-status',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const result = await req.prisma.order.updateMany({
            where: {
                status: 'cancelled',
                terminalStatus: 'cancelled',
                isArchived: false,
            },
            data: {
                status: 'open',
                terminalStatus: null,
                terminalAt: null,
            },
        });

        orderLogger.info({ count: result.count }, 'Fixed cancelled orders');
        res.json({
            message: `Restored ${result.count} orders to open status`,
            count: result.count,
        });
    })
);

/**
 * Backfill all customer LTVs from orders
 * Run once after adding ltv field to Customer
 */
router.post(
    '/backfill-customer-ltvs',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const result = await recalculateAllCustomerLtvs(req.prisma);
        res.json({
            message: `Recalculated LTV for ${result.updated} customers`,
            ...result,
        });
    })
);

// ============================================
// ORDER LINE OPERATIONS
// ============================================

// Cancel a single order line - LEAN: just update status + reverse inventory if needed
router.post(
    '/lines/:lineId/cancel',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);

        // Single query to get line with minimal fields
        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            select: { id: true, lineStatus: true, qty: true, unitPrice: true, order: { select: { customerId: true } } },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }
        if (line.lineStatus === 'shipped') {
            throw new BusinessLogicError('Cannot cancel shipped line', 'CANNOT_CANCEL_SHIPPED');
        }
        if (line.lineStatus === 'cancelled') {
            res.json({ id: lineId, lineStatus: 'cancelled' }); // Already cancelled, just return
            return;
        }

        // If allocated, reverse inventory (important for stock accuracy)
        if (['allocated', 'picked', 'packed'].includes(line.lineStatus || '')) {
            const txn = await req.prisma.inventoryTransaction.findFirst({
                where: { referenceId: lineId, txnType: TXN_TYPE.OUTWARD, reason: TXN_REASON.ORDER_ALLOCATION },
                select: { id: true, skuId: true },
            });
            if (txn) {
                await req.prisma.inventoryTransaction.delete({ where: { id: txn.id } });
                inventoryBalanceCache.invalidate([txn.skuId]);
            }
        }

        // Update line status - that's it
        await req.prisma.orderLine.update({
            where: { id: lineId },
            data: { lineStatus: 'cancelled' },
        });

        // Background: adjust LTV (fire and forget)
        if (line.order?.customerId) {
            const lineAmount = line.qty * line.unitPrice;
            adjustCustomerLtv(req.prisma, line.order.customerId, -lineAmount).catch(() => {});
        }

        res.json({ id: lineId, lineStatus: 'cancelled' });
    })
);

// Uncancel a single order line - LEAN: just update status
router.post(
    '/lines/:lineId/uncancel',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);

        // Single query with minimal fields
        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            select: { id: true, lineStatus: true, qty: true, unitPrice: true, order: { select: { customerId: true } } },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }
        if (line.lineStatus !== 'cancelled') {
            res.json({ id: lineId, lineStatus: line.lineStatus }); // Not cancelled, just return current status
            return;
        }

        // Update line status - that's it
        await req.prisma.orderLine.update({
            where: { id: lineId },
            data: { lineStatus: 'pending' },
        });

        // Background: adjust LTV (fire and forget)
        if (line.order?.customerId) {
            const lineAmount = line.qty * line.unitPrice;
            adjustCustomerLtv(req.prisma, line.order.customerId, lineAmount).catch(() => {});
        }

        res.json({ id: lineId, lineStatus: 'pending' });
    })
);

// Update order line (change qty, unitPrice, or notes)
router.put(
    '/lines/:lineId',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);
        const { qty, unitPrice, notes } = req.body as UpdateLineBody;
        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { order: true },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
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

        const updateData: Prisma.OrderLineUpdateInput = {};
        if (qty !== undefined) updateData.qty = qty;
        if (unitPrice !== undefined) updateData.unitPrice = unitPrice;
        if (notes !== undefined) updateData.notes = notes;

        // If only updating notes, simple update without transaction
        if (!hasQtyOrPrice) {
            const updated = await req.prisma.orderLine.update({
                where: { id: lineId },
                data: updateData,
            });
            res.json(updated);
            return;
        }

        // qty/unitPrice changes need transaction to update order total
        await req.prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: lineId },
                data: updateData,
            });

            const allLines = await tx.orderLine.findMany({
                where: { orderId: line.orderId },
            });
            const newTotal = allLines.reduce((sum, l) => {
                const lineQty = l.id === lineId ? (qty ?? l.qty) : l.qty;
                const linePrice = l.id === lineId ? (unitPrice ?? l.unitPrice) : l.unitPrice;
                return sum + lineQty * linePrice;
            }, 0);
            await tx.order.update({
                where: { id: line.orderId },
                data: { totalAmount: newTotal },
            });
        });

        const updated = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
        });

        res.json(updated);
    })
);

// Add line to order
router.post(
    '/:id/lines',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const { skuId, qty, unitPrice } = req.body as AddLineBody;

        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
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
                    orderId,
                    skuId,
                    qty,
                    unitPrice,
                    lineStatus: 'pending',
                },
            });

            const allLines = await tx.orderLine.findMany({
                where: { orderId },
            });
            const newTotal = allLines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
            await tx.order.update({
                where: { id: orderId },
                data: { totalAmount: newTotal },
            });
        });

        const updated = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: {
                orderLines: {
                    include: {
                        sku: { include: { variation: { include: { product: true } } } },
                    },
                },
            },
        });

        res.json(updated);
    })
);

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
router.post(
    '/lines/:lineId/customize',
    authenticateToken,
    validateMiddleware(CustomizeLineSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);
        const customizationData = req.validatedBody as unknown as CustomizeLineBody;
        const userId = req.user!.id;

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

            // Access nested properties with type assertions
            const orderLine = result.orderLine as { id: string; qty: number; order: { orderNumber: string } };
            const customSku = result.customSku as {
                id: string;
                skuCode: string;
                customizationType: string;
                customizationValue: string;
                customizationNotes: string | null;
            };

            orderLogger.info({
                orderNumber: orderLine.order.orderNumber,
                customSkuCode: customSku.skuCode,
                lineId
            }, 'Custom SKU created for order line');

            res.json({
                id: orderLine.id,
                customSkuCode: customSku.skuCode,
                customSkuId: customSku.id,
                isCustomized: true,
                isNonReturnable: true,
                originalSkuCode: result.originalSkuCode,
                qty: orderLine.qty,
                customizationType: customSku.customizationType,
                customizationValue: customSku.customizationValue,
                customizationNotes: customSku.customizationNotes,
            });
        } catch (error) {
            // Handle specific error codes from createCustomSku
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (errorMessage === 'ORDER_LINE_NOT_FOUND') {
                throw new NotFoundError('Order line not found', 'OrderLine', lineId);
            }
            if (errorMessage === 'LINE_NOT_PENDING') {
                throw new BusinessLogicError(
                    'Cannot customize an allocated/picked/packed line. Unallocate first.',
                    'LINE_NOT_PENDING'
                );
            }
            if (errorMessage === 'ALREADY_CUSTOMIZED') {
                throw new BusinessLogicError('Order line is already customized', 'ALREADY_CUSTOMIZED');
            }
            throw error;
        }
    })
);

/**
 * Remove customization from an order line
 * DELETE /lines/:lineId/customize?force=true
 *
 * Reverts the order line to the original SKU and deletes the custom SKU.
 * Only allowed if no inventory transactions or production batches exist.
 * Pass force=true to delete any existing inventory transactions and production batches.
 */
router.delete(
    '/lines/:lineId/customize',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);
        const force = req.query.force === 'true';

        try {
            const result = await removeCustomization(req.prisma, lineId, { force });

            // Access nested properties with type assertions
            const orderLine = result.orderLine as {
                id: string;
                order: { orderNumber: string };
                sku: { id: string; skuCode: string };
            };

            const forceMsg = result.forcedCleanup
                ? ` (force-deleted ${result.deletedTransactions} inventory txns, ${result.deletedBatches} batches)`
                : '';
            orderLogger.info({
                orderNumber: orderLine.order.orderNumber,
                deletedCustomSkuCode: result.deletedCustomSkuCode,
                lineId,
                forcedCleanup: result.forcedCleanup,
                deletedTransactions: result.deletedTransactions,
                deletedBatches: result.deletedBatches
            }, 'Custom SKU removed from order line');

            res.json({
                id: orderLine.id,
                skuCode: orderLine.sku.skuCode,
                skuId: orderLine.sku.id,
                isCustomized: false,
                deletedCustomSkuCode: result.deletedCustomSkuCode,
                forcedCleanup: result.forcedCleanup,
                deletedTransactions: result.deletedTransactions,
                deletedBatches: result.deletedBatches,
            });
        } catch (error) {
            // Handle specific error codes from removeCustomization
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (errorMessage === 'ORDER_LINE_NOT_FOUND') {
                throw new NotFoundError('Order line not found', 'OrderLine', lineId);
            }
            if (errorMessage === 'NOT_CUSTOMIZED') {
                throw new BusinessLogicError('Order line is not customized', 'NOT_CUSTOMIZED');
            }
            if (errorMessage === 'CANNOT_UNDO_HAS_INVENTORY') {
                throw new BusinessLogicError(
                    'Cannot undo customization - inventory transactions exist for custom SKU',
                    'CANNOT_UNDO_HAS_INVENTORY'
                );
            }
            if (errorMessage === 'CANNOT_UNDO_HAS_PRODUCTION') {
                throw new BusinessLogicError(
                    'Cannot undo customization - production batch exists for custom SKU',
                    'CANNOT_UNDO_HAS_PRODUCTION'
                );
            }
            throw error;
        }
    })
);

// ============================================
// DATA MIGRATION: Copy order tracking to lines
// One-time migration for line-centric architecture
// ============================================

/**
 * Migrate tracking data from Order to OrderLines
 * This is a one-time migration to support multi-AWB shipping
 */
router.post(
    '/migrate-tracking-to-lines',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        // Find all shipped/delivered orders that have AWB on order but not on lines
        const ordersToMigrate = await req.prisma.order.findMany({
            where: {
                awbNumber: { not: null },
                orderLines: {
                    some: {
                        awbNumber: null,
                        lineStatus: { in: ['shipped', 'delivered'] },
                    },
                },
            },
            include: {
                orderLines: {
                    where: {
                        awbNumber: null,
                        lineStatus: { in: ['shipped', 'delivered'] },
                    },
                },
            },
        });

        if (ordersToMigrate.length === 0) {
            res.json({
                message: 'No orders need migration',
                migrated: 0,
            });
            return;
        }

        let migratedOrders = 0;
        let migratedLines = 0;

        for (const order of ordersToMigrate) {
            await req.prisma.orderLine.updateMany({
                where: {
                    orderId: order.id,
                    awbNumber: null,
                    lineStatus: { in: ['shipped', 'delivered'] },
                },
                data: {
                    awbNumber: order.awbNumber,
                    courier: order.courier,
                    trackingStatus: order.trackingStatus,
                    deliveredAt: order.deliveredAt,
                    rtoInitiatedAt: order.rtoInitiatedAt,
                    rtoReceivedAt: order.rtoReceivedAt,
                    lastTrackingUpdate: order.lastTrackingUpdate,
                },
            });

            migratedOrders++;
            migratedLines += order.orderLines.length;
        }

        orderLogger.info({ migratedOrders, migratedLines }, 'Tracking data migration completed');

        res.json({
            message: 'Migration completed',
            migratedOrders,
            migratedLines,
        });
    })
);

export default router;
