/**
 * Customers Route - /customers
 *
 * Uses Route Loader to pre-fetch customers data on the server (SSR).
 * Auth is verified by parent _authenticated layout's beforeLoad.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { CustomersSearchParams } from '@coh/shared';
import {
    getCustomersList,
    type CustomersListResponse,
} from '../../server/functions/customers';

const Customers = lazy(() => import('../../pages/Customers'));

export const Route = createFileRoute('/_authenticated/customers')({
    validateSearch: (search) => CustomersSearchParams.parse(search),
    // Extract search params for loader
    loaderDeps: ({ search }) => ({
        search: search.search,
        tier: search.tier || 'all',
        page: search.page || 1,
        limit: search.limit || 50,
        tab: search.tab || 'all',
    }),
    // Pre-fetch customers data on server
    loader: async ({ deps }): Promise<CustomersLoaderData> => {
        // Skip on special tabs (highValue, atRisk, returners tabs use different data sources)
        if (deps.tab !== 'all') {
            return { customers: null, error: null };
        }

        try {
            const offset = (deps.page - 1) * deps.limit;
            const customers = await getCustomersList({
                data: {
                    search: deps.search,
                    tier: deps.tier as 'all' | 'new' | 'bronze' | 'silver' | 'gold' | 'platinum',
                    limit: deps.limit,
                    offset,
                },
            });
            return { customers, error: null };
        } catch (error) {
            console.error('[Customers Loader] Error:', error);
            return {
                customers: null,
                error: error instanceof Error ? error.message : 'Failed to load customers',
            };
        }
    },
    component: Customers,
});

// Export loader data type for use in components
export interface CustomersLoaderData {
    customers: CustomersListResponse | null;
    error: string | null;
}
