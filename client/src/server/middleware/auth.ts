/**
 * Auth Middleware for TanStack Start Server Functions
 *
 * Validates JWT token from HttpOnly cookie and attaches user context.
 * Server Functions can access user info via the middleware chain.
 */
'use server';

import { createMiddleware } from '@tanstack/react-start';
import { getCookie } from 'vinxi/http';
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
    const token = getCookie('auth_token');

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
