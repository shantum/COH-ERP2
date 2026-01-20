/**
 * Order Search Route - /order-search
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { OrderSearchSearchParams } from '@coh/shared';

const OrderSearch = lazy(() => import('../../pages/OrderSearch'));

export const Route = createFileRoute('/_authenticated/order-search')({
    validateSearch: (search) => OrderSearchSearchParams.parse(search),
    component: OrderSearch,
});
