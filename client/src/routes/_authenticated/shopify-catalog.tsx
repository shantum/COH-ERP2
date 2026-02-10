/**
 * Shopify Catalog Route - /shopify-catalog
 *
 * Monitor all Shopify product metadata: titles, descriptions,
 * prices, variants, tags, images, and ERP link status.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { ShopifyCatalogSearchParams } from '@coh/shared';

const ShopifyCatalog = lazy(() => import('../../pages/ShopifyCatalog'));

export const Route = createFileRoute('/_authenticated/shopify-catalog')({
    validateSearch: (search) => ShopifyCatalogSearchParams.parse(search),
    component: ShopifyCatalog,
});
