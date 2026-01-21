/**
 * Products Route - /products
 *
 * Uses Route Loader to pre-fetch products tree data on the server (SSR).
 * Auth is verified by parent _authenticated layout's beforeLoad.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { ProductsSearchParams } from '@coh/shared';
import {
    getProductsTree,
    type ProductsTreeResponse,
} from '../../server/functions/products';

const Products = lazy(() => import('../../pages/Products'));

export const Route = createFileRoute('/_authenticated/products')({
    validateSearch: (search) => ProductsSearchParams.parse(search),
    // Extract search params for loader
    loaderDeps: ({ search }) => ({
        tab: search.tab || 'products',
    }),
    // Pre-fetch products tree data on server (only for certain tabs)
    loader: async ({ deps }): Promise<ProductsLoaderData> => {
        // Only load products tree for tabs that need it
        const needsProductsTree = ['products', 'bom', 'consumption', 'fabricMapping'].includes(
            deps.tab
        );

        // Skip if tab doesn't need products tree data
        if (!needsProductsTree) {
            return { productsTree: null, error: null };
        }

        try {
            const productsTree = await getProductsTree({ data: {} });
            return { productsTree, error: null };
        } catch (error) {
            console.error('[Products Loader] Error:', error);
            return {
                productsTree: null,
                error: error instanceof Error ? error.message : 'Failed to load products',
            };
        }
    },
    component: Products,
});

// Export loader data type for use in components
export interface ProductsLoaderData {
    productsTree: ProductsTreeResponse | null;
    error: string | null;
}
