/**
 * Dashboard Route - / (index)
 *
 * Uses Route Loader to pre-fetch dashboard data on the server (SSR).
 * Auth is verified by parent _authenticated layout's beforeLoad.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import {
    getOrdersAnalytics,
    type OrdersAnalyticsResponse,
} from '../../server/functions/dashboard';

const Dashboard = lazy(() => import('../../pages/Dashboard'));

export const Route = createFileRoute('/_authenticated/')({
    // Pre-fetch dashboard analytics on server
    loader: async (): Promise<DashboardLoaderData> => {
        try {
            const analytics = await getOrdersAnalytics();
            return { analytics, error: null };
        } catch (error) {
            console.error('[Dashboard Loader] Error:', error);
            return {
                analytics: null,
                error: error instanceof Error ? error.message : 'Failed to load dashboard',
            };
        }
    },
    component: Dashboard,
});

// Export loader data type for use in components
export interface DashboardLoaderData {
    analytics: OrdersAnalyticsResponse | null;
    error: string | null;
}
