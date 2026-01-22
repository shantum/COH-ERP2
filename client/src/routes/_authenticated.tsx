/**
 * Authenticated Layout Route
 *
 * All routes under /_authenticated require authentication.
 * Auth check happens in beforeLoad using Server Function (SSR-safe).
 * This ensures loaders don't run for unauthenticated users.
 *
 * Handles SSR/client hydration mismatch gracefully:
 * - SSR: Server Function may fail to get cookie → returns pendingAuth
 * - Client: Waits for AuthProvider to verify token
 * - Redirect happens via useEffect to avoid hydration issues
 */
import { createFileRoute, redirect, useNavigate, useLocation } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { getAuthUser } from '../server/functions/auth';
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
    // Check for pendingAuth from beforeLoad
    const routeContext = Route.useRouteContext() as { pendingAuth?: boolean; user?: unknown } | undefined;
    const navigate = useNavigate();
    const { isAuthenticated, isLoading, user } = useAuth();
    const location = useLocation();
    const hasRedirected = useRef(false);

    // Debug logging (client-only)
    if (typeof window !== 'undefined') {
        console.log('[AuthLayout] pendingAuth:', routeContext?.pendingAuth, 'isLoading:', isLoading, 'isAuthenticated:', isAuthenticated);
    }

    // Handle redirect via useEffect to avoid hydration issues
    // Only runs after AuthProvider has finished loading
    useEffect(() => {
        // Only handle redirect for pendingAuth case
        if (!routeContext?.pendingAuth) return;
        // Wait for auth check to complete
        if (isLoading) return;
        // Prevent double redirect
        if (hasRedirected.current) return;

        if (!isAuthenticated) {
            console.log('[AuthLayout] useEffect: Not authenticated, redirecting to /login');
            hasRedirected.current = true;
            navigate({ to: '/login', search: { redirect: location.pathname } });
        }
    }, [routeContext?.pendingAuth, isLoading, isAuthenticated, navigate, location.pathname]);

    // Handle pendingAuth: wait for client-side auth verification
    if (routeContext?.pendingAuth) {
        // SSR: Always show spinner, let client verify after hydration
        if (typeof window === 'undefined') {
            return <LoadingSpinner />;
        }

        // Client: If AuthProvider is still loading, show spinner
        if (isLoading) {
            return <LoadingSpinner />;
        }

        // Client: Auth check complete but not authenticated - show spinner while redirecting
        if (!isAuthenticated) {
            return <LoadingSpinner />;
        }

        console.log('[AuthLayout] Authenticated via AuthProvider, user:', user?.email);
    }

    return (
        <Suspense fallback={<LoadingSpinner />}>
            <Layout />
        </Suspense>
    );
}

export const Route = createFileRoute('/_authenticated')({
    beforeLoad: async ({ context, location }) => {
        // FAST PATH: Already authenticated from client context
        if (context.auth?.isAuthenticated && context.auth?.user) {
            return { user: context.auth.user };
        }

        // SSR PATH: Try Server Function
        try {
            const user = await getAuthUser();
            if (user) {
                return { user };
            }
        } catch (error) {
            console.error('[Auth] Server Function error:', error);
            // Continue to fallback
        }

        // SERVER-SIDE: Can't check localStorage, defer to client
        // Return pendingAuth so client can verify auth status after hydration
        if (typeof window === 'undefined') {
            return { user: null, pendingAuth: true };
        }

        // CLIENT-SIDE: Check localStorage
        try {
            if (localStorage.getItem('token')) {
                // Token exists - let client-side auth verify it
                return { user: null, pendingAuth: true };
            }
        } catch {
            // localStorage access failed
        }

        // No auth anywhere - redirect to login
        throw redirect({
            to: '/login',
            search: {
                redirect: location.pathname,
            },
        });
    },
    component: AuthenticatedLayout,
});
