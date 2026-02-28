/**
 * Authenticated Layout Route
 *
 * All routes under /_authenticated require authentication.
 * Auth check uses TanStack Query cache - shared with AuthProvider.
 *
 * Flow:
 * 1. SSR: beforeLoad calls getAuthUser server function, populates query cache
 * 2. Client: beforeLoad uses ensureQueryData (returns cached data if fresh)
 * 3. AuthProvider reads from same cache via useQuery
 * 4. Result: ONE auth call on initial load, cached for 5 minutes
 */

import { createFileRoute, redirect } from '@tanstack/react-router';
import { getAuthUser } from '../server/functions/auth';
import { authQueryKeys } from '../constants/queryKeys';
import { authQueryOptions } from '../hooks/useAuth';

// Direct import (no lazy loading) for the main layout
// React's lazy() causes hydration flicker: SSR content → Suspense fallback → content again
// The Layout component is critical path and should load synchronously for smooth SSR hydration
import Layout from '../components/Layout';

function AuthenticatedLayout() {
    return <Layout />;
}

export const Route = createFileRoute('/_authenticated')({
    beforeLoad: async ({ context, location }) => {
        const { queryClient } = context;

        // SSR PATH: Use server function (can read HttpOnly cookie)
        if (typeof window === 'undefined') {
            try {
                const user = await getAuthUser();
                if (user) {
                    // Populate query cache for client hydration
                    queryClient.setQueryData(authQueryKeys.user, user);
                    return { user };
                }
            } catch (error) {
                console.error('[Auth] Server Function error:', error);
            }

            // Not authenticated on server — redirect immediately (sends 302)
            // Previously returned { user: null } which rendered empty pages before client redirect
            throw redirect({
                to: '/login',
                search: {
                    redirect: location.pathname,
                },
            });
        }

        // CLIENT PATH: Use query cache (shared with AuthProvider)
        try {
            // ensureQueryData returns cached data if fresh, or fetches if stale/missing
            const user = await queryClient.ensureQueryData(authQueryOptions);

            if (user) {
                return { user };
            }
        } catch (error) {
            console.error('[Auth] Query error:', error);
        }

        // Not authenticated - redirect to login
        throw redirect({
            to: '/login',
            search: {
                redirect: location.pathname,
            },
        });
    },
    component: AuthenticatedLayout,
});
