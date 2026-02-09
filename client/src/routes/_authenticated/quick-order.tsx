/**
 * Quick Order Page Route - /quick-order
 * Simple order form matching COH Google Sheet columns
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const QuickOrder = lazy(() => import('../../pages/QuickOrder'));

export const Route = createFileRoute('/_authenticated/quick-order')({
    component: QuickOrder,
});
