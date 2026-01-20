/**
 * Products Route - /products
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { ProductsSearchParams } from '@coh/shared';

const Products = lazy(() => import('../../pages/Products'));

export const Route = createFileRoute('/_authenticated/products')({
    validateSearch: (search) => ProductsSearchParams.parse(search),
    component: Products,
});
