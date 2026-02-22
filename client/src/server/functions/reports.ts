/**
 * Reports Server Functions
 *
 * TanStack Start Server Functions for analytics and reporting queries.
 * Uses Prisma and Kysely for database access.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import { getISTMidnightAsUTC, getISTMonthStartAsUTC, parseISTDateAsUTC, parseISTDateEndAsUTC } from '@coh/shared';

// Dynamic import helper for Kysely queries (prevents bundling Node.js code into client)
async function getKyselyQueries() {
    const module = await import('@coh/shared/services/db/queries/dashboard');
    return {
        getSalesBreakdownByMaterial: module.getSalesBreakdownByMaterial,
        getSalesBreakdownByFabric: module.getSalesBreakdownByFabric,
        getSalesBreakdownByFabricColour: module.getSalesBreakdownByFabricColour,
        getSalesBreakdownByChannel: module.getSalesBreakdownByChannel,
        getSalesBreakdownByStandardColor: module.getSalesBreakdownByStandardColor,
    };
}

// ============================================
// INPUT SCHEMAS
// ============================================

const getTopProductsInputSchema = z.object({
    days: z.number().int().positive().optional(),
    level: z.enum(['product', 'variation', 'sku']).optional().default('product'),
    limit: z.number().int().positive().optional().default(10),
});

const getTopCustomersInputSchema = z.object({
    months: z.union([z.number().int().positive(), z.literal('all')]).optional().default('all'),
    limit: z.number().int().positive().optional().default(10),
});

// Dashboard-specific input schemas (matching API response format)
// days: positive = lookback days, 0 = today only, -1 = yesterday only
const getTopProductsForDashboardInputSchema = z.object({
    days: z.number().int().min(-1).optional().default(0),
    level: z.enum(['product', 'variation']).optional().default('product'),
    limit: z.number().int().positive().optional().default(15),
});

const getTopCustomersForDashboardInputSchema = z.object({
    period: z.string().optional().default('today'),
    limit: z.number().int().positive().optional().default(10),
});

// ============================================
// OUTPUT TYPES
// ============================================

export interface TopProduct {
    id: string;
    name: string;
    category: string;
    imageUrl: string | null;
    unitsSold: number;
    revenue: number;
    avgPrice: number;
}

export interface TopCustomer {
    id: string;
    email: string;
    name: string;
    tier: string;
    totalOrders: number;
    totalSpent: number;
    avgOrderValue: number;
    lastOrderDate: string | null;
}

// Dashboard-specific output types (matching existing API response format)
export interface DashboardProductData {
    id: string;
    name: string;
    category?: string;
    colorName?: string;
    fabricName?: string | null;
    imageUrl: string | null;
    units: number;
    revenue: number;
    orderCount: number;
    variations?: Array<{ colorName: string; units: number }>;
}

export interface DashboardTopProductsResponse {
    level: 'product' | 'variation';
    days: number;
    data: DashboardProductData[];
}

export interface DashboardTopProduct {
    name: string;
    units: number;
}

export interface DashboardCustomerData {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    city?: string;
    tier?: string;
    units: number;
    revenue: number;
    orderCount: number;
    topProducts: DashboardTopProduct[];
}

export interface DashboardTopCustomersResponse {
    period: string;
    data: DashboardCustomerData[];
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get top products by units sold
 *
 * Returns top-selling products within specified time period.
 * Supports product, variation, or SKU-level aggregation.
 */
export const getTopProducts = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getTopProductsInputSchema.parse(input))
    .handler(async ({ data }): Promise<TopProduct[]> => {
        const prisma = await getPrisma();

        const { days, level, limit } = data;

        // Calculate date filter using IST boundaries
        const dateFilter = days
            ? {
                  orderDate: {
                      gte: getISTMidnightAsUTC(-days),
                  },
              }
            : {};

        // Get all non-cancelled order lines
        const orderLines = await prisma.orderLine.findMany({
            where: {
                lineStatus: { not: 'cancelled' },
                order: dateFilter,
            },
            include: {
                sku: {
                    include: {
                        variation: {
                            include: {
                                product: true,
                            },
                        },
                    },
                },
            },
        });

        // Aggregate by level
        const aggregateMap = new Map<
            string,
            {
                id: string;
                name: string;
                category: string;
                imageUrl: string | null;
                unitsSold: number;
                revenue: number;
                prices: number[];
            }
        >();

        for (const line of orderLines) {
            let key: string;
            let name: string;
            let category: string;
            let imageUrl: string | null;

            if (level === 'product') {
                key = line.sku.variation.product.id;
                name = line.sku.variation.product.name;
                category = line.sku.variation.product.category || 'Uncategorized';
                imageUrl = line.sku.variation.product.imageUrl;
            } else if (level === 'variation') {
                key = line.sku.variation.id;
                name = `${line.sku.variation.product.name} - ${line.sku.variation.colorName}`;
                category = line.sku.variation.product.category || 'Uncategorized';
                imageUrl = line.sku.variation.imageUrl || line.sku.variation.product.imageUrl;
            } else {
                // SKU level
                key = line.sku.id;
                name = `${line.sku.variation.product.name} - ${line.sku.variation.colorName} - ${line.sku.size}`;
                category = line.sku.variation.product.category || 'Uncategorized';
                imageUrl = line.sku.variation.imageUrl || line.sku.variation.product.imageUrl;
            }

            if (!aggregateMap.has(key)) {
                aggregateMap.set(key, {
                    id: key,
                    name,
                    category,
                    imageUrl,
                    unitsSold: 0,
                    revenue: 0,
                    prices: [],
                });
            }

            const stats = aggregateMap.get(key)!;
            stats.unitsSold += line.qty;
            stats.revenue += line.unitPrice * line.qty;
            stats.prices.push(line.unitPrice);
        }

        // Convert to array and calculate averages
        const topProducts: TopProduct[] = Array.from(aggregateMap.values())
            .map((stats) => ({
                id: stats.id,
                name: stats.name,
                category: stats.category,
                imageUrl: stats.imageUrl,
                unitsSold: stats.unitsSold,
                revenue: Math.round(stats.revenue * 100) / 100,
                avgPrice:
                    stats.prices.length > 0
                        ? Math.round((stats.prices.reduce((a, b) => a + b, 0) / stats.prices.length) * 100) / 100
                        : 0,
            }))
            .sort((a, b) => b.unitsSold - a.unitsSold)
            .slice(0, limit);

        return topProducts;
    });

/**
 * Get top customers by total spend
 *
 * Returns top customers within specified time period.
 */
export const getTopCustomers = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getTopCustomersInputSchema.parse(input))
    .handler(async ({ data }): Promise<TopCustomer[]> => {
        const prisma = await getPrisma();

        const { months, limit } = data;

        // Calculate date filter using IST boundaries
        const dateFilter =
            months !== 'all'
                ? {
                      orderDate: {
                          gte: getISTMidnightAsUTC(-months * 30),
                      },
                  }
                : {};

        // Get orders with customer info (all non-cancelled lines)
        const orders = await prisma.order.findMany({
            where: {
                ...dateFilter,
                status: {
                    notIn: ['cancelled'],
                },
            },
            include: {
                customer: true,
                orderLines: {
                    where: {
                        lineStatus: { not: 'cancelled' },
                    },
                },
            },
        });

        // Aggregate by customer
        const customerMap = new Map<
            string,
            {
                id: string;
                email: string;
                name: string;
                tier: string;
                totalOrders: number;
                totalSpent: number;
                orderDates: Date[];
            }
        >();

        for (const order of orders) {
            if (!order.customer) continue;

            const customerId = order.customer.id;
            const customerName = [order.customer.firstName, order.customer.lastName]
                .filter(Boolean)
                .join(' ') || 'Unknown';

            if (!customerMap.has(customerId)) {
                customerMap.set(customerId, {
                    id: customerId,
                    email: order.customer.email,
                    name: customerName,
                    tier: order.customer.tier || 'bronze',
                    totalOrders: 0,
                    totalSpent: 0,
                    orderDates: [],
                });
            }

            const stats = customerMap.get(customerId)!;
            stats.totalOrders++;
            stats.orderDates.push(order.orderDate);

            // Calculate order total from orderLines
            const orderTotal = order.orderLines.reduce((sum: number, line: { unitPrice: number; qty: number }) => sum + line.unitPrice * line.qty, 0);
            stats.totalSpent += orderTotal;
        }

        // Convert to array and calculate averages
        const topCustomers: TopCustomer[] = Array.from(customerMap.values())
            .map((stats) => ({
                id: stats.id,
                email: stats.email,
                name: stats.name,
                tier: stats.tier,
                totalOrders: stats.totalOrders,
                totalSpent: Math.round(stats.totalSpent * 100) / 100,
                avgOrderValue:
                    stats.totalOrders > 0
                        ? Math.round((stats.totalSpent / stats.totalOrders) * 100) / 100
                        : 0,
                lastOrderDate:
                    stats.orderDates.length > 0
                        ? new Date(Math.max(...stats.orderDates.map((d) => d.getTime()))).toISOString()
                        : null,
            }))
            .sort((a, b) => b.totalSpent - a.totalSpent)
            .slice(0, limit);

        return topCustomers;
    });

// ============================================
// DASHBOARD-SPECIFIC SERVER FUNCTIONS
// ============================================
// These functions return the exact format expected by dashboard card components,
// matching the previous API response structure for backward compatibility.

/**
 * Get top products for dashboard card
 *
 * Returns top-selling products in the format expected by TopProductsCard component.
 * Supports product or variation level aggregation with color/variation breakdown.
 */
export const getTopProductsForDashboard = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getTopProductsForDashboardInputSchema.parse(input))
    .handler(async ({ data }): Promise<DashboardTopProductsResponse> => {
        const prisma = await getPrisma();

        const { days, level, limit } = data;

        // Calculate date filter using IST boundaries
        // days > 0: lookback period, 0: today only, -1: yesterday only
        let dateFilter: { gte: Date; lte?: Date };
        if (days === -1) {
            // Yesterday only
            dateFilter = {
                gte: getISTMidnightAsUTC(-1),
                lte: getISTMidnightAsUTC(0),
            };
        } else if (days === 0) {
            // Today only
            dateFilter = { gte: getISTMidnightAsUTC(0) };
        } else {
            // Lookback period
            dateFilter = { gte: getISTMidnightAsUTC(-days) };
        }

        // Get order lines within the time period (by order date)
        // Include all non-cancelled lines to see what was ordered, not just shipped
        // NOTE: fabricColour removed from variation - fabric assignment now via BOM
        const orderLines = await prisma.orderLine.findMany({
            where: {
                lineStatus: { not: 'cancelled' },
                order: {
                    orderDate: dateFilter,
                },
            },
            include: {
                sku: {
                    include: {
                        variation: {
                            include: {
                                product: true,
                            },
                        },
                    },
                },
            },
        });

        if (level === 'variation') {
            // Aggregate at variation level
            const variationMap = new Map<
                string,
                {
                    id: string;
                    name: string;
                    colorName: string;
                    fabricName: string | null;
                    imageUrl: string | null;
                    units: number;
                    revenue: number;
                    orderIds: Set<string>;
                }
            >();

            for (const line of orderLines) {
                const variation = line.sku.variation;
                const key = variation.id;

                if (!variationMap.has(key)) {
                    variationMap.set(key, {
                        id: variation.id,
                        name: variation.product.name,
                        colorName: variation.colorName,
                        fabricName: null,  // fabricColour removed - fabric assignment now via BOM
                        imageUrl: variation.imageUrl || variation.product.imageUrl,
                        units: 0,
                        revenue: 0,
                        orderIds: new Set(),
                    });
                }

                const stats = variationMap.get(key)!;
                stats.units += line.qty;
                stats.revenue += line.unitPrice * line.qty;
                stats.orderIds.add(line.orderId);
            }

            const data: DashboardProductData[] = Array.from(variationMap.values())
                .map((v) => ({
                    id: v.id,
                    name: v.name,
                    colorName: v.colorName,
                    fabricName: v.fabricName,
                    imageUrl: v.imageUrl,
                    units: v.units,
                    revenue: Math.round(v.revenue * 100) / 100,
                    orderCount: v.orderIds.size,
                }))
                .sort((a, b) => b.units - a.units)
                .slice(0, limit);

            return { level: 'variation', days, data };
        } else {
            // Aggregate at product level
            const productMap = new Map<
                string,
                {
                    id: string;
                    name: string;
                    category: string;
                    imageUrl: string | null;
                    units: number;
                    revenue: number;
                    orderIds: Set<string>;
                    variations: Map<string, { colorName: string; units: number }>;
                }
            >();

            for (const line of orderLines) {
                const product = line.sku.variation.product;
                const variation = line.sku.variation;
                const key = product.id;

                if (!productMap.has(key)) {
                    productMap.set(key, {
                        id: product.id,
                        name: product.name,
                        category: product.category || 'Uncategorized',
                        imageUrl: product.imageUrl,
                        units: 0,
                        revenue: 0,
                        orderIds: new Set(),
                        variations: new Map(),
                    });
                }

                const stats = productMap.get(key)!;
                stats.units += line.qty;
                stats.revenue += line.unitPrice * line.qty;
                stats.orderIds.add(line.orderId);

                // Track variation breakdown
                if (!stats.variations.has(variation.id)) {
                    stats.variations.set(variation.id, { colorName: variation.colorName, units: 0 });
                }
                stats.variations.get(variation.id)!.units += line.qty;
            }

            const data: DashboardProductData[] = Array.from(productMap.values())
                .map((p) => ({
                    id: p.id,
                    name: p.name,
                    category: p.category,
                    imageUrl: p.imageUrl,
                    units: p.units,
                    revenue: Math.round(p.revenue * 100) / 100,
                    orderCount: p.orderIds.size,
                    variations: Array.from(p.variations.values())
                        .sort((a, b) => b.units - a.units)
                        .slice(0, 5),
                }))
                .sort((a, b) => b.units - a.units)
                .slice(0, limit);

            return { level: 'product', days, data };
        }
    });

/**
 * Get top customers for dashboard card
 *
 * Returns top customers in the format expected by TopCustomersCard component.
 * Includes customer details, stats, and their top purchased products.
 */
export const getTopCustomersForDashboard = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getTopCustomersForDashboardInputSchema.parse(input))
    .handler(async ({ data }): Promise<DashboardTopCustomersResponse> => {
        const prisma = await getPrisma();

        const { period, limit } = data;

        // Parse period into date filter using IST boundaries
        let dateFilter: { gte: Date; lte?: Date };

        switch (period) {
            case 'today':
                dateFilter = { gte: getISTMidnightAsUTC(0) };
                break;
            case 'yesterday':
                dateFilter = {
                    gte: getISTMidnightAsUTC(-1),
                    lte: getISTMidnightAsUTC(0),
                };
                break;
            case 'thisMonth':
                dateFilter = { gte: getISTMonthStartAsUTC(0) };
                break;
            case 'lastMonth':
                dateFilter = { gte: getISTMonthStartAsUTC(-1) };
                break;
            case '3months':
                dateFilter = { gte: getISTMidnightAsUTC(-90) };
                break;
            case '6months':
                dateFilter = { gte: getISTMidnightAsUTC(-180) };
                break;
            case '1year':
                dateFilter = { gte: getISTMidnightAsUTC(-365) };
                break;
            default:
                dateFilter = { gte: getISTMidnightAsUTC(0) };
        }

        // Get order lines within the time period (by order date)
        // Include all non-cancelled lines to see what was ordered
        const orderLines = await prisma.orderLine.findMany({
            where: {
                lineStatus: { not: 'cancelled' },
                order: {
                    orderDate: dateFilter,
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
                            include: { product: true },
                        },
                    },
                },
            },
        });

        // Aggregate by customer
        const customerMap = new Map<
            string,
            {
                id: string;
                name: string;
                email: string;
                phone: string | null;
                tier: string;
                units: number;
                revenue: number;
                orderIds: Set<string>;
                products: Map<string, { name: string; units: number }>;
            }
        >();

        for (const line of orderLines) {
            const customer = line.order.customer;
            if (!customer) continue;

            const customerId = customer.id;

            if (!customerMap.has(customerId)) {
                customerMap.set(customerId, {
                    id: customer.id,
                    name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Unknown',
                    email: customer.email,
                    phone: customer.phone,
                    tier: customer.tier || 'bronze',
                    units: 0,
                    revenue: 0,
                    orderIds: new Set(),
                    products: new Map(),
                });
            }

            const stats = customerMap.get(customerId)!;
            stats.orderIds.add(line.orderId);
            stats.units += line.qty;
            stats.revenue += line.unitPrice * line.qty;

            // Track product purchases
            const productName = line.sku.variation.product.name;
            if (!stats.products.has(productName)) {
                stats.products.set(productName, { name: productName, units: 0 });
            }
            stats.products.get(productName)!.units += line.qty;
        }

        // Convert to array and format
        const customers: DashboardCustomerData[] = Array.from(customerMap.values())
            .map((c) => ({
                id: c.id,
                name: c.name,
                email: c.email,
                phone: c.phone || undefined,
                tier: c.tier,
                units: c.units,
                revenue: Math.round(c.revenue * 100) / 100,
                orderCount: c.orderIds.size,
                topProducts: Array.from(c.products.values())
                    .sort((a, b) => b.units - a.units)
                    .slice(0, 3),
            }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, limit);

        return { period, data: customers };
    });

/**
 * Get customer overview stats
 *
 * Returns aggregated customer statistics for the specified time period.
 */
export const getCustomerOverviewStats = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown) =>
            z
                .object({
                    months: z.union([z.number().int().positive(), z.literal('all')]).optional().default('all'),
                })
                .parse(input)
    )
    .handler(
        async ({
            data,
        }): Promise<{
            totalCustomers: number;
            activeCustomers: number;
            newCustomers: number;
            repeatCustomers: number;
            repeatRate: number;
            totalOrders: number;
            totalRevenue: number;
            avgOrderValue: number;
            avgOrdersPerCustomer: number;
            avgOrderFrequency: number;
            avgLTV: number;
        }> => {
            const prisma = await getPrisma();

            const { months } = data;

            // Calculate date filter using IST boundaries
            const dateFilter =
                months !== 'all'
                    ? {
                          gte: getISTMidnightAsUTC(-months * 30),
                      }
                    : undefined;

            // Get customer stats
            const [totalCustomers, recentOrders, newCustomers, allCustomers] = await Promise.all([
                prisma.customer.count(),
                prisma.order.findMany({
                    where: {
                        ...(dateFilter ? { orderDate: dateFilter } : {}),
                        status: {
                            notIn: ['cancelled'],
                        },
                    },
                    include: {
                        customer: {
                            select: {
                                id: true,
                                ltv: true,
                            },
                        },
                        orderLines: {
                            where: {
                                lineStatus: { not: 'cancelled' },
                            },
                        },
                    },
                }),
                dateFilter
                    ? prisma.customer.count({
                          where: {
                              createdAt: dateFilter,
                          },
                      })
                    : 0,
                prisma.customer.findMany({
                    where: {
                        orderCount: {
                            gt: 0,
                        },
                    },
                    select: {
                        id: true,
                        orderCount: true,
                        ltv: true,
                    },
                }),
            ]);

            // Calculate active customers and totals
            const customerOrderCounts = new Map<string, number>();
            let totalRevenue = 0;

            for (const order of recentOrders) {
                if (order.customerId) {
                    customerOrderCounts.set(
                        order.customerId,
                        (customerOrderCounts.get(order.customerId) || 0) + 1
                    );
                }

                const orderTotal = order.orderLines.reduce((sum: number, line: { unitPrice: number; qty: number }) => sum + line.unitPrice * line.qty, 0);
                totalRevenue += orderTotal;
            }

            const activeCustomers = customerOrderCounts.size;
            const avgOrderValue = recentOrders.length > 0 ? totalRevenue / recentOrders.length : 0;
            const avgOrdersPerCustomer = activeCustomers > 0 ? recentOrders.length / activeCustomers : 0;

            // Calculate repeat customers (customers with more than 1 order)
            const repeatCustomers = Array.from(customerOrderCounts.values()).filter((count) => count > 1)
                .length;
            const repeatRate =
                activeCustomers > 0 ? Math.round((repeatCustomers / activeCustomers) * 100) : 0;

            // Calculate average order frequency (orders per customer per month)
            const timeWindowMonths = months === 'all' ? 12 : months; // Default to 12 months for 'all'
            const avgOrderFrequency =
                activeCustomers > 0
                    ? Math.round((recentOrders.length / activeCustomers / timeWindowMonths) * 100) / 100
                    : 0;

            // Calculate average LTV from all customers
            const totalLTV = allCustomers.reduce((sum: number, c: { id: string; orderCount: number | null; ltv: number | null }) => sum + (c.ltv || 0), 0);
            const avgLTV = allCustomers.length > 0 ? Math.round(totalLTV / allCustomers.length) : 0;

            return {
                totalCustomers,
                activeCustomers,
                newCustomers,
                repeatCustomers,
                repeatRate,
                totalOrders: recentOrders.length,
                totalRevenue: Math.round(totalRevenue * 100) / 100,
                avgOrderValue: Math.round(avgOrderValue * 100) / 100,
                avgOrdersPerCustomer: Math.round(avgOrdersPerCustomer * 100) / 100,
                avgOrderFrequency,
                avgLTV,
            };
        }
    );

/**
 * Get high-value customers
 *
 * Returns customers with highest lifetime value.
 */
export const getHighValueCustomers = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown) =>
            z
                .object({
                    limit: z.number().int().positive().optional().default(100),
                })
                .parse(input)
    )
    .handler(async ({ data }): Promise<TopCustomer[]> => {
        const prisma = await getPrisma();

        const customers = await prisma.customer.findMany({
            where: {
                ltv: {
                    gt: 0,
                },
            },
            orderBy: {
                ltv: 'desc',
            },
            take: data.limit,
            include: {
                orders: {
                    where: {
                        status: {
                            notIn: ['cancelled'],
                        },
                    },
                    orderBy: {
                        orderDate: 'desc',
                    },
                    take: 1,
                    select: {
                        orderDate: true,
                    },
                },
            },
        });

        return customers.map((customer: {
            id: string;
            email: string;
            firstName: string | null;
            lastName: string | null;
            tier: string | null;
            orderCount: number | null;
            ltv: number | null;
            orders: { orderDate: Date }[];
        }) => ({
            id: customer.id,
            email: customer.email,
            name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Unknown',
            tier: customer.tier || 'bronze',
            totalOrders: customer.orderCount || 0,
            totalSpent: customer.ltv || 0,
            avgOrderValue:
                customer.orderCount && customer.ltv
                    ? Math.round((customer.ltv / customer.orderCount) * 100) / 100
                    : 0,
            lastOrderDate: customer.orders[0]?.orderDate.toISOString() || null,
        }));
    });

/**
 * Get at-risk customers
 *
 * Returns customers who haven't ordered recently.
 */
export const getAtRiskCustomers = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<TopCustomer[]> => {
        const prisma = await getPrisma();

        // Get customers with orders but no recent orders (90+ days) using IST boundaries
        const cutoffDate = getISTMidnightAsUTC(-90);

        const customers = await prisma.customer.findMany({
            where: {
                orderCount: {
                    gt: 0,
                },
                lastOrderDate: {
                    lt: cutoffDate,
                },
            },
            orderBy: {
                lastOrderDate: 'asc',
            },
            take: 100,
        });

        return customers.map((customer: {
            id: string;
            email: string;
            firstName: string | null;
            lastName: string | null;
            tier: string | null;
            orderCount: number | null;
            ltv: number | null;
            lastOrderDate: Date | null;
        }) => ({
            id: customer.id,
            email: customer.email,
            name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Unknown',
            tier: customer.tier || 'bronze',
            totalOrders: customer.orderCount || 0,
            totalSpent: customer.ltv || 0,
            avgOrderValue:
                customer.orderCount && customer.ltv
                    ? Math.round((customer.ltv / customer.orderCount) * 100) / 100
                    : 0,
            lastOrderDate: customer.lastOrderDate?.toISOString() || null,
        }));
    });

/**
 * Get frequent returners
 *
 * Returns customers with high return rates.
 */
export const getFrequentReturners = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<TopCustomer[]> => {
        const prisma = await getPrisma();

        // Get customers with returns (using returnCount field on Customer)
        const returners = await prisma.customer.findMany({
            where: {
                returnCount: { gt: 0 },
            },
            include: {
                orders: {
                    where: {
                        status: {
                            notIn: ['cancelled'],
                        },
                    },
                    orderBy: {
                        orderDate: 'desc',
                    },
                    take: 1,
                    select: {
                        orderDate: true,
                    },
                },
            },
            orderBy: {
                orderCount: 'desc',
            },
            take: 100,
        });

        // Define type for customer with return count and orders
        type ReturnerCustomer = {
            id: string;
            email: string;
            firstName: string | null;
            lastName: string | null;
            tier: string | null;
            orderCount: number | null;
            ltv: number | null;
            returnCount: number;
            orders: { orderDate: Date }[];
        };

        // Filter to customers with return rate > 10%
        const frequentReturners = (returners as ReturnerCustomer[])
            .filter((customer: ReturnerCustomer) => {
                const returnCount = customer.returnCount || 0;
                const orderCount = customer.orderCount || 0;
                return orderCount > 0 && returnCount / orderCount > 0.1;
            })
            .sort((a: ReturnerCustomer, b: ReturnerCustomer) => {
                const aRate = (a.returnCount || 0) / (a.orderCount || 1);
                const bRate = (b.returnCount || 0) / (b.orderCount || 1);
                return bRate - aRate;
            });

        return frequentReturners.map((customer: ReturnerCustomer) => ({
            id: customer.id,
            email: customer.email,
            name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Unknown',
            tier: customer.tier || 'bronze',
            totalOrders: customer.orderCount || 0,
            totalSpent: customer.ltv || 0,
            avgOrderValue:
                customer.orderCount && customer.ltv
                    ? Math.round((customer.ltv / customer.orderCount) * 100) / 100
                    : 0,
            lastOrderDate: customer.orders[0]?.orderDate.toISOString() || null,
        }));
    });

// ============================================
// SALES ANALYTICS - For useSalesAnalytics hook
// ============================================

const getSalesAnalyticsInputSchema = z.object({
    dimension: z.enum([
        'summary', 'product', 'category', 'gender', 'color',
        'standardColor', 'material', 'fabric', 'fabricColour', 'channel'
    ]).optional().default('summary'),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    orderStatus: z.enum(['all', 'shipped', 'delivered']).optional().default('all'),
});

export type GetSalesAnalyticsInput = z.infer<typeof getSalesAnalyticsInputSchema>;

/** Sales analytics data point */
export interface SalesDataPoint {
    key: string;
    label: string;
    units: number;
    revenue: number;
    orders: number;
    avgOrderValue: number;
}

/** Time series point for summary view */
export interface TimeSeriesPoint {
    date: string;
    revenue: number;
    units: number;
    orders: number;
}

/** Breakdown item for dimension views */
export interface BreakdownItem {
    key: string;
    label: string;
    revenue: number;
    units: number;
    orders: number;
    avgOrderValue: number;
    percentOfTotal: number;
}

/** Sales analytics response */
export interface SalesAnalyticsResponse {
    dimension: string;
    startDate: string;
    endDate: string;
    data: SalesDataPoint[];
    timeSeries?: TimeSeriesPoint[];
    breakdown?: BreakdownItem[];
    summary: {
        totalUnits: number;
        totalRevenue: number;
        totalOrders: number;
        avgOrderValue: number;
    };
}

/**
 * Get sales analytics
 *
 * Returns sales data aggregated by the specified dimension.
 * Used by useSalesAnalytics hook and Analytics page.
 */
export const getSalesAnalytics = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getSalesAnalyticsInputSchema.parse(input))
    .handler(async ({ data }): Promise<SalesAnalyticsResponse> => {
        const prisma = await getPrisma();

        const { dimension, startDate, endDate, orderStatus } = data;

        // Parse dates as IST (default to last 30 days)
        // User-provided dates (YYYY-MM-DD) are interpreted as IST, not UTC
        const end = endDate ? parseISTDateEndAsUTC(endDate) : new Date();
        const start = startDate ? parseISTDateAsUTC(startDate) : getISTMidnightAsUTC(-30);

        // For BOM-based dimensions (material, fabric, fabricColour, standardColor) and channel,
        // use optimized Kysely queries that do aggregation at DB level
        const kyselyDimensions = ['material', 'fabric', 'fabricColour', 'standardColor', 'channel'] as const;
        type KyselyDimension = typeof kyselyDimensions[number];

        if (kyselyDimensions.includes(dimension as KyselyDimension)) {
            const kyselyQueries = await getKyselyQueries();
            const lineStatusFilter = orderStatus ?? 'all';

            let rows: Awaited<ReturnType<typeof kyselyQueries.getSalesBreakdownByMaterial>>;

            switch (dimension as KyselyDimension) {
                case 'material':
                    rows = await kyselyQueries.getSalesBreakdownByMaterial(start, end, lineStatusFilter);
                    break;
                case 'fabric':
                    rows = await kyselyQueries.getSalesBreakdownByFabric(start, end, lineStatusFilter);
                    break;
                case 'fabricColour':
                    rows = await kyselyQueries.getSalesBreakdownByFabricColour(start, end, lineStatusFilter);
                    break;
                case 'standardColor':
                    rows = await kyselyQueries.getSalesBreakdownByStandardColor(start, end, lineStatusFilter);
                    break;
                case 'channel':
                    rows = await kyselyQueries.getSalesBreakdownByChannel(start, end, lineStatusFilter);
                    break;
                default:
                    rows = [];
            }

            // Convert Kysely results to SalesDataPoint format
            const totalUnits = rows.reduce((sum, r) => sum + r.units, 0);
            const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
            const totalOrders = rows.reduce((sum, r) => sum + r.orderCount, 0);
            const avgOrderValue = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;

            const dataPoints: SalesDataPoint[] = rows.map(r => ({
                key: r.key,
                label: r.label,
                units: r.units,
                revenue: Math.round(r.revenue * 100) / 100,
                orders: r.orderCount,
                avgOrderValue: r.orderCount > 0 ? Math.round((r.revenue / r.orderCount) * 100) / 100 : 0,
            }));

            const breakdown: BreakdownItem[] = dataPoints.map(d => ({
                key: d.key,
                label: d.label,
                revenue: d.revenue,
                units: d.units,
                orders: d.orders,
                avgOrderValue: d.avgOrderValue,
                percentOfTotal: totalRevenue > 0 ? Math.round((d.revenue / totalRevenue) * 10000) / 100 : 0,
            }));

            return {
                dimension,
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                data: dataPoints,
                timeSeries: undefined,
                breakdown,
                summary: {
                    totalUnits,
                    totalRevenue: Math.round(totalRevenue * 100) / 100,
                    totalOrders,
                    avgOrderValue,
                },
            };
        }

        // Build line status filter based on orderStatus
        // 'all' = all non-cancelled, 'shipped' = shipped + delivered, 'delivered' = delivered only
        const lineStatusFilter = orderStatus === 'delivered'
            ? { in: ['delivered'] }
            : orderStatus === 'shipped'
                ? { in: ['shipped', 'delivered'] }
                : { not: 'cancelled' };  // 'all' - include all non-cancelled

        // Fetch order lines for non-BOM dimensions
        const orderLines = await prisma.orderLine.findMany({
            where: {
                order: {
                    orderDate: {
                        gte: start,
                        lte: end,
                    },
                    status: { notIn: ['cancelled'] },
                },
                lineStatus: lineStatusFilter,
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
                            include: {
                                product: true,
                            },
                        },
                    },
                },
            },
        });

        // Aggregate based on dimension
        const aggregateMap = new Map<
            string,
            {
                key: string;
                label: string;
                units: number;
                revenue: number;
                orderIds: Set<string>;
            }
        >();

        for (const line of orderLines) {
            let key: string;
            let label: string;

            switch (dimension) {
                case 'summary': {
                    // For summary, aggregate by day for time series
                    // Convert to IST before extracting date to avoid off-by-one errors
                    const date = line.order.orderDate;
                    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
                    const istDate = new Date(date.getTime() + istOffset);
                    key = istDate.toISOString().split('T')[0];
                    label = key;
                    break;
                }
                case 'product': {
                    key = line.sku.variation.product.id;
                    label = line.sku.variation.product.name;
                    break;
                }
                case 'category': {
                    key = line.sku.variation.product.category || 'uncategorized';
                    label = key.charAt(0).toUpperCase() + key.slice(1);
                    break;
                }
                case 'gender': {
                    key = line.sku.variation.product.gender || 'unspecified';
                    label = key.charAt(0).toUpperCase() + key.slice(1);
                    break;
                }
                case 'color': {
                    key = line.sku.variation.colorName || 'no-color';
                    label = key;
                    break;
                }
                default:
                    key = 'unknown';
                    label = 'Unknown';
            }

            if (!aggregateMap.has(key)) {
                aggregateMap.set(key, {
                    key,
                    label,
                    units: 0,
                    revenue: 0,
                    orderIds: new Set(),
                });
            }

            const stats = aggregateMap.get(key)!;
            stats.units += line.qty;
            stats.revenue += line.unitPrice * line.qty;
            stats.orderIds.add(line.orderId);
        }

        // Convert to array and calculate final values
        const dataPoints: SalesDataPoint[] = Array.from(aggregateMap.values())
            .map((stats) => ({
                key: stats.key,
                label: stats.label,
                units: stats.units,
                revenue: Math.round(stats.revenue * 100) / 100,
                orders: stats.orderIds.size,
                avgOrderValue:
                    stats.orderIds.size > 0
                        ? Math.round((stats.revenue / stats.orderIds.size) * 100) / 100
                        : 0,
            }))
            .sort((a, b) => {
                // Sort chronologically for summary (time series), by revenue for other dimensions
                if (dimension === 'summary') {
                    return a.key.localeCompare(b.key);
                }
                return b.revenue - a.revenue;
            });

        // Calculate summary
        const totalUnits = dataPoints.reduce((sum, d) => sum + d.units, 0);
        const totalRevenue = dataPoints.reduce((sum, d) => sum + d.revenue, 0);
        const uniqueOrderIds = new Set(orderLines.map((l: { orderId: string }) => l.orderId));
        const totalOrders = uniqueOrderIds.size;
        const avgOrderValue = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;

        // Build timeSeries only for summary dimension (shows daily trend)
        const isTimeDimension = dimension === 'summary';
        const timeSeries: TimeSeriesPoint[] | undefined = isTimeDimension
            ? dataPoints.map(d => ({
                date: d.key,
                revenue: d.revenue,
                units: d.units,
                orders: d.orders,
            }))
            : undefined;

        // Build breakdown for non-time dimensions
        const breakdown: BreakdownItem[] | undefined = !isTimeDimension
            ? dataPoints.map(d => ({
                key: d.key,
                label: d.label,
                revenue: d.revenue,
                units: d.units,
                orders: d.orders,
                avgOrderValue: d.avgOrderValue,
                percentOfTotal: totalRevenue > 0 ? Math.round((d.revenue / totalRevenue) * 10000) / 100 : 0,
            }))
            : undefined;

        return {
            dimension,
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            data: dataPoints,
            timeSeries,
            breakdown,
            summary: {
                totalUnits,
                totalRevenue: Math.round(totalRevenue * 100) / 100,
                totalOrders,
                avgOrderValue,
            },
        };
    });
