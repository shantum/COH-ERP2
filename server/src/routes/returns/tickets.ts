/**
 * @module routes/returns/tickets
 * CRUD operations for return requests (tickets)
 *
 * Endpoints:
 * - GET /: List all return requests with filters
 * - GET /pending: Get pending tickets (awaiting receipt)
 * - GET /pending/by-sku: Find pending tickets by SKU code or barcode
 * - GET /action-queue: Get action queue summary for dashboard
 * - GET /order/:orderId: Get order details for creating a return
 * - GET /:id: Get single request with full details
 * - POST /: Create return request (ticket)
 * - PUT /:id: Update return request (add/update shipping info)
 * - DELETE /:id: Delete return request (only if not yet received)
 * - POST /:id/add-item: Add item to return request
 * - DELETE /:id/items/:lineId: Remove item from return request
 * - POST /:id/cancel: Cancel return request (soft cancel)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import {
    NotFoundError,
    ValidationError,
    BusinessLogicError,
    ConflictError,
} from '../../utils/errors.js';
import { getTierThresholds, calculateTier, getCustomerStatsMap } from '../../utils/tierUtils.js';
import type {
    CreateReturnBody,
    UpdateReturnBody,
} from './types.js';
import { sanitizeSearchInput } from './types.js';

const router: Router = Router();

// ============================================
// LIST & QUERY OPERATIONS
// ============================================

// Get all return requests
router.get('/', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const requestType = req.query.requestType as string | undefined;
    const limit = req.query.limit as string | undefined;
    const limitNum = limit ? Number(limit) : 50;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (requestType) where.requestType = requestType;

    const requests = await req.prisma.returnRequest.findMany({
        where,
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
            shipping: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limitNum,
    });

    // Get customer stats for LTV and tier calculation
    const customerIds = [...new Set(requests.map((r) => r.customerId).filter((id): id is string => Boolean(id)))];
    const [customerStats, thresholds] = await Promise.all([
        getCustomerStatsMap(req.prisma, customerIds),
        getTierThresholds(req.prisma),
    ]);

    const enriched = requests.map((r) => {
        const stats = r.customerId ? customerStats[r.customerId] : null;
        const ltv = stats?.ltv ?? 0;
        const orderCount = stats?.orderCount ?? 0;
        return {
            ...r,
            ageDays: r.originalOrder?.orderDate
                ? Math.floor((Date.now() - new Date(r.originalOrder.orderDate).getTime()) / (1000 * 60 * 60 * 24))
                : Math.floor((Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
            customerLtv: ltv,
            customerOrderCount: orderCount,
            customerTier: calculateTier(ltv, thresholds),
        };
    });

    res.json(enriched);
}));

// Get pending tickets (awaiting receipt)
router.get('/pending', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
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
}));

// Find pending tickets by SKU code or barcode
router.get('/pending/by-sku', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    if (!code) {
        throw new ValidationError('SKU code or barcode is required');
    }

    // HIGH PRIORITY FIX: Sanitize search input
    const sanitizedCode = sanitizeSearchInput(code);
    if (!sanitizedCode) {
        throw new ValidationError('Invalid SKU code format');
    }

    // First find the SKU (skuCode serves as barcode for scanning)
    const sku = await req.prisma.sku.findFirst({
        where: { skuCode: sanitizedCode },
        include: {
            variation: { include: { product: true } },
        },
    });

    if (!sku) {
        throw new NotFoundError('SKU not found', 'SKU', sanitizedCode);
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
            barcode: sku.skuCode, // skuCode serves as barcode for scanning
            productName: sku.variation?.product?.name,
            colorName: sku.variation?.colorName,
            size: sku.size,
            imageUrl: sku.variation?.imageUrl || sku.variation?.product?.imageUrl,
        },
        tickets: enriched,
    });
}));

// Get action queue summary for dashboard
router.get('/action-queue', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    // Get all non-completed/cancelled return requests
    const allRequests = await req.prisma.returnRequest.findMany({
        where: {
            status: { notIn: ['resolved', 'cancelled', 'completed'] },
        },
        include: {
            originalOrder: true,
            customer: true,
            lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
            shipping: true,
        },
        orderBy: { createdAt: 'desc' },
    });

    // Get QC queue (from repacking queue)
    const qcPending = await req.prisma.repackingQueueItem.findMany({
        where: { status: 'pending' },
    });

    // Categorize by status/phase
    const pendingPickup = allRequests.filter((r) => r.status === 'requested' && !r.shipping?.some((s) => s.awbNumber));
    const inTransit = allRequests.filter(
        (r) => r.status === 'in_transit' || (r.status === 'requested' && r.shipping?.some((s) => s.awbNumber && s.direction === 'reverse'))
    );
    const received = allRequests.filter((r) => r.status === 'received');

    // Exchanges ready to ship (reverse in transit but replacement not yet shipped)
    const exchangesReadyToShip = allRequests.filter((r) => {
        const isExchange = r.resolution?.startsWith('exchange') || r.requestType === 'exchange';
        const reverseInTransit = r.reverseInTransitAt || r.status === 'in_transit';
        const notYetShipped = !r.forwardShippedAt && !r.forwardDelivered;
        return isExchange && reverseInTransit && notYetShipped;
    });

    // Refunds pending (item received but refund not processed)
    const refundsPending = allRequests.filter((r) => {
        const isRefund = r.resolution === 'refund' || r.requestType === 'return';
        const itemReceived = r.status === 'received' || r.reverseReceived;
        const noRefundYet = !r.refundAmount && !r.refundProcessedAt;
        return isRefund && itemReceived && noRefundYet;
    });

    // Exchange down refunds pending (item QC passed but difference not refunded)
    const exchangeDownRefundsPending = allRequests.filter((r) => {
        const isExchangeDown = r.resolution === 'exchange_down';
        const itemReceived = r.status === 'received' || r.reverseReceived;
        const noRefundYet = !r.refundAmount && !r.refundProcessedAt;
        return isExchangeDown && itemReceived && noRefundYet && r.valueDifference && Number(r.valueDifference) < 0;
    });

    // Exchange up payments pending
    const exchangeUpPaymentsPending = allRequests.filter((r) => {
        const isExchangeUp = r.resolution === 'exchange_up';
        const noPaymentYet = !r.paymentAmount && !r.paymentCollectedAt;
        return isExchangeUp && noPaymentYet && r.valueDifference && Number(r.valueDifference) > 0;
    });

    res.json({
        summary: {
            pendingPickup: pendingPickup.length,
            inTransit: inTransit.length,
            qcPending: qcPending.length,
            received: received.length,
            exchangesReadyToShip: exchangesReadyToShip.length,
            refundsPending: refundsPending.length,
            exchangeDownRefundsPending: exchangeDownRefundsPending.length,
            exchangeUpPaymentsPending: exchangeUpPaymentsPending.length,
        },
        actions: {
            shipReplacements: exchangesReadyToShip.map((r) => ({
                id: r.id,
                requestNumber: r.requestNumber,
                resolution: r.resolution,
                valueDifference: r.valueDifference,
                customer: r.customer ? { name: `${r.customer.firstName} ${r.customer.lastName}`.trim(), email: r.customer.email } : null,
                originalOrder: r.originalOrder ? { orderNumber: r.originalOrder.orderNumber } : null,
                reverseAwb: r.shipping?.find((s) => s.direction === 'reverse')?.awbNumber,
                createdAt: r.createdAt,
            })),
            processRefunds: refundsPending.map((r) => ({
                id: r.id,
                requestNumber: r.requestNumber,
                resolution: r.resolution,
                returnValue: r.returnValue,
                customer: r.customer ? { name: `${r.customer.firstName} ${r.customer.lastName}`.trim(), email: r.customer.email } : null,
                originalOrder: r.originalOrder ? { orderNumber: r.originalOrder.orderNumber, totalAmount: r.originalOrder.totalAmount } : null,
                lines: r.lines.map((l) => ({
                    skuCode: l.sku?.skuCode,
                    productName: l.sku?.variation?.product?.name,
                    colorName: l.sku?.variation?.colorName,
                    size: l.sku?.size,
                    qty: l.qty,
                    mrp: l.sku?.mrp,
                })),
                createdAt: r.createdAt,
            })),
            collectPayments: exchangeUpPaymentsPending.map((r) => ({
                id: r.id,
                requestNumber: r.requestNumber,
                valueDifference: r.valueDifference,
                customer: r.customer ? { name: `${r.customer.firstName} ${r.customer.lastName}`.trim(), email: r.customer.email } : null,
                originalOrder: r.originalOrder ? { orderNumber: r.originalOrder.orderNumber } : null,
                createdAt: r.createdAt,
            })),
            refundDifferences: exchangeDownRefundsPending.map((r) => ({
                id: r.id,
                requestNumber: r.requestNumber,
                valueDifference: r.valueDifference,
                customer: r.customer ? { name: `${r.customer.firstName} ${r.customer.lastName}`.trim(), email: r.customer.email } : null,
                originalOrder: r.originalOrder ? { orderNumber: r.originalOrder.orderNumber } : null,
                createdAt: r.createdAt,
            })),
        },
        lists: {
            pendingPickup: pendingPickup.slice(0, 10),
            inTransit: inTransit.slice(0, 10),
            received: received.slice(0, 10),
        },
    });
}));

// Get order details for creating a return
router.get('/order/:orderId', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.orderId as string;

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
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    // Try to get cached Shopify data for accurate discounted prices
    // Uses lineItemsJson instead of parsing rawData
    const shopifyLineItems: Record<string, number> = {};
    if (order.orderNumber) {
        const cache = await req.prisma.shopifyOrderCache.findFirst({
            where: { orderNumber: order.orderNumber },
            select: { lineItemsJson: true },
        });
        if (cache?.lineItemsJson) {
            try {
                interface CachedLineItem {
                    sku?: string | null;
                    price?: string | null;
                    quantity?: number;
                    discount_allocations?: Array<{ amount: string }>;
                }
                const lineItems: CachedLineItem[] = JSON.parse(cache.lineItemsJson);
                lineItems.forEach((item) => {
                    if (item.sku) {
                        const originalPrice = parseFloat(item.price || '0') || 0;
                        const discountAllocations = item.discount_allocations || [];
                        const totalDiscount = discountAllocations.reduce(
                            (sum, alloc) => sum + (parseFloat(alloc.amount || '0') || 0),
                            0
                        );
                        const effectivePrice = originalPrice - (totalDiscount / (item.quantity || 1));
                        shopifyLineItems[item.sku] = Math.round(effectivePrice * 100) / 100;
                    }
                });
            } catch (e) {
                console.error('Error parsing Shopify lineItemsJson:', e);
            }
        }
    }

    const items = order.orderLines.map((line) => {
        // Use cached Shopify discounted price if available, otherwise fall back to stored price
        const cachedPrice = line.sku?.skuCode ? shopifyLineItems[line.sku.skuCode] : undefined;
        const effectivePrice = cachedPrice !== undefined ? cachedPrice : (Number(line.unitPrice) || Number(line.sku?.mrp) || 0);

        return {
            orderLineId: line.id,
            skuId: line.sku?.id,
            skuCode: line.sku?.skuCode,
            barcode: line.sku?.skuCode, // skuCode serves as barcode for scanning
            productName: line.sku?.variation?.product?.name,
            colorName: line.sku?.variation?.colorName,
            size: line.sku?.size,
            qty: line.qty,
            unitPrice: effectivePrice,
            imageUrl: line.sku?.variation?.imageUrl || line.sku?.variation?.product?.imageUrl,
        };
    });

    // Get shippedAt and deliveredAt from first shipped/delivered line
    const shippedLine = order.orderLines.find(l => l.shippedAt);
    const deliveredLine = order.orderLines.find(l => l.deliveredAt);

    res.json({
        id: order.id,
        orderNumber: order.orderNumber,
        shopifyOrderNumber: order.shopifyOrderId, // Use shopifyOrderId as order number
        orderDate: order.orderDate,
        shippedAt: shippedLine?.shippedAt || null,
        deliveredAt: deliveredLine?.deliveredAt || null,
        customer: order.customer ? {
            id: order.customer.id,
            name: `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() || order.customer.email,
            email: order.customer.email,
            phone: order.customer.phone,
        } : null,
        items,
    });
}));

// Get single request
router.get('/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
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
    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }
    res.json(request);
}));

// ============================================
// CREATE & UPDATE OPERATIONS
// ============================================

// Create return request (ticket)
router.post('/', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const {
        requestType, // 'return' or 'exchange'
        resolution, // 'refund', 'exchange_same', 'exchange_up', 'exchange_down'
        originalOrderId,
        reasonCategory,
        reasonDetails,
        lines, // [{ skuId, qty, exchangeSkuId?, unitPrice? }]
        returnValue,
        replacementValue,
        valueDifference,
        courier,
        awbNumber,
    } = req.body as CreateReturnBody;

    // Derive resolution from requestType if not provided
    const effectiveResolution = resolution || (requestType === 'exchange' ? 'exchange_same' : 'refund');

    // Validate required fields
    if (!reasonCategory) {
        throw new ValidationError('reasonCategory is required');
    }

    // Validate order
    const order = await req.prisma.order.findUnique({
        where: { id: originalOrderId },
        include: { customer: true },
    });
    if (!order) {
        throw new NotFoundError('Order not found', 'Order', originalOrderId);
    }

    // Validate lines
    if (!lines || lines.length === 0) {
        throw new ValidationError('At least one item is required');
    }

    // CUSTOMIZATION CHECK: Block returns for non-returnable (customized) items
    const skuIds = lines.map((l) => l.skuId);

    // Get order lines with their return eligibility status
    const orderLinesWithSkus = await req.prisma.orderLine.findMany({
        where: {
            orderId: originalOrderId,
            skuId: { in: skuIds }
        },
        include: {
            sku: { select: { skuCode: true, isCustomSku: true } }
        }
    });

    // Check for non-returnable items
    interface NonReturnableItem {
        skuCode: string | undefined;
        skuId: string;
        reason: string;
    }
    const nonReturnableItems: NonReturnableItem[] = [];
    for (const lineData of lines) {
        const orderLine = orderLinesWithSkus.find(ol => ol.skuId === lineData.skuId);

        if (orderLine?.isNonReturnable) {
            nonReturnableItems.push({
                skuCode: orderLine.sku?.skuCode,
                skuId: lineData.skuId,
                reason: 'customized'
            });
        }
    }

    if (nonReturnableItems.length > 0) {
        throw new BusinessLogicError(
            'Customized items cannot be returned',
            'NON_RETURNABLE_ITEMS'
        );
    }

    // Check for duplicate items - items from this order already in an active ticket
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
        interface DuplicateSku {
            skuCode: string | undefined;
            ticketNumber: string;
            ticketId: string;
        }
        const duplicateSkus: DuplicateSku[] = [];
        for (const ticket of existingTickets) {
            for (const line of ticket.lines) {
                duplicateSkus.push({
                    skuCode: line.sku?.skuCode,
                    ticketNumber: ticket.requestNumber,
                    ticketId: ticket.id,
                });
            }
        }
        throw new ConflictError(
            'Some items are already in an active return ticket',
            'DUPLICATE_RETURN_ITEMS'
        );
    }

    // Generate unique request number - find max number and increment
    const year = new Date().getFullYear();
    const lastRequest = await req.prisma.returnRequest.findFirst({
        where: { requestNumber: { startsWith: `RET-${year}-` } },
        orderBy: { requestNumber: 'desc' },
        select: { requestNumber: true },
    });
    let nextNumber = 1;
    if (lastRequest) {
        const match = lastRequest.requestNumber.match(/RET-\d{4}-(\d+)/);
        if (match) nextNumber = parseInt(match[1], 10) + 1;
    }
    const requestNumber = `RET-${year}-${String(nextNumber).padStart(4, '0')}`;

    // Determine initial status
    const hasShipping = courier && awbNumber;
    const initialStatus = hasShipping ? 'reverse_initiated' : 'requested';

    const request = await req.prisma.$transaction(async (tx) => {
        // Create return request
        const returnRequest = await tx.returnRequest.create({
            data: {
                requestNumber,
                requestType,
                resolution: effectiveResolution,
                originalOrderId,
                customerId: order.customerId,
                reasonCategory,
                reasonDetails,
                status: initialStatus,
                returnValue: returnValue || null,
                replacementValue: replacementValue || null,
                valueDifference: valueDifference || null,
                lines: {
                    create: lines.map((l) => ({
                        skuId: l.skuId,
                        qty: l.qty || 1,
                        unitPrice: l.unitPrice || null,
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
                    courier: courier!,
                    awbNumber: awbNumber!,
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
                changedById: req.user!.id,
                notes: hasShipping ? `Created with reverse pickup AWB: ${awbNumber}` : 'Created - awaiting reverse pickup',
            },
        });

        return returnRequest;
    }, { timeout: 15000 }); // 15 second timeout

    res.status(201).json(request);
}));

// Update return request (add/update shipping info)
router.put('/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { courier, awbNumber, reasonCategory, reasonDetails } = req.body as UpdateReturnBody;

    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            shipping: true,
            lines: true,
        },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    // HIGH PRIORITY FIX: Check if any items have been received
    const hasReceivedItems = request.lines.some((l) => l.itemCondition !== null);

    await req.prisma.$transaction(async (tx) => {
        // Update request details
        const updateData: Record<string, unknown> = {};

        // HIGH PRIORITY FIX: Lock reason after first item received
        if (reasonCategory && reasonCategory !== request.reasonCategory) {
            if (hasReceivedItems) {
                throw new BusinessLogicError('Cannot change reason after items have been received', 'REASON_LOCKED');
            }
            updateData.reasonCategory = reasonCategory;
        }

        if (reasonDetails !== undefined) {
            // Allow details update even after receiving (for additional notes)
            updateData.reasonDetails = reasonDetails;
        }

        if (Object.keys(updateData).length > 0) {
            await tx.returnRequest.update({
                where: { id },
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
            } else if (courier && awbNumber) {
                // Only create new shipping record if both courier and AWB are provided
                await tx.returnShipping.create({
                    data: {
                        requestId: id,
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
                    where: { id },
                    data: { status: 'reverse_initiated' },
                });

                await tx.returnStatusHistory.create({
                    data: {
                        requestId: id,
                        fromStatus: request.status,
                        toStatus: 'reverse_initiated',
                        changedById: req.user!.id,
                        notes: `Reverse pickup AWB added: ${awbNumber}`,
                    },
                });
            }
        }
    });

    // Fetch updated request
    const updated = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            originalOrder: true,
            customer: true,
            lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
            shipping: true,
        },
    });

    res.json(updated);
}));

// ============================================
// DELETE & CANCEL OPERATIONS
// ============================================

// Delete return request (only if not yet received)
router.delete('/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            lines: true,
            shipping: true,
            statusHistory: true,
        },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    // Only allow deletion if no items have been received yet
    const hasReceivedItems = request.lines.some((l) => l.itemCondition !== null);
    if (hasReceivedItems) {
        throw new BusinessLogicError(
            'Cannot delete - some items have already been received. Cancel the request instead.',
            'HAS_RECEIVED_ITEMS'
        );
    }

    // Don't allow deletion of resolved tickets
    if (request.status === 'resolved') {
        throw new BusinessLogicError('Cannot delete a resolved return request', 'ALREADY_RESOLVED');
    }

    // CRITICAL FIX: Check for processed repacking items that would orphan inventory
    const processedRepackingItems = await req.prisma.repackingQueueItem.findMany({
        where: {
            returnRequestId: request.id,
            status: { in: ['ready', 'write_off'] },
        },
    });

    if (processedRepackingItems.length > 0) {
        throw new BusinessLogicError(
            'Cannot delete - some items have been processed in the QC queue. Cancel the request instead.',
            'HAS_PROCESSED_ITEMS'
        );
    }

    // Delete in transaction (cascade delete related records)
    await req.prisma.$transaction(async (tx) => {
        // CRITICAL FIX: Delete any repacking queue items (unprocessed ones)
        await tx.repackingQueueItem.deleteMany({
            where: { returnRequestId: request.id },
        });

        // Delete status history
        await tx.returnStatusHistory.deleteMany({
            where: { requestId: request.id },
        });

        // Delete shipping records
        await tx.returnShipping.deleteMany({
            where: { requestId: request.id },
        });

        // Delete replacement items (for exchanges)
        await tx.replacementItem.deleteMany({
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
}));

// Add item to return request (from original order)
router.post('/:id/add-item', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { skuId, qty = 1 } = req.body as { skuId?: string; qty?: number };

    if (!skuId) {
        throw new ValidationError('skuId is required');
    }

    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            lines: true,
            originalOrder: {
                include: {
                    orderLines: {
                        include: {
                            sku: true,
                        },
                    },
                },
            },
        },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    // Check if request is in a modifiable state
    if (['resolved', 'cancelled'].includes(request.status)) {
        throw new BusinessLogicError('Cannot modify a resolved or cancelled return request', 'REQUEST_NOT_MODIFIABLE');
    }

    // Check if SKU is from the original order
    const orderLine = request.originalOrder?.orderLines.find((l) => l.skuId === skuId);
    if (!orderLine) {
        throw new ValidationError('This SKU is not from the original order');
    }

    // Check if item is already in the return request
    const existingLine = request.lines.find((l) => l.skuId === skuId);
    if (existingLine) {
        throw new ConflictError('This item is already in the return request', 'DUPLICATE_ITEM');
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
}));

// Remove item from return request
router.delete('/:id/items/:lineId', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const lineId = req.params.lineId as string;

    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            lines: true,
        },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    // Check if request is in a modifiable state
    if (['resolved', 'cancelled'].includes(request.status)) {
        throw new BusinessLogicError('Cannot modify a resolved or cancelled return request', 'REQUEST_NOT_MODIFIABLE');
    }

    // Find the line to delete
    const lineToDelete = request.lines.find((l) => l.id === lineId);
    if (!lineToDelete) {
        throw new NotFoundError('Item not found in return request', 'ReturnRequestLine', lineId);
    }

    // Check if item has been received
    if (lineToDelete.itemCondition) {
        throw new BusinessLogicError('Cannot remove an item that has already been received', 'ITEM_ALREADY_RECEIVED');
    }

    // Don't allow removing the last item
    if (request.lines.length <= 1) {
        throw new BusinessLogicError('Cannot remove the last item. Delete the entire return request instead.', 'LAST_ITEM');
    }

    // Delete the line
    await req.prisma.returnRequestLine.delete({
        where: { id: lineId },
    });

    res.json({ success: true, message: 'Item removed from return request' });
}));

// Cancel return request (soft cancel - keeps record but marks as cancelled)
router.post('/:id/cancel', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { reason } = req.body as { reason?: string };

    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    if (request.status === 'resolved' || request.status === 'cancelled') {
        throw new BusinessLogicError(`Cannot cancel - request is already ${request.status}`, 'ALREADY_TERMINAL');
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
                changedById: req.user!.id,
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
}));

export default router;
