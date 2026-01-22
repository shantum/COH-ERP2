/**
 * Auth Middleware for TanStack Start Server Functions
 *
 * Uses the unified auth core from server - SAME LOGIC as Express middleware.
 * This prevents "auth drift" between API routes and Server Functions.
 *
 * Features (now matching Express):
 * - JWT validation
 * - Token version validation (session invalidation)
 * - Permission loading
 */
'use server';

import { createMiddleware } from '@tanstack/react-start';
import { getCookie, getHeaders } from 'vinxi/http';

// Re-export types for consumers
export interface AuthenticatedUser {
    id: string;
    email: string;
    role: string;
    roleId: string;
    tokenVersion?: number;
}

// Backward compatibility alias
export type AuthUser = AuthenticatedUser;

export interface AuthContext {
    user: AuthenticatedUser;
    permissions: string[];
}

// Optional auth context (user can be null)
export interface OptionalAuthContext {
    user: AuthenticatedUser | null;
    permissions: string[];
}

export type AuthResult =
    | { success: true; user: AuthenticatedUser; permissions: string[] }
    | { success: false; error: string; code: 'NO_TOKEN' | 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'SESSION_INVALIDATED' };

/**
 * Get prisma client and auth core dynamically
 * Server Functions use dynamic imports to avoid bundling issues
 */
async function getAuthDeps() {
    const [{ default: prisma }, authCore] = await Promise.all([
        import('@server/lib/prisma.js'),
        import('@server/utils/authCore.js'),
    ]);
    return { prisma, ...authCore };
}

/**
 * Helper to extract auth token from cookie
 *
 * During SSR, getCookie() may return undefined because cookies aren't forwarded.
 * Fallback: parse auth_token from request headers.
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
 * Uses unified validateAuth() from authCore - same logic as Express.
 * Now includes:
 * - Token version validation (session invalidation)
 * - Permission loading
 *
 * Usage:
 * ```ts
 * export const protectedFn = createServerFn({ method: 'GET' })
 *   .middleware([authMiddleware])
 *   .handler(async ({ context }) => {
 *     const { user, permissions } = context;
 *     // Check permissions: hasPermission(permissions, 'orders:create')
 *   });
 * ```
 */
export const authMiddleware = createMiddleware({ type: 'function' }).server(
    async ({ next }) => {
        const token = getAuthToken();
        const { prisma, validateAuth } = await getAuthDeps();

        // Use unified auth validation - SAME as Express
        const result = await validateAuth(token, prisma);

        if (!result.success) {
            throw new Error(result.error);
        }

        return next({
            context: {
                user: result.user,
                permissions: result.permissions,
            } satisfies AuthContext,
        });
    }
);

/**
 * Optional auth middleware - doesn't throw on missing/invalid token
 *
 * Use when auth is optional but you want user info if available.
 */
export const optionalAuthMiddleware = createMiddleware({ type: 'function' }).server(
    async ({ next }) => {
        const token = getAuthToken();

        let user: AuthenticatedUser | null = null;
        let permissions: string[] = [];

        if (token) {
            const { prisma, validateAuth } = await getAuthDeps();
            const result = await validateAuth(token, prisma);

            if (result.success) {
                user = result.user;
                permissions = result.permissions;
            }
        }

        return next({
            context: { user, permissions } satisfies OptionalAuthContext,
        });
    }
);

/**
 * Admin-only middleware
 *
 * Validates auth AND checks admin access.
 */
export const adminMiddleware = createMiddleware({ type: 'function' }).server(
    async ({ next }) => {
        const token = getAuthToken();
        const { prisma, validateAuth, hasAdminAccess } = await getAuthDeps();
        const result = await validateAuth(token, prisma);

        if (!result.success) {
            throw new Error(result.error);
        }

        if (!hasAdminAccess(result.user, result.permissions)) {
            throw new Error('Admin access required');
        }

        return next({
            context: {
                user: result.user,
                permissions: result.permissions,
            } satisfies AuthContext,
        });
    }
);

/**
 * Create a permission-checking middleware
 *
 * Usage:
 * ```ts
 * export const createOrder = createServerFn({ method: 'POST' })
 *   .middleware([requirePermission('orders:create')])
 *   .handler(async ({ context }) => { ... });
 * ```
 */
export function requirePermission(permission: string) {
    return createMiddleware({ type: 'function' }).server(async ({ next }) => {
        const token = getAuthToken();
        const { prisma, validateAuth, hasPermission } = await getAuthDeps();
        const result = await validateAuth(token, prisma);

        if (!result.success) {
            throw new Error(result.error);
        }

        if (!hasPermission(result.permissions, permission)) {
            throw new Error(`Permission required: ${permission}`);
        }

        return next({
            context: {
                user: result.user,
                permissions: result.permissions,
            } satisfies AuthContext,
        });
    });
}
