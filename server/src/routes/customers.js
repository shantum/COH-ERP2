import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError } from '../utils/errors.js';
import { getTierThresholds, calculateTier, calculateLTV } from '../utils/tierUtils.js';

const router = Router();

// ============================================
// CUSTOMER LIST
// ============================================

router.get('/', asyncHandler(async (req, res) => {
    const { tier, search, limit = 50, offset = 0 } = req.query;

    // Get configurable tier thresholds
    const thresholds = await getTierThresholds(req.prisma);

        let where = {};
        if (search) {
            // Support multi-word search: all words must match across name/email/phone
            const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);

            if (words.length === 1) {
                // Single word: search in any field
                where.OR = [
                    { email: { contains: words[0], mode: 'insensitive' } },
                    { firstName: { contains: words[0], mode: 'insensitive' } },
                    { lastName: { contains: words[0], mode: 'insensitive' } },
                    { phone: { contains: words[0], mode: 'insensitive' } },
                ];
            } else {
                // Multi-word: ALL words must match somewhere in name/email
                where.AND = words.map(word => ({
                    OR: [
                        { email: { contains: word, mode: 'insensitive' } },
                        { firstName: { contains: word, mode: 'insensitive' } },
                        { lastName: { contains: word, mode: 'insensitive' } },
                        { phone: { contains: word, mode: 'insensitive' } },
                    ]
                }));
            }
        }

        const customers = await req.prisma.customer.findMany({
            where,
            include: {
                orders: {
                    select: { id: true, totalAmount: true, orderDate: true, status: true, customerPhone: true },
                    orderBy: { orderDate: 'desc' },
                },
                returnRequests: {
                    select: { id: true, requestType: true },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
            skip: Number(offset),
        });

        // Enrich with metrics
        const enriched = customers.map((customer) => {
            const lifetimeValue = calculateLTV(customer.orders);
            const validOrders = customer.orders.filter((o) => o.status !== 'cancelled');
            const totalOrders = validOrders.length;
            const avgOrderValue = totalOrders > 0 ? lifetimeValue / totalOrders : 0;

            const returns = customer.returnRequests.filter((r) => r.requestType === 'return').length;
            const exchanges = customer.returnRequests.filter((r) => r.requestType === 'exchange').length;
            const returnRate = totalOrders > 0 ? (returns / totalOrders) * 100 : 0;

            // Use shared tier calculation
            const customerTier = calculateTier(lifetimeValue, thresholds);

            // Orders are now sorted by date desc, so first = most recent, last = oldest
            const sortedOrders = validOrders;

            // Get phone from customer record, or fallback to most recent order's phone
            const phone = customer.phone ||
                customer.orders.find(o => o.customerPhone)?.customerPhone ||
                null;

            return {
                id: customer.id,
                email: customer.email,
                firstName: customer.firstName,
                lastName: customer.lastName,
                phone,
                tags: customer.tags,
                totalOrders,
                lifetimeValue,
                avgOrderValue,
                returns,
                exchanges,
                rtoCount: customer.rtoCount || 0,
                returnRate: parseFloat(returnRate.toFixed(1)),
                customerTier,
                firstOrderDate: sortedOrders.length > 0 ? sortedOrders[sortedOrders.length - 1].orderDate : null,
                lastOrderDate: sortedOrders.length > 0 ? sortedOrders[0].orderDate : null,
            };
        });

        // Filter by tier if specified
        let result = enriched;
        if (tier) {
            result = enriched.filter((c) => c.customerTier === tier);
        }

    res.json(result);
}));

// Get customer's past shipping addresses (for address autofill)
// Searches both ERP orders and Shopify cache
router.get('/:id/addresses', asyncHandler(async (req, res) => {
    // Get customer email for Shopify cache lookup
    const customer = await req.prisma.customer.findUnique({
        where: { id: req.params.id },
        select: { email: true },
    });

    const addressMap = new Map();

        // 1. Get addresses from ERP orders
        const orders = await req.prisma.order.findMany({
            where: {
                customerId: req.params.id,
                shippingAddress: { not: null },
            },
            select: {
                shippingAddress: true,
                orderDate: true,
            },
            orderBy: { orderDate: 'desc' },
            take: 20,
        });

        for (const order of orders) {
            if (!order.shippingAddress) continue;
            try {
                const addr = JSON.parse(order.shippingAddress);
                const key = `${addr.address1 || ''}-${addr.city || ''}-${addr.zip || ''}`.toLowerCase();
                if (key && key !== '--' && !addressMap.has(key)) {
                    addressMap.set(key, {
                        ...addr,
                        lastUsed: order.orderDate,
                        source: 'order',
                    });
                }
            } catch {
                // Skip invalid JSON
            }
        }

        // 2. Get addresses from Shopify cache (if customer has email)
        if (customer?.email) {
            const shopifyOrders = await req.prisma.shopifyOrderCache.findMany({
                where: {
                    rawData: { contains: customer.email },
                },
                select: {
                    rawData: true,
                    createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
                take: 20,
            });

            for (const shopifyOrder of shopifyOrders) {
                try {
                    const data = JSON.parse(shopifyOrder.rawData);
                    const shippingAddr = data.shipping_address;
                    if (!shippingAddr) continue;

                    // Normalize Shopify address format to our format
                    const addr = {
                        first_name: shippingAddr.first_name,
                        last_name: shippingAddr.last_name,
                        address1: shippingAddr.address1,
                        address2: shippingAddr.address2,
                        city: shippingAddr.city,
                        province: shippingAddr.province,
                        zip: shippingAddr.zip,
                        country: shippingAddr.country,
                        phone: shippingAddr.phone,
                    };

                    const key = `${addr.address1 || ''}-${addr.city || ''}-${addr.zip || ''}`.toLowerCase();
                    if (key && key !== '--' && !addressMap.has(key)) {
                        addressMap.set(key, {
                            ...addr,
                            lastUsed: shopifyOrder.createdAt,
                            source: 'shopify',
                        });
                    }
                } catch {
                    // Skip invalid JSON
                }
            }
        }

        // Return as array, most recently used first
        const addresses = Array.from(addressMap.values())
            .sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime());

    res.json(addresses);
}));

// Get single customer with full details
router.get('/:id', asyncHandler(async (req, res) => {
    const customer = await req.prisma.customer.findUnique({
        where: { id: req.params.id },
        include: {
            orders: {
                include: {
                    orderLines: {
                        include: {
                            sku: {
                                include: {
                                    variation: {
                                        include: {
                                            product: true,
                                            fabric: { include: { fabricType: true } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                orderBy: { orderDate: 'desc' },
            },
            returnRequests: {
                include: {
                    lines: true,
                },
                orderBy: { createdAt: 'desc' },
            },
            feedback: {
                include: {
                    ratings: true,
                    content: true,
                },
                orderBy: { createdAt: 'desc' },
            },
        },
    });

    if (!customer) {
        throw new NotFoundError('Customer not found', 'Customer', req.params.id);
    }

        // Get configurable tier thresholds
        const thresholds = await getTierThresholds(req.prisma);

        // Calculate metrics using shared utilities
        const lifetimeValue = calculateLTV(customer.orders);
        const validOrders = customer.orders.filter((o) => o.status !== 'cancelled');
        const totalOrders = validOrders.length;

        // Use shared tier calculation
        const customerTier = calculateTier(lifetimeValue, thresholds);

        // Product affinity
        const productCounts = {};
        // Color affinity (using standardColor if available, else colorName)
        const colorCounts = {};
        // Fabric affinity (by fabric type)
        const fabricCounts = {};

        validOrders.forEach((order) => {
            order.orderLines.forEach((line) => {
                const variation = line.sku?.variation;
                if (!variation) return;
                const productName = variation.product?.name;
                const colorKey = variation.standardColor || variation.colorName;
                const fabricType = variation.fabric?.fabricType?.name;

                if (productName) productCounts[productName] = (productCounts[productName] || 0) + line.qty;
                if (colorKey) colorCounts[colorKey] = (colorCounts[colorKey] || 0) + line.qty;
                if (fabricType) fabricCounts[fabricType] = (fabricCounts[fabricType] || 0) + line.qty;
            });
        });

        const productAffinity = Object.entries(productCounts)
            .map(([name, qty]) => ({ productName: name, qty }))
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5);

        const colorAffinity = Object.entries(colorCounts)
            .map(([color, qty]) => ({ color, qty }))
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5);

        const fabricAffinity = Object.entries(fabricCounts)
            .map(([fabricType, qty]) => ({ fabricType, qty }))
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5);

    res.json({
        ...customer,
        totalOrders,
        lifetimeValue,
        customerTier,
        productAffinity,
        colorAffinity,
        fabricAffinity,
    });
}));

// Create customer
router.post('/', authenticateToken, asyncHandler(async (req, res) => {
    const { email, phone, firstName, lastName, defaultAddress, tags } = req.body;

    const customer = await req.prisma.customer.create({
        data: {
            email,
            phone,
            firstName,
            lastName,
            defaultAddress,
            tags: tags || [],
        },
    });

    res.status(201).json(customer);
}));

// Update customer
router.put('/:id', authenticateToken, asyncHandler(async (req, res) => {
    const { phone, firstName, lastName, defaultAddress, tags, acceptsMarketing } = req.body;

    const customer = await req.prisma.customer.update({
        where: { id: req.params.id },
        data: { phone, firstName, lastName, defaultAddress, tags, acceptsMarketing },
    });

    res.json(customer);
}));

// ============================================
// CUSTOMER ANALYTICS
// ============================================

// Customer base analytics with time filtering
router.get('/analytics/overview', asyncHandler(async (req, res) => {
    const { months } = req.query;

    // Build date filter
    let dateFilter = {};
        if (months && months !== 'all') {
            const sinceDate = new Date();
            sinceDate.setMonth(sinceDate.getMonth() - Number(months));
            dateFilter = { orderDate: { gte: sinceDate } };
        }

        // Get all customers with their orders (filtered by date if specified)
        const customers = await req.prisma.customer.findMany({
            include: {
                orders: {
                    where: dateFilter,
                    select: { id: true, totalAmount: true, status: true, orderDate: true },
                },
            },
        });

        // Calculate metrics
        let totalCustomers = 0;
        let customersWithOrders = 0;
        let repeatCustomers = 0;
        let totalOrders = 0;
        let totalRevenue = 0;
        let orderFrequencySum = 0;
        let customersWithMultipleOrders = 0;

        const orderDatesAll = [];

        customers.forEach((c) => {
            const validOrders = c.orders.filter((o) => o.status !== 'cancelled');

            if (validOrders.length > 0) {
                customersWithOrders++;
                totalOrders += validOrders.length;
                totalRevenue += validOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

                if (validOrders.length > 1) {
                    repeatCustomers++;
                    customersWithMultipleOrders++;
                }

                // Calculate order frequency for this customer
                const orderDates = validOrders.map((o) => new Date(o.orderDate).getTime());
                orderDatesAll.push(...orderDates);

                if (orderDates.length > 0) {
                    const firstOrder = Math.min(...orderDates);
                    const monthsSinceFirst = Math.max(1, (Date.now() - firstOrder) / (1000 * 60 * 60 * 24 * 30));
                    orderFrequencySum += validOrders.length / monthsSinceFirst;
                }
            }
        });

        // Only count customers with orders in analytics
        totalCustomers = customersWithOrders;

        // Calculate aggregates
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const avgOrdersPerCustomer = customersWithOrders > 0 ? totalOrders / customersWithOrders : 0;
        const repeatRate = customersWithOrders > 0 ? (repeatCustomers / customersWithOrders) * 100 : 0;
        const avgOrderFrequency = customersWithOrders > 0 ? orderFrequencySum / customersWithOrders : 0;
        const avgLTV = customersWithOrders > 0 ? totalRevenue / customersWithOrders : 0;

        // New vs returning breakdown
        const newCustomers = customersWithOrders - repeatCustomers;

    res.json({
        totalCustomers,
        customersWithOrders,
        newCustomers,
        repeatCustomers,
        repeatRate: parseFloat(repeatRate.toFixed(1)),
        totalOrders,
        totalRevenue: Math.round(totalRevenue),
        avgOrderValue: Math.round(avgOrderValue),
        avgOrdersPerCustomer: parseFloat(avgOrdersPerCustomer.toFixed(1)),
        avgOrderFrequency: parseFloat(avgOrderFrequency.toFixed(2)),
        avgLTV: Math.round(avgLTV),
    });
}));

// High-value customers (top N by LTV)
router.get('/analytics/high-value', asyncHandler(async (req, res) => {
    const { limit = 100 } = req.query;
    const topN = Math.min(Number(limit) || 100, 5000);

        const customers = await req.prisma.customer.findMany({
            include: {
                orders: { select: { totalAmount: true, status: true, orderDate: true } },
            },
        });

        // Calculate metrics for all customers
        const enrichedCustomers = customers
            .map((c) => {
                const validOrders = c.orders.filter((o) => o.status !== 'cancelled');
                const lifetimeValue = validOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
                const totalOrders = validOrders.length;
                const avgOrderValue = totalOrders > 0 ? lifetimeValue / totalOrders : 0;

                // Find first and last order dates
                const orderDates = validOrders.map((o) => new Date(o.orderDate).getTime());
                const firstOrderDate = orderDates.length > 0 ? new Date(Math.min(...orderDates)) : null;
                const lastOrderDate = orderDates.length > 0 ? new Date(Math.max(...orderDates)) : null;

                // Calculate order frequency (orders per month since first order)
                let orderFrequency = 0;
                if (firstOrderDate && totalOrders > 0) {
                    const monthsSinceFirst = Math.max(1, (Date.now() - firstOrderDate.getTime()) / (1000 * 60 * 60 * 24 * 30));
                    orderFrequency = totalOrders / monthsSinceFirst;
                }

                return {
                    id: c.id,
                    email: c.email,
                    firstName: c.firstName,
                    lastName: c.lastName,
                    lifetimeValue,
                    totalOrders,
                    avgOrderValue: Math.round(avgOrderValue),
                    orderFrequency: parseFloat(orderFrequency.toFixed(2)),
                    firstOrderDate,
                    lastOrderDate,
                };
            })
            .filter((c) => c.totalOrders > 0) // Only customers with orders
            .sort((a, b) => b.lifetimeValue - a.lifetimeValue)
            .slice(0, topN);

        // Calculate aggregate stats for the top N
        const totalCustomers = enrichedCustomers.length;
        const totalRevenue = enrichedCustomers.reduce((sum, c) => sum + c.lifetimeValue, 0);
        const totalOrdersAll = enrichedCustomers.reduce((sum, c) => sum + c.totalOrders, 0);
        const avgLTV = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;
        const avgAOV = totalOrdersAll > 0 ? totalRevenue / totalOrdersAll : 0;
        const avgOrdersPerCustomer = totalCustomers > 0 ? totalOrdersAll / totalCustomers : 0;
        const avgOrderFrequency = totalCustomers > 0
            ? enrichedCustomers.reduce((sum, c) => sum + c.orderFrequency, 0) / totalCustomers
            : 0;

    res.json({
        customers: enrichedCustomers,
        stats: {
            totalCustomers,
            totalRevenue: Math.round(totalRevenue),
            totalOrders: totalOrdersAll,
            avgLTV: Math.round(avgLTV),
            avgAOV: Math.round(avgAOV),
            avgOrdersPerCustomer: parseFloat(avgOrdersPerCustomer.toFixed(1)),
            avgOrderFrequency: parseFloat(avgOrderFrequency.toFixed(2)),
        },
    });
}));

// Frequent returners (>20% return rate)
router.get('/analytics/frequent-returners', asyncHandler(async (req, res) => {
    const customers = await req.prisma.customer.findMany({
        include: {
            orders: { select: { id: true, status: true } },
            returnRequests: { select: { id: true, requestType: true } },
        },
    });

    const frequentReturners = customers
        .map((c) => {
            const orders = c.orders.filter((o) => o.status !== 'cancelled').length;
            const returns = c.returnRequests.filter((r) => r.requestType === 'return').length;
            const returnRate = orders > 0 ? (returns / orders) * 100 : 0;
            return {
                id: c.id,
                email: c.email,
                firstName: c.firstName,
                lastName: c.lastName,
                totalOrders: orders,
                returns,
                returnRate: returnRate.toFixed(1),
            };
        })
        .filter((c) => c.returnRate > 20 && c.totalOrders >= 2)
        .sort((a, b) => b.returnRate - a.returnRate);

    res.json(frequentReturners);
}));

// At-risk customers (high LTV but no order in 90+ days)
router.get('/analytics/at-risk', asyncHandler(async (req, res) => {
    const thresholds = await getTierThresholds(req.prisma);

    const customers = await req.prisma.customer.findMany({
        include: {
            orders: { select: { totalAmount: true, orderDate: true, status: true } },
        },
    });

    const atRisk = customers
        .map((c) => {
            const lifetimeValue = calculateLTV(c.orders);
            const validOrders = c.orders.filter((o) => o.status !== 'cancelled');
            const lastOrder = validOrders.length > 0 ? new Date(Math.max(...validOrders.map((o) => new Date(o.orderDate)))) : null;
            const daysSinceLastOrder = lastOrder ? Math.floor((Date.now() - lastOrder.getTime()) / (1000 * 60 * 60 * 24)) : null;
            const customerTier = calculateTier(lifetimeValue, thresholds);

            return {
                id: c.id,
                email: c.email,
                firstName: c.firstName,
                lastName: c.lastName,
                lifetimeValue,
                customerTier,
                lastOrderDate: lastOrder,
                daysSinceLastOrder,
            };
        })
        .filter((c) => c.lifetimeValue >= thresholds.silver && c.daysSinceLastOrder > 90) // Silver+ inactive 90+ days
        .sort((a, b) => b.daysSinceLastOrder - a.daysSinceLastOrder);

    res.json(atRisk);
}));

export default router;
