/**
 * Inventory Route - /inventory
 *
 * Uses Route Loader to pre-fetch inventory data on the server (SSR).
 * Auth is verified by parent _authenticated layout's beforeLoad.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { InventorySearchParams } from '@coh/shared';
import { USE_SERVER_FUNCTIONS } from '../../config/serverFunctionFlags';
import {
    getInventoryList,
    type InventoryListResponse,
} from '../../server/functions/inventory';

const Inventory = lazy(() => import('../../pages/Inventory'));

export const Route = createFileRoute('/_authenticated/inventory')({
    validateSearch: (search) => InventorySearchParams.parse(search),
    // Extract search params for loader
    loaderDeps: ({ search }) => ({
        stockFilter: search.stockFilter,
        search: search.search,
        page: search.page || 1,
        limit: search.limit || 100,
    }),
    // Pre-fetch inventory data on server
    loader: async ({ deps }): Promise<InventoryLoaderData> => {
        // Skip Server Function if flag is disabled
        if (!USE_SERVER_FUNCTIONS.inventoryList) {
            return { inventory: null, error: null };
        }

        try {
            const offset = (deps.page - 1) * deps.limit;
            const inventory = await getInventoryList({
                data: {
                    includeCustomSkus: false,
                    search: deps.search,
                    stockFilter: deps.stockFilter as 'all' | 'in_stock' | 'low_stock' | 'out_of_stock' | undefined,
                    limit: deps.limit,
                    offset,
                },
            });
            return { inventory, error: null };
        } catch (error) {
            console.error('[Inventory Loader] Error:', error);
            return {
                inventory: null,
                error: error instanceof Error ? error.message : 'Failed to load inventory',
            };
        }
    },
    component: Inventory,
});

// Export loader data type for use in components
export interface InventoryLoaderData {
    inventory: InventoryListResponse | null;
    error: string | null;
}
