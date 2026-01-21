/**
 * Auth Middleware for TanStack Start Server Functions
 *
 * Validates JWT token from HttpOnly cookie and attaches user context.
 * Server Functions can access user info via the middleware chain.
 */
'use server';

import { createMiddleware } from '@tanstack/react-start';
import { getCookie, getHeaders } from 'vinxi/http';
import jwt from 'jsonwebtoken';

/**
 * User context attached by auth middleware
 */
export interface AuthUser {
    id: string;
    email: string;
    role: string;
    roleId: string;
    tokenVersion: number;
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
 * Auth middleware that validates JWT from auth_token cookie
 *
 * Usage in Server Functions:
 * ```ts
 * export const protectedFn = createServerFn({ method: 'GET' })
 *   .middleware([authMiddleware])
 *   .handler(async ({ context }) => {
 *     const user = context.user; // AuthUser
 *     // ...
 *   });
 * ```
 */
export const authMiddleware = createMiddleware({ type: 'function' }).server(async ({ next }) => {
    const token = getAuthToken();

    if (!token) {
        throw new Error('Authentication required');
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        throw new Error('JWT_SECRET not configured');
    }

    try {
        const decoded = jwt.verify(token, jwtSecret) as AuthUser;

        return next({
            context: {
                user: decoded,
            },
        });
    } catch {
        throw new Error('Invalid or expired token');
    }
});
