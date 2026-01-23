/**
 * Inventory Route - /inventory
 *
 * Uses Route Loader to pre-fetch inventory data on the server (SSR).
 * Auth is verified by parent _authenticated layout's beforeLoad.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { InventorySearchParams } from '@coh/shared';
import {
    getInventoryList,
    type InventoryListResponse,
} from '../../server/functions/inventory';

const Inventory = lazy(() => import('../../pages/Inventory'));

export const Route = createFileRoute('/_authenticated/inventory')({
    validateSearch: (search) => InventorySearchParams.parse(search),
    // Extract search params for loader (only stockFilter used, client does filtering)
    loaderDeps: ({ search }) => ({
        stockFilter: search.stockFilter,
    }),
    // Pre-fetch ALL inventory data on server (client-side filtering via AG-Grid)
    loader: async ({ deps }): Promise<InventoryLoaderData> => {
        try {
            const inventory = await getInventoryList({
                data: {
                    includeCustomSkus: false,
                    stockFilter: deps.stockFilter as 'all' | 'in_stock' | 'low_stock' | 'out_of_stock' | undefined,
                    limit: 10000, // Load all SKUs for client-side search/filter
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
