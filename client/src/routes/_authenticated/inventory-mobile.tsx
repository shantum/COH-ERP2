/**
 * Inventory Mobile Route - /inventory-mobile
 *
 * Mobile-friendly inventory page using TanStack Table and shadcn/ui.
 * Shows product-grouped stock data with Shopify comparison.
 *
 * Uses server-side grouping for optimal payload size (~500 products vs ~10,000 SKUs).
 */
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { getInventoryGrouped, type InventoryGroupedResult } from '../../server/functions/inventory';

// Direct import (no lazy loading) for SSR routes with loader data
// React's lazy() causes hydration flicker: SSR content → Suspense fallback → content again
import InventoryMobile from '../../pages/InventoryMobile';

// Filter value types
export const stockFilterValues = ['all', 'in_stock', 'out_of_stock', 'low_stock'] as const;
export const shopifyStatusFilterValues = ['all', 'active', 'archived', 'draft'] as const;
export const discrepancyFilterValues = ['all', 'has_discrepancy', 'no_discrepancy'] as const;
export const fabricFilterValues = ['all', 'has_fabric', 'no_fabric', 'low_fabric'] as const;

// Sort options for numeric columns
export const sortByValues = ['stock', 'shopify', 'fabric'] as const;
export const sortOrderValues = ['desc', 'asc'] as const;

// Search params schema
const inventoryMobileSearchSchema = z.object({
    search: z.string().optional(),
    page: z.coerce.number().int().positive().optional().default(1),
    pageSize: z.coerce.number().int().positive().optional().default(50),
    // Filters
    stockFilter: z.enum(stockFilterValues).optional().default('all'),
    shopifyStatus: z.enum(shopifyStatusFilterValues).optional().default('all'),
    discrepancy: z.enum(discrepancyFilterValues).optional().default('all'),
    fabricFilter: z.enum(fabricFilterValues).optional().default('all'),
    // Sorting
    sortBy: z.enum(sortByValues).optional().default('stock'),
    sortOrder: z.enum(sortOrderValues).optional().default('desc'),
});

export type InventoryMobileSearch = z.infer<typeof inventoryMobileSearchSchema>;

export const Route = createFileRoute('/_authenticated/inventory-mobile')({
    validateSearch: (search) => inventoryMobileSearchSchema.parse(search),
    loaderDeps: ({ search }) => ({
        search: search.search,
        stockFilter: search.stockFilter,
        shopifyStatus: search.shopifyStatus,
        discrepancy: search.discrepancy,
        fabricFilter: search.fabricFilter,
        sortBy: search.sortBy,
        sortOrder: search.sortOrder,
    }),
    loader: async ({ deps }): Promise<InventoryMobileLoaderData> => {
        try {
            // Use server-side grouped data (much smaller payload)
            const inventory = await getInventoryGrouped({
                data: {
                    search: deps.search,
                    stockFilter: deps.stockFilter,
                    shopifyStatus: deps.shopifyStatus,
                    discrepancy: deps.discrepancy,
                    fabricFilter: deps.fabricFilter,
                    sortBy: deps.sortBy,
                    sortOrder: deps.sortOrder,
                },
            });
            return { inventory, error: null };
        } catch (error) {
            console.error('[InventoryMobile Loader] Error:', error);
            return {
                inventory: null,
                error: error instanceof Error ? error.message : 'Failed to load inventory',
            };
        }
    },
    component: InventoryMobile,
});

export interface InventoryMobileLoaderData {
    inventory: InventoryGroupedResult | null;
    error: string | null;
}
