/**
 * Tailor Performance Route - /tailor-performance
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { TailorPerformanceSearchParams } from '@coh/shared';

const TailorPerformance = lazy(() => import('../../pages/TailorPerformance'));

export const Route = createFileRoute('/_authenticated/tailor-performance')({
    validateSearch: (search) => TailorPerformanceSearchParams.parse(search),
    component: TailorPerformance,
});
