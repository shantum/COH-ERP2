/**
 * Kysely Customer Queries
 *
 * High-performance customer queries using type-safe SQL.
 * Moved from server/src/db/queries/customersListKysely.ts
 * to be accessible from Server Functions.
 *
 * ⚠️  DYNAMIC IMPORTS ONLY ⚠️
 * Uses getKysely() which has dynamic imports internally.
 * Do not add static imports of kysely/pg here. See services/index.ts for details.
 */

import { getKysely } from '../kysely.js';
import { getPrisma } from '../prisma.js';
import type {
    CustomerDetailResult,
    ColorAffinity,
    ProductAffinity,
    FabricAffinity,
    ReturnAnalysis,
    RevenueTimeline,
    PaymentBreakdown,
} from '../../../schemas/customers.js';

// ============================================
// INPUT TYPES
// ============================================

export interface CustomerDetailParams {
    id: string;
}

// Type for enriched order with lines from Prisma query
interface OrderWithLines {
    id: string;
    orderNumber: string;
    totalAmount: number | null;
    status: string;
    orderDate: Date;
    internalNotes: string | null;
    paymentMethod: string | null;
    channel: string;
    isExchange: boolean;
    orderLines: Array<{
        id: string;
        qty: number;
        unitPrice: number;
        lineStatus: string;
        notes: string | null;
        refundAmount: number | null;
        returnStatus: string | null;
        returnReasonCategory: string | null;
        returnReasonDetail: string | null;
        returnResolution: string | null;
        returnCondition: string | null;
        rtoCondition: string | null;
        rtoInitiatedAt: Date | null;
        sku: {
            size: string | null;
            variation: {
                colorName: string | null;
                colorHex: string | null;
                imageUrl: string | null;
                product: {
                    name: string | null;
                    imageUrl: string | null;
                } | null;
            } | null;
        } | null;
    }>;
}

// ============================================
// QUERIES
// ============================================

/**
 * Get single customer by ID with full profile data
 *
 * Uses Kysely for efficient base query + Prisma for relations.
 * Includes:
 * - Customer stats (ltv, orders, returns, RTO, store credit)
 * - Style DNA (color, product, fabric affinities)
 * - All orders with enriched line items (return/RTO data)
 * - Return analysis, revenue timeline, payment breakdown
 */
export async function getCustomerKysely(id: string): Promise<CustomerDetailResult | null> {
    const db = await getKysely();
    const prisma = await getPrisma();

    // Get customer with all stats including new fields
    const customer = await db
        .selectFrom('Customer')
        .select([
            'Customer.id',
            'Customer.email',
            'Customer.firstName',
            'Customer.lastName',
            'Customer.phone',
            'Customer.tier',
            'Customer.tags',
            'Customer.createdAt',
            'Customer.updatedAt',
            'Customer.orderCount',
            'Customer.ltv',
            'Customer.returnCount',
            'Customer.exchangeCount',
            'Customer.rtoCount',
            'Customer.rtoOrderCount',
            'Customer.rtoValue',
            'Customer.storeCreditBalance',
            'Customer.firstOrderDate',
            'Customer.lastOrderDate',
            'Customer.acceptsMarketing',
            'Customer.defaultAddress',
        ])
        .where('Customer.id', '=', id)
        .executeTakeFirst();

    if (!customer) return null;

    // Get ALL orders with enriched line details (return/RTO fields)
    const orders: OrderWithLines[] = await prisma.order.findMany({
        where: { customerId: id },
        orderBy: { orderDate: 'desc' },
        select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            status: true,
            orderDate: true,
            internalNotes: true,
            paymentMethod: true,
            channel: true,
            isExchange: true,
            orderLines: {
                select: {
                    id: true,
                    qty: true,
                    unitPrice: true,
                    lineStatus: true,
                    notes: true,
                    refundAmount: true,
                    returnStatus: true,
                    returnReasonCategory: true,
                    returnReasonDetail: true,
                    returnResolution: true,
                    returnCondition: true,
                    rtoCondition: true,
                    rtoInitiatedAt: true,
                    sku: {
                        select: {
                            size: true,
                            variation: {
                                select: {
                                    colorName: true,
                                    colorHex: true,
                                    imageUrl: true,
                                    product: {
                                        select: {
                                            name: true,
                                            imageUrl: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    // Calculate affinities from ALL order lines
    const colorCounts = new Map<string, { qty: number; hex: string | null }>();
    const productCounts = new Map<string, number>();
    const fabricCounts = new Map<string, number>();

    // Return analysis tracking
    const reasonCounts = new Map<string, number>();
    const resolutionCounts = new Map<string, number>();
    const rtoConditionCounts = new Map<string, number>();
    let totalReturnedLines = 0;
    let totalRtoLines = 0;

    // Revenue timeline tracking
    const monthlyRevenue = new Map<string, { revenue: number; orders: number }>();

    // Payment breakdown tracking
    const paymentMethodCounts = new Map<string, { count: number; total: number }>();

    // Order notes collection
    const orderNotes: Array<{ orderNumber: string; note: string; orderDate: Date }> = [];

    for (const order of orders) {
        // Revenue timeline (monthly)
        const monthKey = `${order.orderDate.getFullYear()}-${String(order.orderDate.getMonth() + 1).padStart(2, '0')}`;
        const existing = monthlyRevenue.get(monthKey) || { revenue: 0, orders: 0 };
        monthlyRevenue.set(monthKey, {
            revenue: existing.revenue + (order.totalAmount || 0),
            orders: existing.orders + 1,
        });

        // Payment breakdown
        const method = order.paymentMethod || 'Unknown';
        const pmEntry = paymentMethodCounts.get(method) || { count: 0, total: 0 };
        paymentMethodCounts.set(method, {
            count: pmEntry.count + 1,
            total: pmEntry.total + (order.totalAmount || 0),
        });

        // Order notes
        if (order.internalNotes) {
            orderNotes.push({
                orderNumber: order.orderNumber,
                note: order.internalNotes,
                orderDate: order.orderDate,
            });
        }

        for (const line of order.orderLines) {
            const variation = line.sku?.variation;
            if (variation) {
                // Color affinity
                const colorName = variation.colorName;
                if (colorName) {
                    const existingColor = colorCounts.get(colorName) || { qty: 0, hex: variation.colorHex };
                    colorCounts.set(colorName, {
                        qty: existingColor.qty + line.qty,
                        hex: existingColor.hex || variation.colorHex,
                    });
                }

                // Product affinity
                const productName = variation.product?.name;
                if (productName) {
                    productCounts.set(productName, (productCounts.get(productName) || 0) + line.qty);
                }
            }

            // Return analysis
            if (line.returnStatus) {
                totalReturnedLines++;
                if (line.returnReasonCategory) {
                    reasonCounts.set(line.returnReasonCategory, (reasonCounts.get(line.returnReasonCategory) || 0) + 1);
                }
                if (line.returnResolution) {
                    resolutionCounts.set(line.returnResolution, (resolutionCounts.get(line.returnResolution) || 0) + 1);
                }
            }

            // RTO analysis
            if (line.rtoInitiatedAt) {
                totalRtoLines++;
                if (line.rtoCondition) {
                    rtoConditionCounts.set(line.rtoCondition, (rtoConditionCounts.get(line.rtoCondition) || 0) + 1);
                }
            }

            // Line notes
            if (line.notes) {
                orderNotes.push({
                    orderNumber: order.orderNumber,
                    note: `[Line] ${line.notes}`,
                    orderDate: order.orderDate,
                });
            }
        }
    }

    // Convert affinities to sorted arrays (top 10)
    const colorAffinity: ColorAffinity[] = Array.from(colorCounts.entries())
        .map(([color, data]) => ({ color, ...(data.hex ? { hex: data.hex } : {}), qty: data.qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10);

    const productAffinity: ProductAffinity[] = Array.from(productCounts.entries())
        .map(([productName, qty]) => ({ productName, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10);

    const fabricAffinity: FabricAffinity[] = Array.from(fabricCounts.entries())
        .map(([fabricType, qty]) => ({ fabricType, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10);

    // Build return analysis
    const returnAnalysis: ReturnAnalysis | null = (totalReturnedLines > 0 || totalRtoLines > 0)
        ? {
            reasonBreakdown: Array.from(reasonCounts.entries())
                .map(([reason, count]) => ({ reason, count }))
                .sort((a, b) => b.count - a.count),
            resolutionBreakdown: Array.from(resolutionCounts.entries())
                .map(([resolution, count]) => ({ resolution, count }))
                .sort((a, b) => b.count - a.count),
            rtoConditionBreakdown: Array.from(rtoConditionCounts.entries())
                .map(([condition, count]) => ({ condition, count }))
                .sort((a, b) => b.count - a.count),
            totalReturnedLines,
            totalRtoLines,
        }
        : null;

    // Build revenue timeline (last 12 months sorted)
    const revenueTimeline: RevenueTimeline = Array.from(monthlyRevenue.entries())
        .map(([month, data]) => ({ month, revenue: Math.round(data.revenue), orders: data.orders }))
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-12);

    // Build payment breakdown
    const paymentBreakdown: PaymentBreakdown = Array.from(paymentMethodCounts.entries())
        .map(([method, data]) => ({ method, count: data.count, total: Math.round(data.total) }))
        .sort((a, b) => b.count - a.count);

    // Calculate derived stats
    const totalOrders = customer.orderCount || 0;
    const lifetimeValue = customer.ltv || 0;
    const avgOrderValue = totalOrders > 0 ? Math.round(lifetimeValue / totalOrders) : 0;
    const returnCount = customer.returnCount || 0;
    const returnRate = totalOrders > 0 ? (returnCount / totalOrders) * 100 : 0;

    // Parse default address
    let defaultAddress = null;
    if (customer.defaultAddress) {
        try {
            defaultAddress = typeof customer.defaultAddress === 'string'
                ? JSON.parse(customer.defaultAddress)
                : customer.defaultAddress;
        } catch {
            defaultAddress = null;
        }
    }

    // Only return last 50 orders in the response (analysis uses all)
    const recentOrders = orders.slice(0, 50);

    return {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        tier: customer.tier,
        customerTier: customer.tier,
        tags: customer.tags,
        createdAt: customer.createdAt as Date,
        updatedAt: customer.updatedAt as Date,
        // Stats
        totalOrders,
        lifetimeValue,
        avgOrderValue,
        returnRate,
        returnCount,
        exchangeCount: customer.exchangeCount || 0,
        rtoCount: customer.rtoCount || 0,
        rtoOrderCount: (customer.rtoOrderCount as number) || 0,
        rtoValue: Number(customer.rtoValue) || 0,
        storeCreditBalance: Number(customer.storeCreditBalance) || 0,
        firstOrderDate: customer.firstOrderDate as Date | null,
        lastOrderDate: customer.lastOrderDate as Date | null,
        acceptsMarketing: customer.acceptsMarketing || false,
        defaultAddress,
        // Style DNA
        colorAffinity: colorAffinity.length > 0 ? colorAffinity : null,
        productAffinity: productAffinity.length > 0 ? productAffinity : null,
        fabricAffinity: fabricAffinity.length > 0 ? fabricAffinity : null,
        // Orders with enriched lines
        orders: recentOrders.map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            totalAmount: o.totalAmount,
            status: o.status,
            orderDate: o.orderDate,
            internalNotes: o.internalNotes,
            paymentMethod: o.paymentMethod,
            channel: o.channel,
            isExchange: o.isExchange,
            orderLines: o.orderLines.map((line) => ({
                id: line.id,
                qty: line.qty,
                unitPrice: line.unitPrice,
                lineStatus: line.lineStatus,
                notes: line.notes,
                refundAmount: line.refundAmount,
                returnStatus: line.returnStatus,
                returnReasonCategory: line.returnReasonCategory,
                returnReasonDetail: line.returnReasonDetail,
                returnResolution: line.returnResolution,
                returnCondition: line.returnCondition,
                rtoCondition: line.rtoCondition,
                rtoInitiatedAt: line.rtoInitiatedAt,
                sku: line.sku ? {
                    size: line.sku.size,
                    variation: line.sku.variation ? {
                        colorName: line.sku.variation.colorName,
                        colorHex: line.sku.variation.colorHex,
                        imageUrl: line.sku.variation.imageUrl,
                        product: line.sku.variation.product,
                        fabricColour: null,  // Removed - fabric assignment now via BOM
                    } : null,
                } : null,
            })),
        })),
        // Analysis
        returnAnalysis,
        revenueTimeline: revenueTimeline.length > 0 ? revenueTimeline : null,
        paymentBreakdown: paymentBreakdown.length > 0 ? paymentBreakdown : null,
        orderNotes: orderNotes.length > 0 ? orderNotes.sort((a, b) => b.orderDate.getTime() - a.orderDate.getTime()) : null,
    };
}
