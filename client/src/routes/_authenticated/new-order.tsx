/**
 * New Order Page Route - /new-order
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const NewOrder = lazy(() => import('../../pages/NewOrder'));

export const Route = createFileRoute('/_authenticated/new-order')({
    component: NewOrder,
});
