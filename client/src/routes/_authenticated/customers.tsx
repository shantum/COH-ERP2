/**
 * Customers Route - /customers
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { CustomersSearchParams } from '@coh/shared';

const Customers = lazy(() => import('../../pages/Customers'));

export const Route = createFileRoute('/_authenticated/customers')({
    validateSearch: (search) => CustomersSearchParams.parse(search),
    component: Customers,
});
