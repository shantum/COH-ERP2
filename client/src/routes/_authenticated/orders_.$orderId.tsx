/**
 * Order Detail Route - /orders/:orderId
 *
 * Uses pathless layout escape (orders_) to avoid nesting under the orders layout.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const OrderDetail = lazy(() => import('../../pages/orders/OrderDetail'));

export const Route = createFileRoute('/_authenticated/orders_/$orderId')({
    component: OrderDetail,
});
