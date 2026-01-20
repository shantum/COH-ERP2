/**
 * Orders Route - /orders
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { OrdersSearchParams } from '@coh/shared';

const Orders = lazy(() => import('../../pages/Orders'));

export const Route = createFileRoute('/_authenticated/orders')({
    validateSearch: (search) => OrdersSearchParams.parse(search),
    component: Orders,
});
