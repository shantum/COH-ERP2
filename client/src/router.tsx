/**
 * Router Configuration for TanStack Start
 *
 * Creates the router instance with context for authentication
 * and QueryClient. Used by both client and server entries.
 */

import { createRouter } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';
import type { RouterContext } from './routerContext';

// Shared QueryClient instance
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30000,
            retry: 1,
        },
    },
});

// Create router instance (used by TanStack Start and SPA fallback)
export const router = createRouter({
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

/**
 * Creates and returns the router instance
 * Called by TanStack Start on both client and server
 */
export async function getRouter() {
    return router;
}

export type AppRouter = typeof router;
