/**
 * Auth Server Functions
 *
 * Server-side authentication utilities for TanStack Start.
 * Reads auth_token cookie set by Express server during login.
 */

import { createServerFn } from '@tanstack/react-start';
import { getCookie, getHeaders } from 'vinxi/http';

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
        // Try direct cookie access first (works in production)
        let token = getCookie('auth_token');

        // Fallback: parse from request headers (for SSR)
        if (!token) {
            const headers = getHeaders();
            const cookieHeader = headers?.cookie;
            if (cookieHeader) {
                const match = cookieHeader.match(/auth_token=([^;]+)/);
                token = match?.[1];
            }
        }

        return token;
    } catch {
        // No request context available (e.g., client-side call)
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
            const apiUrl = process.env.VITE_API_URL || 'http://localhost:3001';
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
