/**
 * @module routes/customers
 * @description Customer management and analytics
 *
 * Features:
 * - Customer list with LTV, tier, return rate, and order stats
 * - Tier calculation: platinum/gold/silver based on configurable LTV thresholds
 * - Address lookup from past orders (ERP + Shopify cache for autofill)
 * - Product/color/fabric affinity analysis
 * - Analytics: overview (repeat rate, AOV), high-value customers, at-risk (90+ days no order)
 *
 * Tier Logic: calculateTier(LTV, thresholds) where thresholds from SystemSetting or DEFAULT_TIER_THRESHOLDS
 * LTV Calculation: SUM(order.totalAmount) for non-cancelled orders
 *
 * @see utils/tierUtils.ts - Tier calculation logic
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError } from '../utils/errors.js';
import { getTierThresholds, calculateTier, calculateLTV } from '../utils/tierUtils.js';
import type { TierThresholds, CustomerTier, OrderForLTV } from '../utils/tierUtils.js';

const router: Router = Router();

// ============================================
// INTERFACES
// ============================================

/** Address from order history */
interface CustomerAddress {
    first_name?: string;
    last_name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
    phone?: string;
    lastUsed: Date;
    source: 'order' | 'shopify';
}

/** Product affinity data */
interface ProductAffinity {
    productName: string;
    qty: number;
}

/** Color affinity data */
interface ColorAffinity {
    color: string;
    qty: number;
    hex: string | null;
}

/** Fabric affinity data */
interface FabricAffinity {
    fabricType: string;
    qty: number;
}

/** Color data accumulator */
interface ColorData {
    qty: number;
    hex: string | null;
}

/** Analytics overview response */
interface AnalyticsOverview {
    totalCustomers: number;
    customersWithOrders: number;
    newCustomers: number;
    repeatCustomers: number;
    repeatRate: number;
    totalOrders: number;
    totalRevenue: number;
    avgOrderValue: number;
    avgOrdersPerCustomer: number;
    avgOrderFrequency: number;
    avgLTV: number;
}

/** High-value customer data */
interface HighValueCustomer {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    lifetimeValue: number;
    totalOrders: number;
    avgOrderValue: number;
    orderFrequency: number;
    firstOrderDate: Date | null;
    lastOrderDate: Date | null;
}

/** High-value analytics stats */
interface HighValueStats {
    totalCustomers: number;
    totalRevenue: number;
    totalOrders: number;
    avgLTV: number;
    avgAOV: number;
    avgOrdersPerCustomer: number;
    avgOrderFrequency: number;
}

/** Frequent returner data */
interface FrequentReturner {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    totalOrders: number;
    returns: number;
    returnRate: string;
}

/** At-risk customer data */
interface AtRiskCustomer {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    lifetimeValue: number;
    customerTier: CustomerTier;
    lastOrderDate: Date | null;
    daysSinceLastOrder: number | null;
}

// ============================================
// CUSTOMER LIST
// ============================================

/**
 * List customers with metrics (LTV, tier, returns, orders)
 * @route GET /api/customers?tier=gold&search=name&limit=50&offset=0
 * @param {string} [query.tier] - Filter by tier ('platinum', 'gold', 'silver')
 * @param {string} [query.search] - Multi-word search across email/name/phone (AND logic)
 * @param {number} [query.limit=50] - Max results
 * @param {number} [query.offset=0] - Skip N results
 * @returns {Object[]} customers - [{ id, email, firstName, lastName, phone, totalOrders, lifetimeValue, avgOrderValue, returns, exchanges, rtoCount, returnRate, customerTier, firstOrderDate, lastOrderDate }]
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const tier = req.query.tier as string | undefined;
    const search = req.query.search as string | undefined;
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;

    // Get configurable tier thresholds
    const thresholds: TierThresholds = await getTierThresholds(req.prisma);

    // Build where clause
    const where: Prisma.CustomerWhereInput = {};

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
                select: { id: true, totalAmount: true, orderDate: true, status: true, customerPhone: true, trackingStatus: true, paymentMethod: true },
                orderBy: { orderDate: 'desc' },
            },
            returnRequests: {
                select: { id: true, requestType: true },
            },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
    });

    // Enrich with metrics
    const enriched = customers.map((customer) => {
        const lifetimeValue = calculateLTV(customer.orders as OrderForLTV[]);
        const validOrders = customer.orders.filter((o) => o.status !== 'cancelled');
        const totalOrders = validOrders.length;
        const avgOrderValue = totalOrders > 0 ? lifetimeValue / totalOrders : 0;

        const returns = customer.returnRequests.filter((r) => r.requestType === 'return').length;
        const exchanges = customer.returnRequests.filter((r) => r.requestType === 'exchange').length;
        const returnRate = totalOrders > 0 ? (returns / totalOrders) * 100 : 0;

        // Calculate RTO count from actual order status (COD orders only - prepaid RTOs are refunded)
        const rtoCount = customer.orders.filter((o) =>
            o.trackingStatus?.startsWith('rto') && o.paymentMethod === 'COD'
        ).length;

        // Use stored tier, or calculate if not set
        // This ensures tier is always accurate (auto-updated on delivery)
        const calculatedTier = calculateTier(lifetimeValue, thresholds);
        const customerTier: CustomerTier = (customer.tier as CustomerTier) || calculatedTier;

        // Orders are now sorted by date desc, so first = most recent, last = oldest
        const sortedOrders = validOrders;

        // Get phone from customer record, or fallback to most recent order's phone
        const phone = customer.phone ||
            customer.orders.find(o => o.customerPhone)?.customerPhone ||
            null;

        // Parse tags - handle both string and array formats
        let tags: string[] = [];
        if (customer.tags) {
            if (Array.isArray(customer.tags)) {
                tags = customer.tags;
            } else if (typeof customer.tags === 'string') {
                try {
                    tags = JSON.parse(customer.tags);
                } catch {
                    tags = [customer.tags];
                }
            }
        }

        return {
            id: customer.id,
            email: customer.email,
            firstName: customer.firstName,
            lastName: customer.lastName,
            phone,
            tags,
            totalOrders,
            lifetimeValue,
            avgOrderValue,
            returns,
            exchanges,
            rtoCount, // Calculated from actual orders
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

/**
 * Get past shipping addresses for autofill (searches ERP orders + Shopify cache)
 * @route GET /api/customers/:id/addresses
 * @param {string} id - Customer UUID
 * @returns {Object[]} addresses - [{ address1, address2, city, province, zip, country, phone, lastUsed, source: 'order'|'shopify' }]
 * @description Dedupes by address1-city-zip key, returns max 20 most recent unique addresses.
 */
router.get('/:id/addresses', asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.params.id as string;

    // Get customer email for Shopify cache lookup
    const customer = await req.prisma.customer.findUnique({
        where: { id: customerId },
        select: { email: true },
    });

    const addressMap = new Map<string, CustomerAddress>();

    // 1. Get addresses from ERP orders
    const orders = await req.prisma.order.findMany({
        where: {
            customerId,
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
            const addr = JSON.parse(order.shippingAddress) as Record<string, string>;
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
                const data = JSON.parse(shopifyOrder.rawData) as { shipping_address?: Record<string, string> };
                const shippingAddr = data.shipping_address;
                if (!shippingAddr) continue;

                // Normalize Shopify address format to our format
                const addr: CustomerAddress = {
                    first_name: shippingAddr.first_name,
                    last_name: shippingAddr.last_name,
                    address1: shippingAddr.address1,
                    address2: shippingAddr.address2,
                    city: shippingAddr.city,
                    province: shippingAddr.province,
                    zip: shippingAddr.zip,
                    country: shippingAddr.country,
                    phone: shippingAddr.phone,
                    lastUsed: shopifyOrder.createdAt,
                    source: 'shopify',
                };

                const key = `${addr.address1 || ''}-${addr.city || ''}-${addr.zip || ''}`.toLowerCase();
                if (key && key !== '--' && !addressMap.has(key)) {
                    addressMap.set(key, addr);
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

/**
 * Get single customer with full order/return/feedback history and affinity analysis
 * @route GET /api/customers/:id
 * @param {string} id - Customer UUID
 * @returns {Object} customer - { ...customer, orders[], returnRequests[], feedback[], totalOrders, lifetimeValue, customerTier, productAffinity[], colorAffinity[], fabricAffinity[] }
 * @description Affinity = top 5 most-ordered products/colors/fabrics by quantity.
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.params.id as string;

    const customerWithRelations = await req.prisma.customer.findUnique({
        where: { id: customerId },
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

    if (!customerWithRelations) {
        throw new NotFoundError('Customer not found', 'Customer', customerId);
    }

    // Get configurable tier thresholds
    const thresholds: TierThresholds = await getTierThresholds(req.prisma);

    // Calculate metrics using shared utilities
    const lifetimeValue = calculateLTV(customerWithRelations.orders as OrderForLTV[]);
    const validOrders = customerWithRelations.orders.filter((o) => o.status !== 'cancelled');
    const totalOrders = validOrders.length;

    // Calculate RTO count from actual order status (COD orders only - prepaid RTOs are refunded)
    const rtoCount = customerWithRelations.orders.filter((o) =>
        o.trackingStatus?.startsWith('rto') && o.paymentMethod === 'COD'
    ).length;

    // Use stored tier, or calculate if not set
    const calculatedTier = calculateTier(lifetimeValue, thresholds);
    const customerTier: CustomerTier = (customerWithRelations.tier as CustomerTier) || calculatedTier;

    // Product affinity
    const productCounts: Record<string, number> = {};
    // Color affinity (using standardColor if available, else colorName) - includes hex from fabric
    const colorData: Record<string, ColorData> = {}; // { colorName: { qty: number, hex: string | null } }
    // Fabric affinity (by fabric type)
    const fabricCounts: Record<string, number> = {};

    validOrders.forEach((order) => {
        order.orderLines.forEach((line) => {
            const variation = line.sku?.variation;
            if (!variation) return;
            const productName = variation.product?.name;
            const colorKey = variation.standardColor || variation.colorName;
            const colorHex = variation.fabric?.colorHex || null;
            const fabricType = variation.fabric?.fabricType?.name;

            if (productName) productCounts[productName] = (productCounts[productName] || 0) + line.qty;
            if (colorKey) {
                if (!colorData[colorKey]) {
                    colorData[colorKey] = { qty: 0, hex: colorHex };
                }
                colorData[colorKey].qty += line.qty;
                // Update hex if we find one (prefer non-null)
                if (colorHex && !colorData[colorKey].hex) {
                    colorData[colorKey].hex = colorHex;
                }
            }
            if (fabricType) fabricCounts[fabricType] = (fabricCounts[fabricType] || 0) + line.qty;
        });
    });

    const productAffinity: ProductAffinity[] = Object.entries(productCounts)
        .map(([name, qty]) => ({ productName: name, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);

    const colorAffinity: ColorAffinity[] = Object.entries(colorData)
        .map(([color, data]) => ({ color, qty: data.qty, hex: data.hex }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);

    const fabricAffinity: FabricAffinity[] = Object.entries(fabricCounts)
        .map(([fabricType, qty]) => ({ fabricType, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);

    res.json({
        ...customerWithRelations,
        totalOrders,
        lifetimeValue,
        customerTier,
        rtoCount, // Calculated from actual orders (overrides denormalized field)
        productAffinity,
        colorAffinity,
        fabricAffinity,
    });
}));

// Create customer
router.post('/', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
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
router.put('/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.params.id as string;
    const { phone, firstName, lastName, defaultAddress, tags, acceptsMarketing } = req.body;

    const customer = await req.prisma.customer.update({
        where: { id: customerId },
        data: { phone, firstName, lastName, defaultAddress, tags, acceptsMarketing },
    });

    res.json(customer);
}));

// ============================================
// CUSTOMER ANALYTICS
// ============================================

/**
 * Customer base overview with KPIs
 * @route GET /api/customers/analytics/overview?months=6
 * @param {number} [query.months] - Filter orders from last N months ('all' for all-time)
 * @returns {Object} { totalCustomers, customersWithOrders, newCustomers, repeatCustomers, repeatRate, totalOrders, totalRevenue, avgOrderValue, avgOrdersPerCustomer, avgOrderFrequency, avgLTV }
 * @description Repeat = 2+ orders. Frequency = orders/month since first order.
 */
router.get('/analytics/overview', asyncHandler(async (req: Request, res: Response) => {
    const months = req.query.months as string | undefined;

    // Build date filter
    const dateFilter: Prisma.OrderWhereInput = {};
    if (months && months !== 'all') {
        const sinceDate = new Date();
        sinceDate.setMonth(sinceDate.getMonth() - Number(months));
        dateFilter.orderDate = { gte: sinceDate };
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

    customers.forEach((c) => {
        const validOrders = c.orders.filter((o) => o.status !== 'cancelled');

        if (validOrders.length > 0) {
            customersWithOrders++;
            totalOrders += validOrders.length;
            totalRevenue += validOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

            if (validOrders.length > 1) {
                repeatCustomers++;
            }

            // Calculate order frequency for this customer
            const orderDates = validOrders.map((o) => new Date(o.orderDate).getTime());

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

    const response: AnalyticsOverview = {
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
    };

    res.json(response);
}));

/**
 * Top customers by LTV
 * @route GET /api/customers/analytics/high-value?limit=100
 * @param {number} [query.limit=100] - Max customers (max 5000)
 * @returns {Object} { customers: [{ id, email, firstName, lastName, lifetimeValue, totalOrders, avgOrderValue, orderFrequency, firstOrderDate, lastOrderDate }], stats: { totalCustomers, totalRevenue, totalOrders, avgLTV, avgAOV, avgOrdersPerCustomer, avgOrderFrequency } }
 */
router.get('/analytics/high-value', asyncHandler(async (req: Request, res: Response) => {
    const limitParam = req.query.limit as string | undefined;
    const topN = Math.min(Number(limitParam) || 100, 5000);

    const customers = await req.prisma.customer.findMany({
        include: {
            orders: { select: { totalAmount: true, status: true, orderDate: true } },
        },
    });

    // Calculate metrics for all customers
    const enrichedCustomers: HighValueCustomer[] = customers
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

    const stats: HighValueStats = {
        totalCustomers,
        totalRevenue: Math.round(totalRevenue),
        totalOrders: totalOrdersAll,
        avgLTV: Math.round(avgLTV),
        avgAOV: Math.round(avgAOV),
        avgOrdersPerCustomer: parseFloat(avgOrdersPerCustomer.toFixed(1)),
        avgOrderFrequency: parseFloat(avgOrderFrequency.toFixed(2)),
    };

    res.json({
        customers: enrichedCustomers,
        stats,
    });
}));

/**
 * Customers with >20% return rate (min 2 orders)
 * @route GET /api/customers/analytics/frequent-returners
 * @returns {Object[]} customers - [{ id, email, firstName, lastName, totalOrders, returns, returnRate }]
 */
router.get('/analytics/frequent-returners', asyncHandler(async (req: Request, res: Response) => {
    const customers = await req.prisma.customer.findMany({
        include: {
            orders: { select: { id: true, status: true } },
            returnRequests: { select: { id: true, requestType: true } },
        },
    });

    const frequentReturners: FrequentReturner[] = customers
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
        .filter((c) => parseFloat(c.returnRate) > 20 && c.totalOrders >= 2)
        .sort((a, b) => parseFloat(b.returnRate) - parseFloat(a.returnRate));

    res.json(frequentReturners);
}));

/**
 * At-risk customers: Silver+ tier with 90+ days no order
 * @route GET /api/customers/analytics/at-risk
 * @returns {Object[]} customers - [{ id, email, firstName, lastName, lifetimeValue, customerTier, lastOrderDate, daysSinceLastOrder }]
 * @description Targets re-engagement campaigns for valuable inactive customers.
 */
router.get('/analytics/at-risk', asyncHandler(async (req: Request, res: Response) => {
    const thresholds: TierThresholds = await getTierThresholds(req.prisma);

    const customers = await req.prisma.customer.findMany({
        include: {
            orders: { select: { totalAmount: true, orderDate: true, status: true } },
        },
    });

    const atRisk: AtRiskCustomer[] = customers
        .map((c) => {
            const lifetimeValue = calculateLTV(c.orders as OrderForLTV[]);
            const validOrders = c.orders.filter((o) => o.status !== 'cancelled');
            const lastOrder = validOrders.length > 0 ? new Date(Math.max(...validOrders.map((o) => new Date(o.orderDate).getTime()))) : null;
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
        .filter((c) => c.lifetimeValue >= thresholds.silver && c.daysSinceLastOrder !== null && c.daysSinceLastOrder > 90) // Silver+ inactive 90+ days
        .sort((a, b) => (b.daysSinceLastOrder ?? 0) - (a.daysSinceLastOrder ?? 0));

    res.json(atRisk);
}));

export default router;
