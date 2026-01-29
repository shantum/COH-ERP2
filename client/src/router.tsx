/**
 * Router Configuration for TanStack Start
 *
 * CRITICAL: In SSR mode, we MUST create new router and queryClient instances
 * per request to prevent state leakage between concurrent requests.
 *
 * Using singletons causes response mixing - request A gets response B's data.
 * See: https://github.com/TanStack/router/issues/6051
 */

import { createRouter, type AnyRouter } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';
import type { RouterContext } from './routerContext';

/**
 * Create a fresh QueryClient instance
 * Used per-request in SSR, singleton on client
 */
function createQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 30000,
                retry: 1,
            },
        },
    });
}

/**
 * Create a fresh router instance
 * Used per-request in SSR, singleton on client
 */
function createAppRouter(queryClient: QueryClient) {
    return createRouter({
        routeTree,
        context: {
            queryClient,
            auth: {
                user: null,
                isAuthenticated: false,
                isLoading: true,
            },
        } satisfies RouterContext,
        defaultPreload: 'intent',
        scrollRestoration: true,
    });
}

// Client-side singleton (safe because browser is single-user)
let clientRouter: AnyRouter | null = null;
let clientQueryClient: QueryClient | null = null;

/**
 * Get or create client-side singletons
 */
function getClientInstances() {
    if (!clientQueryClient) {
        clientQueryClient = createQueryClient();
    }
    if (!clientRouter) {
        clientRouter = createAppRouter(clientQueryClient);
    }
    return { router: clientRouter, queryClient: clientQueryClient };
}

/**
 * Creates and returns a router instance
 * Called by TanStack Start on both client and server
 *
 * - SSR (server): Creates NEW instances per request to prevent state leakage
 * - Client (browser): Returns singleton (safe, single user)
 */
export async function getRouter(): Promise<ReturnType<typeof createAppRouter>> {
    // SSR: Create fresh instances per request
    if (typeof window === 'undefined') {
        const queryClient = createQueryClient();
        const router = createAppRouter(queryClient);
        return router;
    }

    // Client: Return singleton
    const { router } = getClientInstances();
    return router;
}

// Export for client-side usage (useQueryClient, etc.)
export function getQueryClient() {
    if (typeof window === 'undefined') {
        throw new Error('getQueryClient() should only be called on client side');
    }
    const { queryClient } = getClientInstances();
    return queryClient;
}

// Legacy exports for compatibility (client-side only)
export const queryClient = typeof window !== 'undefined'
    ? getClientInstances().queryClient
    : (null as unknown as QueryClient);

export const router = typeof window !== 'undefined'
    ? getClientInstances().router
    : (null as unknown as ReturnType<typeof createAppRouter>);

export type AppRouter = ReturnType<typeof createAppRouter>;
