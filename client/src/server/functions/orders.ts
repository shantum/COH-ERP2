/**
 * Orders Server Function - Direct Database Access Pattern
 *
 * Queries the database directly using shared Kysely queries,
 * authenticated via HttpOnly cookies.
 *
 * Architecture:
 * Client → Server Function → Shared Kysely Query → Database
 *              ↑
 *       Cookie auth (automatic)
 */
'use server';

import { createServerFn } from '@tanstack/react-start';
import { OrdersSearchParams } from '@coh/shared';
import { listOrdersKysely, transformKyselyToRows } from '@coh/shared/database';
import { authMiddleware } from '../middleware/auth';

// Initialize Kysely on first import
import '../db';

/**
 * Return type for getOrders Server Function
 * Matches the existing tRPC orders.list response shape
 */
export interface GetOrdersResponse {
    rows: ReturnType<typeof transformKyselyToRows>;
    view: 'open' | 'shipped' | 'cancelled';
    hasInventory: boolean;
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasMore: boolean;
    };
}

/**
 * Get orders list with pagination and filtering
 *
 * Server Function with direct database access via shared Kysely queries.
 * Authenticated via HttpOnly cookie (authMiddleware).
 *
 * @example
 * // In a component:
 * const { data } = useQuery({
 *   queryKey: ['orders', 'list', search],
 *   queryFn: () => getOrders({ data: search }),
 * });
 */
export const getOrders = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((data: unknown) => {
        // Validate with Zod schema
        const parsed = OrdersSearchParams.safeParse(data);
        if (!parsed.success) {
            throw new Error(`Invalid input: ${parsed.error.message}`);
        }
        return parsed.data;
    })
    .handler(async ({ data }): Promise<GetOrdersResponse> => {
        // Query database directly using shared Kysely query
        const { orders, totalCount } = await listOrdersKysely({
            view: data.view,
            page: data.page,
            limit: data.limit,
            shippedFilter: data.shippedFilter,
            search: data.search,
            days: data.days,
        });

        // Transform to flattened row format expected by frontend
        const rows = transformKyselyToRows(orders);

        return {
            rows,
            view: data.view,
            hasInventory: true, // Kysely query always includes inventory-ready data
            pagination: {
                total: totalCount,
                page: data.page,
                limit: data.limit,
                totalPages: Math.ceil(totalCount / data.limit),
                hasMore: data.page * data.limit < totalCount,
            },
        };
    });
