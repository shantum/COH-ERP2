/**
 * Products Route - /products
 *
 * Uses Route Loader to pre-fetch products tree data on the server (SSR).
 * Auth is verified by parent _authenticated layout's beforeLoad.
 */
import { createFileRoute } from '@tanstack/react-router';
import { ProductsSearchParams } from '@coh/shared';
import {
    getProductsTree,
    type ProductsTreeResponse,
} from '../../server/functions/products';

// Direct import (no lazy loading) for SSR routes with loader data
// React's lazy() causes hydration flicker: SSR content → Suspense fallback → content again
import Products from '../../pages/Products';

export const Route = createFileRoute('/_authenticated/products')({
    validateSearch: (search) => ProductsSearchParams.parse(search),
    // Pre-fetch products tree data on server
    loader: async ({ context }): Promise<ProductsLoaderData> => {
        // Skip data fetch if auth failed during SSR — client will redirect to login
        if (!context.user) {
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
