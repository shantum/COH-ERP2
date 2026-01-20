/**
 * Analytics Route - /analytics
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { AnalyticsSearchParams } from '@coh/shared';

const Analytics = lazy(() => import('../../pages/Analytics'));

export const Route = createFileRoute('/_authenticated/analytics')({
    validateSearch: (search) => AnalyticsSearchParams.parse(search),
    component: Analytics,
});
