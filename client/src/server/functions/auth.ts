/**
 * Auth Server Functions
 *
 * Server-side authentication utilities for TanStack Start.
 * Reads auth_token cookie set by Express server during login.
 */

import { createServerFn } from '@tanstack/react-start';
import { getCookie, getRequestHeader } from '@tanstack/react-start/server';

/**
 * User data returned from auth check
 */
export interface AuthUser {
    id: string;
    email: string;
    name: string;
    role: string;
    roleId?: string | null;
    roleName?: string | null;
    permissions?: string[];
}

/**
 * Helper to extract auth token from cookie
 *
 * During SSR, getCookie() may return undefined because cookies aren't forwarded.
 * Fallback: parse auth_token from request headers.
 *
 * Note: vinxi/http functions may throw if there's no request context (e.g., client-side).
 * We catch these errors gracefully and return undefined.
 */
function getAuthToken(): string | undefined {
    try {
        // Use TanStack Start's getCookie - works for SSR and client-initiated Server Functions
        const token = getCookie('auth_token');
        return token;
    } catch {
        // Fallback: try reading cookie header directly
        try {
            const cookieHeader = getRequestHeader('cookie');
            if (cookieHeader) {
                const match = cookieHeader.match(/auth_token=([^;]+)/);
                return match?.[1];
            }
        } catch {
            // Ignore fallback errors
        }
        return undefined;
    }
}

/**
 * Server Function: Get current authenticated user
 *
 * Reads auth_token cookie and verifies with the backend.
 * Returns user data or null if not authenticated.
 */
export const getAuthUser = createServerFn({ method: 'GET' }).handler(
    async (): Promise<AuthUser | null> => {
        try {
            // Get auth_token from cookie (set by Express on login)
            const token = getAuthToken();

            if (!token) {
                return null;
            }

            // Verify token with Express backend
            // In production (Railway), Express runs on same server at PORT
            // In development, Express runs separately on port 3001
            const port = process.env.PORT || '3001';
            const apiUrl = process.env.NODE_ENV === 'production'
                ? `http://127.0.0.1:${port}`
                : 'http://localhost:3001';
            const response = await fetch(`${apiUrl}/api/auth/me`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!response.ok) {
                return null;
            }

            const user = await response.json();
            return user as AuthUser;
        } catch (error) {
            console.error('[getAuthUser] Error:', error);
            return null;
        }
    }
);
