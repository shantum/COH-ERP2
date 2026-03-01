/**
 * Growth Analytics Route - /growth-analytics
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const GrowthAnalytics = lazy(() => import('../../pages/GrowthAnalytics'));

export const Route = createFileRoute('/_authenticated/growth-analytics')({
    component: GrowthAnalytics,
});
