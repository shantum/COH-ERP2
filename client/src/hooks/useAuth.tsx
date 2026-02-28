/**
 * Auth Hook - Single Source of Truth for Authentication
 *
 * Uses TanStack Query to cache auth state. Both this hook and route beforeLoad
 * share the same query cache, preventing duplicate /api/auth/me calls.
 *
 * Flow:
 * 1. beforeLoad calls ensureQueryData (populates cache if empty)
 * 2. AuthProvider reads from same cache via useQuery
 * 3. Subsequent navigations hit cache (staleTime: 5 min)
 */

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../services/api';
import { authQueryKeys } from '../constants/queryKeys';
import type { AuthUser } from '../types';

interface AuthContextType {
    user: AuthUser | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Auth query options - shared between AuthProvider and route beforeLoad
 * Exported so _authenticated.tsx can use the same query configuration
 */
export const authQueryOptions = {
    queryKey: authQueryKeys.user,
    queryFn: async (): Promise<AuthUser | null> => {
        // Only run on client - server uses getAuthUser server function
        if (typeof window === 'undefined') {
            return null;
        }

        try {
            const res = await authApi.me();
            return res.data as AuthUser;
        } catch {
            return null;
        }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - don't re-fetch if fresh
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    retry: false, // Don't retry auth failures
};

export function AuthProvider({ children }: { children: ReactNode }) {
    const queryClient = useQueryClient();

    // Use TanStack Query for auth state - shares cache with route beforeLoad
    const { data: user, isLoading } = useQuery({
        ...authQueryOptions,
        // On SSR, start with loading=false to avoid hydration mismatch
        // The route's beforeLoad will have already fetched auth via server function
        enabled: typeof window !== 'undefined',
    });

    const login = useCallback(async (email: string, password: string) => {
        const res = await authApi.login(email, password);
        // Cookie is set automatically by the server (HttpOnly)
        // Update the query cache with the new user
        queryClient.setQueryData(authQueryKeys.user, res.data.user);
    }, [queryClient]);

    const logout = useCallback(async () => {
        // Clear server-side cookie
        try {
            await authApi.logout();
        } catch {
            // Continue with logout even if server call fails
        }
        // Clear the query cache
        queryClient.setQueryData(authQueryKeys.user, null);
        // Invalidate to ensure fresh state on next login
        queryClient.invalidateQueries({ queryKey: authQueryKeys.user });
    }, [queryClient]);

    // Listen for unauthorized events from API interceptor
    // On 401: clear auth cache and redirect to login
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const handleUnauthorized = () => {
            // Clear the query cache on 401
            queryClient.setQueryData(authQueryKeys.user, null);
            // Redirect to login with current path as redirect target
            // Full page navigation ensures clean state (no stale data in components)
            const currentPath = window.location.pathname;
            const redirectParam = currentPath !== '/login' ? `?redirect=${encodeURIComponent(currentPath)}` : '';
            window.location.href = `/login${redirectParam}`;
        };

        window.addEventListener('auth:unauthorized', handleUnauthorized);
        return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
    }, [queryClient]);

    const value = useMemo<AuthContextType>(() => ({
        user: user ?? null,
        isAuthenticated: !!user,
        isLoading: typeof window === 'undefined' ? false : isLoading,
        login,
        logout,
    }), [user, isLoading, login, logout]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
}
