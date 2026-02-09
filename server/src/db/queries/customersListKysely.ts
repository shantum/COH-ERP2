/**
 * Kysely Customers List Query
 *
 * High-performance replacement for Prisma's nested includes.
 * Uses the denormalized ltv/orderCount/tier fields on Customer table
 * instead of fetching and aggregating orders.
 *
 * Follows the three directives:
 * - D1: Types from DB, no manual interfaces
 * - D2: All JOINs use indexed FKs (verified in schema)
 * - D3: Lean payload - only fields used by frontend
 *
 * All public exports are validated against Zod schemas to catch schema drift.
 */

import { sql, type SqlBool } from 'kysely';
import { kysely } from '../index.js';
import type { CustomerTier } from '../../utils/tierUtils.js';
import {
    customersListResultSchema,
    customerDetailResultSchema,
    customerStatsResultSchema,
    type CustomerListItem,
    type CustomersListResult,
    type CustomerDetailResult,
    type CustomerStatsResult,
} from '@coh/shared';

// Re-export output types from schemas
export type { CustomerListItem, CustomersListResult, CustomerDetailResult, CustomerStatsResult };

// ============================================
// INPUT TYPES (not validated - internal use)
// ============================================

export interface CustomersListParams {
    search?: string;
    tier?: CustomerTier;
    limit?: number;
    offset?: number;
}

// ============================================
// MAIN QUERY
// ============================================

/**
 * List customers with search and tier filter
 * Uses denormalized ltv/orderCount/tier fields for efficiency
 */
export async function listCustomersKysely(
    params: CustomersListParams
): Promise<CustomersListResult> {
    const { search, tier, limit = 50, offset = 0 } = params;

    // Build base query for counting
    let countQuery = kysely.selectFrom('Customer').select(sql<number>`count(*)::int`.as('count'));

    // Build main query
    let mainQuery = kysely
        .selectFrom('Customer')
        .select([
            'Customer.id',
            'Customer.email',
            'Customer.firstName',
            'Customer.lastName',
            'Customer.phone',
            'Customer.orderCount',
            'Customer.ltv',
            'Customer.tier',
            'Customer.createdAt',
        ]);

    // Apply search filter
    if (search) {
        const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);

        if (words.length === 1) {
            const searchTerm = `%${words[0]}%`;
            mainQuery = mainQuery.where((eb) =>
                eb.or([
                    sql<SqlBool>`LOWER("Customer"."email") LIKE ${searchTerm}`,
                    sql<SqlBool>`LOWER("Customer"."firstName") LIKE ${searchTerm}`,
                    sql<SqlBool>`LOWER("Customer"."lastName") LIKE ${searchTerm}`,
                    sql<SqlBool>`"Customer"."phone" LIKE ${searchTerm}`,
                ])
            ) as typeof mainQuery;
            countQuery = countQuery.where((eb) =>
                eb.or([
                    sql<SqlBool>`LOWER("Customer"."email") LIKE ${searchTerm}`,
                    sql<SqlBool>`LOWER("Customer"."firstName") LIKE ${searchTerm}`,
                    sql<SqlBool>`LOWER("Customer"."lastName") LIKE ${searchTerm}`,
                    sql<SqlBool>`"Customer"."phone" LIKE ${searchTerm}`,
                ])
            ) as typeof countQuery;
        } else {
            // Multi-word search: all words must match
            for (const word of words) {
                const searchTerm = `%${word}%`;
                mainQuery = mainQuery.where((eb) =>
                    eb.or([
                        sql<SqlBool>`LOWER("Customer"."email") LIKE ${searchTerm}`,
                        sql<SqlBool>`LOWER("Customer"."firstName") LIKE ${searchTerm}`,
                        sql<SqlBool>`LOWER("Customer"."lastName") LIKE ${searchTerm}`,
                        sql<SqlBool>`"Customer"."phone" LIKE ${searchTerm}`,
                    ])
                ) as typeof mainQuery;
                countQuery = countQuery.where((eb) =>
                    eb.or([
                        sql<SqlBool>`LOWER("Customer"."email") LIKE ${searchTerm}`,
                        sql<SqlBool>`LOWER("Customer"."firstName") LIKE ${searchTerm}`,
                        sql<SqlBool>`LOWER("Customer"."lastName") LIKE ${searchTerm}`,
                        sql<SqlBool>`"Customer"."phone" LIKE ${searchTerm}`,
                    ])
                ) as typeof countQuery;
            }
        }
    }

    // Apply tier filter (using stored tier field)
    if (tier) {
        mainQuery = mainQuery.where('Customer.tier', '=', tier) as typeof mainQuery;
        countQuery = countQuery.where('Customer.tier', '=', tier) as typeof countQuery;
    }

    // Get total count
    const countResult = await countQuery.executeTakeFirst();
    const total = countResult?.count ?? 0;

    // Get customers with pagination
    const customersRaw = await mainQuery
        .orderBy('Customer.createdAt', 'desc')
        .limit(limit)
        .offset(offset)
        .execute();

    // Map to result type
    const customers: CustomerListItem[] = customersRaw.map((c) => ({
        id: c.id,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        totalOrders: c.orderCount,
        lifetimeValue: c.ltv,
        customerTier: (c.tier || 'bronze') as CustomerTier,
        createdAt: c.createdAt as Date,
    }));

    const result = {
        customers,
        pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total,
        },
    };

    // Validate output against Zod schema
    return customersListResultSchema.parse(result);
}

// ============================================
// CUSTOMER DETAIL QUERY
// ============================================

/**
 * Get single customer by ID with recent orders
 */
export async function getCustomerKysely(id: string): Promise<CustomerDetailResult | null> {
    // Get customer
    const customer = await kysely
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
    const recentOrders = await kysely
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

    const result = {
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

    // Validate output against Zod schema
    return customerDetailResultSchema.parse(result);
}

// ============================================
// CUSTOMER STATS QUERY
// ============================================

/**
 * Get customer statistics
 * Uses denormalized fields where available, computes rates from counts
 */
export async function getCustomerStatsKysely(id: string): Promise<CustomerStatsResult | null> {
    // Get customer with stored metrics
    const customer = await kysely
        .selectFrom('Customer')
        .select([
            'Customer.id',
            'Customer.tier',
            'Customer.ltv',
            'Customer.orderCount',
            'Customer.rtoCount',
            'Customer.returnCount',
            'Customer.exchangeCount',
            'Customer.firstOrderDate',
            'Customer.lastOrderDate',
        ])
        .where('Customer.id', '=', id)
        .executeTakeFirst();

    if (!customer) return null;

    const orderCount = customer.orderCount || 0;
    const ltv = customer.ltv || 0;
    const rtoCount = customer.rtoCount || 0;
    const returnCount = customer.returnCount || 0;
    const exchangeCount = customer.exchangeCount || 0;

    const avgOrderValue = orderCount > 0 ? Math.round(ltv / orderCount) : 0;
    const rtoRate = orderCount > 0 ? parseFloat(((rtoCount / orderCount) * 100).toFixed(1)) : 0;
    const returnRate = orderCount > 0 ? parseFloat(((returnCount / orderCount) * 100).toFixed(1)) : 0;

    const result = {
        customerId: customer.id,
        lifetimeValue: ltv,
        orderCount,
        avgOrderValue,
        rtoCount,
        rtoRate,
        returns: returnCount,
        exchanges: exchangeCount,
        returnRate,
        tier: (customer.tier || 'bronze') as CustomerTier,
        firstOrderDate: customer.firstOrderDate as Date | null,
        lastOrderDate: customer.lastOrderDate as Date | null,
    };

    // Validate output against Zod schema
    return customerStatsResultSchema.parse(result);
}
