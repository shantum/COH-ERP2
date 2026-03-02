/**
 * Storefront Live Route - /storefront
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const StorefrontLive = lazy(() => import('../../pages/StorefrontLive'));

export const Route = createFileRoute('/_authenticated/storefront')({
    component: StorefrontLive,
});
