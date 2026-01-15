/**
 * List Orders Router
 * GET endpoints for listing and viewing orders
 *
 * Unified view-based architecture:
 * GET /orders?view=open|shipped|rto|cod_pending|archived
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import {
    buildViewWhereClause,
    enrichOrdersForView,
    ORDER_UNIFIED_SELECT,
    getValidViewNames,
    getViewConfig,
} from '../../utils/orderViews.js';
import { filterConfidentialFields } from '../../middleware/permissions.js';
import { orderLogger } from '../../utils/logger.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

/** Query parameters for order list endpoint */
interface OrderListQuery {
    view?: string;
    limit?: string;
    offset?: string;
    days?: string;
    search?: string;
    sortBy?: string;
    [key: string]: string | undefined;
}

/** Query parameters for search-all endpoint */
interface SearchAllQuery {
    q?: string;
    limit?: string;
}

/** Query parameters for summary endpoints */
interface SummaryQuery {
    days?: string;
}

/** Query parameters for archived orders */
interface ArchivedOrdersQuery {
    limit?: string;
    offset?: string;
    days?: string;
    sortBy?: string;
}

/** Tab result from search-all query */
interface TabResult {
    tab: string;
    orders: SearchResultOrder[];
}

/** Search result order (minimal fields) */
interface SearchResultOrder {
    id: string;
    orderNumber: string;
    customerName: string | null;
    status: string;
    paymentMethod: string | null;
    totalAmount: number | null;
    orderDate: Date | null;
    trackingStatus: string | null;
    awbNumber: string | null;
}

/** Tab display name mapping */
interface TabNames {
    [key: string]: string;
}

/** Order with order lines for filtering */
interface OrderWithLines {
    orderLines?: Array<{ lineStatus?: string | null }>;
    [key: string]: unknown;
}

/** Order line with full details */
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

/** Order with customer relation */
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

/** RTO order for summary calculation */
interface RtoOrder {
    id: string;
    trackingStatus: string | null;
    paymentMethod: string | null;
    totalAmount: number | null;
    rtoInitiatedAt: Date | null;
    rtoReceivedAt: Date | null;
}

/** Shipped order for summary calculation */
interface ShippedOrder {
    id: string;
    status: string;
    trackingStatus: string | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    paymentMethod: string | null;
}

/** Archived order for analytics */
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

/** Product stats accumulator */
interface ProductStats {
    units: number;
    revenue: number;
}

/** Channel split data */
interface ChannelSplit {
    channel: string;
    count: number;
    percentage: number;
}

/** Top product data */
interface TopProduct {
    name: string;
    units: number;
    revenue: number;
}

/** Analytics order for open orders */
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

/** Revenue order for analytics */
interface RevenueOrder {
    totalAmount: number | null;
    paymentMethod: string | null;
    orderDate: Date | null;
    customerId: string | null;
}

/** Product data accumulator for analytics */
interface ProductData {
    id: string;
    name: string;
    imageUrl: string | null;
    qty: number;
    orderCount: number;
    salesValue: number;
    variants: Record<string, { name: string; qty: number }>;
}

/** Revenue period stats */
interface RevenuePeriod {
    total: number;
    orderCount: number;
}

/** Customer stats for a period */
interface CustomerStats {
    newCustomers: number;
    returningCustomers: number;
    newPercent: number;
    returningPercent: number;
}

/** Full revenue period data */
interface RevenuePeriodFull extends RevenuePeriod {
    change: number | null;
    customers: CustomerStats;
}

// ============================================
// UNIFIED ORDERS LIST (View-based)
// ============================================

/**
 * GET /orders?view=<viewName>
 *
 * Unified endpoint for all order views.
 * Replaces individual /open, /shipped, /rto, /cod-pending endpoints.
 *
 * Query params:
 * - view: open|shipped|rto|cod_pending|archived|all (default: open)
 * - limit: Number of orders to return
 * - offset: Pagination offset
 * - days: Date range filter (for views with dateFilter)
 * - search: Search across orderNumber, customerName, awbNumber, email, phone
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const {
            view = 'open',
            limit,
            offset = '0',
            days,
            search,
            sortBy, // Extract sortBy to prevent it from being added to WHERE clause
            ...additionalFilters
        } = req.query as OrderListQuery;

        // Validate view
        const viewConfig = getViewConfig(view);
        if (!viewConfig) {
            return res.status(400).json({
                error: `Invalid view: ${view}`,
                validViews: getValidViewNames(),
            });
        }

        // Use view's default limit if not specified
        const take = Number(limit) || viewConfig.defaultLimit || 100;
        const skip = Number(offset);

        // Build WHERE clause using view config
        const where = buildViewWhereClause(view, {
            days,
            search,
            additionalFilters,
        });

        // Determine sort order - use sortBy param if valid, otherwise use view default
        let orderBy = viewConfig.orderBy;
        if (sortBy && ['orderDate', 'archivedAt', 'shippedAt', 'createdAt'].includes(sortBy)) {
            orderBy = { [sortBy]: 'desc' };
        }

        // Execute query with pagination
        // For COD pending view, also fetch total pending amount
        const queries: Promise<unknown>[] = [
            req.prisma.order.count({ where }),
            req.prisma.order.findMany({
                where,
                select: ORDER_UNIFIED_SELECT,
                orderBy,
                take,
                skip,
            }),
        ];

        // Add aggregate for COD pending view
        if (view === 'cod_pending') {
            queries.push(
                req.prisma.order.aggregate({ where, _sum: { totalAmount: true } })
            );
        }

        const results = await Promise.all(queries);
        const totalCount = results[0] as number;
        const orders = results[1] as OrderWithLines[];
        const aggregateResult = view === 'cod_pending' ? results[2] as { _sum: { totalAmount: number | null } } : undefined;
        const totalPendingAmount = aggregateResult?._sum?.totalAmount || 0;

        // Apply view-specific enrichments
        const enriched = await enrichOrdersForView(
            req.prisma,
            orders,
            viewConfig.enrichment
        );

        // Filter confidential fields based on user permissions
        const filteredOrders = filterConfidentialFields(enriched, req.userPermissions);

        const response: Record<string, unknown> = {
            orders: filteredOrders,
            view,
            viewName: viewConfig.name,
            pagination: {
                total: totalCount,
                limit: take,
                offset: skip,
                hasMore: skip + orders.length < totalCount,
                page: Math.floor(skip / take) + 1,
                totalPages: Math.ceil(totalCount / take),
            },
        };

        // Add view-specific fields
        if (view === 'cod_pending') {
            response.totalPendingAmount = totalPendingAmount;
        }

        res.json(response);
    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Get orders error');
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

/**
 * GET /orders/search-all
 *
 * Search across ALL tabs and return results grouped by tab.
 * Used for global order search functionality.
 *
 * Query params:
 * - q: Search query (required, min 2 chars)
 * - limit: Max results per tab (default: 5)
 */
router.get('/search-all', async (req: Request, res: Response) => {
    try {
        const { q, limit = '5' } = req.query as SearchAllQuery;

        if (!q || q.trim().length < 2) {
            return res.json({ results: [], query: q || '' });
        }

        const searchTerm = q.trim();
        const take = Math.min(Number(limit), 20); // Cap at 20 per tab

        // Build search OR clause
        const searchWhere: Prisma.OrderWhereInput = {
            OR: [
                { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
                { customerName: { contains: searchTerm, mode: 'insensitive' } },
                { awbNumber: { contains: searchTerm } },
                { customerEmail: { contains: searchTerm, mode: 'insensitive' } },
                { customerPhone: { contains: searchTerm } },
            ]
        };

        // Define tab filters (matching ORDER_VIEWS)
        const tabs: Record<string, Prisma.OrderWhereInput> = {
            open: {
                AND: [
                    searchWhere,
                    { status: 'open', isArchived: false }
                ]
            },
            shipped: {
                AND: [
                    searchWhere,
                    { status: { in: ['shipped', 'delivered'] }, isArchived: false },
                    { NOT: { trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] } } },
                    { NOT: { AND: [{ paymentMethod: 'COD' }, { trackingStatus: 'delivered' }, { codRemittedAt: null }] } }
                ]
            },
            rto: {
                AND: [
                    searchWhere,
                    { trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] }, isArchived: false }
                ]
            },
            cod_pending: {
                AND: [
                    searchWhere,
                    { paymentMethod: 'COD', trackingStatus: 'delivered', codRemittedAt: null, isArchived: false }
                ]
            },
            archived: {
                AND: [
                    searchWhere,
                    { isArchived: true }
                ]
            }
        };

        // Query all tabs in parallel
        const queries = Object.entries(tabs).map(([tabName, where]) =>
            req.prisma.order.findMany({
                where,
                select: {
                    id: true,
                    orderNumber: true,
                    customerName: true,
                    status: true,
                    paymentMethod: true,
                    totalAmount: true,
                    orderDate: true,
                    trackingStatus: true,
                    awbNumber: true,
                },
                orderBy: { orderDate: 'desc' },
                take,
            }).then((orders): TabResult => ({ tab: tabName, orders }))
        );

        const tabResults = await Promise.all(queries);

        // Format response
        const results = tabResults
            .filter((r) => r.orders.length > 0)
            .map((r) => ({
                tab: r.tab,
                tabName: getTabDisplayName(r.tab),
                count: r.orders.length,
                orders: r.orders.map((o) => ({
                    id: o.id,
                    orderNumber: o.orderNumber,
                    customerName: o.customerName,
                    status: o.status,
                    paymentMethod: o.paymentMethod,
                    totalAmount: o.totalAmount,
                    trackingStatus: o.trackingStatus,
                    awbNumber: o.awbNumber,
                }))
            }));

        res.json({
            query: searchTerm,
            totalResults: results.reduce((sum, r) => sum + r.count, 0),
            results
        });

    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Search all error');
        res.status(500).json({ error: 'Search failed' });
    }
});

// Helper for tab display names
function getTabDisplayName(tab: string): string {
    const names: TabNames = {
        open: 'Open',
        shipped: 'Shipped',
        rto: 'RTO',
        cod_pending: 'COD Pending',
        archived: 'Archived'
    };
    return names[tab] || tab;
}

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

        // Use same filter as /shipped endpoint to match displayed orders
        const whereClause: Prisma.OrderWhereInput = {
            status: { in: ['shipped', 'delivered'] },
            shippedAt: { gte: sinceDate },
            isArchived: false,
            // Exclude RTO orders (use OR to handle null trackingStatus correctly)
            OR: [
                { trackingStatus: null },
                { trackingStatus: { notIn: ['rto_in_transit', 'rto_delivered'] } }
            ],
            // Exclude delivered COD orders awaiting payment
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
            // Check trackingStatus first (most reliable)
            if (order.trackingStatus === 'delivered' || order.deliveredAt) {
                delivered++;
            } else if (order.trackingStatus && (
                order.trackingStatus.includes('rto') ||
                order.trackingStatus === 'cancelled'
            )) {
                // RTO orders are already filtered out by whereClause, but keep this for safety
                rto++;
            } else {
                // Order is in transit
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
// Returns individual cancelled lines with their parent order info
// Only shows lines from orders that have been released to cancelled
router.get('/status/cancelled', async (req: Request, res: Response) => {
    try {
        // Fetch cancelled lines from released-to-cancelled orders
        const cancelledLines = await req.prisma.orderLine.findMany({
            where: {
                lineStatus: 'cancelled',
                order: {
                    isArchived: false,
                    releasedToCancelled: true, // Only show released cancelled orders
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

        // Transform to order-like structure for frontend compatibility
        // Each cancelled line becomes a row with order context
        const rows = cancelledLines.map((line: OrderLineWithDetails) => {
            const order = line.order;
            return {
                // Order-level fields (for display)
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
                // Line-specific fields
                lineId: line.id,
                lineStatus: line.lineStatus,
                // Single line as orderLines array for grid compatibility
                orderLines: [line],
                // Calculated total for this cancelled line only
                totalAmount: (line.unitPrice || 0) * (line.qty || 1),
                // Flag to indicate this is a line-level row
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

// ============================================
// ORDERS ANALYTICS (for analytics bar)
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
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Current periods
        const yesterdayStart = new Date(todayStart);
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        const last7DaysStart = new Date(todayStart);
        last7DaysStart.setDate(last7DaysStart.getDate() - 7);
        const last30DaysStart = new Date(todayStart);
        last30DaysStart.setDate(last30DaysStart.getDate() - 30);
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);

        // Comparison periods
        const dayBeforeYesterdayStart = new Date(todayStart);
        dayBeforeYesterdayStart.setDate(dayBeforeYesterdayStart.getDate() - 2);
        const prior7DaysStart = new Date(todayStart);
        prior7DaysStart.setDate(prior7DaysStart.getDate() - 14);
        const prior7DaysEnd = new Date(todayStart);
        prior7DaysEnd.setDate(prior7DaysEnd.getDate() - 7);
        const prior30DaysStart = new Date(todayStart);
        prior30DaysStart.setDate(prior30DaysStart.getDate() - 60);
        const prior30DaysEnd = new Date(todayStart);
        prior30DaysEnd.setDate(prior30DaysEnd.getDate() - 30);
        const monthBeforeLastStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        const monthBeforeLastEnd = lastMonthStart;

        // For same-time comparisons
        const yesterdaySameTime = new Date(now);
        yesterdaySameTime.setDate(yesterdaySameTime.getDate() - 1);
        const dayBeforeYesterdaySameTime = new Date(now);
        dayBeforeYesterdaySameTime.setDate(dayBeforeYesterdaySameTime.getDate() - 2);
        // Last month same date/time for this month comparison
        const lastMonthSameDateTime = new Date(now);
        lastMonthSameDateTime.setMonth(lastMonthSameDateTime.getMonth() - 1);

        // Get ALL orders from 60+ days ago for all comparisons (include customerId for new/returning)
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

        // Get first order date for each customer to determine new vs returning
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

        // Calculate new vs returning customer stats for a set of orders
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
        // Last month till same date/time
        const lastMonthSamePeriodRevenue = calcRevenue(filterByDateRange(recentOrders, lastMonthStart, lastMonthSameDateTime));

        // Calculate customer stats for each period
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

        // Count pending orders (orders with at least one pending line)
        const pendingOrders = openOrders.filter((o) =>
            o.orderLines.some((l) => l.lineStatus === 'pending')
        ).length;

        // Count allocated orders (orders with all lines allocated or further)
        const allocatedOrders = openOrders.filter((o) =>
            o.orderLines.length > 0 && o.orderLines.every((l) => l.lineStatus !== 'pending')
        ).length;

        // Count ready to ship (orders with all lines packed)
        const readyToShip = openOrders.filter((o) =>
            o.orderLines.length > 0 && o.orderLines.every((l) => l.lineStatus === 'packed')
        ).length;

        // Payment method split (case-insensitive check)
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

        // Top products by quantity sold in last 30 days (with images and sales value)
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
                    // Use variation image if available, otherwise product image
                    const imageUrl = variation?.imageUrl || product?.imageUrl || null;
                    productData[productId] = {
                        id: productId,
                        name: product.name,
                        imageUrl,
                        qty: 0,
                        orderCount: 0,
                        salesValue: 0,
                        variants: {}, // Track by variation/color
                    };
                }
                productData[productId].qty += line.qty;
                productData[productId].orderCount += 1;
                productData[productId].salesValue += (line.unitPrice || 0) * line.qty;

                // Track variant breakdown
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

        // Convert variants object to sorted array
        interface ProductDataWithVariantsArray extends Omit<ProductData, 'variants'> {
            variants: Array<{ name: string; qty: number }>;
        }

        const productDataArray: ProductDataWithVariantsArray[] = Object.values(productData).map((product) => ({
            ...product,
            variants: Object.values(product.variants)
                .sort((a, b) => b.qty - a.qty)
                .slice(0, 5), // Top 5 variants
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

// Get single order
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const orderId = req.params.id as string;
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: {
                customer: true,
                orderLines: {
                    include: {
                        sku: {
                            include: {
                                variation: {
                                    include: {
                                        product: true,
                                        fabric: true,
                                    },
                                },
                            },
                        },
                        productionBatch: true,
                    },
                },
                returnRequests: true,
                shopifyCache: true,
            },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        let shopifyAdminUrl: string | null = null;
        if (order.shopifyOrderId) {
            const shopDomainSetting = await req.prisma.systemSetting.findUnique({
                where: { key: 'shopify_shop_domain' },
            });
            if (shopDomainSetting?.value) {
                const domain = shopDomainSetting.value;
                if (domain.includes('admin.shopify.com')) {
                    shopifyAdminUrl = `https://${domain}/orders/${order.shopifyOrderId}`;
                } else {
                    shopifyAdminUrl = `https://${domain}/admin/orders/${order.shopifyOrderId}`;
                }
            }
        }

        interface ShopifyDetails {
            subtotalPrice: string | null;
            totalPrice: string | null;
            totalTax: string | null;
            totalDiscounts: string | null;
            currency: string;
            financialStatus: string | null;
            fulfillmentStatus: string | null;
            discountCodes: unknown[];
            tags: string | null;
            customerNote: string | null;
            customerEmail: string | null;
            customerPhone: string | null;
            shippingAddress: unknown | null;
            billingAddress: unknown | null;
            shippingLines: Array<{ title: string; price: string }>;
            taxLines: Array<{ title: string; price: string; rate: number }>;
            lineItems: Array<{
                id: string;
                title: string;
                variantTitle: string | null;
                sku: string | null;
                quantity: number;
                price: string;
                totalDiscount: string;
                discountAllocations: Array<{ amount: string }>;
                imageUrl: string | null;
            }>;
            noteAttributes: unknown[];
        }

        let shopifyDetails: ShopifyDetails | null = null;
        const cache = order.shopifyCache;
        if (cache) {
            try {
                // Parse the JSON fields we now store (no rawData parsing needed!)
                interface CachedLineItem {
                    id: number | string;
                    sku?: string | null;
                    title?: string | null;
                    variant_title?: string | null;
                    price?: string | null;
                    quantity?: number;
                    discount_allocations?: Array<{ amount: string }>;
                }
                interface CachedShippingLine {
                    title?: string | null;
                    price?: string | null;
                }
                interface CachedTaxLine {
                    title?: string | null;
                    price?: string | null;
                    rate?: number | null;
                }

                const lineItems: CachedLineItem[] = cache.lineItemsJson ? JSON.parse(cache.lineItemsJson) : [];
                const shippingLines: CachedShippingLine[] = cache.shippingLinesJson ? JSON.parse(cache.shippingLinesJson) : [];
                const taxLines: CachedTaxLine[] = cache.taxLinesJson ? JSON.parse(cache.taxLinesJson) : [];
                const noteAttributes = cache.noteAttributesJson ? JSON.parse(cache.noteAttributesJson) : [];

                // Get SKU images from lineItems
                const skuCodes = lineItems
                    .map((item) => item.sku)
                    .filter((sku): sku is string => Boolean(sku));

                const skuImages: Record<string, string | null> = {};
                if (skuCodes.length > 0) {
                    const skus = await req.prisma.sku.findMany({
                        where: { skuCode: { in: skuCodes } },
                        select: {
                            skuCode: true,
                            variation: {
                                select: {
                                    imageUrl: true,
                                    product: {
                                        select: { imageUrl: true }
                                    }
                                }
                            }
                        }
                    });
                    for (const sku of skus) {
                        skuImages[sku.skuCode] = sku.variation?.imageUrl || sku.variation?.product?.imageUrl || null;
                    }
                }

                // Build shipping address from cached columns
                const shippingAddress = cache.shippingAddress1 ? {
                    address1: cache.shippingAddress1,
                    address2: cache.shippingAddress2 || null,
                    city: cache.shippingCity || null,
                    province: cache.shippingProvince || cache.shippingState || null,
                    province_code: cache.shippingProvinceCode || null,
                    country: cache.shippingCountry || null,
                    country_code: cache.shippingCountryCode || null,
                    zip: cache.shippingZip || null,
                    name: cache.shippingName || null,
                    phone: cache.shippingPhone || null,
                } : null;

                // Build billing address from cached columns
                const billingAddress = cache.billingAddress1 ? {
                    address1: cache.billingAddress1,
                    address2: cache.billingAddress2 || null,
                    city: cache.billingCity || null,
                    province: cache.billingState || null,
                    country: cache.billingCountry || null,
                    country_code: cache.billingCountryCode || null,
                    zip: cache.billingZip || null,
                    name: cache.billingName || null,
                    phone: cache.billingPhone || null,
                } : null;

                shopifyDetails = {
                    subtotalPrice: cache.subtotalPrice?.toString() || null,
                    totalPrice: cache.totalPrice?.toString() || null,
                    totalTax: cache.totalTax?.toString() || null,
                    totalDiscounts: cache.totalDiscounts?.toString() || null,
                    currency: cache.currency || 'INR',
                    financialStatus: cache.financialStatus || null,
                    fulfillmentStatus: cache.fulfillmentStatus || null,
                    discountCodes: cache.discountCodes ? cache.discountCodes.split(', ').filter(Boolean).map(code => ({ code })) : [],
                    tags: cache.tags || null,
                    customerNote: cache.customerNotes || null,
                    customerEmail: cache.customerEmail || null,
                    customerPhone: cache.shippingPhone || cache.customerPhone || null,
                    shippingAddress,
                    billingAddress,
                    shippingLines: shippingLines.map((s) => ({
                        title: s.title || '',
                        price: s.price || '0',
                    })),
                    taxLines: taxLines.map((t) => ({
                        title: t.title || '',
                        price: t.price || '0',
                        rate: t.rate || 0,
                    })),
                    lineItems: lineItems.map((item) => {
                        const discountAllocations = item.discount_allocations || [];
                        const totalDiscount = discountAllocations.reduce(
                            (sum, d) => sum + (parseFloat(d.amount) || 0),
                            0
                        ).toFixed(2);
                        return {
                            id: String(item.id),
                            title: item.title || '',
                            variantTitle: item.variant_title || null,
                            sku: item.sku || null,
                            quantity: item.quantity || 0,
                            price: item.price || '0',
                            totalDiscount,
                            discountAllocations: discountAllocations.map((d) => ({
                                amount: d.amount,
                            })),
                            imageUrl: item.sku ? skuImages[item.sku] || null : null,
                        };
                    }),
                    noteAttributes,
                };
            } catch (e) {
                orderLogger.error({ error: (e as Error).message }, 'Error parsing Shopify cached JSON fields');
            }
        }

        const orderData = {
            ...order,
            shopifyDetails,
            shopifyAdminUrl,
        };

        // Filter confidential fields based on user permissions
        const filtered = filterConfidentialFields(orderData, req.userPermissions);
        res.json(filtered);
    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Get order error');
        res.status(500).json({ error: 'Failed to fetch order' });
    }
});

// ============================================
// DASHBOARD STATS (Zen Philosophy)
// ============================================

/**
 * GET /orders/dashboard-stats
 * Returns counts for all action queues (for dashboard summary)
 */
router.get('/dashboard-stats', async (req: Request, res: Response) => {
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // Run all count queries in parallel
        const [
            readyToShip,
            needsAttention,
            inTransit,
            rtoInProgress,
            codAtRisk,
            pendingPayment,
            completed,
        ] = await Promise.all([
            // Ready to ship: Open, not on hold, not archived
            req.prisma.order.count({
                where: {
                    status: 'open',
                    isArchived: false,
                    isOnHold: false,
                },
            }),

            // Needs attention: On hold OR RTO delivered but not processed
            req.prisma.order.count({
                where: {
                    OR: [
                        { isOnHold: true },
                        { trackingStatus: 'rto_delivered', terminalStatus: null },
                    ],
                    isArchived: false,
                },
            }),

            // In transit: Shipped, no terminal status, not RTO
            req.prisma.order.count({
                where: {
                    status: 'shipped',
                    terminalStatus: null,
                    isArchived: false,
                    NOT: {
                        trackingStatus: { in: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] },
                    },
                },
            }),

            // RTO in progress
            req.prisma.order.count({
                where: {
                    trackingStatus: { in: ['rto_initiated', 'rto_in_transit'] },
                    isArchived: false,
                },
            }),

            // COD at risk: COD shipped > 7 days ago, not terminal
            req.prisma.order.count({
                where: {
                    status: 'shipped',
                    paymentMethod: 'COD',
                    terminalStatus: null,
                    shippedAt: { lt: sevenDaysAgo },
                    isArchived: false,
                },
            }),

            // Pending payment: Delivered COD awaiting remittance
            req.prisma.order.count({
                where: {
                    terminalStatus: 'delivered',
                    paymentMethod: 'COD',
                    codRemittedAt: null,
                    isArchived: false,
                },
            }),

            // Completed (last 15 days for reference)
            req.prisma.order.count({
                where: {
                    terminalStatus: { not: null },
                    isArchived: false,
                },
            }),
        ]);

        res.json({
            readyToShip,
            needsAttention,
            inTransit,
            watchList: rtoInProgress + codAtRisk, // Combined watch list
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
