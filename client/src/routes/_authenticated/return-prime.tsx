/**
 * Return Prime Route - /return-prime
 *
 * Dashboard for customer returns and exchanges from Return Prime.
 * Displays stats, request list, and analytics.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { ReturnPrimeSearchParamsSchema } from '@coh/shared/schemas/returnPrime';

const ReturnPrimePage = lazy(() => import('../../pages/ReturnPrime'));

export const Route = createFileRoute('/_authenticated/return-prime')({
    validateSearch: (search) => ReturnPrimeSearchParamsSchema.parse(search),
    component: ReturnPrimePage,
});
