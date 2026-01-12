/**
 * tRPC Provider
 *
 * Wraps the app with tRPC client, integrating with existing React Query setup.
 * Enables gradual migration from Axios to tRPC.
 *
 * Key features:
 * - Reuses existing QueryClient from App.tsx
 * - Handles 401 errors via existing auth:unauthorized event
 * - Batches requests for better performance
 */

import { QueryClient } from '@tanstack/react-query';
import { trpc, createTRPCClient } from '../services/trpc';
import { useState, useEffect } from 'react';

interface TRPCProviderProps {
    children: React.ReactNode;
    queryClient: QueryClient;
}

export function TRPCProvider({ children, queryClient }: TRPCProviderProps) {
    const [trpcClient] = useState(() => createTRPCClient());

    // Listen for auth:unauthorized events (matches api.ts interceptor pattern)
    useEffect(() => {
        const handleUnauthorized = () => {
            // Clear React Query cache on logout
            queryClient.clear();
        };

        window.addEventListener('auth:unauthorized', handleUnauthorized);

        return () => {
            window.removeEventListener('auth:unauthorized', handleUnauthorized);
        };
    }, [queryClient]);

    return (
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
            {children}
        </trpc.Provider>
    );
}
