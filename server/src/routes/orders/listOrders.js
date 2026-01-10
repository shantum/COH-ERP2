/**
 * List Orders Router
 * GET endpoints for listing and viewing orders
 * 
 * Unified view-based architecture:
 * GET /orders?view=open|shipped|rto|cod_pending|archived
 */

import { Router } from 'express';
import {
    ORDER_LIST_SELECT_OPEN,
    ORDER_LIST_SELECT_SHIPPED,
    ORDER_LIST_SELECT_RTO,
    ORDER_LIST_SELECT_COD_PENDING,
    enrichOrdersWithCustomerStats,
    extractShopifyTrackingFields,
    calculateDaysSince,
    determineTrackingStatus,
    enrichOrderLinesWithAddresses,
} from '../../utils/queryPatterns.js';
import {
    ORDER_VIEWS,
    buildViewWhereClause,
    enrichOrdersForView,
    ORDER_UNIFIED_SELECT,
    getValidViewNames,
    getViewConfig,
} from '../../utils/orderViews.js';

const router = Router();

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
router.get('/', async (req, res) => {
    try {
        const {
            view = 'open',
            limit,
            offset = 0,
            days,
            search,
            sortBy,  // Extract sortBy to prevent it from being added to WHERE clause
            ...additionalFilters
        } = req.query;

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
        const queries = [
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
        const totalCount = results[0];
        const orders = results[1];
        const totalPendingAmount = view === 'cod_pending' ? (results[2]?._sum?.totalAmount || 0) : undefined;

        // Apply view-specific enrichments
        const enriched = await enrichOrdersForView(
            req.prisma,
            orders,
            viewConfig.enrichment
        );

        const response = {
            orders: enriched,
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
        if (totalPendingAmount !== undefined) {
            response.totalPendingAmount = totalPendingAmount;
        }

        res.json(response);
    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// Get open orders with fulfillment status
router.get('/open', async (req, res) => {
    try {
        const { limit = 10000, offset = 0 } = req.query;
        const take = Number(limit);
        const skip = Number(offset);

        const whereClause = { status: 'open', isArchived: false };

        const totalCount = await req.prisma.order.count({ where: whereClause });

        const orders = await req.prisma.order.findMany({
            where: whereClause,
            take,
            skip,
            select: ORDER_LIST_SELECT_OPEN,
            orderBy: { orderDate: 'asc' },
        });

        const enrichedOrders = await enrichOrdersWithCustomerStats(req.prisma, orders, {
            includeFulfillmentStage: true,
            includeLineStatusCounts: true,
        });

        // Add resolved shipping addresses to order lines
        const ordersWithAddresses = enrichedOrders.map(enrichOrderLinesWithAddresses);

        res.json({
            orders: ordersWithAddresses,
            pagination: {
                total: totalCount,
                limit: take,
                offset: skip,
                hasMore: skip + enrichedOrders.length < totalCount,
            }
        });
    } catch (error) {
        console.error('Get open orders error:', error);
        res.status(500).json({ error: 'Failed to fetch open orders' });
    }
});

// Get shipped orders
router.get('/shipped', async (req, res) => {
    try {
        const { limit = 100, offset = 0, days = 30 } = req.query;
        const take = Number(limit);
        const skip = Number(offset);

        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - Number(days));

        const whereClause = {
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

        const totalCount = await req.prisma.order.count({ where: whereClause });

        const orders = await req.prisma.order.findMany({
            where: whereClause,
            select: ORDER_LIST_SELECT_SHIPPED,
            orderBy: { shippedAt: 'desc' },
            take,
            skip,
        });

        const enrichedWithCustomer = await enrichOrdersWithCustomerStats(req.prisma, orders);

        const enriched = enrichedWithCustomer.map((order) => {
            const daysInTransit = calculateDaysSince(order.shippedAt);
            const trackingStatus = determineTrackingStatus(order, daysInTransit);
            const shopifyCache = extractShopifyTrackingFields(order.shopifyCache);

            return {
                ...order,
                shopifyCache,
                daysInTransit,
                trackingStatus,
            };
        });

        res.json({
            orders: enriched,
            pagination: {
                total: totalCount,
                limit: take,
                offset: skip,
                hasMore: skip + orders.length < totalCount,
                page: Math.floor(skip / take) + 1,
                totalPages: Math.ceil(totalCount / take)
            }
        });
    } catch (error) {
        console.error('Get shipped orders error:', error);
        res.status(500).json({ error: 'Failed to fetch shipped orders' });
    }
});

// Get RTO orders summary
router.get('/rto/summary', async (req, res) => {
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
        });

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

        res.json({
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
        });
    } catch (error) {
        console.error('Get RTO summary error:', error);
        res.status(500).json({ error: 'Failed to fetch RTO summary' });
    }
});

// Get RTO orders (Return to Origin)
router.get('/rto', async (req, res) => {
    try {
        const { limit = 200, offset = 0 } = req.query;
        const take = Number(limit);
        const skip = Number(offset);

        const whereClause = {
            trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
            isArchived: false,
        };

        const totalCount = await req.prisma.order.count({ where: whereClause });

        const orders = await req.prisma.order.findMany({
            where: whereClause,
            select: ORDER_LIST_SELECT_RTO,
            orderBy: { rtoInitiatedAt: 'desc' },
            take,
            skip,
        });

        const enrichedWithCustomer = await enrichOrdersWithCustomerStats(req.prisma, orders);

        const enriched = enrichedWithCustomer.map((order) => ({
            ...order,
            daysInRto: calculateDaysSince(order.rtoInitiatedAt),
        }));

        res.json({
            orders: enriched,
            total: totalCount,
            pagination: {
                total: totalCount,
                limit: take,
                offset: skip,
                hasMore: skip + orders.length < totalCount,
                page: Math.floor(skip / take) + 1,
                totalPages: Math.ceil(totalCount / take)
            }
        });
    } catch (error) {
        console.error('Get RTO orders error:', error);
        res.status(500).json({ error: 'Failed to fetch RTO orders' });
    }
});

// Get COD pending orders (delivered but awaiting payment)
router.get('/cod-pending', async (req, res) => {
    try {
        const { limit = 200, offset = 0 } = req.query;
        const take = Number(limit);
        const skip = Number(offset);

        const whereClause = {
            paymentMethod: 'COD',
            trackingStatus: 'delivered',
            codRemittedAt: null,
            isArchived: false,
        };

        const [totalCount, totalPendingAmount] = await Promise.all([
            req.prisma.order.count({ where: whereClause }),
            req.prisma.order.aggregate({ where: whereClause, _sum: { totalAmount: true } }),
        ]);

        const orders = await req.prisma.order.findMany({
            where: whereClause,
            select: ORDER_LIST_SELECT_COD_PENDING,
            orderBy: { deliveredAt: 'desc' },
            take,
            skip,
        });

        const enrichedWithCustomer = await enrichOrdersWithCustomerStats(req.prisma, orders);

        const enriched = enrichedWithCustomer.map((order) => ({
            ...order,
            daysSinceDelivery: calculateDaysSince(order.deliveredAt),
        }));

        res.json({
            orders: enriched,
            total: totalCount,
            totalPendingAmount: totalPendingAmount._sum.totalAmount || 0,
            pagination: {
                total: totalCount,
                limit: take,
                offset: skip,
                hasMore: skip + orders.length < totalCount,
                page: Math.floor(skip / take) + 1,
                totalPages: Math.ceil(totalCount / take)
            }
        });
    } catch (error) {
        console.error('Get COD pending orders error:', error);
        res.status(500).json({ error: 'Failed to fetch COD pending orders' });
    }
});

// Get shipped orders summary (status counts)
router.get('/shipped/summary', async (req, res) => {
    try {
        const { days = 30 } = req.query;
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - Number(days));

        // Use same filter as /shipped endpoint to match displayed orders
        const whereClause = {
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
        });

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
        console.error('Get shipped summary error:', error);
        res.status(500).json({ error: 'Failed to fetch shipped summary' });
    }
});

// Get archived orders analytics
router.get('/archived/analytics', async (req, res) => {
    try {
        const { days = 30 } = req.query;
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
        });

        const orderCount = orders.length;
        const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        const avgValue = orderCount > 0 ? totalRevenue / orderCount : 0;

        const channelCounts = {};
        for (const order of orders) {
            const ch = order.channel || 'shopify';
            channelCounts[ch] = (channelCounts[ch] || 0) + 1;
        }
        const channelSplit = Object.entries(channelCounts).map(([channel, count]) => ({
            channel,
            count,
            percentage: orderCount > 0 ? Math.round((count / orderCount) * 100) : 0,
        }));

        const productStats = {};
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

        const topProducts = Object.entries(productStats)
            .map(([name, stats]) => ({ name, ...stats }))
            .sort((a, b) => b.units - a.units)
            .slice(0, 10);

        res.json({
            orderCount,
            totalRevenue,
            avgValue,
            channelSplit,
            topProducts,
        });
    } catch (error) {
        console.error('Get archived analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch archived analytics' });
    }
});

// Get archived orders (paginated, optionally filtered by days)
router.get('/status/archived', async (req, res) => {
    try {
        const { limit = 100, offset = 0, days, sortBy = 'archivedAt' } = req.query;
        const take = Number(limit);
        const skip = Number(offset);

        const where = { isArchived: true };
        if (days) {
            const sinceDate = new Date();
            sinceDate.setDate(sinceDate.getDate() - Number(days));
            where.orderDate = { gte: sinceDate };
        }

        const orderBy = sortBy === 'orderDate'
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
                            paymentMethod: true,
                            financialStatus: true,
                            fulfillmentStatus: true,
                            shipmentStatus: true,
                            deliveredAt: true,
                            trackingNumber: true,
                            trackingCompany: true,
                        }
                    },
                },
                orderBy,
                take,
                skip,
            }),
            req.prisma.order.count({ where }),
        ]);

        const transformedOrders = orders.map(order => {
            const cache = order.shopifyCache || {};

            let deliveryDays = null;
            const shippedDate = order.shippedAt ? new Date(order.shippedAt) : null;
            const deliveredDate = order.deliveredAt ? new Date(order.deliveredAt) :
                cache.deliveredAt ? new Date(cache.deliveredAt) : null;
            if (shippedDate && deliveredDate) {
                deliveryDays = Math.round((deliveredDate.getTime() - shippedDate.getTime()) / (1000 * 60 * 60 * 24));
            }

            return {
                ...order,
                deliveryDays,
                customerTier: order.customer?.tier,
                customerLtv: order.customer?.lifetimeValue,
                shopifyPaymentMethod: cache.paymentMethod || order.paymentMethod,
                shopifyFinancialStatus: cache.financialStatus,
                shopifyFulfillmentStatus: cache.fulfillmentStatus,
                shopifyShipmentStatus: cache.shipmentStatus,
                shopifyDeliveredAt: cache.deliveredAt,
            };
        });

        res.json({ orders: transformedOrders, totalCount, limit: take, offset: skip, sortBy });
    } catch (error) {
        console.error('Get archived orders error:', error);
        res.status(500).json({ error: 'Failed to fetch archived orders' });
    }
});

// Get cancelled lines (line-level view for cancelled tab)
// Returns individual cancelled lines with their parent order info
router.get('/status/cancelled', async (req, res) => {
    try {
        // Fetch all cancelled lines with order and SKU info
        const cancelledLines = await req.prisma.orderLine.findMany({
            where: {
                lineStatus: 'cancelled',
                order: {
                    isArchived: false,
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
            orderBy: { updatedAt: 'desc' },
        });

        // Transform to order-like structure for frontend compatibility
        // Each cancelled line becomes a row with order context
        const rows = cancelledLines.map(line => {
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

        res.json(rows);
    } catch (error) {
        console.error('Get cancelled lines error:', error);
        res.status(500).json({ error: 'Failed to fetch cancelled lines' });
    }
});

// Get single order
router.get('/:id', async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id },
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

        let shopifyAdminUrl = null;
        if (order?.shopifyOrderId) {
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

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        let shopifyDetails = null;
        if (order.shopifyCache?.rawData) {
            try {
                const raw = JSON.parse(order.shopifyCache.rawData);

                const skuCodes = (raw.line_items || [])
                    .map(item => item.sku)
                    .filter(Boolean);

                const skuImages = {};
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

                shopifyDetails = {
                    subtotalPrice: raw.subtotal_price || raw.current_subtotal_price,
                    totalPrice: raw.total_price || raw.current_total_price,
                    totalTax: raw.total_tax || raw.current_total_tax,
                    totalDiscounts: raw.total_discounts || raw.current_total_discounts,
                    currency: raw.currency || 'INR',
                    financialStatus: raw.financial_status,
                    fulfillmentStatus: raw.fulfillment_status,
                    discountCodes: raw.discount_codes || [],
                    tags: raw.tags || null,
                    customerNote: raw.note || null,
                    shippingLines: (raw.shipping_lines || []).map(s => ({
                        title: s.title,
                        price: s.price,
                    })),
                    taxLines: (raw.tax_lines || []).map(t => ({
                        title: t.title,
                        price: t.price,
                        rate: t.rate,
                    })),
                    lineItems: (raw.line_items || []).map(item => ({
                        id: String(item.id),
                        title: item.title,
                        variantTitle: item.variant_title,
                        sku: item.sku,
                        quantity: item.quantity,
                        price: item.price,
                        totalDiscount: item.total_discount || '0.00',
                        discountAllocations: (item.discount_allocations || []).map(d => ({
                            amount: d.amount,
                        })),
                        imageUrl: item.image?.src || skuImages[item.sku] || null,
                    })),
                    noteAttributes: raw.note_attributes || [],
                };
            } catch (e) {
                console.error('Error parsing Shopify raw data:', e);
            }
        }

        res.json({
            ...order,
            shopifyDetails,
            shopifyAdminUrl,
        });
    } catch (error) {
        console.error('Get order error:', error);
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
router.get('/dashboard-stats', async (req, res) => {
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
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

export default router;
