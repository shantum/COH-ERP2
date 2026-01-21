/**
 * Router Context Types for TanStack Router
 *
 * This file defines the context that is passed to all routes via TanStack Router.
 * It includes QueryClient and authentication state.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { AuthState } from './types';

/**
 * Full router context passed to all routes
 *
 * Access in routes via:
 * - beforeLoad: ({ context }) => context.auth.isAuthenticated
 * - component: use hooks like useAuth() or Route.useRouteContext()
 */
export interface RouterContext {
    /** TanStack Query client for cache management */
    queryClient: QueryClient;
    /** Authentication state */
    auth: AuthState;
}
