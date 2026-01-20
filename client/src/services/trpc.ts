/**
 * tRPC Client Setup
 *
 * Type-safe API client that works alongside existing Axios calls.
 * Provides full type inference from server tRPC routers.
 *
 * Usage:
 * import { trpc } from '@/services/trpc';
 *
 * // In components:
 * const { data, isLoading } = trpc.orders.list.useQuery({ view: 'open' });
 * const mutation = trpc.orders.update.useMutation();
 */

import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../../../server/src/trpc/routers/_app';

/**
 * Create tRPC React hooks with type safety from server
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Get auth token from localStorage
 * Matches existing Axios interceptor pattern in api.ts
 */
const getAuthToken = () => {
    return localStorage.getItem('token');
};

/**
 * Generate a unique request ID for distributed tracing
 * Format: timestamp(base36)-random(7 chars)
 * Example: "m5x2k3-a1b2c3d"
 */
const generateRequestId = (): string => {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
};

/**
 * Get base URL for tRPC endpoint
 * Matches existing API_BASE_URL logic in api.ts
 */
const getTRPCUrl = () => {
    const apiBaseUrl = import.meta.env.VITE_API_URL ||
        (import.meta.env.PROD ? '' : 'http://127.0.0.1:3001');
    return `${apiBaseUrl}/trpc`;
};

/**
 * Create tRPC client with auth and transformer
 * This function is called by TRPCProvider to create the client
 */
export const createTRPCClient = () => {
    return trpc.createClient({
        links: [
            httpBatchLink({
                url: getTRPCUrl(),
                // Add auth token and request ID to every request
                headers() {
                    const token = getAuthToken();
                    const requestId = generateRequestId();
                    return {
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        'x-request-id': requestId,
                    };
                },
                // Use SuperJSON transformer to match server (supports Date, Map, Set, etc.)
                transformer: superjson,
            }),
        ],
    });
};
