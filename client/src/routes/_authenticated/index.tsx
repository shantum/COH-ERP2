/**
 * Dashboard Route - / (index)
 *
 * Uses Route Loader to pre-fetch dashboard data on the server (SSR).
 * Auth is verified by parent _authenticated layout's beforeLoad.
 */
import { createFileRoute } from '@tanstack/react-router';
import {
    getOrdersAnalytics,
    type OrdersAnalyticsResponse,
} from '../../server/functions/dashboard';

// Direct import (no lazy loading) for SSR routes with loader data
// React's lazy() causes hydration flicker: SSR content → Suspense fallback → content again
import Dashboard from '../../pages/Dashboard';

export const Route = createFileRoute('/_authenticated/')({
    // Pre-fetch dashboard analytics on server
    loader: async ({ context }): Promise<DashboardLoaderData> => {
        // Skip data fetch if auth failed during SSR — client will redirect to login
        if (!context.user) {
            return { analytics: null, error: null };
        }
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
