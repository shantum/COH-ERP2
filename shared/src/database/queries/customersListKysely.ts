/**
 * Kysely Customers List Query
 *
 * High-performance replacement for Prisma's nested includes.
 * Uses the denormalized ltv/orderCount/tier fields on Customer table.
 *
 * Shared between Express server and TanStack Start Server Functions.
 */

import { sql } from 'kysely';
import { getKysely } from '../createKysely.js';

// ============================================
// TYPES
// ============================================

export type CustomerTier = 'new' | 'bronze' | 'silver' | 'gold' | 'platinum';

export interface CustomersListParams {
    search?: string;
    tier?: CustomerTier | 'all';
    limit?: number;
    offset?: number;
}

export interface CustomerListItem {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    totalOrders: number;
    lifetimeValue: number;
    customerTier: CustomerTier;
    createdAt: Date;
}

export interface CustomersListResponse {
    customers: CustomerListItem[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    };
}

// ============================================
// MAIN QUERY
// ============================================

/**
 * List customers with search and tier filter
 * Uses denormalized ltv/orderCount/tier fields for efficiency
 */
export async function listCustomersKysely(
    params: CustomersListParams = {}
): Promise<CustomersListResponse> {
    const kysely = getKysely();
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mainQuery = mainQuery.where((eb: any) =>
                eb.or([
                    sql`LOWER("Customer"."email") LIKE ${searchTerm}`,
                    sql`LOWER("Customer"."firstName") LIKE ${searchTerm}`,
                    sql`LOWER("Customer"."lastName") LIKE ${searchTerm}`,
                    sql`"Customer"."phone" LIKE ${searchTerm}`,
                ])
            ) as typeof mainQuery;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            countQuery = countQuery.where((eb: any) =>
                eb.or([
                    sql`LOWER("Customer"."email") LIKE ${searchTerm}`,
                    sql`LOWER("Customer"."firstName") LIKE ${searchTerm}`,
                    sql`LOWER("Customer"."lastName") LIKE ${searchTerm}`,
                    sql`"Customer"."phone" LIKE ${searchTerm}`,
                ])
            ) as typeof countQuery;
        } else {
            // Multi-word search: all words must match
            for (const word of words) {
                const searchTerm = `%${word}%`;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                mainQuery = mainQuery.where((eb: any) =>
                    eb.or([
                        sql`LOWER("Customer"."email") LIKE ${searchTerm}`,
                        sql`LOWER("Customer"."firstName") LIKE ${searchTerm}`,
                        sql`LOWER("Customer"."lastName") LIKE ${searchTerm}`,
                        sql`"Customer"."phone" LIKE ${searchTerm}`,
                    ])
                ) as typeof mainQuery;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                countQuery = countQuery.where((eb: any) =>
                    eb.or([
                        sql`LOWER("Customer"."email") LIKE ${searchTerm}`,
                        sql`LOWER("Customer"."firstName") LIKE ${searchTerm}`,
                        sql`LOWER("Customer"."lastName") LIKE ${searchTerm}`,
                        sql`"Customer"."phone" LIKE ${searchTerm}`,
                    ])
                ) as typeof countQuery;
            }
        }
    }

    // Apply tier filter (using stored tier field)
    if (tier && tier !== 'all') {
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
        totalOrders: c.orderCount || 0,
        lifetimeValue: c.ltv || 0,
        customerTier: (c.tier || 'bronze') as CustomerTier,
        createdAt: c.createdAt as Date,
    }));

    return {
        customers,
        pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total,
        },
    };
}
