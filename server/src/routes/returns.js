import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
    NotFoundError,
    ValidationError,
    BusinessLogicError,
    ConflictError,
} from '../utils/errors.js';
import { getTierThresholds, calculateTier, getCustomerStatsMap } from '../utils/tierUtils.js';

const router = Router();

// ============================================
// STATUS TRANSITION VALIDATION (State Machine)
// ============================================

/**
 * Valid status transitions for return requests
 * Key = current status, Value = array of allowed next statuses
 */
const VALID_STATUS_TRANSITIONS = {
    'requested': ['reverse_initiated', 'in_transit', 'cancelled'],
    'reverse_initiated': ['in_transit', 'received', 'cancelled'],
    'in_transit': ['received', 'cancelled'],
    'received': ['processing', 'resolved', 'cancelled', 'reverse_initiated'], // reverse_initiated for undo
    'processing': ['resolved', 'cancelled'],
    'resolved': [], // Terminal state - no transitions allowed
    'cancelled': [], // Terminal state - no transitions allowed
    'completed': [], // Terminal state - no transitions allowed
};

/**
 * Validates if a status transition is allowed
 * @param {string} fromStatus - Current status
 * @param {string} toStatus - Target status
 * @returns {boolean} - Whether transition is valid
 */
function isValidStatusTransition(fromStatus, toStatus) {
    // Allow same status (no-op)
    if (fromStatus === toStatus) return true;

    // Special case for 'new' (initial state during creation)
    if (fromStatus === 'new') return true;

    const allowedTransitions = VALID_STATUS_TRANSITIONS[fromStatus];
    if (!allowedTransitions) return false;

    return allowedTransitions.includes(toStatus);
}

/**
 * Sanitizes search input to prevent SQL injection and special character issues
 * @param {string} input - User input to sanitize
 * @returns {string} - Sanitized input
 */
function sanitizeSearchInput(input) {
    if (!input || typeof input !== 'string') return '';
    // Remove SQL special characters and escape sequences
    return input
        .replace(/['"\\;%_]/g, '') // Remove quotes, backslash, semicolon, wildcards
        .replace(/--/g, '') // Remove SQL comments
        .trim()
        .slice(0, 100); // Limit length
}

// ============================================
// RETURN REQUESTS (TICKETS)
// ============================================

// Get all return requests
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
    const { status, requestType, limit = 50 } = req.query;
        const where = {};
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
}));

// Get pending tickets (awaiting receipt)
router.get('/pending', authenticateToken, asyncHandler(async (req, res) => {
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
router.get('/pending/by-sku', authenticateToken, asyncHandler(async (req, res) => {
    const { code } = req.query;
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
            barcode: sku.barcode,
            productName: sku.variation?.product?.name,
            colorName: sku.variation?.colorName,
            size: sku.size,
            imageUrl: sku.variation?.imageUrl || sku.variation?.product?.imageUrl,
        },
        tickets: enriched,
    });
}));

// ============================================
// ACTION QUEUE DASHBOARD
// ============================================

// Get action queue summary for dashboard
router.get('/action-queue', authenticateToken, asyncHandler(async (req, res) => {
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
            return isExchangeDown && itemReceived && noRefundYet && r.valueDifference && r.valueDifference < 0;
        });

        // Exchange up payments pending
        const exchangeUpPaymentsPending = allRequests.filter((r) => {
            const isExchangeUp = r.resolution === 'exchange_up';
            const noPaymentYet = !r.paymentAmount && !r.paymentCollectedAt;
            return isExchangeUp && noPaymentYet && r.valueDifference && r.valueDifference > 0;
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
router.get('/order/:orderId', authenticateToken, asyncHandler(async (req, res) => {
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
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    // Try to get cached Shopify data for accurate discounted prices
        let shopifyLineItems = {};
        if (order.orderNumber) {
            const cache = await req.prisma.shopifyOrderCache.findFirst({
                where: { orderNumber: order.orderNumber },
            });
            if (cache?.rawData) {
                try {
                    const rawData = typeof cache.rawData === 'string' ? JSON.parse(cache.rawData) : cache.rawData;
                    // Build lookup by SKU code for matching
                    (rawData.line_items || []).forEach((item) => {
                        if (item.sku) {
                            const originalPrice = parseFloat(item.price) || 0;
                            const discountAllocations = item.discount_allocations || [];
                            const totalDiscount = discountAllocations.reduce(
                                (sum, alloc) => sum + (parseFloat(alloc.amount) || 0),
                                0
                            );
                            const effectivePrice = originalPrice - (totalDiscount / item.quantity);
                            shopifyLineItems[item.sku] = Math.round(effectivePrice * 100) / 100;
                        }
                    });
                } catch (e) {
                    console.error('Error parsing Shopify cache:', e);
                }
            }
        }

        const items = order.orderLines.map((line) => {
            // Use cached Shopify discounted price if available, otherwise fall back to stored price
            const cachedPrice = shopifyLineItems[line.sku.skuCode];
            const effectivePrice = cachedPrice !== undefined ? cachedPrice : (line.unitPrice || line.sku.mrp || 0);

            return {
                orderLineId: line.id,
                skuId: line.sku.id,
                skuCode: line.sku.skuCode,
                barcode: line.sku.barcode,
                productName: line.sku.variation?.product?.name,
                colorName: line.sku.variation?.colorName,
                size: line.sku.size,
                qty: line.qty,
                unitPrice: effectivePrice,
                imageUrl: line.sku.variation?.imageUrl || line.sku.variation?.product?.imageUrl,
            };
        });

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
}));

// Get single request
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
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
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }
    res.json(request);
}));

// Create return request (ticket)
router.post('/', authenticateToken, asyncHandler(async (req, res) => {
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
    } = req.body;

    // Derive resolution from requestType if not provided
    const effectiveResolution = resolution || (requestType === 'exchange' ? 'exchange_same' : 'refund');

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
        const nonReturnableItems = [];
        for (const lineData of lines) {
            const orderLine = orderLinesWithSkus.find(ol => ol.skuId === lineData.skuId);

            if (orderLine?.isNonReturnable) {
                nonReturnableItems.push({
                    skuCode: orderLine.sku.skuCode,
                    skuId: lineData.skuId,
                    reason: 'customized'
                });
            }
        }

    if (nonReturnableItems.length > 0) {
        throw new BusinessLogicError(
            'Customized items cannot be returned',
            'NON_RETURNABLE_ITEMS',
            { nonReturnableItems, isCustomized: true, hint: 'These items were customized for this order and are non-returnable' }
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
        throw new ConflictError(
            'Some items are already in an active return ticket',
            'DUPLICATE_RETURN_ITEMS',
            { duplicates: duplicateSkus }
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
}));

// Update return request (add/update shipping info)
router.put('/:id', authenticateToken, asyncHandler(async (req, res) => {
    const { courier, awbNumber, reasonCategory, reasonDetails } = req.body;

    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        include: {
            shipping: true,
            lines: true,
        },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }

    // HIGH PRIORITY FIX: Check if any items have been received
    const hasReceivedItems = request.lines.some((l) => l.itemCondition !== null);

    await req.prisma.$transaction(async (tx) => {
        // Update request details
        const updateData = {};

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
}));

// Delete return request (only if not yet received)
router.delete('/:id', authenticateToken, asyncHandler(async (req, res) => {
    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        include: {
            lines: true,
            shipping: true,
            statusHistory: true,
        },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
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
            'HAS_PROCESSED_ITEMS',
            { processedItems: processedRepackingItems.length }
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
router.post('/:id/add-item', authenticateToken, asyncHandler(async (req, res) => {
    const { skuId, qty = 1 } = req.body;

    if (!skuId) {
        throw new ValidationError('skuId is required');
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
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }

    // Check if request is in a modifiable state
    if (['resolved', 'cancelled'].includes(request.status)) {
        throw new BusinessLogicError('Cannot modify a resolved or cancelled return request', 'REQUEST_NOT_MODIFIABLE');
    }

    // Check if SKU is from the original order
    const orderLine = request.originalOrder?.lines.find((l) => l.skuId === skuId);
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
router.delete('/:id/items/:lineId', authenticateToken, asyncHandler(async (req, res) => {
    const { id, lineId } = req.params;

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
router.post('/:id/cancel', authenticateToken, asyncHandler(async (req, res) => {
    const { reason } = req.body;

    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
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
}));

// ============================================
// RECEIVE ITEMS (Return Inward)
// ============================================

// Receive a specific line item from a ticket
router.post('/:id/receive-item', authenticateToken, asyncHandler(async (req, res) => {
    const { lineId, condition } = req.body;

    // Validate condition
    const validConditions = ['good', 'used', 'damaged', 'wrong_product'];
    if (!validConditions.includes(condition)) {
        throw new ValidationError('Invalid condition. Must be: good, used, damaged, or wrong_product');
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
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }

    const line = request.lines.find((l) => l.id === lineId);
    if (!line) {
        throw new NotFoundError('Return line not found', 'ReturnRequestLine', lineId);
    }

    if (line.itemCondition) {
        throw new ConflictError('Item already received', 'ALREADY_RECEIVED');
    }

        const result = await req.prisma.$transaction(async (tx) => {
            // CRITICAL FIX: Use optimistic locking - verify line is still unreceived inside transaction
            const freshLine = await tx.returnRequestLine.findUnique({
                where: { id: lineId },
            });

            if (!freshLine) {
                throw new ConflictError('Return line not found', 'LINE_NOT_FOUND');
            }

            if (freshLine.itemCondition !== null) {
                throw new ConflictError('Item already received by another user', 'ALREADY_RECEIVED');
            }

            // Update line with condition
            await tx.returnRequestLine.update({
                where: { id: lineId },
                data: { itemCondition: condition },
            });

            // Check if repacking queue item already exists (prevent duplicate)
            const existingRepackingItem = await tx.repackingQueueItem.findFirst({
                where: { returnLineId: lineId },
            });

            if (existingRepackingItem) {
                throw new ConflictError('Item already in repacking queue', 'ALREADY_IN_QUEUE');
            }

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

            // Re-fetch lines inside transaction to avoid race condition
            // (concurrent receives could both see stale data otherwise)
            const updatedLines = await tx.returnRequestLine.findMany({
                where: { requestId: request.id }
            });
            const allLinesReceived = updatedLines.every((l) => l.itemCondition !== null);

            // Build condition summary for notes
            const conditionLabels = {
                'good': 'Good Condition - Item is in resellable condition',
                'used': 'Used / Worn - Item shows signs of use',
                'damaged': 'Damaged - Item is damaged',
                'wrong_product': 'Wrong Product - Different item than expected',
            };
            const conditionNote = conditionLabels[condition] || condition;

            if (allLinesReceived) {
                // Build update data - mark status received
                const updateData = { status: 'received' };

                // For exchanges, also mark reverseReceived
                if (request.requestType === 'exchange') {
                    updateData.reverseReceived = true;
                    updateData.reverseReceivedAt = new Date();
                }

                await tx.returnRequest.update({
                    where: { id: request.id },
                    data: updateData,
                });

                await tx.returnStatusHistory.create({
                    data: {
                        requestId: request.id,
                        fromStatus: request.status,
                        toStatus: 'received',
                        changedById: req.user.id,
                        notes: `All items received. Condition: ${conditionNote}`,
                    },
                });

                // Update shipping status
                await tx.returnShipping.updateMany({
                    where: { requestId: request.id, direction: 'reverse' },
                    data: { status: 'delivered', receivedAt: new Date(), notes: conditionNote },
                });

                // Check auto-resolve for exchanges
                if (request.requestType === 'exchange' && request.forwardDelivered) {
                    await tx.returnRequest.update({
                        where: { id: request.id },
                        data: { status: 'resolved' },
                    });
                    await tx.returnStatusHistory.create({
                        data: {
                            requestId: request.id,
                            fromStatus: 'received',
                            toStatus: 'resolved',
                            changedById: req.user.id,
                            notes: 'Exchange auto-resolved: both reverse received and forward delivered',
                        },
                    });
                }
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
}));

// Undo receive - remove item from QC queue and clear received status
router.post('/:id/undo-receive', authenticateToken, asyncHandler(async (req, res) => {
    const { lineId } = req.body;

    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        include: {
            lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
            customer: true,
        },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }

    const line = request.lines.find((l) => l.id === lineId);
    if (!line) {
        throw new NotFoundError('Return line not found', 'ReturnRequestLine', lineId);
    }

    if (!line.itemCondition) {
        throw new BusinessLogicError('Item has not been received yet', 'NOT_RECEIVED');
    }

    // Find the repacking queue item for this line
    const repackingItem = await req.prisma.repackingQueueItem.findFirst({
        where: { returnLineId: lineId },
    });

    if (repackingItem && (repackingItem.status === 'ready' || repackingItem.status === 'write_off')) {
        throw new BusinessLogicError(
            'Cannot undo - item has already been processed (added to stock or written off)',
            'ALREADY_PROCESSED'
        );
    }

        await req.prisma.$transaction(async (tx) => {
            // CRITICAL FIX: Delete any inventory transactions created for this repacking item
            // This handles the case where the item was processed (added to stock) but we still need to undo
            if (repackingItem) {
                // Delete inventory transactions that reference this repacking queue item
                await tx.inventoryTransaction.deleteMany({
                    where: {
                        referenceId: repackingItem.id,
                        reason: 'return_receipt',
                    },
                });

                // Also delete any write-off logs if the item was written off
                await tx.writeOffLog.deleteMany({
                    where: { sourceId: repackingItem.id },
                });

                // Delete the repacking queue item
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
}));

// ============================================
// STATUS UPDATES
// ============================================

router.post('/:id/initiate-reverse', authenticateToken, asyncHandler(async (req, res) => {
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
}));

router.post('/:id/mark-received', authenticateToken, asyncHandler(async (req, res) => {
    await req.prisma.returnShipping.updateMany({
        where: { requestId: req.params.id, direction: 'reverse' },
        data: { status: 'delivered', receivedAt: new Date() },
    });
    await updateStatus(req.prisma, req.params.id, 'received', req.user.id);
    res.json({ success: true });
}));

router.post('/:id/resolve', authenticateToken, asyncHandler(async (req, res) => {
    const { resolutionType, resolutionNotes, refundAmount } = req.body;
    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        include: { lines: true },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }

    // CRITICAL FIX: Validate status transition
    if (!isValidStatusTransition(request.status, 'resolved')) {
        throw new BusinessLogicError(
            `Cannot resolve from status '${request.status}'. Must be in 'received' or 'processing' status first.`,
            'INVALID_STATUS_TRANSITION'
        );
    }

    // CRITICAL FIX: Validate all lines are received (have itemCondition set)
    const unreceivedLines = request.lines.filter((l) => l.itemCondition === null);
    if (unreceivedLines.length > 0) {
        throw new BusinessLogicError(
            `Cannot resolve - ${unreceivedLines.length} item(s) have not been received yet. All items must be received before resolving.`,
            'UNRECEIVED_ITEMS',
            { unreceived: unreceivedLines.length }
        );
    }

    // CRITICAL FIX: Validate refund amount doesn't exceed original value
    if (refundAmount !== undefined && refundAmount !== null) {
        const maxRefundAmount = request.lines.reduce((sum, line) => {
            const linePrice = line.unitPrice || 0;
            return sum + (linePrice * line.qty);
        }, 0);

        if (refundAmount > maxRefundAmount) {
            throw new ValidationError(
                `Refund amount (${refundAmount}) exceeds maximum allowed (${maxRefundAmount})`,
                { maxAllowed: maxRefundAmount }
            );
        }
    }

        await req.prisma.$transaction(async (tx) => {
            const updateData = {
                status: 'resolved',
                resolutionType,
                resolutionNotes,
            };

            // Set refund amount if provided
            if (refundAmount !== undefined) {
                updateData.refundAmount = refundAmount;
                updateData.refundProcessedAt = new Date();
            }

            await tx.returnRequest.update({
                where: { id: req.params.id },
                data: updateData,
            });

            // Add status history
            await tx.returnStatusHistory.create({
                data: {
                    requestId: req.params.id,
                    fromStatus: request.status,
                    toStatus: 'resolved',
                    changedById: req.user.id,
                    notes: resolutionNotes || `Resolved with type: ${resolutionType || 'none'}`,
                },
            });

            // Note: Inventory transactions are now handled by the repacking queue process
            // This legacy code is kept for backward compatibility with old tickets
            // that may not have gone through the repacking queue
            const processedViaRepacking = await tx.repackingQueueItem.findMany({
                where: { returnRequestId: request.id },
            });

            // Only create inventory transactions if NOT processed via repacking queue
            if (processedViaRepacking.length === 0) {
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
            }
        });
    res.json({ success: true });
}));

router.post('/:id/cancel-simple', authenticateToken, asyncHandler(async (req, res) => {
    const { reason } = req.body;
    await updateStatus(req.prisma, req.params.id, 'cancelled', req.user.id, reason);
    res.json({ success: true });
}));

// ============================================
// ANALYTICS
// ============================================

router.get('/analytics/by-product', authenticateToken, asyncHandler(async (req, res) => {
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
}));

// ============================================
// EXCHANGE ORDER LINKING
// ============================================

// Link exchange ticket to replacement order
router.put('/:id/link-exchange-order', authenticateToken, asyncHandler(async (req, res) => {
    const { orderId } = req.body;

    if (!orderId) {
        throw new ValidationError('orderId is required');
    }

    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }

    if (request.requestType !== 'exchange') {
        throw new BusinessLogicError('Only exchange requests can be linked to orders', 'NOT_EXCHANGE');
    }

    // Verify order exists
    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    // Check if order is already linked to another exchange
    const existingLink = await req.prisma.returnRequest.findFirst({
        where: {
            exchangeOrderId: orderId,
            id: { not: req.params.id },
        },
    });

    if (existingLink) {
        throw new ConflictError(
            `This order is already linked to exchange ${existingLink.requestNumber}`,
            'ALREADY_LINKED'
        );
    }

        await req.prisma.$transaction(async (tx) => {
            await tx.returnRequest.update({
                where: { id: req.params.id },
                data: { exchangeOrderId: orderId },
            });

            await tx.returnStatusHistory.create({
                data: {
                    requestId: req.params.id,
                    fromStatus: request.status,
                    toStatus: request.status,
                    changedById: req.user.id,
                    notes: `Linked to exchange order ${order.orderNumber}`,
                },
            });
        });

        const updated = await req.prisma.returnRequest.findUnique({
            where: { id: req.params.id },
            include: {
                originalOrder: true,
                exchangeOrder: true,
                customer: true,
                lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
                shipping: true,
            },
        });

    res.json(updated);
}));

// Unlink exchange order (undo)
router.put('/:id/unlink-exchange-order', authenticateToken, asyncHandler(async (req, res) => {
    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        include: { exchangeOrder: true },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }

    if (!request.exchangeOrderId) {
        throw new BusinessLogicError('No exchange order linked', 'NO_LINKED_ORDER');
    }

    const orderNumber = request.exchangeOrder?.orderNumber;

    await req.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({
            where: { id: req.params.id },
            data: { exchangeOrderId: null },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: req.params.id,
                fromStatus: request.status,
                toStatus: request.status,
                changedById: req.user.id,
                notes: `Unlinked exchange order ${orderNumber}`,
            },
        });
    });

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
}));

// ============================================
// EXCHANGE SHIPMENT TRACKING
// ============================================

// Helper to check auto-resolution
async function checkAutoResolve(tx, requestId, userId) {
    const request = await tx.returnRequest.findUnique({
        where: { id: requestId },
    });

    if (request.reverseReceived && request.forwardDelivered && request.status !== 'resolved') {
        await tx.returnRequest.update({
            where: { id: requestId },
            data: { status: 'resolved', resolutionType: 'exchange' },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId,
                fromStatus: request.status,
                toStatus: 'resolved',
                changedById: userId,
                notes: 'Auto-resolved: both reverse received and forward delivered',
            },
        });

        return true;
    }
    return false;
}

// Mark reverse shipment received
router.put('/:id/mark-reverse-received', authenticateToken, asyncHandler(async (req, res) => {
    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }

    if (request.reverseReceived) {
        throw new BusinessLogicError('Reverse shipment already marked as received', 'ALREADY_RECEIVED');
    }

    let autoResolved = false;
    await req.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({
            where: { id: req.params.id },
            data: {
                reverseReceived: true,
                reverseReceivedAt: new Date(),
            },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: req.params.id,
                fromStatus: request.status,
                toStatus: request.status,
                changedById: req.user.id,
                notes: 'Marked reverse shipment as received',
            },
        });

        autoResolved = await checkAutoResolve(tx, req.params.id, req.user.id);
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            shipping: true,
        },
    });

    res.json({ ...updated, autoResolved });
}));

// Unmark reverse received (undo)
router.put('/:id/unmark-reverse-received', authenticateToken, asyncHandler(async (req, res) => {
    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }

    if (!request.reverseReceived) {
        throw new BusinessLogicError('Reverse shipment not marked as received', 'NOT_RECEIVED');
    }

    // If already resolved, need to un-resolve
    const wasResolved = request.status === 'resolved';

    await req.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({
            where: { id: req.params.id },
            data: {
                reverseReceived: false,
                reverseReceivedAt: null,
                status: wasResolved ? 'in_transit' : request.status,
            },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: req.params.id,
                fromStatus: request.status,
                toStatus: wasResolved ? 'in_transit' : request.status,
                changedById: req.user.id,
                notes: 'Undo: unmarked reverse shipment as received',
            },
        });
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            shipping: true,
        },
    });

    res.json(updated);
}));

// Mark forward shipment delivered
router.put('/:id/mark-forward-delivered', authenticateToken, asyncHandler(async (req, res) => {
    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }

    if (request.requestType !== 'exchange') {
        throw new BusinessLogicError('Only exchange requests can have forward delivery', 'NOT_EXCHANGE');
    }

    if (request.forwardDelivered) {
        throw new BusinessLogicError('Forward shipment already marked as delivered', 'ALREADY_DELIVERED');
    }

    let autoResolved = false;
    await req.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({
            where: { id: req.params.id },
            data: {
                forwardDelivered: true,
                forwardDeliveredAt: new Date(),
            },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: req.params.id,
                fromStatus: request.status,
                toStatus: request.status,
                changedById: req.user.id,
                notes: 'Marked forward shipment as delivered',
            },
        });

        autoResolved = await checkAutoResolve(tx, req.params.id, req.user.id);
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            shipping: true,
        },
    });

    res.json({ ...updated, autoResolved });
}));

// Unmark forward delivered (undo)
router.put('/:id/unmark-forward-delivered', authenticateToken, asyncHandler(async (req, res) => {
    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }

    if (!request.forwardDelivered) {
        throw new BusinessLogicError('Forward shipment not marked as delivered', 'NOT_DELIVERED');
    }

    // If already resolved, need to un-resolve
    const wasResolved = request.status === 'resolved';

    await req.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({
            where: { id: req.params.id },
            data: {
                forwardDelivered: false,
                forwardDeliveredAt: null,
                status: wasResolved ? 'in_transit' : request.status,
            },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: req.params.id,
                fromStatus: request.status,
                toStatus: wasResolved ? 'in_transit' : request.status,
                changedById: req.user.id,
                notes: 'Undo: unmarked forward shipment as delivered',
            },
        });
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            shipping: true,
        },
    });

    res.json(updated);
}));

// ============================================
// EARLY-SHIP LOGIC FOR EXCHANGES
// ============================================

// Mark reverse shipment as in-transit (enables early shipping of replacement)
router.put('/:id/mark-reverse-in-transit', authenticateToken, asyncHandler(async (req, res) => {
    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        include: { shipping: true },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }

    if (request.reverseInTransitAt) {
        throw new BusinessLogicError('Reverse shipment already marked as in-transit', 'ALREADY_IN_TRANSIT');
    }

    // Check if there's a reverse shipping record with AWB
    const reverseShipping = request.shipping?.find((s) => s.direction === 'reverse' && s.awbNumber);
    if (!reverseShipping) {
        throw new BusinessLogicError('No reverse pickup AWB found. Add reverse shipping details first.', 'NO_REVERSE_AWB');
    }

    await req.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({
            where: { id: req.params.id },
            data: {
                reverseInTransitAt: new Date(),
                status: 'in_transit',
            },
        });

        // Update shipping status
        await tx.returnShipping.update({
            where: { id: reverseShipping.id },
            data: { status: 'in_transit' },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: req.params.id,
                fromStatus: request.status,
                toStatus: 'in_transit',
                changedById: req.user.id,
                notes: 'Reverse pickup confirmed in-transit. Exchange replacement can now be shipped.',
            },
        });
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            shipping: true,
        },
    });

    res.json(updated);
}));

// Ship replacement (for exchanges - can be done when reverse is in-transit)
router.put('/:id/ship-replacement', authenticateToken, asyncHandler(async (req, res) => {
    const { courier, awbNumber, notes } = req.body;

    if (!courier || !awbNumber) {
        throw new ValidationError('Courier and AWB number are required');
    }

    const request = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        include: { shipping: true },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', req.params.id);
    }

    // Check if this is an exchange
    const isExchange = request.resolution?.startsWith('exchange') || request.requestType === 'exchange';
    if (!isExchange) {
        throw new BusinessLogicError('This is not an exchange request', 'NOT_EXCHANGE');
    }

    // Check if replacement already shipped
    if (request.forwardShippedAt) {
        throw new BusinessLogicError('Replacement has already been shipped', 'ALREADY_SHIPPED');
    }

    // Check if reverse is at least in-transit (allows early shipping)
    const reverseInTransit = request.reverseInTransitAt || request.status === 'in_transit';
    if (!reverseInTransit) {
        throw new BusinessLogicError('Reverse pickup must be confirmed in-transit before shipping replacement', 'REVERSE_NOT_IN_TRANSIT');
    }

    await req.prisma.$transaction(async (tx) => {
        // Create forward shipping record
        await tx.returnShipping.create({
            data: {
                requestId: req.params.id,
                direction: 'forward',
                courier,
                awbNumber,
                status: 'shipped',
                shippedAt: new Date(),
            },
        });

        // Update request with forward shipped timestamp
        await tx.returnRequest.update({
            where: { id: req.params.id },
            data: {
                forwardShippedAt: new Date(),
            },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId: req.params.id,
                fromStatus: request.status,
                toStatus: request.status,
                changedById: req.user.id,
                notes: notes || `Replacement shipped via ${courier} (AWB: ${awbNumber})`,
            },
        });
    });

    const updated = await req.prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        include: {
            originalOrder: true,
            exchangeOrder: true,
            customer: true,
            shipping: true,
        },
    });

    res.json(updated);
}));

// ============================================
// HELPERS
// ============================================

/**
 * Updates status with state machine validation
 * @throws {Error} If transition is invalid
 */
async function updateStatus(prisma, requestId, newStatus, userId, notes = null) {
    const request = await prisma.returnRequest.findUnique({ where: { id: requestId } });

    if (!request) {
        throw new Error('Return request not found');
    }

    // Validate status transition
    if (!isValidStatusTransition(request.status, newStatus)) {
        throw new Error(`Invalid status transition from '${request.status}' to '${newStatus}'`);
    }

    await prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({ where: { id: requestId }, data: { status: newStatus } });
        await tx.returnStatusHistory.create({
            data: { requestId, fromStatus: request.status, toStatus: newStatus, changedById: userId, notes },
        });
    });
}

export default router;
