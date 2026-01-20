/**
 * Authenticated Layout Route
 *
 * All routes under /_authenticated require authentication.
 * Auth check happens in component (not beforeLoad) to handle SSR properly.
 * During SSR, router context has static default values, so beforeLoad
 * redirects don't work correctly with TanStack Start.
 */
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useAuth } from '../hooks/useAuth';

const Layout = lazy(() => import('../components/Layout'));

function LoadingSpinner() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
    );
}

function AuthenticatedLayout() {
    const auth = useAuth();

    // During SSR (typeof window === 'undefined'), isLoading is false and isAuthenticated is false
    // We render the layout shell during SSR - client will check auth and redirect if needed
    const isSSR = typeof window === 'undefined';

    // Show loading spinner while auth is being determined (client-side only)
    if (!isSSR && auth.isLoading) {
        return <LoadingSpinner />;
    }

    // Redirect to login if not authenticated (client-side only)
    // During SSR, we skip this check and render the layout
    if (!isSSR && !auth.isAuthenticated) {
        return <Navigate to="/login" />;
    }

    return (
        <Suspense fallback={<LoadingSpinner />}>
            <Layout />
        </Suspense>
    );
}

export const Route = createFileRoute('/_authenticated')({
    component: AuthenticatedLayout,
});
