/**
 * Auth Middleware for TanStack Start Server Functions
 *
 * Thin wrappers around @coh/shared/services/auth — the single source of truth.
 * This file only handles token extraction (TanStack getCookie) and
 * TanStack createMiddleware integration.
 */
'use server';

import { createMiddleware } from '@tanstack/react-start';
import { getCookie, getRequestHeader } from '@tanstack/react-start/server';
import { getPrisma } from '@coh/shared/services/db';

// Re-export types so existing imports keep working
export type {
    AuthenticatedUser,
    AuthUser,
    AuthContext,
    OptionalAuthContext,
    AuthResult,
} from '@coh/shared/services/auth';

// Re-export permission helpers
export { hasPermission, hasAdminAccess } from '@coh/shared/services/auth';

// Import core validation (dynamic import at module level is fine — this is 'use server')
const getValidateAuth = async () => {
    const { validateAuth } = await import('@coh/shared/services/auth');
    return validateAuth;
};

// ============================================
// TOKEN EXTRACTION
// ============================================

/**
 * Extract auth token from cookie using TanStack Start's getCookie.
 */
function getAuthToken(): string | undefined {
    try {
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

// ============================================
// MIDDLEWARE EXPORTS
// ============================================

/**
 * Auth middleware that validates JWT from auth_token cookie
 */
export const authMiddleware = createMiddleware({ type: 'function' }).server(
    async ({ next }) => {
        const token = getAuthToken();
        const prisma = await getPrisma();
        const validateAuth = await getValidateAuth();

        const result = await validateAuth(token, prisma);

        if (!result.success) {
            throw new Error(result.error);
        }

        return next({
            context: {
                user: result.user,
                permissions: result.permissions,
            },
        });
    }
);

/**
 * Optional auth middleware - doesn't throw on missing/invalid token
 */
export const optionalAuthMiddleware = createMiddleware({ type: 'function' }).server(
    async ({ next }) => {
        const token = getAuthToken();

        let user: import('@coh/shared/services/auth').AuthenticatedUser | null = null;
        let permissions: string[] = [];

        if (token) {
            const prisma = await getPrisma();
            const validateAuth = await getValidateAuth();
            const result = await validateAuth(token, prisma);

            if (result.success) {
                user = result.user;
                permissions = result.permissions;
            }
        }

        return next({
            context: { user, permissions },
        });
    }
);

/**
 * Admin-only middleware
 */
export const adminMiddleware = createMiddleware({ type: 'function' }).server(
    async ({ next }) => {
        const token = getAuthToken();
        const prisma = await getPrisma();
        const validateAuth = await getValidateAuth();
        const { hasAdminAccess } = await import('@coh/shared/services/auth');

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
            },
        });
    }
);

/**
 * Create a permission-checking middleware
 */
export function requirePermission(permission: string) {
    return createMiddleware({ type: 'function' }).server(async ({ next }) => {
        const token = getAuthToken();
        const prisma = await getPrisma();
        const validateAuth = await getValidateAuth();
        const { hasPermission } = await import('@coh/shared/services/auth');

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
            },
        });
    });
}
