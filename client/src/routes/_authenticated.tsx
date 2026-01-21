/**
 * Authenticated Layout Route
 *
 * All routes under /_authenticated require authentication.
 * Auth check happens in beforeLoad using Server Function (SSR-safe).
 * This ensures loaders don't run for unauthenticated users.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { getAuthUser } from '../server/functions/auth';

const Layout = lazy(() => import('../components/Layout'));

function LoadingSpinner() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
    );
}

function AuthenticatedLayout() {
    return (
        <Suspense fallback={<LoadingSpinner />}>
            <Layout />
        </Suspense>
    );
}

export const Route = createFileRoute('/_authenticated')({
    beforeLoad: async ({ context, location }) => {
        // Check if we already have auth in context (from parent route)
        if (context.auth?.isAuthenticated && context.auth?.user) {
            return { user: context.auth.user };
        }

        // Call server function to verify auth from cookie
        const user = await getAuthUser();

        if (!user) {
            // Not authenticated - redirect to login
            // Use location.pathname from router context (SSR-safe)
            throw redirect({
                to: '/login',
                search: {
                    redirect: location.pathname,
                },
            });
        }

        // Return user to context for child routes
        return { user };
    },
    component: AuthenticatedLayout,
});
