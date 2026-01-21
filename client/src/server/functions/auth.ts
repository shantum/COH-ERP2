/**
 * Auth Server Functions
 *
 * Server-side authentication utilities for TanStack Start.
 * Reads auth_token cookie set by Express server during login.
 */

import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';

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
 * Server Function: Get current authenticated user
 *
 * Reads auth_token cookie and verifies with the backend.
 * Returns user data or null if not authenticated.
 */
export const getAuthUser = createServerFn({ method: 'GET' }).handler(
    async (): Promise<AuthUser | null> => {
        try {
            // Get auth_token from cookie (set by Express on login)
            const token = getCookie('auth_token');

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
