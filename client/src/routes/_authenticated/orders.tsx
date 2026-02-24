/**
 * Orders Route - /orders
 *
 * Uses Route Loader to pre-fetch orders data on the server (SSR).
 * Auth is verified by parent _authenticated layout's beforeLoad.
 */
import { createFileRoute } from '@tanstack/react-router';
import { OrdersSearchParams } from '@coh/shared';
import { getOrders, type OrdersResponse } from '../../server/functions/orders';

import Orders from '../../pages/Orders';

export const Route = createFileRoute('/_authenticated/orders')({
    validateSearch: (search) => OrdersSearchParams.parse(search),
    loaderDeps: ({ search }) => ({
        view: search.view || 'all',
        page: search.page || 1,
        limit: search.limit || 250,
    }),
    loader: async ({ deps, context }): Promise<OrdersLoaderData> => {
        // Skip data fetch if auth failed during SSR — client will redirect to login
        if (!context.user) {
            return {
                orders: {
                    rows: [],
                    view: deps.view,
                    hasInventory: false,
                    pagination: { total: 0, page: 1, limit: deps.limit, totalPages: 0, hasMore: false },
                },
                error: null,
            };
        }
        try {
            const orders = await getOrders({
                data: {
                    view: deps.view as 'all' | 'in_transit' | 'delivered' | 'rto' | 'cancelled',
                    page: deps.page,
                    limit: deps.limit,
                },
            });
            return { orders, error: null };
        } catch (error) {
            console.error('[Orders Loader] Error:', error);
            return {
                orders: {
                    rows: [],
                    view: deps.view,
                    hasInventory: false,
                    pagination: { total: 0, page: 1, limit: deps.limit, totalPages: 0, hasMore: false },
                },
                error: error instanceof Error ? error.message : 'Failed to load orders',
            };
        }
    },
    component: Orders,
});

export interface OrdersLoaderData {
    orders: OrdersResponse;
    error: string | null;
}
