/**
 * Dashboard Route - / (index)
 *
 * Note: SSR data loading disabled during migration.
 * Dashboard component fetches data client-side via tRPC hooks.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const Dashboard = lazy(() => import('../../pages/Dashboard'));

export const Route = createFileRoute('/_authenticated/')({
    component: Dashboard,
});
