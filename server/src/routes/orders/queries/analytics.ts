/**
 * Order Analytics
 * Analytics for open orders and dashboard stats
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { orderLogger } from '../../../utils/logger.js';
import {
    todayStartIST,
    yesterdayStartIST,
    daysAgoStartIST,
    thisMonthStartIST,
    lastMonthStartIST,
    lastMonthEndIST,
    sameTimeYesterdayIST,
    sameTimeLastMonthIST,
} from '../../../utils/dateHelpers.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

interface AnalyticsOrder {
    id: string;
    paymentMethod: string | null;
    totalAmount: number | null;
    orderLines: Array<{
        qty: number;
        lineStatus: string | null;
        sku: {
            variation: {
                imageUrl: string | null;
                product: { id: string; name: string; imageUrl: string | null } | null;
            } | null;
        } | null;
    }>;
}

interface RevenueOrder {
    totalAmount: number | null;
    paymentMethod: string | null;
    orderDate: Date | null;
    customerId: string | null;
}

interface ProductData {
    id: string;
    name: string;
    imageUrl: string | null;
    qty: number;
    orderCount: number;
    salesValue: number;
    variants: Record<string, { name: string; qty: number }>;
}

interface RevenuePeriod {
    total: number;
    orderCount: number;
}

interface CustomerStats {
    newCustomers: number;
    returningCustomers: number;
    newPercent: number;
    returningPercent: number;
}

interface RevenuePeriodFull extends RevenuePeriod {
    change: number | null;
    customers: CustomerStats;
}

// ============================================
// ORDERS ANALYTICS
// ============================================

/**
 * GET /orders/analytics
 * Returns analytics for open orders: pending count, payment split, top products
 */
router.get('/analytics', async (req: Request, res: Response) => {
    try {
        // Get open orders with their lines for analysis
        const openOrders = await req.prisma.order.findMany({
            where: {
                status: 'open',
                isArchived: false,
            },
            select: {
                id: true,
                paymentMethod: true,
                totalAmount: true,
                orderLines: {
                    where: { lineStatus: { not: 'cancelled' } },
                    select: {
                        qty: true,
                        lineStatus: true,
                        sku: {
                            select: {
                                variation: {
                                    select: {
                                        imageUrl: true,
                                        product: {
                                            select: { id: true, name: true, imageUrl: true }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }) as AnalyticsOrder[];

        // Get orders for revenue calculations across multiple time periods
        // All date boundaries use IST (UTC+5:30) for consistency with Indian business hours
        const todayStart = todayStartIST();

        // Current periods (IST)
        const yesterdayStart = yesterdayStartIST();
        const last7DaysStart = daysAgoStartIST(7);
        const last30DaysStart = daysAgoStartIST(30);
        const thisMonthStart = thisMonthStartIST();
        const lastMonthStart = lastMonthStartIST();
        const lastMonthEnd = lastMonthEndIST();

        // Comparison periods (IST)
        const dayBeforeYesterdayStart = daysAgoStartIST(2);
        const prior7DaysStart = daysAgoStartIST(14);
        const prior7DaysEnd = daysAgoStartIST(7);
        const prior30DaysStart = daysAgoStartIST(60);
        const prior30DaysEnd = daysAgoStartIST(30);
        // For month-before-last, use IST-aware calculation
        const monthBeforeLastStart = (() => {
            const ist = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
            const first = new Date(ist.getFullYear(), ist.getMonth() - 2, 1);
            return new Date(first.getTime() - (5 * 60 + 30) * 60 * 1000);
        })();
        const monthBeforeLastEnd = lastMonthStart;

        // For same-time comparisons
        const yesterdaySameTime = sameTimeYesterdayIST();
        const lastMonthSameDateTime = sameTimeLastMonthIST();

        // Get ALL orders from 60+ days ago for all comparisons
        const recentOrders = await req.prisma.order.findMany({
            where: {
                orderDate: { gte: monthBeforeLastStart },
            },
            select: {
                totalAmount: true,
                paymentMethod: true,
                orderDate: true,
                customerId: true,
            }
        }) as RevenueOrder[];

        // Get first order date for each customer
        const customerFirstOrders = await req.prisma.order.groupBy({
            by: ['customerId'],
            _min: { orderDate: true },
            where: { customerId: { not: null } },
        });
        const customerFirstOrderMap = new Map<string, Date>();
        customerFirstOrders.forEach((c) => {
            if (c.customerId && c._min.orderDate) {
                customerFirstOrderMap.set(c.customerId, new Date(c._min.orderDate));
            }
        });

        const filterByDateRange = (orders: RevenueOrder[], start: Date, end: Date | null = null): RevenueOrder[] => {
            return orders.filter((o) => {
                if (!o.orderDate) return false;
                const date = new Date(o.orderDate);
                if (end) {
                    return date >= start && date < end;
                }
                return date >= start;
            });
        };

        const calcRevenue = (orders: RevenueOrder[]): RevenuePeriod => ({
            total: orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
            orderCount: orders.length,
        });

        const calcCustomerStats = (orders: RevenueOrder[], periodStart: Date): CustomerStats => {
            let newCustomers = 0;
            let returningCustomers = 0;
            const seenCustomers = new Set<string>();

            orders.forEach((o) => {
                if (!o.customerId || seenCustomers.has(o.customerId)) return;
                seenCustomers.add(o.customerId);

                const firstOrderDate = customerFirstOrderMap.get(o.customerId);
                if (firstOrderDate && firstOrderDate >= periodStart) {
                    newCustomers++;
                } else {
                    returningCustomers++;
                }
            });

            const total = newCustomers + returningCustomers;
            return {
                newCustomers,
                returningCustomers,
                newPercent: total > 0 ? Math.round((newCustomers / total) * 100) : 0,
                returningPercent: total > 0 ? Math.round((returningCustomers / total) * 100) : 0,
            };
        };

        const calcChange = (current: number, previous: number): number | null => {
            if (!previous || previous === 0) return null;
            return ((current - previous) / previous) * 100;
        };

        // Calculate all revenue periods
        const todayOrders = filterByDateRange(recentOrders, todayStart);
        const yesterdayOrders = filterByDateRange(recentOrders, yesterdayStart, todayStart);
        const last7DaysOrders = filterByDateRange(recentOrders, last7DaysStart);
        const last30DaysOrdersFiltered = filterByDateRange(recentOrders, last30DaysStart);
        const lastMonthOrders = filterByDateRange(recentOrders, lastMonthStart, lastMonthEnd);
        const thisMonthOrders = filterByDateRange(recentOrders, thisMonthStart);

        const todayRevenue = calcRevenue(todayOrders);
        const yesterdaySameTimeRevenue = calcRevenue(filterByDateRange(recentOrders, yesterdayStart, yesterdaySameTime));
        const yesterdayRevenue = calcRevenue(yesterdayOrders);
        const dayBeforeYesterdayRevenue = calcRevenue(filterByDateRange(recentOrders, dayBeforeYesterdayStart, yesterdayStart));
        const last7DaysRevenue = calcRevenue(last7DaysOrders);
        const prior7DaysRevenue = calcRevenue(filterByDateRange(recentOrders, prior7DaysStart, prior7DaysEnd));
        const last30DaysRevenue = calcRevenue(last30DaysOrdersFiltered);
        const prior30DaysRevenue = calcRevenue(filterByDateRange(recentOrders, prior30DaysStart, prior30DaysEnd));
        const lastMonthRevenue = calcRevenue(lastMonthOrders);
        const monthBeforeLastRevenue = calcRevenue(filterByDateRange(recentOrders, monthBeforeLastStart, monthBeforeLastEnd));
        const thisMonthRevenue = calcRevenue(thisMonthOrders);
        const lastMonthSamePeriodRevenue = calcRevenue(filterByDateRange(recentOrders, lastMonthStart, lastMonthSameDateTime));

        // Calculate customer stats
        const todayCustomers = calcCustomerStats(todayOrders, todayStart);
        const yesterdayCustomers = calcCustomerStats(yesterdayOrders, yesterdayStart);
        const last7DaysCustomers = calcCustomerStats(last7DaysOrders, last7DaysStart);
        const last30DaysCustomers = calcCustomerStats(last30DaysOrdersFiltered, last30DaysStart);
        const lastMonthCustomers = calcCustomerStats(lastMonthOrders, lastMonthStart);
        const thisMonthCustomers = calcCustomerStats(thisMonthOrders, thisMonthStart);

        const revenue: Record<string, RevenuePeriodFull> = {
            today: { ...todayRevenue, change: calcChange(todayRevenue.total, yesterdaySameTimeRevenue.total), customers: todayCustomers },
            yesterday: { ...yesterdayRevenue, change: calcChange(yesterdayRevenue.total, dayBeforeYesterdayRevenue.total), customers: yesterdayCustomers },
            last7Days: { ...last7DaysRevenue, change: calcChange(last7DaysRevenue.total, prior7DaysRevenue.total), customers: last7DaysCustomers },
            last30Days: { ...last30DaysRevenue, change: calcChange(last30DaysRevenue.total, prior30DaysRevenue.total), customers: last30DaysCustomers },
            lastMonth: { ...lastMonthRevenue, change: calcChange(lastMonthRevenue.total, monthBeforeLastRevenue.total), customers: lastMonthCustomers },
            thisMonth: { ...thisMonthRevenue, change: calcChange(thisMonthRevenue.total, lastMonthSamePeriodRevenue.total), customers: thisMonthCustomers },
        };

        // Count pending orders
        const pendingOrders = openOrders.filter((o) =>
            o.orderLines.some((l) => l.lineStatus === 'pending')
        ).length;

        // Count allocated orders
        const allocatedOrders = openOrders.filter((o) =>
            o.orderLines.length > 0 && o.orderLines.every((l) => l.lineStatus !== 'pending')
        ).length;

        // Count ready to ship
        const readyToShip = openOrders.filter((o) =>
            o.orderLines.length > 0 && o.orderLines.every((l) => l.lineStatus === 'packed')
        ).length;

        // Payment method split
        const codOrders = openOrders.filter((o) => o.paymentMethod?.toLowerCase() === 'cod');
        const prepaidOrders = openOrders.filter((o) => o.paymentMethod?.toLowerCase() !== 'cod');

        const paymentSplit = {
            cod: {
                count: codOrders.length,
                amount: codOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0)
            },
            prepaid: {
                count: prepaidOrders.length,
                amount: prepaidOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0)
            }
        };

        // Top products by quantity sold in last 30 days
        const last30DaysOrdersForProducts = await req.prisma.order.findMany({
            where: {
                orderDate: { gte: last30DaysStart },
            },
            select: {
                totalAmount: true,
                orderLines: {
                    select: {
                        qty: true,
                        unitPrice: true,
                        sku: {
                            select: {
                                variation: {
                                    select: {
                                        id: true,
                                        colorName: true,
                                        imageUrl: true,
                                        product: {
                                            select: { id: true, name: true, imageUrl: true }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        interface ProductOrderLine {
            qty: number;
            unitPrice: number;
            sku: {
                variation: {
                    id: string;
                    colorName: string | null;
                    imageUrl: string | null;
                    product: { id: string; name: string; imageUrl: string | null } | null;
                } | null;
            } | null;
        }

        interface ProductOrder {
            totalAmount: number | null;
            orderLines: ProductOrderLine[];
        }

        const productData: Record<string, ProductData> = {};
        (last30DaysOrdersForProducts as ProductOrder[]).forEach((order) => {
            order.orderLines.forEach((line) => {
                const variation = line.sku?.variation;
                const product = variation?.product;
                const productId = product?.id;
                if (!productId) return;

                if (!productData[productId]) {
                    const imageUrl = variation?.imageUrl || product?.imageUrl || null;
                    productData[productId] = {
                        id: productId,
                        name: product.name,
                        imageUrl,
                        qty: 0,
                        orderCount: 0,
                        salesValue: 0,
                        variants: {},
                    };
                }
                productData[productId].qty += line.qty;
                productData[productId].orderCount += 1;
                productData[productId].salesValue += (line.unitPrice || 0) * line.qty;

                const variantId = variation?.id;
                const variantName = variation?.colorName || 'Unknown';
                if (variantId) {
                    if (!productData[productId].variants[variantId]) {
                        productData[productId].variants[variantId] = {
                            name: variantName,
                            qty: 0,
                        };
                    }
                    productData[productId].variants[variantId].qty += line.qty;
                }
            });
        });

        interface ProductDataWithVariantsArray extends Omit<ProductData, 'variants'> {
            variants: Array<{ name: string; qty: number }>;
        }

        const productDataArray: ProductDataWithVariantsArray[] = Object.values(productData).map((product) => ({
            ...product,
            variants: Object.values(product.variants)
                .sort((a, b) => b.qty - a.qty)
                .slice(0, 5),
        }));

        const topProducts = productDataArray
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 10);

        // Total units in open orders
        const totalUnits = openOrders.reduce((sum, o) =>
            sum + o.orderLines.reduce((lineSum, l) => lineSum + l.qty, 0), 0
        );

        res.json({
            totalOrders: openOrders.length,
            pendingOrders,
            allocatedOrders,
            readyToShip,
            totalUnits,
            paymentSplit,
            topProducts,
            revenue,
        });
    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Orders analytics error');
        res.status(500).json({ error: 'Failed to fetch orders analytics' });
    }
});

// ============================================
// DASHBOARD STATS
// ============================================

/**
 * GET /orders/dashboard-stats
 * Returns counts for all action queues (for dashboard summary)
 *
 * NOTE: After migration, tracking fields are on OrderLine, not Order.
 * Dashboard stats now use line-level queries for accurate counts.
 */
router.get('/dashboard-stats', async (req: Request, res: Response) => {
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // Run all count queries in parallel
        // Use line-level fields for tracking data, order-level for status/payment
        const [
            readyToShip,
            needsAttention,
            inTransit,
            rtoInProgress,
            codAtRisk,
            pendingPayment,
            completed,
        ] = await Promise.all([
            // Ready to ship: Open orders with at least one packed line
            req.prisma.order.count({
                where: {
                    status: 'open',
                    isArchived: false,
                    // Has at least one packed line
                    orderLines: {
                        some: { lineStatus: 'packed' },
                    },
                },
            }),

            // Needs attention: Orders with RTO delivered but not processed
            req.prisma.order.count({
                where: {
                    isArchived: false,
                    orderLines: {
                        some: {
                            trackingStatus: 'rto_delivered',
                            rtoReceivedAt: null,
                        },
                    },
                },
            }),

            // In transit: Shipped lines not yet delivered, not RTO
            req.prisma.order.count({
                where: {
                    status: 'shipped',
                    isArchived: false,
                    orderLines: {
                        some: {
                            lineStatus: 'shipped',
                            deliveredAt: null,
                            trackingStatus: { notIn: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] },
                        },
                    },
                },
            }),

            // RTO in progress: Lines with RTO status
            req.prisma.order.count({
                where: {
                    isArchived: false,
                    orderLines: {
                        some: {
                            trackingStatus: { in: ['rto_initiated', 'rto_in_transit'] },
                        },
                    },
                },
            }),

            // COD at risk: COD shipped > 7 days ago, not delivered
            req.prisma.order.count({
                where: {
                    status: 'shipped',
                    paymentMethod: 'COD',
                    isArchived: false,
                    orderLines: {
                        some: {
                            lineStatus: 'shipped',
                            shippedAt: { lt: sevenDaysAgo },
                            deliveredAt: null,
                        },
                    },
                },
            }),

            // Pending payment: Delivered COD awaiting remittance
            req.prisma.order.count({
                where: {
                    paymentMethod: 'COD',
                    codRemittedAt: null,
                    isArchived: false,
                    orderLines: {
                        every: {
                            OR: [
                                { lineStatus: 'cancelled' },
                                { deliveredAt: { not: null } },
                            ],
                        },
                        some: { deliveredAt: { not: null } },
                    },
                },
            }),

            // Completed: Orders with all lines in terminal state
            req.prisma.order.count({
                where: {
                    isArchived: false,
                    orderLines: {
                        every: {
                            OR: [
                                { deliveredAt: { not: null } },
                                { rtoReceivedAt: { not: null } },
                                { lineStatus: 'cancelled' },
                            ],
                        },
                    },
                },
            }),
        ]);

        res.json({
            readyToShip,
            needsAttention,
            inTransit,
            watchList: rtoInProgress + codAtRisk,
            rtoInProgress,
            codAtRisk,
            pendingPayment,
            completed,
        });
    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Dashboard stats error');
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

export default router;
