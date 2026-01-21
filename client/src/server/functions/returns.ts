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
