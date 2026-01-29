/**
 * Inventory Route - /inventory
 *
 * Uses Route Loader to pre-fetch inventory data on the server (SSR).
 * Auth is verified by parent _authenticated layout's beforeLoad.
 *
 * Server-side pagination: ~100 items per page for performance.
 */
import { createFileRoute } from '@tanstack/react-router';
import { InventorySearchParams } from '@coh/shared';
import {
    getInventoryAll,
    type InventoryAllResult,
} from '../../server/functions/inventory';

// Direct import (no lazy loading) for SSR routes with loader data
// React's lazy() causes hydration flicker: SSR content → Suspense fallback → content again
import Inventory from '../../pages/Inventory';

export const Route = createFileRoute('/_authenticated/inventory')({
    validateSearch: (search) => InventorySearchParams.parse(search),
    // Extract search params for loader (pagination + filters)
    loaderDeps: ({ search }) => ({
        page: search.page,
        limit: search.limit,
        search: search.search,
        stockFilter: search.stockFilter,
    }),
    // Pre-fetch paginated inventory data on server
    loader: async ({ deps }): Promise<InventoryLoaderData> => {
        try {
            const { page, limit, search, stockFilter } = deps;
            const offset = (page - 1) * limit;

            const inventory = await getInventoryAll({
                data: {
                    includeCustomSkus: false,
                    search: search || undefined,
                    stockFilter: stockFilter as 'all' | 'in_stock' | 'low_stock' | 'out_of_stock' | undefined,
                    limit,
                    offset,
                },
            });

            // Add totalPages to pagination for convenience
            const totalPages = Math.ceil(inventory.pagination.total / limit);

            return {
                inventory: {
                    ...inventory,
                    pagination: {
                        ...inventory.pagination,
                        totalPages,
                    },
                },
                error: null,
            };
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

// Extended pagination type with totalPages
export interface InventoryPagination {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    totalPages: number;
}

// Export loader data type for use in components
export interface InventoryLoaderData {
    inventory: (Omit<InventoryAllResult, 'pagination'> & { pagination: InventoryPagination }) | null;
    error: string | null;
}
