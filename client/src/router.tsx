/**
 * Router Configuration - TanStack Router
 *
 * This file creates the router instance using the route tree
 * defined in routeTree.gen.ts.
 */

import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import type { RouterContext } from './routerContext';
import { addBreadcrumb } from './utils/breadcrumbTracker';

// Create router instance
export const router = createRouter({
    routeTree,
    // Preload on hover/focus for instant navigation
    defaultPreload: 'intent',
    // How long preloaded route data is considered fresh (prevents loader spam on rapid hovering)
    // Set to match shortest query staleTime (30s) to align with TanStack Query cache
    defaultPreloadStaleTime: 30 * 1000,
    context: {
        queryClient: undefined!,
        trpc: undefined!,
        auth: undefined!,
    } satisfies RouterContext,
});

// Track navigation events for debugging and error reporting
router.subscribe('onBeforeLoad', ({ toLocation }) => {
    addBreadcrumb('navigation', {
        pathname: toLocation.pathname,
        search: toLocation.search,
    });
});

// Register router for type safety
declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
