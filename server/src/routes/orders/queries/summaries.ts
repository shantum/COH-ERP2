/**
 * Order Summaries
 * RTO summary, shipped summary, archived analytics, and status views
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { filterConfidentialFields } from '../../../middleware/permissions.js';
import { orderLogger } from '../../../utils/logger.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

interface SummaryQuery {
    days?: string;
}

interface ArchivedOrdersQuery {
    limit?: string;
    offset?: string;
    days?: string;
    sortBy?: string;
}

interface RtoOrder {
    id: string;
    trackingStatus: string | null;
    paymentMethod: string | null;
    totalAmount: number | null;
    rtoInitiatedAt: Date | null;
    rtoReceivedAt: Date | null;
}

interface ShippedOrder {
    id: string;
    status: string;
    trackingStatus: string | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    paymentMethod: string | null;
}

interface ArchivedOrder {
    id: string;
    totalAmount: number | null;
    channel: string | null;
    orderLines: Array<{
        qty: number;
        unitPrice: number;
        sku: {
            id: string;
            skuCode: string;
            variation: {
                product: { name: string } | null;
            } | null;
        } | null;
    }>;
}

interface ProductStats {
    units: number;
    revenue: number;
}

interface ChannelSplit {
    channel: string;
    count: number;
    percentage: number;
}

interface TopProduct {
    name: string;
    units: number;
    revenue: number;
}

interface OrderLineWithDetails {
    id: string;
    qty: number;
    unitPrice: number;
    lineStatus: string | null;
    sku: {
        id: string;
        skuCode: string;
        variation: {
            colorName: string | null;
            product: { name: string } | null;
            fabric: unknown | null;
        } | null;
    } | null;
    order: OrderWithCustomer;
}

interface OrderWithCustomer {
    id: string;
    orderNumber: string;
    customerId: string | null;
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    shippingAddress: unknown;
    channel: string | null;
    orderDate: Date | null;
    paymentMethod: string | null;
    status: string;
    partiallyCancelled: boolean;
    createdAt: Date;
    customer: unknown | null;
}

// ============================================
// SUMMARIES
// ============================================

// Get RTO orders summary
router.get('/rto/summary', async (req: Request, res: Response) => {
    try {
        const orders = await req.prisma.order.findMany({
            where: {
                trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                isArchived: false,
            },
            select: {
                id: true,
                trackingStatus: true,
                paymentMethod: true,
                totalAmount: true,
                rtoInitiatedAt: true,
                rtoReceivedAt: true,
            },
        }) as RtoOrder[];

        const now = Date.now();
        let pendingReceipt = 0;
        let received = 0;
        let prepaid = 0;
        let cod = 0;
        let totalValue = 0;
        let prepaidValue = 0;
        let codValue = 0;
        let within7Days = 0;
        let within14Days = 0;
        let over14Days = 0;
        let totalTransitDays = 0;
        let transitOrderCount = 0;

        for (const order of orders) {
            const amount = order.totalAmount || 0;
            totalValue += amount;

            // Status classification
            if (order.trackingStatus === 'rto_delivered' || order.rtoReceivedAt) {
                received++;
            } else {
                pendingReceipt++;

                // Transit duration calculation (only for pending orders)
                if (order.rtoInitiatedAt) {
                    const daysInRto = Math.floor(
                        (now - new Date(order.rtoInitiatedAt).getTime()) / (1000 * 60 * 60 * 24)
                    );
                    totalTransitDays += daysInRto;
                    transitOrderCount++;

                    if (daysInRto <= 7) within7Days++;
                    else if (daysInRto <= 14) within14Days++;
                    else over14Days++;
                }
            }

            // Payment method classification
            const isPrepaid = order.paymentMethod?.toLowerCase() !== 'cod';
            if (isPrepaid) {
                prepaid++;
                prepaidValue += amount;
            } else {
                cod++;
                codValue += amount;
            }
        }

        const summary = {
            pendingReceipt,
            received,
            total: orders.length,
            transitBreakdown: { within7Days, within14Days, over14Days },
            avgDaysInTransit: transitOrderCount > 0
                ? Math.round((totalTransitDays / transitOrderCount) * 10) / 10
                : 0,
            paymentBreakdown: { prepaid, cod },
            totalValue,
            prepaidValue,
            codValue,
            needsAttention: over14Days,
        };

        // Filter confidential fields based on user permissions
        const filtered = filterConfidentialFields(summary, req.userPermissions);
        res.json(filtered);
    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Get RTO summary error');
        res.status(500).json({ error: 'Failed to fetch RTO summary' });
    }
});

// Get shipped orders summary (status counts)
router.get('/shipped/summary', async (req: Request, res: Response) => {
    try {
        const { days = '30' } = req.query as SummaryQuery;
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - Number(days));

        const whereClause: Prisma.OrderWhereInput = {
            status: { in: ['shipped', 'delivered'] },
            shippedAt: { gte: sinceDate },
            isArchived: false,
            OR: [
                { trackingStatus: null },
                { trackingStatus: { notIn: ['rto_in_transit', 'rto_delivered'] } }
            ],
            NOT: {
                AND: [
                    { paymentMethod: 'COD' },
                    { trackingStatus: 'delivered' },
                    { codRemittedAt: null }
                ]
            }
        };

        const orders = await req.prisma.order.findMany({
            where: whereClause,
            select: {
                id: true,
                status: true,
                trackingStatus: true,
                shippedAt: true,
                deliveredAt: true,
                paymentMethod: true,
            },
        }) as ShippedOrder[];

        const now = Date.now();
        let inTransit = 0;
        let delivered = 0;
        let delayed = 0;
        let rto = 0;

        for (const order of orders) {
            if (order.trackingStatus === 'delivered' || order.deliveredAt) {
                delivered++;
            } else if (order.trackingStatus && (
                order.trackingStatus.includes('rto') ||
                order.trackingStatus === 'cancelled'
            )) {
                rto++;
            } else {
                const daysInTransit = order.shippedAt
                    ? Math.floor((now - new Date(order.shippedAt).getTime()) / (1000 * 60 * 60 * 24))
                    : 0;
                if (daysInTransit > 7) {
                    delayed++;
                } else {
                    inTransit++;
                }
            }
        }

        res.json({
            inTransit,
            delivered,
            delayed,
            rto,
            needsAttention: delayed + rto,
            total: orders.length,
        });
    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Get shipped summary error');
        res.status(500).json({ error: 'Failed to fetch shipped summary' });
    }
});

// Get archived orders analytics
router.get('/archived/analytics', async (req: Request, res: Response) => {
    try {
        const { days = '30' } = req.query as SummaryQuery;
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - Number(days));

        const orders = await req.prisma.order.findMany({
            where: {
                isArchived: true,
                orderDate: { gte: sinceDate },
            },
            select: {
                id: true,
                totalAmount: true,
                channel: true,
                orderLines: {
                    select: {
                        qty: true,
                        unitPrice: true,
                        sku: {
                            select: {
                                id: true,
                                skuCode: true,
                                variation: {
                                    select: {
                                        product: {
                                            select: { name: true },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        }) as ArchivedOrder[];

        const orderCount = orders.length;
        const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        const avgValue = orderCount > 0 ? totalRevenue / orderCount : 0;

        const channelCounts: Record<string, number> = {};
        for (const order of orders) {
            const ch = order.channel || 'shopify';
            channelCounts[ch] = (channelCounts[ch] || 0) + 1;
        }
        const channelSplit: ChannelSplit[] = Object.entries(channelCounts).map(([channel, count]) => ({
            channel,
            count,
            percentage: orderCount > 0 ? Math.round((count / orderCount) * 100) : 0,
        }));

        const productStats: Record<string, ProductStats> = {};
        for (const order of orders) {
            for (const line of order.orderLines) {
                const productName = line.sku?.variation?.product?.name || 'Unknown';
                if (!productStats[productName]) {
                    productStats[productName] = { units: 0, revenue: 0 };
                }
                productStats[productName].units += line.qty;
                productStats[productName].revenue += line.qty * line.unitPrice;
            }
        }

        const topProducts: TopProduct[] = Object.entries(productStats)
            .map(([name, stats]) => ({ name, ...stats }))
            .sort((a, b) => b.units - a.units)
            .slice(0, 10);

        const analytics = {
            orderCount,
            totalRevenue,
            avgValue,
            channelSplit,
            topProducts,
        };

        // Filter confidential fields based on user permissions
        const filtered = filterConfidentialFields(analytics, req.userPermissions);
        res.json(filtered);
    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Get archived analytics error');
        res.status(500).json({ error: 'Failed to fetch archived analytics' });
    }
});

// Get archived orders (paginated, optionally filtered by days)
router.get('/status/archived', async (req: Request, res: Response) => {
    try {
        const { limit = '100', offset = '0', days, sortBy = 'archivedAt' } = req.query as ArchivedOrdersQuery;
        const take = Number(limit);
        const skip = Number(offset);

        const where: Prisma.OrderWhereInput = { isArchived: true };
        if (days) {
            const sinceDate = new Date();
            sinceDate.setDate(sinceDate.getDate() - Number(days));
            where.orderDate = { gte: sinceDate };
        }

        const orderBy: Prisma.OrderOrderByWithRelationInput = sortBy === 'orderDate'
            ? { orderDate: 'desc' }
            : { archivedAt: 'desc' };

        const [orders, totalCount] = await Promise.all([
            req.prisma.order.findMany({
                where,
                select: {
                    id: true,
                    orderNumber: true,
                    shopifyOrderId: true,
                    status: true,
                    channel: true,
                    orderDate: true,
                    shippedAt: true,
                    deliveredAt: true,
                    archivedAt: true,
                    totalAmount: true,
                    paymentMethod: true,
                    customerName: true,
                    customerEmail: true,
                    customerPhone: true,
                    customerId: true,
                    shippingAddress: true,
                    courier: true,
                    awbNumber: true,
                    trackingStatus: true,
                    expectedDeliveryDate: true,
                    deliveryAttempts: true,
                    courierStatusCode: true,
                    lastScanLocation: true,
                    lastScanAt: true,
                    lastScanStatus: true,
                    lastTrackingUpdate: true,
                    codRemittedAt: true,
                    codRemittanceUtr: true,
                    codRemittedAmount: true,
                    customer: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        }
                    },
                    orderLines: {
                        select: {
                            id: true,
                            qty: true,
                            sku: {
                                select: {
                                    skuCode: true,
                                    variation: {
                                        select: {
                                            colorName: true,
                                            product: { select: { name: true } },
                                        }
                                    }
                                }
                            }
                        }
                    },
                    shopifyCache: {
                        select: {
                            financialStatus: true,
                            fulfillmentStatus: true,
                        }
                    },
                },
                orderBy,
                take,
                skip,
            }),
            req.prisma.order.count({ where }),
        ]);

        const transformedOrders = orders.map((order) => {
            let deliveryDays: number | null = null;
            const shippedDate = order.shippedAt ? new Date(order.shippedAt) : null;
            const deliveredDate = order.deliveredAt ? new Date(order.deliveredAt) : null;
            if (shippedDate && deliveredDate) {
                deliveryDays = Math.round((deliveredDate.getTime() - shippedDate.getTime()) / (1000 * 60 * 60 * 24));
            }

            return {
                ...order,
                deliveryDays,
                customerTier: (order.customer as { tier?: string } | null)?.tier,
                customerLtv: (order.customer as { lifetimeValue?: number } | null)?.lifetimeValue,
                shopifyFinancialStatus: order.shopifyCache?.financialStatus,
                shopifyFulfillmentStatus: order.shopifyCache?.fulfillmentStatus,
            };
        });

        // Filter confidential fields based on user permissions
        const filteredOrders = filterConfidentialFields(transformedOrders, req.userPermissions);
        res.json({ orders: filteredOrders, totalCount, limit: take, offset: skip, sortBy });
    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Get archived orders error');
        res.status(500).json({ error: 'Failed to fetch archived orders' });
    }
});

// Get cancelled lines (line-level view for cancelled tab)
router.get('/status/cancelled', async (req: Request, res: Response) => {
    try {
        const cancelledLines = await req.prisma.orderLine.findMany({
            where: {
                lineStatus: 'cancelled',
                order: {
                    isArchived: false,
                    releasedToCancelled: true,
                },
            },
            include: {
                order: {
                    include: {
                        customer: true,
                    },
                },
                sku: {
                    include: {
                        variation: {
                            include: { product: true, fabric: true },
                        },
                    },
                },
            },
            orderBy: { order: { createdAt: 'desc' } },
        });

        const rows = cancelledLines.map((line: OrderLineWithDetails) => {
            const order = line.order;
            return {
                id: order.id,
                orderNumber: order.orderNumber,
                customerId: order.customerId,
                customerName: order.customerName,
                customerEmail: order.customerEmail,
                customerPhone: order.customerPhone,
                shippingAddress: order.shippingAddress,
                channel: order.channel,
                orderDate: order.orderDate,
                paymentMethod: order.paymentMethod,
                status: order.status,
                partiallyCancelled: order.partiallyCancelled,
                customer: order.customer,
                lineId: line.id,
                lineStatus: line.lineStatus,
                orderLines: [line],
                totalAmount: (line.unitPrice || 0) * (line.qty || 1),
                _isLineView: true,
            };
        });

        // Filter confidential fields based on user permissions
        const filteredRows = filterConfidentialFields(rows, req.userPermissions);
        res.json(filteredRows);
    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Get cancelled lines error');
        res.status(500).json({ error: 'Failed to fetch cancelled lines' });
    }
});

export default router;
