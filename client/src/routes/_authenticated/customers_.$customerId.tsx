/**
 * Customer Detail Route - /customers/:customerId
 *
 * Uses pathless layout escape (customers_) to avoid nesting under the customers layout.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const CustomerDetail = lazy(() => import('../../pages/customers/CustomerDetail'));

export const Route = createFileRoute('/_authenticated/customers_/$customerId')({
    component: CustomerDetail,
});
