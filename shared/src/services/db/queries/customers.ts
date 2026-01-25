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
} from '../../../schemas/customers.js';

// ============================================
// INPUT TYPES
// ============================================

export interface CustomerDetailParams {
    id: string;
}

// Type for order with lines from Prisma query
interface OrderWithLines {
    id: string;
    orderNumber: string;
    totalAmount: number | null;
    status: string;
    orderDate: Date;
    orderLines: Array<{
        id: string;
        qty: number;
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
                fabricColour: {
                    fabric: {
                        name: string | null;
                    } | null;
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
 * - Customer stats (ltv, orders, returns, RTO)
 * - Style DNA (color, product, fabric affinities)
 * - Recent orders with line items for size preferences
 */
export async function getCustomerKysely(id: string): Promise<CustomerDetailResult | null> {
    const db = await getKysely();
    const prisma = await getPrisma();

    // Get customer with all stats
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
            'Customer.firstOrderDate',
            'Customer.lastOrderDate',
            'Customer.acceptsMarketing',
            'Customer.defaultAddress',
        ])
        .where('Customer.id', '=', id)
        .executeTakeFirst();

    if (!customer) return null;

    // Get orders with full line details using Prisma for relations
    const orders: OrderWithLines[] = await prisma.order.findMany({
        where: { customerId: id },
        orderBy: { orderDate: 'desc' },
        take: 20,
        select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            status: true,
            orderDate: true,
            orderLines: {
                select: {
                    id: true,
                    qty: true,
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
                                    fabricColour: {
                                        select: {
                                            fabric: {
                                                select: {
                                                    name: true,
                                                },
                                            },
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

    // Calculate affinities from order lines
    const colorCounts = new Map<string, { qty: number; hex: string | null }>();
    const productCounts = new Map<string, number>();
    const fabricCounts = new Map<string, number>();

    for (const order of orders) {
        for (const line of order.orderLines) {
            const variation = line.sku?.variation;
            if (!variation) continue;

            // Color affinity
            const colorName = variation.colorName;
            if (colorName) {
                const existing = colorCounts.get(colorName) || { qty: 0, hex: variation.colorHex };
                colorCounts.set(colorName, {
                    qty: existing.qty + line.qty,
                    hex: existing.hex || variation.colorHex,
                });
            }

            // Product affinity
            const productName = variation.product?.name;
            if (productName) {
                productCounts.set(productName, (productCounts.get(productName) || 0) + line.qty);
            }

            // Fabric affinity
            const fabricName = variation.fabricColour?.fabric?.name;
            if (fabricName) {
                fabricCounts.set(fabricName, (fabricCounts.get(fabricName) || 0) + line.qty);
            }
        }
    }

    // Convert to sorted arrays (top 10)
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

    // Calculate derived stats
    const totalOrders = customer.orderCount || 0;
    const lifetimeValue = customer.ltv || 0;
    const avgOrderValue = totalOrders > 0 ? Math.round(lifetimeValue / totalOrders) : 0;
    const returnCount = customer.returnCount || 0;
    const returnRate = totalOrders > 0 ? (returnCount / totalOrders) * 100 : 0;

    // Parse default address if stored as JSON string
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
        firstOrderDate: customer.firstOrderDate as Date | null,
        lastOrderDate: customer.lastOrderDate as Date | null,
        acceptsMarketing: customer.acceptsMarketing || false,
        defaultAddress,
        // Style DNA
        colorAffinity: colorAffinity.length > 0 ? colorAffinity : null,
        productAffinity: productAffinity.length > 0 ? productAffinity : null,
        fabricAffinity: fabricAffinity.length > 0 ? fabricAffinity : null,
        // Orders with lines for size preferences
        orders: orders.map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            totalAmount: o.totalAmount,
            status: o.status,
            orderDate: o.orderDate,
            orderLines: o.orderLines.map((line) => ({
                id: line.id,
                qty: line.qty,
                sku: line.sku ? {
                    size: line.sku.size,
                    variation: line.sku.variation ? {
                        colorName: line.sku.variation.colorName,
                        colorHex: line.sku.variation.colorHex,
                        imageUrl: line.sku.variation.imageUrl,
                        product: line.sku.variation.product,
                        fabricColour: line.sku.variation.fabricColour,
                    } : null,
                } : null,
            })),
        })),
    };
}
