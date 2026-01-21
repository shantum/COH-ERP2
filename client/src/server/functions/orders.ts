/**
 * Orders Server Functions
 *
 * TanStack Start Server Functions for orders data fetching.
 * Bypasses tRPC/Express, calls Kysely directly from the server.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

// Input validation schema matching OrdersListParams
const ordersListInputSchema = z.object({
    view: z.enum(['open', 'shipped', 'cancelled'] as const),
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(1000).default(100),
    shippedFilter: z.enum(['all', 'rto', 'cod_pending'] as const).optional(),
    search: z.string().optional(),
    days: z.number().int().positive().optional(),
    sortBy: z.enum(['orderDate', 'archivedAt', 'shippedAt', 'createdAt'] as const).optional(),
});

export type OrdersListInput = z.infer<typeof ordersListInputSchema>;

/**
 * Response type matching useUnifiedOrdersData expectations
 * Uses any[] for rows since transformKyselyToRows returns a complex computed type
 */
export interface OrdersResponse {
    rows: any[];
    view: string;
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
 * Server Function: Get orders list
 *
 * Fetches orders directly from database using Kysely.
 * Returns flattened rows ready for AG-Grid display.
 */
export const getOrders = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => ordersListInputSchema.parse(input))
    .handler(async ({ data }): Promise<OrdersResponse> => {
        console.log('[Server Function] getOrders called with:', data);

        try {
            // Dynamic imports - only loaded on server, not bundled into client
            // This prevents Node.js-only modules (pg, Buffer) from breaking the browser
            const { createKysely } = await import('@coh/shared/database');
            const { listOrdersKysely, transformKyselyToRows } = await import(
                '@coh/shared/database/queries/ordersListKysely'
            );

            // Initialize Kysely singleton (safe to call multiple times)
            createKysely(process.env.DATABASE_URL);

            const params = {
                view: data.view as 'open' | 'shipped' | 'cancelled',
                page: data.page,
                limit: data.limit,
                shippedFilter: data.shippedFilter as 'all' | 'rto' | 'cod_pending' | undefined,
                search: data.search,
                days: data.days,
                sortBy: data.sortBy as 'orderDate' | 'archivedAt' | 'shippedAt' | 'createdAt' | undefined,
            };

            // Call Kysely query directly
            const result = await listOrdersKysely(params);
            console.log('[Server Function] Query returned', result.orders.length, 'orders, total:', result.totalCount);

            // Transform to flattened rows for AG-Grid
            const rows = transformKyselyToRows(result.orders);

            // Calculate pagination
            const totalPages = Math.ceil(result.totalCount / data.limit);

            return {
                rows,
                view: data.view,
                hasInventory: false, // TODO: Add inventory enrichment
                pagination: {
                    total: result.totalCount,
                    page: data.page,
                    limit: data.limit,
                    totalPages,
                    hasMore: data.page < totalPages,
                },
            };
        } catch (error) {
            console.error('[Server Function] Error in getOrders:', error);
            throw error;
        }
    });
