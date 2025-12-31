import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// ============================================
// CUSTOMER LIST
// ============================================

router.get('/', async (req, res) => {
    try {
        const { tier, search, limit = 50, offset = 0 } = req.query;

        let where = {};
        if (search) {
            where.OR = [
                { email: { contains: search, mode: 'insensitive' } },
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
            ];
        }

        const customers = await req.prisma.customer.findMany({
            where,
            include: {
                orders: {
                    select: { id: true, totalAmount: true, orderDate: true, status: true },
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
            const orders = customer.orders.filter((o) => o.status !== 'cancelled');
            const totalOrders = orders.length;
            const lifetimeValue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
            const avgOrderValue = totalOrders > 0 ? lifetimeValue / totalOrders : 0;

            const returns = customer.returnRequests.filter((r) => r.requestType === 'return').length;
            const exchanges = customer.returnRequests.filter((r) => r.requestType === 'exchange').length;
            const returnRate = totalOrders > 0 ? (returns / totalOrders) * 100 : 0;

            let customerTier = 'bronze';
            if (lifetimeValue >= 50000) customerTier = 'platinum';
            else if (lifetimeValue >= 25000) customerTier = 'gold';
            else if (lifetimeValue >= 10000) customerTier = 'silver';

            return {
                id: customer.id,
                email: customer.email,
                firstName: customer.firstName,
                lastName: customer.lastName,
                phone: customer.phone,
                tags: customer.tags,
                totalOrders,
                lifetimeValue: lifetimeValue.toFixed(2),
                avgOrderValue: avgOrderValue.toFixed(2),
                returns,
                exchanges,
                returnRate: returnRate.toFixed(1),
                customerTier,
                firstOrderDate: orders.length > 0 ? orders[orders.length - 1].orderDate : null,
                lastOrderDate: orders.length > 0 ? orders[0].orderDate : null,
            };
        });

        // Filter by tier if specified
        let result = enriched;
        if (tier) {
            result = enriched.filter((c) => c.customerTier === tier);
        }

        res.json(result);
    } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({ error: 'Failed to fetch customers' });
    }
});

// Get single customer with full details
router.get('/:id', async (req, res) => {
    try {
        const customer = await req.prisma.customer.findUnique({
            where: { id: req.params.id },
            include: {
                orders: {
                    include: {
                        orderLines: {
                            include: {
                                sku: {
                                    include: {
                                        variation: { include: { product: true } },
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
            return res.status(404).json({ error: 'Customer not found' });
        }

        // Calculate metrics
        const orders = customer.orders.filter((o) => o.status !== 'cancelled');
        const totalOrders = orders.length;
        const lifetimeValue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

        let customerTier = 'bronze';
        if (lifetimeValue >= 50000) customerTier = 'platinum';
        else if (lifetimeValue >= 25000) customerTier = 'gold';
        else if (lifetimeValue >= 10000) customerTier = 'silver';

        // Product affinity
        const productCounts = {};
        orders.forEach((order) => {
            order.orderLines.forEach((line) => {
                const productName = line.sku.variation.product.name;
                productCounts[productName] = (productCounts[productName] || 0) + line.qty;
            });
        });

        const productAffinity = Object.entries(productCounts)
            .map(([name, qty]) => ({ productName: name, qty }))
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5);

        res.json({
            ...customer,
            totalOrders,
            lifetimeValue: lifetimeValue.toFixed(2),
            customerTier,
            productAffinity,
        });
    } catch (error) {
        console.error('Get customer error:', error);
        res.status(500).json({ error: 'Failed to fetch customer' });
    }
});

// Create customer
router.post('/', authenticateToken, async (req, res) => {
    try {
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
    } catch (error) {
        console.error('Create customer error:', error);
        res.status(500).json({ error: 'Failed to create customer' });
    }
});

// Update customer
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { phone, firstName, lastName, defaultAddress, tags, acceptsMarketing } = req.body;

        const customer = await req.prisma.customer.update({
            where: { id: req.params.id },
            data: { phone, firstName, lastName, defaultAddress, tags, acceptsMarketing },
        });

        res.json(customer);
    } catch (error) {
        console.error('Update customer error:', error);
        res.status(500).json({ error: 'Failed to update customer' });
    }
});

// ============================================
// CUSTOMER ANALYTICS
// ============================================

// High-value customers (platinum + gold)
router.get('/analytics/high-value', async (req, res) => {
    try {
        const customers = await req.prisma.customer.findMany({
            include: {
                orders: { select: { totalAmount: true, status: true } },
            },
        });

        const highValue = customers
            .map((c) => {
                const orders = c.orders.filter((o) => o.status !== 'cancelled');
                const ltv = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
                return { ...c, lifetimeValue: ltv };
            })
            .filter((c) => c.lifetimeValue >= 25000)
            .sort((a, b) => b.lifetimeValue - a.lifetimeValue);

        res.json(highValue);
    } catch (error) {
        console.error('Get high-value customers error:', error);
        res.status(500).json({ error: 'Failed to fetch high-value customers' });
    }
});

// Frequent returners (>20% return rate)
router.get('/analytics/frequent-returners', async (req, res) => {
    try {
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
    } catch (error) {
        console.error('Get frequent returners error:', error);
        res.status(500).json({ error: 'Failed to fetch frequent returners' });
    }
});

// At-risk customers (high LTV but no order in 90+ days)
router.get('/analytics/at-risk', async (req, res) => {
    try {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        const customers = await req.prisma.customer.findMany({
            include: {
                orders: { select: { totalAmount: true, orderDate: true, status: true } },
            },
        });

        const atRisk = customers
            .map((c) => {
                const orders = c.orders.filter((o) => o.status !== 'cancelled');
                const ltv = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
                const lastOrder = orders.length > 0 ? new Date(Math.max(...orders.map((o) => new Date(o.orderDate)))) : null;
                const daysSinceLastOrder = lastOrder ? Math.floor((Date.now() - lastOrder.getTime()) / (1000 * 60 * 60 * 24)) : null;

                return {
                    id: c.id,
                    email: c.email,
                    firstName: c.firstName,
                    lastName: c.lastName,
                    lifetimeValue: ltv.toFixed(2),
                    lastOrderDate: lastOrder,
                    daysSinceLastOrder,
                };
            })
            .filter((c) => Number(c.lifetimeValue) >= 10000 && c.daysSinceLastOrder > 90)
            .sort((a, b) => b.daysSinceLastOrder - a.daysSinceLastOrder);

        res.json(atRisk);
    } catch (error) {
        console.error('Get at-risk customers error:', error);
        res.status(500).json({ error: 'Failed to fetch at-risk customers' });
    }
});

export default router;
