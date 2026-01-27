/**
 * Returns Query Server Functions
 *
 * TanStack Start Server Functions for returns/exchange data fetching.
 * Uses Prisma for database access.
 *
 * IMPORTANT: Prisma client is dynamically imported to prevent Node.js code
 * from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// INPUT SCHEMAS
// ============================================

const getOrderInputSchema = z.object({
    orderNumber: z.string().min(1, 'Order number is required'),
});

const findBySkuCodeInputSchema = z.object({
    code: z.string().min(1, 'SKU code is required'),
});

// ============================================
// OUTPUT TYPES
// ============================================

export interface ReturnLine {
    id: string;
    skuId: string;
    qty: number;
    unitPrice?: number;
    itemCondition: string | null;
    inspectionNotes?: string | null;
    sku: {
        id: string;
        skuCode: string;
        size: string;
        variation: {
            colorName: string;
            imageUrl: string | null;
            product: {
                name: string;
                imageUrl: string | null;
            };
        };
    };
}

export interface ReturnRequest {
    id: string;
    requestNumber: string;
    requestType: 'return' | 'exchange';
    resolution?: string;
    status: string;
    reasonCategory: string;
    reasonDetails: string | null;
    createdAt: string;
    originalOrderId: string;
    originalOrder: {
        id: string;
        orderNumber: string;
        orderDate?: string;
        shippedAt?: string;
        deliveredAt?: string;
        customerName?: string;
    } | null;
    exchangeOrderId: string | null;
    exchangeOrder: {
        id: string;
        orderNumber: string;
        status: string;
        awbNumber?: string;
        courier?: string;
    } | null;
    reverseInTransitAt?: string | null;
    reverseReceived: boolean;
    reverseReceivedAt?: string | null;
    forwardDelivered: boolean;
    forwardDeliveredAt?: string | null;
    customerId: string;
    customerName: string;
    customerEmail: string;
    returnLines: ReturnLine[];
}

export interface ActionQueueItem {
    id: string;
    requestNumber: string;
    requestType: 'return' | 'exchange';
    status: string;
    actionType: 'reverse_receive' | 'forward_ship' | 'complete';
    actionLabel: string;
    createdAt: string;
    customerName: string;
    originalOrderNumber: string;
    exchangeOrderNumber?: string;
    itemCount: number;
}

export interface ProductReturnAnalytics {
    productId: string;
    productName: string;
    category: string;
    returnCount: number;
    totalQty: number;
    topReasons: { reason: string; count: number }[];
    avgDaysSinceShipment: number;
}

export interface OrderDetails {
    id: string;
    orderNumber: string;
    shopifyOrderNumber: string | null;
    orderDate: string;
    shippedAt: string | null;
    deliveredAt: string | null;
    customer: {
        id: string;
        name: string;
        email: string;
        phone: string | null;
    } | null;
    items: {
        orderLineId: string;
        skuId: string;
        skuCode: string;
        productName: string;
        colorName: string;
        size: string;
        qty: number;
        unitPrice?: number;
        imageUrl: string | null;
    }[];
}

// ============================================
// HELPER: LAZY DATABASE IMPORTS
// ============================================

/**
 * Lazy import Prisma client to prevent bundling server code into client
 */
async function getPrisma() {
    const { PrismaClient } = await import('@prisma/client');
    const globalForPrisma = globalThis as unknown as {
        prisma: InstanceType<typeof PrismaClient> | undefined;
    };
    const prisma = globalForPrisma.prisma ?? new PrismaClient();
    if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.prisma = prisma;
    }
    return prisma;
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get all return requests
 *
 * Returns all return/exchange requests with full details.
 * Used by Returns page "Tickets" tab.
 */
export const getReturnsAll = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<ReturnRequest[]> => {
        const prisma = await getPrisma();

        const requests = await prisma.returnRequest.findMany({
            include: {
                originalOrder: {
                    select: {
                        id: true,
                        orderNumber: true,
                        orderDate: true,
                        customer: {
                            select: {
                                firstName: true,
                                lastName: true,
                            },
                        },
                        orderLines: {
                            select: {
                                shippedAt: true,
                                deliveredAt: true,
                            },
                            take: 1,
                        },
                    },
                },
                exchangeOrder: {
                    select: {
                        id: true,
                        orderNumber: true,
                        status: true,
                        orderLines: {
                            select: {
                                awbNumber: true,
                                courier: true,
                            },
                            take: 1,
                        },
                    },
                },
                customer: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                lines: {
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
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return requests.map((req) => {
            const customerName = req.customer
                ? [req.customer.firstName, req.customer.lastName].filter(Boolean).join(' ')
                : 'Unknown';

            const originalOrderCustomerName = req.originalOrder?.customer
                ? [req.originalOrder.customer.firstName, req.originalOrder.customer.lastName]
                      .filter(Boolean)
                      .join(' ')
                : undefined;

            const firstLine = req.originalOrder?.orderLines?.[0];
            const firstExchangeLine = req.exchangeOrder?.orderLines?.[0];

            return {
                id: req.id,
                requestNumber: req.requestNumber,
                requestType: req.requestType as 'return' | 'exchange',
                resolution: req.resolution || undefined,
                status: req.status,
                reasonCategory: req.reasonCategory,
                reasonDetails: req.reasonDetails,
                createdAt: req.createdAt.toISOString(),
                originalOrderId: req.originalOrderId,
                originalOrder: req.originalOrder
                    ? {
                          id: req.originalOrder.id,
                          orderNumber: req.originalOrder.orderNumber,
                          orderDate: req.originalOrder.orderDate?.toISOString(),
                          shippedAt: firstLine?.shippedAt?.toISOString(),
                          deliveredAt: firstLine?.deliveredAt?.toISOString(),
                          customerName: originalOrderCustomerName,
                      }
                    : null,
                exchangeOrderId: req.exchangeOrderId,
                exchangeOrder: req.exchangeOrder
                    ? {
                          id: req.exchangeOrder.id,
                          orderNumber: req.exchangeOrder.orderNumber,
                          status: req.exchangeOrder.status,
                          awbNumber: firstExchangeLine?.awbNumber || undefined,
                          courier: firstExchangeLine?.courier || undefined,
                      }
                    : null,
                reverseInTransitAt: req.reverseInTransitAt?.toISOString(),
                reverseReceived: req.reverseReceived,
                reverseReceivedAt: req.reverseReceivedAt?.toISOString(),
                forwardDelivered: req.forwardDelivered,
                forwardDeliveredAt: req.forwardDeliveredAt?.toISOString(),
                customerId: req.customerId || '',
                customerName,
                customerEmail: req.customer?.email || '',
                returnLines: req.lines.map((line) => ({
                    id: line.id,
                    skuId: line.skuId,
                    qty: line.qty,
                    unitPrice: line.unitPrice || undefined,
                    itemCondition: line.itemCondition,
                    inspectionNotes: line.inspectionNotes,
                    sku: {
                        id: line.sku.id,
                        skuCode: line.sku.skuCode,
                        size: line.sku.size,
                        variation: {
                            colorName: line.sku.variation.colorName,
                            imageUrl: line.sku.variation.imageUrl,
                            product: {
                                name: line.sku.variation.product.name,
                                imageUrl: line.sku.variation.product.imageUrl,
                            },
                        },
                    },
                })),
            };
        });
    });

/**
 * Get pending return requests
 *
 * Returns requests that need attention (not completed/cancelled).
 */
export const getReturnsPending = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<ReturnRequest[]> => {
        const prisma = await getPrisma();

        const requests = await prisma.returnRequest.findMany({
            where: {
                status: {
                    notIn: ['completed', 'cancelled'],
                },
            },
            include: {
                originalOrder: {
                    select: {
                        id: true,
                        orderNumber: true,
                        orderDate: true,
                        customer: {
                            select: {
                                firstName: true,
                                lastName: true,
                            },
                        },
                        orderLines: {
                            select: {
                                shippedAt: true,
                                deliveredAt: true,
                            },
                            take: 1,
                        },
                    },
                },
                exchangeOrder: {
                    select: {
                        id: true,
                        orderNumber: true,
                        status: true,
                        orderLines: {
                            select: {
                                awbNumber: true,
                                courier: true,
                            },
                            take: 1,
                        },
                    },
                },
                customer: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                lines: {
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
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return requests.map((req) => {
            const customerName = req.customer
                ? [req.customer.firstName, req.customer.lastName].filter(Boolean).join(' ')
                : 'Unknown';

            const originalOrderCustomerName = req.originalOrder?.customer
                ? [req.originalOrder.customer.firstName, req.originalOrder.customer.lastName]
                      .filter(Boolean)
                      .join(' ')
                : undefined;

            const firstLine = req.originalOrder?.orderLines?.[0];
            const firstExchangeLine = req.exchangeOrder?.orderLines?.[0];

            return {
                id: req.id,
                requestNumber: req.requestNumber,
                requestType: req.requestType as 'return' | 'exchange',
                resolution: req.resolution || undefined,
                status: req.status,
                reasonCategory: req.reasonCategory,
                reasonDetails: req.reasonDetails,
                createdAt: req.createdAt.toISOString(),
                originalOrderId: req.originalOrderId,
                originalOrder: req.originalOrder
                    ? {
                          id: req.originalOrder.id,
                          orderNumber: req.originalOrder.orderNumber,
                          orderDate: req.originalOrder.orderDate?.toISOString(),
                          shippedAt: firstLine?.shippedAt?.toISOString(),
                          deliveredAt: firstLine?.deliveredAt?.toISOString(),
                          customerName: originalOrderCustomerName,
                      }
                    : null,
                exchangeOrderId: req.exchangeOrderId,
                exchangeOrder: req.exchangeOrder
                    ? {
                          id: req.exchangeOrder.id,
                          orderNumber: req.exchangeOrder.orderNumber,
                          status: req.exchangeOrder.status,
                          awbNumber: firstExchangeLine?.awbNumber || undefined,
                          courier: firstExchangeLine?.courier || undefined,
                      }
                    : null,
                reverseInTransitAt: req.reverseInTransitAt?.toISOString(),
                reverseReceived: req.reverseReceived,
                reverseReceivedAt: req.reverseReceivedAt?.toISOString(),
                forwardDelivered: req.forwardDelivered,
                forwardDeliveredAt: req.forwardDeliveredAt?.toISOString(),
                customerId: req.customerId || '',
                customerName,
                customerEmail: req.customer?.email || '',
                returnLines: req.lines.map((line) => ({
                    id: line.id,
                    skuId: line.skuId,
                    qty: line.qty,
                    unitPrice: line.unitPrice || undefined,
                    itemCondition: line.itemCondition,
                    inspectionNotes: line.inspectionNotes,
                    sku: {
                        id: line.sku.id,
                        skuCode: line.sku.skuCode,
                        size: line.sku.size,
                        variation: {
                            colorName: line.sku.variation.colorName,
                            imageUrl: line.sku.variation.imageUrl,
                            product: {
                                name: line.sku.variation.product.name,
                                imageUrl: line.sku.variation.product.imageUrl,
                            },
                        },
                    },
                })),
            };
        });
    });

/**
 * Get action queue for returns
 *
 * Returns items requiring action (reverse receive, forward ship).
 */
export const getReturnsActionQueue = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<ActionQueueItem[]> => {
        const prisma = await getPrisma();

        const requests = await prisma.returnRequest.findMany({
            where: {
                status: {
                    notIn: ['completed', 'cancelled'],
                },
            },
            include: {
                originalOrder: {
                    select: {
                        orderNumber: true,
                    },
                },
                exchangeOrder: {
                    select: {
                        orderNumber: true,
                    },
                },
                customer: {
                    select: {
                        firstName: true,
                        lastName: true,
                    },
                },
                lines: {
                    select: {
                        qty: true,
                    },
                },
            },
            orderBy: { createdAt: 'asc' },
        });

        const actionItems: ActionQueueItem[] = [];

        for (const req of requests) {
            const customerName = req.customer
                ? [req.customer.firstName, req.customer.lastName].filter(Boolean).join(' ')
                : 'Unknown';

            const itemCount = req.lines.reduce((sum, line) => sum + line.qty, 0);

            // Determine action type based on status
            let actionType: ActionQueueItem['actionType'];
            let actionLabel: string;

            if (!req.reverseReceived && req.requestType === 'return') {
                actionType = 'reverse_receive';
                actionLabel = 'Receive Items';
            } else if (!req.reverseReceived && req.requestType === 'exchange') {
                actionType = 'reverse_receive';
                actionLabel = 'Receive Exchange Return';
            } else if (req.reverseReceived && req.requestType === 'exchange' && !req.forwardDelivered) {
                actionType = 'forward_ship';
                actionLabel = 'Ship Exchange Order';
            } else if (req.reverseReceived && (req.status === 'approved' || req.status === 'processed')) {
                actionType = 'complete';
                actionLabel = 'Complete Request';
            } else {
                continue; // Skip items that don't need action
            }

            actionItems.push({
                id: req.id,
                requestNumber: req.requestNumber,
                requestType: req.requestType as 'return' | 'exchange',
                status: req.status,
                actionType,
                actionLabel,
                createdAt: req.createdAt.toISOString(),
                customerName,
                originalOrderNumber: req.originalOrder.orderNumber,
                exchangeOrderNumber: req.exchangeOrder?.orderNumber,
                itemCount,
            });
        }

        return actionItems;
    });

/**
 * Get return analytics by product
 *
 * Returns aggregated return statistics per product.
 */
export const getReturnsAnalyticsByProduct = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<ProductReturnAnalytics[]> => {
        const prisma = await getPrisma();

        // Get all return lines with product details
        const returnLines = await prisma.returnRequestLine.findMany({
            include: {
                request: {
                    select: {
                        reasonCategory: true,
                        createdAt: true,
                        originalOrder: {
                            select: {
                                orderLines: {
                                    select: {
                                        shippedAt: true,
                                    },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
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

        // Group by product
        const productMap = new Map<
            string,
            {
                productId: string;
                productName: string;
                category: string;
                returnCount: number;
                totalQty: number;
                reasons: Map<string, number>;
                daysSinceShipment: number[];
            }
        >();

        for (const line of returnLines) {
            const productId = line.sku.variation.product.id;
            const productName = line.sku.variation.product.name;
            const category = line.sku.variation.product.category || 'Uncategorized';

            if (!productMap.has(productId)) {
                productMap.set(productId, {
                    productId,
                    productName,
                    category,
                    returnCount: 0,
                    totalQty: 0,
                    reasons: new Map(),
                    daysSinceShipment: [],
                });
            }

            const stats = productMap.get(productId)!;
            stats.returnCount++;
            stats.totalQty += line.qty;

            // Track reason
            const reason = line.request.reasonCategory;
            stats.reasons.set(reason, (stats.reasons.get(reason) || 0) + 1);

            // Calculate days since shipment
            const shippedAt = line.request.originalOrder.orderLines[0]?.shippedAt;
            if (shippedAt) {
                const daysDiff = Math.floor(
                    (line.request.createdAt.getTime() - shippedAt.getTime()) /
                        (1000 * 60 * 60 * 24)
                );
                stats.daysSinceShipment.push(daysDiff);
            }
        }

        // Convert to array and sort by return count
        const analytics: ProductReturnAnalytics[] = Array.from(productMap.values())
            .map((stats) => ({
                productId: stats.productId,
                productName: stats.productName,
                category: stats.category,
                returnCount: stats.returnCount,
                totalQty: stats.totalQty,
                topReasons: Array.from(stats.reasons.entries())
                    .map(([reason, count]) => ({ reason, count }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 3),
                avgDaysSinceShipment:
                    stats.daysSinceShipment.length > 0
                        ? Math.round(
                              stats.daysSinceShipment.reduce((a, b) => a + b, 0) /
                                  stats.daysSinceShipment.length
                          )
                        : 0,
            }))
            .sort((a, b) => b.returnCount - a.returnCount);

        return analytics;
    });

/**
 * Get order details by order number
 *
 * Used when creating a return request to fetch original order details.
 */
export const getReturnsOrder = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getOrderInputSchema.parse(input))
    .handler(async ({ data }): Promise<OrderDetails> => {
        const prisma = await getPrisma();

        const order = await prisma.order.findFirst({
            where: {
                OR: [
                    { orderNumber: data.orderNumber },
                    { shopifyCache: { orderNumber: data.orderNumber } },
                ],
            },
            include: {
                customer: true,
                shopifyCache: {
                    select: {
                        orderNumber: true,
                    },
                },
                orderLines: {
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
                },
            },
        });

        if (!order) {
            throw new Error('Order not found');
        }

        const customerName = order.customer
            ? [order.customer.firstName, order.customer.lastName].filter(Boolean).join(' ')
            : 'Unknown';

        // Get first line's shipped/delivered timestamps
        const firstLine = order.orderLines[0];

        return {
            id: order.id,
            orderNumber: order.orderNumber,
            shopifyOrderNumber: order.shopifyCache?.orderNumber || null,
            orderDate: order.orderDate.toISOString(),
            shippedAt: firstLine?.shippedAt?.toISOString() || null,
            deliveredAt: firstLine?.deliveredAt?.toISOString() || null,
            customer: order.customer
                ? {
                      id: order.customer.id,
                      name: customerName,
                      email: order.customer.email,
                      phone: order.customer.phone,
                  }
                : null,
            items: order.orderLines.map((line) => ({
                orderLineId: line.id,
                skuId: line.skuId,
                skuCode: line.sku.skuCode,
                productName: line.sku.variation.product.name,
                colorName: line.sku.variation.colorName,
                size: line.sku.size,
                qty: line.qty,
                unitPrice: line.unitPrice || undefined,
                imageUrl: line.sku.variation.imageUrl || line.sku.variation.product.imageUrl,
            })),
        };
    });

/**
 * Find return request by SKU code
 *
 * Used for barcode scanning to quickly find return request.
 */
export const getReturnsBySkuCode = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => findBySkuCodeInputSchema.parse(input))
    .handler(async ({ data }): Promise<ReturnRequest | null> => {
        const prisma = await getPrisma();

        // Find SKU by code
        const sku = await prisma.sku.findFirst({
            where: {
                skuCode: data.code,
            },
        });

        if (!sku) {
            return null;
        }

        // Find most recent pending return request with this SKU
        const returnLine = await prisma.returnRequestLine.findFirst({
            where: {
                skuId: sku.id,
                request: {
                    status: {
                        notIn: ['completed', 'cancelled'],
                    },
                },
            },
            include: {
                request: {
                    include: {
                        originalOrder: {
                            select: {
                                id: true,
                                orderNumber: true,
                                orderDate: true,
                                customer: {
                                    select: {
                                        firstName: true,
                                        lastName: true,
                                    },
                                },
                                orderLines: {
                                    select: {
                                        shippedAt: true,
                                        deliveredAt: true,
                                    },
                                    take: 1,
                                },
                            },
                        },
                        exchangeOrder: {
                            select: {
                                id: true,
                                orderNumber: true,
                                status: true,
                                orderLines: {
                                    select: {
                                        awbNumber: true,
                                        courier: true,
                                    },
                                    take: 1,
                                },
                            },
                        },
                        customer: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true,
                            },
                        },
                        lines: {
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
                        },
                    },
                },
            },
            orderBy: {
                request: {
                    createdAt: 'desc',
                },
            },
        });

        if (!returnLine) {
            return null;
        }

        const req = returnLine.request;

        const customerName = req.customer
            ? [req.customer.firstName, req.customer.lastName].filter(Boolean).join(' ')
            : 'Unknown';

        const originalOrderCustomerName = req.originalOrder?.customer
            ? [req.originalOrder.customer.firstName, req.originalOrder.customer.lastName]
                  .filter(Boolean)
                  .join(' ')
            : undefined;

        const firstLine = req.originalOrder?.orderLines?.[0];
        const firstExchangeLine = req.exchangeOrder?.orderLines?.[0];

        return {
            id: req.id,
            requestNumber: req.requestNumber,
            requestType: req.requestType as 'return' | 'exchange',
            resolution: req.resolution || undefined,
            status: req.status,
            reasonCategory: req.reasonCategory,
            reasonDetails: req.reasonDetails,
            createdAt: req.createdAt.toISOString(),
            originalOrderId: req.originalOrderId,
            originalOrder: req.originalOrder
                ? {
                      id: req.originalOrder.id,
                      orderNumber: req.originalOrder.orderNumber,
                      orderDate: req.originalOrder.orderDate?.toISOString(),
                      shippedAt: firstLine?.shippedAt?.toISOString(),
                      deliveredAt: firstLine?.deliveredAt?.toISOString(),
                      customerName: originalOrderCustomerName,
                  }
                : null,
            exchangeOrderId: req.exchangeOrderId,
            exchangeOrder: req.exchangeOrder
                ? {
                      id: req.exchangeOrder.id,
                      orderNumber: req.exchangeOrder.orderNumber,
                      status: req.exchangeOrder.status,
                      awbNumber: firstExchangeLine?.awbNumber || undefined,
                      courier: firstExchangeLine?.courier || undefined,
                  }
                : null,
            reverseInTransitAt: req.reverseInTransitAt?.toISOString(),
            reverseReceived: req.reverseReceived,
            reverseReceivedAt: req.reverseReceivedAt?.toISOString(),
            forwardDelivered: req.forwardDelivered,
            forwardDeliveredAt: req.forwardDeliveredAt?.toISOString(),
            customerId: req.customerId || '',
            customerName,
            customerEmail: req.customer?.email || '',
            returnLines: req.lines.map((line) => ({
                id: line.id,
                skuId: line.skuId,
                qty: line.qty,
                unitPrice: line.unitPrice || undefined,
                itemCondition: line.itemCondition,
                inspectionNotes: line.inspectionNotes,
                sku: {
                    id: line.sku.id,
                    skuCode: line.sku.skuCode,
                    size: line.sku.size,
                    variation: {
                        colorName: line.sku.variation.colorName,
                        imageUrl: line.sku.variation.imageUrl,
                        product: {
                            name: line.sku.variation.product.name,
                            imageUrl: line.sku.variation.product.imageUrl,
                        },
                    },
                },
            })),
        };
    });

// ============================================
// PENDING SOURCES & QUEUE (for ReturnsRto page)
// ============================================

const getPendingQueueInputSchema = z.object({
    source: z.enum(['production', 'repacking', 'returns', 'rto']),
    limit: z.number().int().positive().optional().default(200),
});

export interface PendingSourcesCounts {
    repacking: number;
    returns: number;
    rto: number;
    rtoUrgent: number;
}

export interface PendingSourcesResponse {
    counts: PendingSourcesCounts;
}

export interface QueuePanelItemResponse {
    id: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    imageUrl?: string;
    contextLabel: string;
    contextValue: string;
    // RTO-specific
    atWarehouse?: boolean;
    daysInRto?: number;
    customerName?: string;
    orderNumber?: string;
    // Returns-specific
    requestNumber?: string;
    // Repacking-specific
    queueItemId?: string;
    condition?: string;
    inspectionNotes?: string;
    returnRequestNumber?: string;
    orderLineId?: string;
    rtoOrderNumber?: string;
    // For click-to-process
    lineId?: string;
    orderId?: string;
    // Production-specific
    batchId?: string;
    batchCode?: string;
}

export interface PendingQueueResponse {
    source: string;
    items: QueuePanelItemResponse[];
    total: number;
}

/**
 * Get pending source counts for Returns RTO page tabs
 */
export const getPendingSources = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<PendingSourcesResponse> => {
        const prisma = await getPrisma();

        // Count repacking queue items (pending status)
        const repackingCount = await prisma.repackingQueueItem.count({
            where: { status: 'pending' },
        });

        // Count pending returns from OrderLine (new line-level system)
        const returnsCount = await prisma.orderLine.count({
            where: {
                returnStatus: {
                    in: ['requested', 'pickup_scheduled', 'in_transit'],
                },
                returnReceivedAt: null,
            },
        });

        // Count RTO pending (rto_in_transit, at warehouse but not inwarded)
        const rtoCount = await prisma.orderLine.count({
            where: {
                trackingStatus: { in: ['rto_in_transit', 'rto_out_for_delivery'] },
                rtoReceivedAt: null,
            },
        });

        // Count urgent RTOs (more than 7 days in RTO status)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const rtoUrgentCount = await prisma.orderLine.count({
            where: {
                trackingStatus: { in: ['rto_in_transit', 'rto_out_for_delivery'] },
                rtoReceivedAt: null,
                rtoInitiatedAt: { lte: sevenDaysAgo },
            },
        });

        return {
            counts: {
                repacking: repackingCount,
                returns: returnsCount,
                rto: rtoCount,
                rtoUrgent: rtoUrgentCount,
            },
        };
    });

/**
 * Get pending queue items by source
 */
export const getPendingQueue = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getPendingQueueInputSchema.parse(input))
    .handler(async ({ data }): Promise<PendingQueueResponse> => {
        const prisma = await getPrisma();
        const { source, limit } = data;

        const items: QueuePanelItemResponse[] = [];

        if (source === 'repacking') {
            // Get repacking queue items
            const queueItems = await prisma.repackingQueueItem.findMany({
                where: { status: 'pending' },
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
                    returnRequest: {
                        select: { requestNumber: true },
                    },
                    orderLine: {
                        select: {
                            order: {
                                select: { orderNumber: true },
                            },
                        },
                    },
                },
                orderBy: { createdAt: 'asc' },
                take: limit,
            });

            for (const item of queueItems) {
                items.push({
                    id: item.id,
                    queueItemId: item.id,
                    skuId: item.skuId,
                    skuCode: item.sku.skuCode,
                    productName: item.sku.variation.product.name,
                    colorName: item.sku.variation.colorName,
                    size: item.sku.size,
                    qty: item.qty,
                    imageUrl: item.sku.variation.imageUrl || item.sku.variation.product.imageUrl || undefined,
                    contextLabel: item.returnRequest ? 'Return' : item.orderLine ? 'RTO' : 'Scan',
                    contextValue: item.returnRequest?.requestNumber || item.orderLine?.order?.orderNumber || 'Unallocated',
                    condition: item.condition || undefined,
                    inspectionNotes: item.inspectionNotes || undefined,
                    returnRequestNumber: item.returnRequest?.requestNumber || undefined,
                    rtoOrderNumber: item.orderLine?.order?.orderNumber || undefined,
                    orderLineId: item.orderLineId || undefined,
                });
            }
        } else if (source === 'returns') {
            // Get pending returns from OrderLine (new line-level system)
            // Items awaiting receipt at warehouse
            const returnLines = await prisma.orderLine.findMany({
                where: {
                    returnStatus: {
                        in: ['requested', 'pickup_scheduled', 'in_transit'],
                    },
                    returnReceivedAt: null,
                },
                include: {
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            customerName: true,
                        },
                    },
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
                orderBy: { returnRequestedAt: 'asc' },
                take: limit,
            });

            for (const line of returnLines) {
                items.push({
                    id: line.id,
                    skuId: line.skuId,
                    skuCode: line.sku.skuCode,
                    productName: line.sku.variation.product.name,
                    colorName: line.sku.variation.colorName,
                    size: line.sku.size,
                    qty: line.returnQty || line.qty,
                    imageUrl: line.sku.variation.imageUrl || line.sku.variation.product.imageUrl || undefined,
                    contextLabel: 'Order',
                    contextValue: line.order.orderNumber,
                    customerName: line.order.customerName,
                    orderLineId: line.id,
                });
            }
        } else if (source === 'rto') {
            // Get RTO pending lines
            const rtoLines = await prisma.orderLine.findMany({
                where: {
                    trackingStatus: { in: ['rto_in_transit', 'rto_out_for_delivery'] },
                    rtoReceivedAt: null,
                },
                include: {
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            customerName: true,
                        },
                    },
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
                orderBy: { rtoInitiatedAt: 'asc' },
                take: limit,
            });

            for (const line of rtoLines) {
                // Calculate days in RTO
                let daysInRto: number | undefined;
                if (line.rtoInitiatedAt) {
                    const daysDiff = Math.floor(
                        (Date.now() - new Date(line.rtoInitiatedAt).getTime()) / (1000 * 60 * 60 * 24)
                    );
                    daysInRto = daysDiff;
                }

                items.push({
                    id: line.id,
                    lineId: line.id,
                    orderId: line.order.id,
                    skuId: line.skuId,
                    skuCode: line.sku.skuCode,
                    productName: line.sku.variation.product.name,
                    colorName: line.sku.variation.colorName,
                    size: line.sku.size,
                    qty: line.qty,
                    imageUrl: line.sku.variation.imageUrl || line.sku.variation.product.imageUrl || undefined,
                    contextLabel: 'Order',
                    contextValue: line.order.orderNumber,
                    orderNumber: line.order.orderNumber,
                    customerName: line.order.customerName,
                    atWarehouse: line.trackingStatus === 'rto_out_for_delivery',
                    daysInRto,
                });
            }
        } else if (source === 'production') {
            // Get pending production batches
            const batches = await prisma.productionBatch.findMany({
                where: {
                    status: { in: ['planned', 'in_progress'] },
                    skuId: { not: null },
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
                orderBy: { batchDate: 'asc' },
                take: limit,
            });

            for (const batch of batches) {
                if (!batch.sku) continue;
                const qtyPending = batch.qtyPlanned - (batch.qtyCompleted || 0);
                if (qtyPending <= 0) continue;

                items.push({
                    id: batch.id,
                    batchId: batch.id,
                    skuId: batch.skuId!,
                    skuCode: batch.sku.skuCode,
                    productName: batch.sku.variation.product.name,
                    colorName: batch.sku.variation.colorName,
                    size: batch.sku.size,
                    qty: qtyPending,
                    imageUrl: batch.sku.variation.imageUrl || batch.sku.variation.product.imageUrl || undefined,
                    contextLabel: 'Batch',
                    contextValue: batch.batchCode || `Batch ${batch.id.slice(0, 8)}`,
                    batchCode: batch.batchCode || undefined,
                });
            }
        }

        return {
            source,
            items,
            total: items.length,
        };
    });

// Type for scan lookup match
export interface ScanLookupMatch {
    source: string;
    priority: number;
    data: {
        lineId: string;
        requestId?: string;
        requestNumber?: string;
        reasonCategory?: string | null;
        orderId?: string;
        orderNumber?: string;
        customerName?: string;
        qty: number;
        atWarehouse?: boolean;
        // Repacking-specific fields
        queueId?: string;
        condition?: string;
        returnRequestNumber?: string | null;
        // Production-specific fields
        batchId?: string;
        batchCode?: string;
        qtyPlanned?: number;
        qtyCompleted?: number;
        qtyPending?: number;
        batchDate?: string;
    };
}

// Type for scan lookup result
export interface ScanLookupResult {
    sku: {
        id: string;
        skuCode: string;
        barcode: string | null;
        productName: string;
        colorName: string;
        size: string;
        mrp: number;
        imageUrl: string | null;
    };
    currentBalance: number;
    availableBalance: number;
    matches: ScanLookupMatch[];
    recommendedSource: string;
}

/**
 * Scan lookup for SKU code (used in allocation modal)
 */
export const scanLookup = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => findBySkuCodeInputSchema.parse(input))
    .handler(async ({ data }): Promise<ScanLookupResult> => {
        const prisma = await getPrisma();
        const { code } = data;

        // Find SKU by code (SKU model doesn't have barcode field)
        const sku = await prisma.sku.findFirst({
            where: { skuCode: code },
            include: {
                variation: {
                    include: {
                        product: true,
                    },
                },
            },
        });

        if (!sku) {
            throw new Error('SKU not found');
        }

        // Get inventory balance
        const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
        const balanceMap = await inventoryBalanceCache.get(prisma, [sku.id]);
        const balance = balanceMap.get(sku.id) || { currentBalance: 0, availableBalance: 0 };

        // Find matching return requests
        const returnMatches = await prisma.returnRequestLine.findMany({
            where: {
                skuId: sku.id,
                request: {
                    status: { notIn: ['completed', 'cancelled'] },
                    reverseReceived: false,
                },
            },
            include: {
                request: {
                    select: {
                        id: true,
                        requestNumber: true,
                        reasonCategory: true,
                    },
                },
            },
            take: 10,
        });

        // Find matching RTO orders
        const rtoMatches = await prisma.orderLine.findMany({
            where: {
                skuId: sku.id,
                trackingStatus: { in: ['rto_in_transit', 'rto_out_for_delivery'] },
                rtoReceivedAt: null,
            },
            include: {
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        customerName: true,
                    },
                },
            },
            take: 10,
        });

        // Find matching repacking queue items
        const repackingMatches = await prisma.repackingQueueItem.findMany({
            where: {
                skuId: sku.id,
                status: 'pending',
            },
            include: {
                returnRequest: {
                    select: { requestNumber: true },
                },
            },
            take: 10,
        });

        // Find matching production batches
        const productionMatches = await prisma.productionBatch.findMany({
            where: {
                skuId: sku.id,
                status: { in: ['pending', 'planned', 'in_progress'] },
            },
            select: {
                id: true,
                batchCode: true,
                batchDate: true,
                qtyPlanned: true,
                qtyCompleted: true,
            },
            take: 10,
        });

        // Build matches array
        const matches: ScanLookupMatch[] = [];

        for (const returnLine of returnMatches) {
            matches.push({
                source: 'return',
                priority: 1,
                data: {
                    lineId: returnLine.id,
                    requestId: returnLine.request.id,
                    requestNumber: returnLine.request.requestNumber,
                    reasonCategory: returnLine.request.reasonCategory,
                    qty: returnLine.qty,
                },
            });
        }

        for (const rtoLine of rtoMatches) {
            matches.push({
                source: 'rto',
                priority: 2,
                data: {
                    lineId: rtoLine.id,
                    orderId: rtoLine.order.id,
                    orderNumber: rtoLine.order.orderNumber,
                    customerName: rtoLine.order.customerName,
                    qty: rtoLine.qty,
                    atWarehouse: rtoLine.trackingStatus === 'rto_out_for_delivery',
                },
            });
        }

        for (const repackItem of repackingMatches) {
            matches.push({
                source: 'repacking',
                priority: 3,
                data: {
                    lineId: repackItem.id,
                    queueId: repackItem.id,
                    qty: repackItem.qty,
                    condition: repackItem.condition || 'unknown',
                    returnRequestNumber: repackItem.returnRequest?.requestNumber || null,
                },
            });
        }

        for (const prodBatch of productionMatches) {
            const qtyPending = prodBatch.qtyPlanned - prodBatch.qtyCompleted;
            if (qtyPending > 0) {
                matches.push({
                    source: 'production',
                    priority: 4,
                    data: {
                        lineId: prodBatch.id,
                        batchId: prodBatch.id,
                        batchCode: prodBatch.batchCode || '',
                        qty: qtyPending,
                        qtyPlanned: prodBatch.qtyPlanned,
                        qtyCompleted: prodBatch.qtyCompleted,
                        qtyPending,
                        batchDate: prodBatch.batchDate.toISOString(),
                    },
                });
            }
        }

        return {
            sku: {
                id: sku.id,
                skuCode: sku.skuCode,
                barcode: null, // SKU model doesn't have barcode field
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                mrp: Number(sku.mrp),
                imageUrl: sku.variation.imageUrl || sku.variation.product.imageUrl,
            },
            currentBalance: balance.currentBalance,
            availableBalance: balance.availableBalance,
            matches,
            recommendedSource: matches.length > 0 ? matches[0].source : 'adjustment',
        };
    });

// ============================================
// RTO ORDERS SEARCH (for AllocationModal)
// ============================================

const searchRtoOrdersInputSchema = z.object({
    search: z.string().optional(),
    limit: z.number().int().positive().max(50).optional().default(5),
});

export interface RtoOrderSearchResult {
    id: string;
    orderNumber: string;
    customerName: string | null;
    awbNumber: string | null;
    rtoInitiatedAt: string | null;
    orderDate: string;
}

export interface RtoOrdersSearchResponse {
    orders: RtoOrderSearchResult[];
}

/**
 * Search RTO orders for allocation
 *
 * Returns RTO orders matching search query (order number or AWB).
 * Used by AllocationModal for finding RTO orders to link.
 */
export const searchRtoOrders = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => searchRtoOrdersInputSchema.parse(input))
    .handler(async ({ data }): Promise<RtoOrdersSearchResponse> => {
        const prisma = await getPrisma();
        const { search, limit } = data;

        // Build where clause for RTO orders
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: Record<string, any> = {
            isArchived: false,
            orderLines: {
                some: {
                    trackingStatus: { in: ['rto_in_transit', 'rto_out_for_delivery'] },
                    rtoReceivedAt: null,
                },
            },
        };

        // Add search filter
        if (search && search.length >= 3) {
            where.OR = [
                { orderNumber: { contains: search, mode: 'insensitive' } },
                { orderLines: { some: { awbNumber: { contains: search, mode: 'insensitive' } } } },
            ];
        }

        const orders = await prisma.order.findMany({
            where,
            select: {
                id: true,
                orderNumber: true,
                customerName: true,
                orderDate: true,
                orderLines: {
                    where: {
                        trackingStatus: { in: ['rto_in_transit', 'rto_out_for_delivery'] },
                        rtoReceivedAt: null,
                    },
                    select: {
                        awbNumber: true,
                        rtoInitiatedAt: true,
                    },
                    take: 1,
                },
            },
            orderBy: { orderDate: 'desc' },
            take: limit,
        });

        return {
            orders: orders.map((order) => ({
                id: order.id,
                orderNumber: order.orderNumber,
                customerName: order.customerName,
                awbNumber: order.orderLines[0]?.awbNumber || null,
                rtoInitiatedAt: order.orderLines[0]?.rtoInitiatedAt?.toISOString() || null,
                orderDate: order.orderDate.toISOString(),
            })),
        };
    });

// ============================================
// LINE-LEVEL RETURN QUERIES (NEW)
// ============================================
// These queries work with OrderLine.return* fields directly,
// for the new line-level returns system.

import {
    type OrderForReturn,
    type OrderLineForReturn,
    type ActiveReturnLine,
    type ReturnActionQueueItem,
    type RefundCalculationResult,
} from '@coh/shared/schemas/returns';
import {
    checkEligibility,
    RETURN_POLICY,
    RETURN_REASONS,
    RETURN_CONDITIONS,
    RETURN_RESOLUTIONS,
    RETURN_PICKUP_TYPES,
    RETURN_REFUND_METHODS,
    NON_RETURNABLE_REASONS,
    type EligibilitySettings,
    toOptions,
} from '@coh/shared/domain/returns';

/**
 * Get order with lines for return initiation
 * Includes eligibility checks for each line
 */
export const getOrderForReturn = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => z.object({ orderNumber: z.string() }).parse(input))
    .handler(async ({ data }): Promise<OrderForReturn> => {
        const prisma = await getPrisma();

        // Fetch settings from DB (with fallback to code defaults)
        const dbSettings = await prisma.returnSettings.findFirst({ where: { id: 'default' } });
        const settings: EligibilitySettings = dbSettings
            ? { windowDays: dbSettings.windowDays, windowWarningDays: dbSettings.windowWarningDays }
            : { windowDays: RETURN_POLICY.windowDays, windowWarningDays: RETURN_POLICY.windowWarningDays };

        const order = await prisma.order.findFirst({
            where: {
                OR: [
                    { orderNumber: data.orderNumber },
                    { shopifyCache: { orderNumber: data.orderNumber } },
                ],
            },
            include: {
                orderLines: {
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
                },
            },
        });

        if (!order) {
            throw new Error('Order not found');
        }

        const lines: OrderLineForReturn[] = order.orderLines.map((line) => {
            const product = line.sku.variation.product;
            const eligibility = checkEligibility({
                deliveredAt: line.deliveredAt,
                returnStatus: line.returnStatus,
                isNonReturnable: line.isNonReturnable,
                productIsReturnable: product.isReturnable,
                productNonReturnableReason: product.nonReturnableReason,
            }, settings);

            return {
                id: line.id,
                orderId: line.orderId,
                skuId: line.skuId,
                skuCode: line.sku.skuCode,
                size: line.sku.size,
                qty: line.qty,
                unitPrice: line.unitPrice,
                lineStatus: line.lineStatus,
                deliveredAt: line.deliveredAt,
                returnStatus: line.returnStatus,
                returnQty: line.returnQty,
                eligibility,
                productId: product.id,
                productName: product.name,
                colorName: line.sku.variation.colorName,
                imageUrl: line.sku.variation.imageUrl || product.imageUrl,
                isReturnable: product.isReturnable,
                nonReturnableReason: product.nonReturnableReason,
            };
        });

        return {
            id: order.id,
            orderNumber: order.orderNumber,
            orderDate: order.orderDate,
            totalAmount: order.totalAmount,
            customerName: order.customerName,
            customerEmail: order.customerEmail,
            customerPhone: order.customerPhone,
            shippingAddress: order.shippingAddress,
            lines,
        };
    });

/**
 * Get all active line-level returns
 * For returns dashboard listing
 */
export const getActiveLineReturns = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<ActiveReturnLine[]> => {
        const prisma = await getPrisma();

        const lines = await prisma.orderLine.findMany({
            where: {
                returnStatus: {
                    notIn: ['complete', 'cancelled'],
                },
            },
            include: {
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        customerId: true,
                        customerName: true,
                        customerEmail: true,
                        customerPhone: true,
                    },
                },
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
            orderBy: { returnRequestedAt: 'desc' },
        });

        return lines.map((line) => ({
            id: line.id,
            orderId: line.orderId,
            orderNumber: line.order.orderNumber,
            skuId: line.skuId,
            skuCode: line.sku.skuCode,
            size: line.sku.size,
            qty: line.qty,
            unitPrice: line.unitPrice,
            returnBatchNumber: line.returnBatchNumber,
            returnStatus: line.returnStatus!,
            returnQty: line.returnQty!,
            returnRequestedAt: line.returnRequestedAt,
            returnReasonCategory: line.returnReasonCategory,
            returnReasonDetail: line.returnReasonDetail,
            returnResolution: line.returnResolution,
            returnPickupType: line.returnPickupType,
            returnAwbNumber: line.returnAwbNumber,
            returnCourier: line.returnCourier,
            returnPickupScheduledAt: line.returnPickupScheduledAt,
            returnReceivedAt: line.returnReceivedAt,
            returnCondition: line.returnCondition,
            returnExchangeOrderId: line.returnExchangeOrderId,
            returnNotes: line.returnNotes,
            customerId: line.order.customerId,
            customerName: line.order.customerName,
            customerEmail: line.order.customerEmail,
            customerPhone: line.order.customerPhone,
            productId: line.sku.variation.product.id,
            productName: line.sku.variation.product.name,
            colorName: line.sku.variation.colorName,
            imageUrl: line.sku.variation.imageUrl || line.sku.variation.product.imageUrl,
        }));
    });

/**
 * Get return action queue (lines needing action)
 * Prioritized list for staff to process
 */
export const getLineReturnActionQueue = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<ReturnActionQueueItem[]> => {
        const prisma = await getPrisma();

        const lines = await prisma.orderLine.findMany({
            where: {
                returnStatus: {
                    in: ['requested', 'pickup_scheduled', 'in_transit', 'received'],
                },
            },
            include: {
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        customerId: true,
                        customerName: true,
                        customerEmail: true,
                        customerPhone: true,
                    },
                },
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
            orderBy: { returnRequestedAt: 'asc' },
        });

        const actionItems: ReturnActionQueueItem[] = [];

        for (const line of lines) {
            // Determine action needed based on status and resolution
            let actionNeeded: 'schedule_pickup' | 'receive' | 'process_refund' | 'create_exchange' | 'complete';

            switch (line.returnStatus) {
                case 'requested':
                    actionNeeded = 'schedule_pickup';
                    break;
                case 'pickup_scheduled':
                case 'in_transit':
                    actionNeeded = 'receive';
                    break;
                case 'received':
                    if (line.returnResolution === 'refund' && !line.returnRefundCompletedAt) {
                        actionNeeded = 'process_refund';
                    } else if (line.returnResolution === 'exchange' && !line.returnExchangeOrderId) {
                        actionNeeded = 'create_exchange';
                    } else {
                        actionNeeded = 'complete';
                    }
                    break;
                default:
                    continue;
            }

            const daysSinceRequest = line.returnRequestedAt
                ? Math.floor((Date.now() - line.returnRequestedAt.getTime()) / (1000 * 60 * 60 * 24))
                : 0;

            actionItems.push({
                id: line.id,
                orderId: line.orderId,
                orderNumber: line.order.orderNumber,
                skuId: line.skuId,
                skuCode: line.sku.skuCode,
                size: line.sku.size,
                qty: line.qty,
                unitPrice: line.unitPrice,
                returnBatchNumber: line.returnBatchNumber,
                returnStatus: line.returnStatus!,
                returnQty: line.returnQty!,
                returnRequestedAt: line.returnRequestedAt,
                returnReasonCategory: line.returnReasonCategory,
                returnReasonDetail: line.returnReasonDetail,
                returnResolution: line.returnResolution,
                returnPickupType: line.returnPickupType,
                returnAwbNumber: line.returnAwbNumber,
                returnCourier: line.returnCourier,
                returnPickupScheduledAt: line.returnPickupScheduledAt,
                returnReceivedAt: line.returnReceivedAt,
                returnCondition: line.returnCondition,
                returnExchangeOrderId: line.returnExchangeOrderId,
                returnNotes: line.returnNotes,
                customerId: line.order.customerId,
                customerName: line.order.customerName,
                customerEmail: line.order.customerEmail,
                customerPhone: line.order.customerPhone,
                productId: line.sku.variation.product.id,
                productName: line.sku.variation.product.name,
                colorName: line.sku.variation.colorName,
                imageUrl: line.sku.variation.imageUrl || line.sku.variation.product.imageUrl,
                actionNeeded,
                daysSinceRequest,
            });
        }

        // Sort by priority: receive first, then by age
        actionItems.sort((a, b) => {
            const priorityOrder = ['receive', 'schedule_pickup', 'process_refund', 'create_exchange', 'complete'];
            const aPriority = priorityOrder.indexOf(a.actionNeeded);
            const bPriority = priorityOrder.indexOf(b.actionNeeded);
            if (aPriority !== bPriority) return aPriority - bPriority;
            return b.daysSinceRequest - a.daysSinceRequest;
        });

        return actionItems;
    });

/**
 * Calculate refund amount for a return line
 * Shows breakdown: gross, discount clawback, net
 */
export const calculateLineReturnRefund = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => z.object({ orderLineId: z.string().uuid() }).parse(input))
    .handler(async ({ data }): Promise<RefundCalculationResult> => {
        const prisma = await getPrisma();
        const { orderLineId } = data;

        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            include: {
                order: {
                    select: {
                        totalAmount: true,
                        orderLines: {
                            select: {
                                id: true,
                                qty: true,
                                unitPrice: true,
                                returnStatus: true,
                                returnQty: true,
                            },
                        },
                    },
                },
            },
        });

        if (!line) {
            throw new Error('Order line not found');
        }

        if (!line.returnQty) {
            throw new Error('No return quantity set');
        }

        // Calculate gross amount (line value * return qty ratio)
        const lineTotal = line.unitPrice * line.qty;
        const grossAmount = (line.unitPrice * line.returnQty);

        // Calculate discount clawback (if order total drops below discount threshold)
        // This is a simplified calculation - in practice, you'd check against order-level discounts
        const discountClawback = 0;

        // Check if this return would drop order below any discount threshold
        // For now, assume no clawback (would need to implement discount rules)
        const suggestedDeductions = 0;

        const netAmount = grossAmount - discountClawback - suggestedDeductions;

        return {
            orderLineId,
            lineTotal,
            returnQty: line.returnQty,
            grossAmount,
            discountClawback,
            suggestedDeductions,
            netAmount,
        };
    });

// ============================================
// RETURN CONFIGURATION
// ============================================

export interface ReturnConfigResponse {
    windowDays: number;
    windowWarningDays: number;
    autoRejectAfterDays: number | null;
    allowExpiredOverride: boolean;
    reasonCategories: Array<{ value: string; label: string }>;
    conditions: Array<{ value: string; label: string }>;
    resolutions: Array<{ value: string; label: string }>;
    pickupTypes: Array<{ value: string; label: string }>;
    refundMethods: Array<{ value: string; label: string }>;
    nonReturnableReasons: Array<{ value: string; label: string }>;
}

/**
 * Get return settings from DB with fallback to code defaults
 */
async function getReturnSettingsFromDb(): Promise<EligibilitySettings & { autoRejectAfterDays: number | null; allowExpiredOverride: boolean }> {
    try {
        const prisma = await getPrisma();

        // Try to get settings from DB
        const dbSettings = await prisma.returnSettings.findFirst({
            where: { id: 'default' },
        });

        if (dbSettings) {
            return {
                windowDays: dbSettings.windowDays,
                windowWarningDays: dbSettings.windowWarningDays,
                autoRejectAfterDays: dbSettings.autoRejectAfterDays,
                allowExpiredOverride: dbSettings.allowExpiredOverride,
            };
        }
    } catch (error) {
        // Table might not exist yet - fall back to defaults
        console.warn('Failed to load return settings from DB, using defaults:', error);
    }

    // Return code defaults
    return {
        windowDays: RETURN_POLICY.windowDays,
        windowWarningDays: RETURN_POLICY.windowWarningDays,
        autoRejectAfterDays: RETURN_POLICY.autoRejectAfterDays,
        allowExpiredOverride: RETURN_POLICY.allowExpiredWithOverride,
    };
}

/**
 * Get return configuration settings
 * Reads from DB if available, falls back to code defaults
 */
export const getReturnConfig = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<ReturnConfigResponse> => {
        const settings = await getReturnSettingsFromDb();

        return {
            windowDays: settings.windowDays,
            windowWarningDays: settings.windowWarningDays,
            autoRejectAfterDays: settings.autoRejectAfterDays,
            allowExpiredOverride: settings.allowExpiredOverride,
            reasonCategories: toOptions(RETURN_REASONS),
            conditions: toOptions(RETURN_CONDITIONS),
            resolutions: toOptions(RETURN_RESOLUTIONS),
            pickupTypes: toOptions(RETURN_PICKUP_TYPES),
            refundMethods: toOptions(RETURN_REFUND_METHODS),
            nonReturnableReasons: toOptions(NON_RETURNABLE_REASONS),
        };
    });

/**
 * Update return settings
 */
export const updateReturnSettings = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) =>
        z.object({
            windowDays: z.number().int().min(1).max(365),
            windowWarningDays: z.number().int().min(0).max(365),
            autoRejectAfterDays: z.number().int().min(1).max(365).nullable(),
            allowExpiredOverride: z.boolean(),
        }).parse(input)
    )
    .handler(async ({ data, context }): Promise<{ success: boolean }> => {
        const prisma = await getPrisma();
        const userId = context.user.id;

        // Validation: windowWarningDays should be less than windowDays
        if (data.windowWarningDays >= data.windowDays) {
            throw new Error('Warning threshold must be less than return window');
        }

        await prisma.returnSettings.upsert({
            where: { id: 'default' },
            create: {
                id: 'default',
                windowDays: data.windowDays,
                windowWarningDays: data.windowWarningDays,
                autoRejectAfterDays: data.autoRejectAfterDays,
                allowExpiredOverride: data.allowExpiredOverride,
                updatedById: userId,
            },
            update: {
                windowDays: data.windowDays,
                windowWarningDays: data.windowWarningDays,
                autoRejectAfterDays: data.autoRejectAfterDays,
                allowExpiredOverride: data.allowExpiredOverride,
                updatedById: userId,
            },
        });

        return { success: true };
    });
