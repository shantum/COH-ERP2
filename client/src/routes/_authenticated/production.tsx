/**
 * Production Route - /production
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { ProductionSearchParams } from '@coh/shared';

const Production = lazy(() => import('../../pages/Production'));

export const Route = createFileRoute('/_authenticated/production')({
    validateSearch: (search) => ProductionSearchParams.parse(search),
    component: Production,
});
