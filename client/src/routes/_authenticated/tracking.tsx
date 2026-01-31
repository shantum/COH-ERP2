/**
 * Tracking Page Route - /tracking
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const TrackingPage = lazy(() => import('../../pages/Tracking'));

export const Route = createFileRoute('/_authenticated/tracking')({
    component: TrackingPage,
});
