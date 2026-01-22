/**
 * Kysely Customer Queries
 *
 * High-performance customer queries using type-safe SQL.
 * Moved from server/src/db/queries/customersListKysely.ts
 * to be accessible from Server Functions.
 */

import { getKysely } from '../kysely.js';
import type { CustomerDetailResult } from '../../../schemas/customers.js';

// ============================================
// INPUT TYPES
// ============================================

export interface CustomerDetailParams {
    id: string;
}

// ============================================
// QUERIES
// ============================================

/**
 * Get single customer by ID with recent orders
 *
 * Uses Kysely for efficient JOINs and aggregation.
 * Returns customer details with up to 10 recent orders.
 */
export async function getCustomerKysely(id: string): Promise<CustomerDetailResult | null> {
    const db = await getKysely();

    // Get customer
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
        ])
        .where('Customer.id', '=', id)
        .executeTakeFirst();

    if (!customer) return null;

    // Get recent orders (limit 10)
    const recentOrders = await db
        .selectFrom('Order')
        .select([
            'Order.id',
            'Order.orderNumber',
            'Order.totalAmount',
            'Order.status',
            'Order.orderDate',
        ])
        .where('Order.customerId', '=', id)
        .orderBy('Order.orderDate', 'desc')
        .limit(10)
        .execute();

    return {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        tier: customer.tier,
        tags: customer.tags,
        createdAt: customer.createdAt as Date,
        updatedAt: customer.updatedAt as Date,
        ordersCount: customer.orderCount,
        recentOrders: recentOrders.map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            totalAmount: o.totalAmount,
            status: o.status,
            orderDate: o.orderDate as Date,
        })),
    };
}
