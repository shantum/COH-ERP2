/**
 * Inventory Mobile Route - /inventory-mobile
 *
 * Mobile-friendly inventory page using TanStack Table and shadcn/ui.
 * Shows SKU-level stock data with product info and Shopify comparison.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { z } from 'zod';
import { getInventoryAll, type InventoryAllResult } from '../../server/functions/inventory';

const InventoryMobile = lazy(() => import('../../pages/InventoryMobile'));

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
            // Fetch all items for product grouping (client groups by product)
            // Filters are applied server-side, only the filtered subset is returned
            const inventory = await getInventoryAll({
                data: {
                    includeCustomSkus: false,
                    search: deps.search,
                    limit: 10000, // Need all for product grouping
                    offset: 0,
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
    inventory: InventoryAllResult | null;
    error: string | null;
}
