/**
 * Returns RTO Route - /returns-rto
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const ReturnsRto = lazy(() => import('../../pages/ReturnsRto'));

export const Route = createFileRoute('/_authenticated/returns-rto')({
    component: ReturnsRto,
});
