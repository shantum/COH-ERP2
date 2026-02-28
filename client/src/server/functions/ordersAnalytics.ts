/**
 * Orders Analytics Server Function
 *
 * Returns analytics data for the OrdersAnalyticsBar component.
 * Extracted from orders.ts for maintainability.
 */

import { createServerFn } from '@tanstack/react-start';
import { getPrisma } from '@coh/shared/services/db';
import { authMiddleware } from '../middleware/auth';
import { getISTMidnightAsUTC, getISTMonthStartAsUTC, getISTMonthEndAsUTC } from '@coh/shared';
import type { OrdersAnalyticsResponse, TopProduct } from './orderTypes';
import { serverLog } from './serverLog';

// ============================================
// ORDERS ANALYTICS - Server Function
// ============================================

/**
 * Server Function: Get orders analytics
 *
 * Returns analytics data for the OrdersAnalyticsBar component.
 * Includes pipeline counts, revenue data, payment split, and top products.
 */
export const getOrdersAnalytics = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<OrdersAnalyticsResponse> => {
        try {
            const prisma = await getPrisma();

            // Calculate date ranges in IST timezone for user-facing analytics
            // All dates are converted to UTC for database queries
            const todayStart = getISTMidnightAsUTC(0);
            const yesterdayStart = getISTMidnightAsUTC(-1);
            const yesterdayEnd = todayStart; // Yesterday ends when today starts
            const last7DaysStart = getISTMidnightAsUTC(-7);
            const last30DaysStart = getISTMidnightAsUTC(-30);
            const thisMonthStart = getISTMonthStartAsUTC(0);
            const lastMonthStart = getISTMonthStartAsUTC(-1);
            const lastMonthEnd = getISTMonthEndAsUTC(-1);

            // Open orders base filter
            const openFilter = {
                isArchived: false,
                OR: [
                    { status: 'open' },
                    {
                        AND: [{ releasedToShipped: false }, { releasedToCancelled: false }],
                    },
                ],
            };

            // Get pipeline counts by line status
            const [totalOrders, pendingLines, allocatedLines, readyLines, totalUnits] = await Promise.all([
                prisma.order.count({ where: openFilter }),
                prisma.orderLine.count({
                    where: {
                        order: openFilter,
                        lineStatus: 'pending',
                    },
                }),
                prisma.orderLine.count({
                    where: {
                        order: openFilter,
                        lineStatus: 'allocated',
                    },
                }),
                prisma.orderLine.count({
                    where: {
                        order: openFilter,
                        lineStatus: 'packed',
                    },
                }),
                prisma.orderLine.aggregate({
                    where: { order: openFilter },
                    _sum: { qty: true },
                }),
            ]);

            // Get payment split
            const [codOrders, prepaidOrders] = await Promise.all([
                prisma.order.aggregate({
                    where: { ...openFilter, paymentMethod: 'COD' },
                    _count: true,
                    _sum: { totalAmount: true },
                }),
                prisma.order.aggregate({
                    where: { ...openFilter, paymentMethod: { not: 'COD' } },
                    _count: true,
                    _sum: { totalAmount: true },
                }),
            ]);

            // Get revenue data for different periods
            const getRevenueForPeriod = async (startDate: Date, endDate?: Date) => {
                const dateFilter = endDate
                    ? { orderDate: { gte: startDate, lt: endDate } }
                    : { orderDate: { gte: startDate } };

                const result = await prisma.order.aggregate({
                    where: {
                        ...dateFilter,
                        releasedToCancelled: false,
                    },
                    _sum: { totalAmount: true },
                    _count: true,
                });

                // Get customer breakdown (new vs returning) using count queries
                const newCustomers = await prisma.order.count({
                    where: {
                        ...dateFilter,
                        releasedToCancelled: false,
                        customer: { orderCount: 1 },
                    },
                });
                const totalOrders = result._count;
                const returningCustomers = totalOrders - newCustomers;
                const total = totalOrders || 1;

                return {
                    total: result._sum.totalAmount || 0,
                    orderCount: result._count,
                    change: null as number | null,
                    customers: {
                        newCustomers,
                        returningCustomers,
                        newPercent: Math.round((newCustomers / total) * 100),
                        returningPercent: Math.round((returningCustomers / total) * 100),
                    },
                };
            };

            // Get all revenue data in parallel
            const [today, yesterday, last7Days, last30Days, lastMonth, thisMonth] = await Promise.all([
                getRevenueForPeriod(todayStart),
                getRevenueForPeriod(yesterdayStart, yesterdayEnd),
                getRevenueForPeriod(last7DaysStart),
                getRevenueForPeriod(last30DaysStart),
                getRevenueForPeriod(lastMonthStart, lastMonthEnd),
                getRevenueForPeriod(thisMonthStart),
            ]);

            // Calculate change percentages
            if (yesterday.total > 0) {
                today.change = Math.round(((today.total - yesterday.total) / yesterday.total) * 100);
            }

            // Get top products from last 30 days
            const topProductsData = await prisma.orderLine.groupBy({
                by: ['skuId'],
                where: {
                    order: {
                        orderDate: { gte: last30DaysStart },
                        releasedToCancelled: false,
                    },
                },
                _sum: { qty: true, unitPrice: true },
                _count: { orderId: true },
                orderBy: { _sum: { qty: 'desc' } },
                take: 10,
            });

            // Get product details for top products
            const skuIds = topProductsData.map((p: { skuId: string }) => p.skuId);
            const skuDetails = await prisma.sku.findMany({
                where: { id: { in: skuIds } },
                include: {
                    variation: {
                        include: {
                            product: {
                                select: { id: true, name: true, imageUrl: true },
                            },
                        },
                    },
                },
            });

            type SkuDetail = typeof skuDetails[number];
            const skuMap = new Map<string, SkuDetail>(skuDetails.map((s) => [s.id, s]));

            // Aggregate by product
            const productAggregates = new Map<string, TopProduct>();
            for (const item of topProductsData) {
                const sku = skuMap.get(item.skuId);
                if (!sku) continue;

                const product = sku.variation.product;
                const existing = productAggregates.get(product.id);
                const qty = item._sum.qty || 0;
                const salesValue = (item._sum.unitPrice || 0) * qty;

                if (existing) {
                    existing.qty += qty;
                    existing.orderCount += item._count.orderId;
                    existing.salesValue += salesValue;
                    existing.variants.push({
                        name: `${sku.variation.colorName} - ${sku.size}`,
                        qty,
                    });
                } else {
                    productAggregates.set(product.id, {
                        id: product.id,
                        name: product.name,
                        imageUrl: product.imageUrl || sku.variation.imageUrl,
                        qty,
                        orderCount: item._count.orderId,
                        salesValue,
                        variants: [{
                            name: `${sku.variation.colorName} - ${sku.size}`,
                            qty,
                        }],
                    });
                }
            }

            const topProducts = Array.from(productAggregates.values())
                .sort((a, b) => b.qty - a.qty)
                .slice(0, 6);

            return {
                totalOrders,
                pendingOrders: pendingLines,
                allocatedOrders: allocatedLines,
                readyToShip: readyLines,
                totalUnits: totalUnits._sum.qty || 0,
                paymentSplit: {
                    cod: {
                        count: codOrders._count,
                        amount: codOrders._sum.totalAmount || 0,
                    },
                    prepaid: {
                        count: prepaidOrders._count,
                        amount: prepaidOrders._sum.totalAmount || 0,
                    },
                },
                topProducts,
                revenue: {
                    today,
                    yesterday,
                    last7Days,
                    last30Days,
                    lastMonth,
                    thisMonth,
                },
            };
        } catch (error: unknown) {
            serverLog.error({ domain: 'orders', fn: 'getOrdersAnalytics' }, 'Failed to get orders analytics', error);
            throw error;
        }
    });
