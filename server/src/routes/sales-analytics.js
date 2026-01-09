/**
 * Sales Analytics API
 * Provides sales data aggregated by various dimensions
 */

import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

/**
 * GET /sales-analytics
 * Returns sales metrics aggregated by the specified dimension
 *
 * Query params:
 * - dimension: summary | product | category | gender | color | standardColor | fabricType | fabricColor | channel
 * - startDate: ISO date string (default: 30 days ago)
 * - endDate: ISO date string (default: today)
 * - orderStatus: all | shipped | delivered (default: all)
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const {
            dimension = 'summary',
            startDate,
            endDate,
            orderStatus = 'all',
        } = req.query;

        // Parse dates
        const now = new Date();
        const defaultStart = new Date(now);
        defaultStart.setDate(defaultStart.getDate() - 30);

        const start = startDate ? new Date(startDate) : defaultStart;
        const end = endDate ? new Date(endDate) : now;
        // Set end date to end of day
        end.setHours(23, 59, 59, 999);

        // Build status filter based on orderStatus param
        let statusFilter;
        if (orderStatus === 'delivered') {
            statusFilter = { in: ['delivered'] };
        } else if (orderStatus === 'all') {
            statusFilter = { notIn: ['cancelled'] };
        } else {
            // Default: shipped (includes shipped and delivered)
            statusFilter = { in: ['shipped', 'delivered'] };
        }

        // Base where clause for order lines (includes archived orders for complete analytics)
        const baseWhere = {
            order: {
                orderDate: { gte: start, lte: end },
                status: statusFilter,
            },
        };

        // Get summary metrics
        const summary = await getSummaryMetrics(req.prisma, baseWhere);

        // Get time series data for charts
        const timeSeries = await getTimeSeries(req.prisma, start, end, statusFilter);

        // Get dimension breakdown if not summary
        let breakdown = null;
        if (dimension !== 'summary') {
            breakdown = await getBreakdown(req.prisma, baseWhere, dimension, summary.totalRevenue);
        }

        res.json({
            summary,
            timeSeries,
            breakdown,
            period: {
                startDate: start.toISOString(),
                endDate: end.toISOString(),
            },
        });
    } catch (error) {
        console.error('Sales analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch sales analytics' });
    }
});

/**
 * Get summary metrics (total revenue, units, orders, avg order value)
 */
async function getSummaryMetrics(prisma, baseWhere) {
    // Get all order lines matching criteria
    const orderLines = await prisma.orderLine.findMany({
        where: baseWhere,
        select: {
            qty: true,
            unitPrice: true,
            orderId: true,
        },
    });

    // Calculate metrics
    let totalRevenue = 0;
    let totalUnits = 0;
    const orderIds = new Set();

    for (const line of orderLines) {
        totalRevenue += line.qty * line.unitPrice;
        totalUnits += line.qty;
        orderIds.add(line.orderId);
    }

    const totalOrders = orderIds.size;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalUnits,
        totalOrders,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
    };
}

/**
 * Get time series data (daily aggregation)
 */
async function getTimeSeries(prisma, startDate, endDate, statusFilter) {
    // Get all order lines with order dates
    const orderLines = await prisma.orderLine.findMany({
        where: {
            order: {
                orderDate: { gte: startDate, lte: endDate },
                status: statusFilter,
            },
        },
        select: {
            qty: true,
            unitPrice: true,
            orderId: true,
            order: {
                select: {
                    orderDate: true,
                },
            },
        },
    });

    // Aggregate by date
    const dateMap = new Map();

    for (const line of orderLines) {
        const dateKey = line.order.orderDate.toISOString().split('T')[0];

        if (!dateMap.has(dateKey)) {
            dateMap.set(dateKey, {
                date: dateKey,
                revenue: 0,
                units: 0,
                orderIds: new Set(),
            });
        }

        const day = dateMap.get(dateKey);
        day.revenue += line.qty * line.unitPrice;
        day.units += line.qty;
        day.orderIds.add(line.orderId);
    }

    // Convert to array and add order count
    const result = Array.from(dateMap.values())
        .map(day => ({
            date: day.date,
            revenue: Math.round(day.revenue * 100) / 100,
            units: day.units,
            orders: day.orderIds.size,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return result;
}

/**
 * Get breakdown by dimension
 */
async function getBreakdown(prisma, baseWhere, dimension, totalRevenue) {
    // Fetch order lines with full hierarchy
    const orderLines = await prisma.orderLine.findMany({
        where: baseWhere,
        select: {
            qty: true,
            unitPrice: true,
            orderId: true,
            sku: {
                select: {
                    id: true,
                    variation: {
                        select: {
                            id: true,
                            colorName: true,
                            standardColor: true,
                            fabric: {
                                select: {
                                    id: true,
                                    colorName: true,
                                    fabricType: {
                                        select: {
                                            id: true,
                                            name: true,
                                        },
                                    },
                                },
                            },
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    category: true,
                                    gender: true,
                                },
                            },
                        },
                    },
                },
            },
            order: {
                select: {
                    channel: true,
                },
            },
        },
    });

    // Aggregate by dimension
    const groups = new Map();

    for (const line of orderLines) {
        const { key, keyId } = getDimensionKey(line, dimension);
        if (!key) continue;

        if (!groups.has(key)) {
            groups.set(key, {
                key,
                keyId,
                revenue: 0,
                units: 0,
                orderIds: new Set(),
            });
        }

        const group = groups.get(key);
        group.revenue += line.qty * line.unitPrice;
        group.units += line.qty;
        group.orderIds.add(line.orderId);
    }

    // Convert to array with percentages
    const result = Array.from(groups.values())
        .map(group => ({
            key: group.key,
            keyId: group.keyId,
            revenue: Math.round(group.revenue * 100) / 100,
            units: group.units,
            orders: group.orderIds.size,
            percentOfTotal: totalRevenue > 0
                ? Math.round((group.revenue / totalRevenue) * 10000) / 100
                : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);

    return result;
}

/**
 * Get the grouping key based on dimension
 */
function getDimensionKey(line, dimension) {
    const sku = line.sku;
    const variation = sku?.variation;
    const product = variation?.product;
    const fabric = variation?.fabric;
    const fabricType = fabric?.fabricType;

    switch (dimension) {
        case 'product':
            return {
                key: product?.name || 'Unknown',
                keyId: product?.id,
            };

        case 'category':
            return {
                key: product?.category || 'Unknown',
                keyId: null,
            };

        case 'gender':
            return {
                key: product?.gender || 'Unknown',
                keyId: null,
            };

        case 'color':
            return {
                key: variation?.colorName || 'Unknown',
                keyId: variation?.id,
            };

        case 'standardColor':
            return {
                key: variation?.standardColor || 'Other',
                keyId: null,
            };

        case 'fabricType':
            return {
                key: fabricType?.name || 'Unknown',
                keyId: fabricType?.id,
            };

        case 'fabricColor':
            return {
                key: fabric?.colorName || 'Unknown',
                keyId: fabric?.id,
            };

        case 'channel':
            return {
                key: line.order?.channel || 'Unknown',
                keyId: null,
            };

        default:
            return { key: null, keyId: null };
    }
}

export default router;
