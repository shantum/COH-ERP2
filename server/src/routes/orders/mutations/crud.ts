/**
 * Order CRUD Operations
 * Create, update, delete orders
 */

import { Router } from 'express';
import type { Request, Response, RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import { authenticateToken } from '../../../middleware/auth.js';
import { asyncHandler } from '../../../middleware/asyncHandler.js';
import { releaseReservedInventory } from '../../../utils/queryPatterns.js';
import { findOrCreateCustomerByContact } from '../../../utils/customerUtils.js';
import { validate } from '../../../utils/validation.js';
import { CreateOrderSchema, UpdateOrderSchema } from '@coh/shared';
import { NotFoundError, BusinessLogicError } from '../../../utils/errors.js';
import { updateCustomerTier } from '../../../utils/tierUtils.js';

const router: Router = Router();

const validateMiddleware = validate as (schema: unknown) => RequestHandler;

// ============================================
// TYPE DEFINITIONS
// ============================================

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

interface UpdateOrderBody {
    customerName?: string;
    customerEmail?: string | null;
    customerPhone?: string | null;
    shippingAddress?: string | null;
    internalNotes?: string | null;
    shipByDate?: string | null;
    isExchange?: boolean;
}

type OrderUpdateData = Prisma.OrderUpdateInput;

// ============================================
// HELPER FUNCTION
// ============================================

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
            const customer = await findOrCreateCustomerByContact(
                req.prisma,
                customerData as unknown as { email: string; phone: string; firstName: string; lastName: string; defaultAddress: string }
            ) as { id: string };
            customerId = customer.id;
        }

        // Create order with lines in transaction
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

export default router;
