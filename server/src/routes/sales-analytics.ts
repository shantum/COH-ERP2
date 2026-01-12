/**
 * Sales Analytics API
 * Provides sales data aggregated by various dimensions
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PrismaClient, Prisma } from '@prisma/client';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';

const router: Router = Router();

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Summary metrics for sales analytics
 */
interface SummaryMetrics {
    totalRevenue: number;
    totalUnits: number;
    totalOrders: number;
    avgOrderValue: number;
}

/**
 * Time series data point for daily aggregation
 */
interface TimeSeriesDataPoint {
    date: string;
    revenue: number;
    units: number;
    orders: number;
}

/**
 * Breakdown item by dimension
 */
interface BreakdownItem {
    key: string;
    keyId: string | number | null;
    revenue: number;
    units: number;
    orders: number;
    percentOfTotal: number;
}

/**
 * Dimension key result from getDimensionKey
 */
interface DimensionKeyResult {
    key: string | null;
    keyId: string | number | null;
}

/**
 * Internal aggregation group for breakdown calculation
 */
interface AggregationGroup {
    key: string;
    keyId: string | number | null;
    revenue: number;
    units: number;
    orderIds: Set<string>;
}

/**
 * Internal daily aggregation for time series
 */
interface DailyAggregation {
    date: string;
    revenue: number;
    units: number;
    orderIds: Set<string>;
}

/**
 * Order line from summary metrics query
 */
interface SummaryOrderLine {
    qty: number;
    unitPrice: number;
    orderId: string;
}

/**
 * Order line from time series query
 */
interface TimeSeriesOrderLine {
    qty: number;
    unitPrice: number;
    orderId: string;
    order: {
        orderDate: Date;
    };
}

/**
 * Order line from breakdown query with full hierarchy
 */
interface BreakdownOrderLine {
    qty: number;
    unitPrice: number;
    orderId: string;
    sku: {
        id: string;
        variation: {
            id: string;
            colorName: string | null;
            standardColor: string | null;
            fabric: {
                id: string;
                colorName: string;
                fabricType: {
                    id: string;
                    name: string;
                } | null;
            } | null;
            product: {
                id: string;
                name: string;
                category: string | null;
                gender: string | null;
            };
        };
    } | null;
    order: {
        channel: string | null;
    };
}

/**
 * Valid dimension values for breakdown
 */
type Dimension =
    | 'summary'
    | 'product'
    | 'category'
    | 'gender'
    | 'color'
    | 'standardColor'
    | 'fabricType'
    | 'fabricColor'
    | 'channel';

/**
 * Valid order status filter values
 */
type OrderStatusFilter = 'all' | 'shipped' | 'delivered';

/**
 * Base where clause type for order line queries
 */
type OrderLineWhereInput = Prisma.OrderLineWhereInput;

/**
 * Status filter type for Prisma queries
 */
type StatusFilter = { in: string[] } | { notIn: string[] };

// ============================================================================
// Route Handlers
// ============================================================================

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
router.get(
    '/',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response) => {
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

        const start = startDate ? new Date(startDate as string) : defaultStart;
        const end = endDate ? new Date(endDate as string) : now;
        // Set end date to end of day
        end.setHours(23, 59, 59, 999);

        // Build status filter based on orderStatus param
        let statusFilter: StatusFilter;
        if (orderStatus === 'delivered') {
            statusFilter = { in: ['delivered'] };
        } else if (orderStatus === 'all') {
            statusFilter = { notIn: ['cancelled'] };
        } else {
            // Default: shipped (includes shipped and delivered)
            statusFilter = { in: ['shipped', 'delivered'] };
        }

        // Base where clause for order lines (includes archived orders for complete analytics)
        // Excludes zero-value orders (exchange/replacement orders from Return Prime)
        const baseWhere: OrderLineWhereInput = {
            order: {
                orderDate: { gte: start, lte: end },
                status: statusFilter,
                totalAmount: { gt: 0 },
            },
        };

        // Get summary metrics
        const summary = await getSummaryMetrics(req.prisma, baseWhere);

        // Get time series data for charts
        const timeSeries = await getTimeSeries(
            req.prisma,
            start,
            end,
            statusFilter
        );

        // Get dimension breakdown if not summary
        let breakdown: BreakdownItem[] | null = null;
        if (dimension !== 'summary') {
            breakdown = await getBreakdown(
                req.prisma,
                baseWhere,
                dimension as Dimension,
                summary.totalRevenue
            );
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
    })
);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get summary metrics (total revenue, units, orders, avg order value)
 */
async function getSummaryMetrics(
    prisma: PrismaClient,
    baseWhere: OrderLineWhereInput
): Promise<SummaryMetrics> {
    // Get all order lines matching criteria
    const orderLines = (await prisma.orderLine.findMany({
        where: baseWhere,
        select: {
            qty: true,
            unitPrice: true,
            orderId: true,
        },
    })) as SummaryOrderLine[];

    // Calculate metrics
    let totalRevenue = 0;
    let totalUnits = 0;
    const orderIds = new Set<string>();

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
async function getTimeSeries(
    prisma: PrismaClient,
    startDate: Date,
    endDate: Date,
    statusFilter: StatusFilter
): Promise<TimeSeriesDataPoint[]> {
    // Get all order lines with order dates (excludes zero-value exchange orders)
    const orderLines = (await prisma.orderLine.findMany({
        where: {
            order: {
                orderDate: { gte: startDate, lte: endDate },
                status: statusFilter,
                totalAmount: { gt: 0 },
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
    })) as TimeSeriesOrderLine[];

    // Aggregate by date
    const dateMap = new Map<string, DailyAggregation>();

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

        const day = dateMap.get(dateKey)!;
        day.revenue += line.qty * line.unitPrice;
        day.units += line.qty;
        day.orderIds.add(line.orderId);
    }

    // Convert to array and add order count
    const result = Array.from(dateMap.values())
        .map((day) => ({
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
async function getBreakdown(
    prisma: PrismaClient,
    baseWhere: OrderLineWhereInput,
    dimension: Dimension,
    totalRevenue: number
): Promise<BreakdownItem[]> {
    // Fetch order lines with full hierarchy
    const orderLines = (await prisma.orderLine.findMany({
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
    })) as BreakdownOrderLine[];

    // Aggregate by dimension
    const groups = new Map<string, AggregationGroup>();

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

        const group = groups.get(key)!;
        group.revenue += line.qty * line.unitPrice;
        group.units += line.qty;
        group.orderIds.add(line.orderId);
    }

    // Convert to array with percentages
    const result = Array.from(groups.values())
        .map((group) => ({
            key: group.key,
            keyId: group.keyId,
            revenue: Math.round(group.revenue * 100) / 100,
            units: group.units,
            orders: group.orderIds.size,
            percentOfTotal:
                totalRevenue > 0
                    ? Math.round((group.revenue / totalRevenue) * 10000) / 100
                    : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);

    return result;
}

/**
 * Get the grouping key based on dimension
 */
function getDimensionKey(
    line: BreakdownOrderLine,
    dimension: Dimension
): DimensionKeyResult {
    const sku = line.sku;
    const variation = sku?.variation;
    const product = variation?.product;
    const fabric = variation?.fabric;
    const fabricType = fabric?.fabricType;

    switch (dimension) {
        case 'product':
            return {
                key: product?.name || 'Unknown',
                keyId: product?.id ?? null,
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
                keyId: variation?.id ?? null,
            };

        case 'standardColor':
            return {
                key: variation?.standardColor || 'Other',
                keyId: null,
            };

        case 'fabricType':
            return {
                key: fabricType?.name || 'Unknown',
                keyId: fabricType?.id ?? null,
            };

        case 'fabricColor':
            return {
                key: fabric?.colorName || 'Unknown',
                keyId: fabric?.id ?? null,
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
