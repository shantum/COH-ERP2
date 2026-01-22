/**
 * Authenticated Layout Route
 *
 * All routes under /_authenticated require authentication.
 * Auth check happens in beforeLoad using Server Function (SSR-safe).
 * This ensures loaders don't run for unauthenticated users.
 *
 * Handles SSR/client hydration gracefully:
 * - SSR: Server Function may fail to get cookie → returns pendingAuth
 * - Client: Waits for AuthProvider to verify token
 * - IMPORTANT: Render output must be identical on SSR and initial client render
 *   to avoid hydration mismatch. No `typeof window` checks in render path.
 */
import { createFileRoute, redirect, useNavigate, useLocation } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
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
    const { isAuthenticated, isLoading } = useAuth();
    const location = useLocation();
    const hasRedirected = useRef(false);

    // Track if we've hydrated (client-side only state update)
    // This ensures SSR and initial client render are identical (both show spinner when pendingAuth)
    const [isHydrated, setIsHydrated] = useState(false);

    // Mark as hydrated after first client render
    useEffect(() => {
        setIsHydrated(true);
    }, []);

    // Debug logging (only after hydration to avoid SSR/client mismatch)
    useEffect(() => {
        console.log('[AuthLayout] pendingAuth:', routeContext?.pendingAuth, 'isLoading:', isLoading, 'isAuthenticated:', isAuthenticated, 'isHydrated:', isHydrated);
    }, [routeContext?.pendingAuth, isLoading, isAuthenticated, isHydrated]);

    // Handle redirect via useEffect to avoid hydration issues
    // Only runs after AuthProvider has finished loading AND we've hydrated
    useEffect(() => {
        // Only handle redirect for pendingAuth case
        if (!routeContext?.pendingAuth) return;
        // Wait for hydration
        if (!isHydrated) return;
        // Wait for auth check to complete
        if (isLoading) return;
        // Prevent double redirect
        if (hasRedirected.current) return;

        if (!isAuthenticated) {
            console.log('[AuthLayout] useEffect: Not authenticated, redirecting to /login');
            hasRedirected.current = true;
            navigate({ to: '/login', search: { redirect: location.pathname } });
        }
    }, [routeContext?.pendingAuth, isHydrated, isLoading, isAuthenticated, navigate, location.pathname]);

    // Handle pendingAuth: wait for client-side auth verification
    // IMPORTANT: No `typeof window` checks here to avoid hydration mismatch
    if (routeContext?.pendingAuth) {
        // Before hydration or while AuthProvider is loading, show spinner
        // This is the same output on SSR and initial client render
        if (!isHydrated || isLoading) {
            return <LoadingSpinner />;
        }

        // After hydration and auth check complete
        if (!isAuthenticated) {
            // Show spinner while redirect is in progress
            return <LoadingSpinner />;
        }

        // Authenticated - fall through to render Layout
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
