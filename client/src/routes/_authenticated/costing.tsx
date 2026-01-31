/**
 * Costing Route - /costing
 *
 * P&L analysis dashboard with overhead costs, contribution analysis,
 * and breakeven insights.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { CostingSearchParams } from '@coh/shared';

const Costing = lazy(() => import('../../pages/Costing'));

export const Route = createFileRoute('/_authenticated/costing')({
    validateSearch: (search) => CostingSearchParams.parse(search),
    component: Costing,
});
