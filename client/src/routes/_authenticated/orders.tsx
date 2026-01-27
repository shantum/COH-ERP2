/**
 * Orders Route - /orders
 *
 * Uses Route Loader to pre-fetch orders data on the server (SSR).
 * Auth is verified by parent _authenticated layout's beforeLoad.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { OrdersSearchParams } from '@coh/shared';
import { getOrders, type OrdersResponse } from '../../server/functions/orders';

const Orders = lazy(() => import('../../pages/Orders'));

export const Route = createFileRoute('/_authenticated/orders')({
    validateSearch: (search) => OrdersSearchParams.parse(search),
    // Extract search params for loader
    loaderDeps: ({ search }) => ({
        view: search.view || 'open',
        page: search.page || 1,
    }),
    // Pre-fetch orders data on server
    loader: async ({ deps }): Promise<OrdersLoaderData> => {
        try {
            const orders = await getOrders({
                data: {
                    view: deps.view as 'open' | 'shipped' | 'rto' | 'all',
                    page: deps.page,
                    limit: 250,
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
                    pagination: { total: 0, page: 1, limit: 250, totalPages: 0, hasMore: false },
                },
                error: error instanceof Error ? error.message : 'Failed to load orders',
            };
        }
    },
    component: Orders,
});

// Export loader data type for use in components
export interface OrdersLoaderData {
    orders: OrdersResponse;
    error: string | null;
}
