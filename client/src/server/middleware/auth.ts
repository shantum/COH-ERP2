/**
 * Auth Middleware for TanStack Start Server Functions
 *
 * Self-contained auth validation for Server Functions.
 * Uses the same logic as Express middleware but with inlined validation
 * to avoid cross-project import issues in production builds.
 *
 * Features:
 * - JWT validation
 * - Token version validation (session invalidation)
 * - Permission loading
 */
'use server';

import { createMiddleware } from '@tanstack/react-start';
import { getCookie, getRequestHeader } from '@tanstack/react-start/server';
import { z } from 'zod';

// ============================================
// TYPES
// ============================================

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

// ============================================
// JWT PAYLOAD SCHEMA
// ============================================

const JwtPayloadSchema = z.object({
    id: z.string(),
    email: z.string().email(),
    role: z.string(),
    roleId: z.string(),
    tokenVersion: z.number().optional(),
    iat: z.number().optional(),
    exp: z.number().optional(),
});

type JwtPayload = z.infer<typeof JwtPayloadSchema>;

// ============================================
// LAZY IMPORTS (avoid bundling server code)
// ============================================

/**
 * Lazy import Prisma client to prevent bundling server code into client
 */
async function getPrisma() {
    const { PrismaClient } = await import('@prisma/client');
    const globalForPrisma = globalThis as unknown as {
        prisma: InstanceType<typeof PrismaClient> | undefined;
    };
    const prisma = globalForPrisma.prisma ?? new PrismaClient();
    if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.prisma = prisma;
    }
    return prisma;
}

/**
 * Lazy import jsonwebtoken
 */
async function getJwt() {
    const jwt = await import('jsonwebtoken');
    return jwt.default || jwt;
}

// ============================================
// VALIDATION FUNCTIONS (inlined from authCore)
// ============================================

/**
 * Verify and decode a JWT token
 */
async function verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
    try {
        const jwt = await getJwt();
        const decoded = jwt.verify(token, secret);
        const parsed = JwtPayloadSchema.safeParse(decoded);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/**
 * Validate token version against database
 */
async function validateTokenVersion(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: any,
    userId: string,
    tokenVersion: number
): Promise<boolean> {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { tokenVersion: true },
        });
        if (!user) return false;
        return user.tokenVersion === tokenVersion;
    } catch {
        return false;
    }
}

/**
 * Get user permissions from database
 */
async function getUserPermissions(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: any,
    userId: string
): Promise<string[]> {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                userRole: true,
                permissionOverrides: true,
            },
        });

        if (!user) return [];

        // Start with role permissions (stored as JSON array)
        const rolePermissions: string[] = [];
        if (user.userRole?.permissions && Array.isArray(user.userRole.permissions)) {
            rolePermissions.push(...(user.userRole.permissions as string[]));
        }

        // Apply individual overrides
        const grantedOverrides = user.permissionOverrides
            .filter((o: { granted: boolean; permission: string }) => o.granted)
            .map((o: { permission: string }) => o.permission);

        const revokedOverrides = new Set(
            user.permissionOverrides
                .filter((o: { granted: boolean }) => !o.granted)
                .map((o: { permission: string }) => o.permission)
        );

        // Combine: (role permissions - revoked) + granted overrides
        const finalPermissions = [
            ...rolePermissions.filter((p) => !revokedOverrides.has(p)),
            ...grantedOverrides,
        ];

        return [...new Set(finalPermissions)];
    } catch {
        return [];
    }
}

/**
 * Full authentication validation
 */
async function validateAuth(
    token: string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: any
): Promise<AuthResult> {
    // 1. Check token exists
    if (!token) {
        return { success: false, error: 'Access token required', code: 'NO_TOKEN' };
    }

    // 2. Get JWT secret
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        throw new Error('JWT_SECRET not configured');
    }

    // 3. Verify and decode token
    const payload = await verifyToken(token, jwtSecret);
    if (!payload) {
        return { success: false, error: 'Invalid or expired token', code: 'INVALID_TOKEN' };
    }

    // 4. Validate token version (if present)
    if (payload.tokenVersion !== undefined) {
        const isValid = await validateTokenVersion(prisma, payload.id, payload.tokenVersion);
        if (!isValid) {
            return {
                success: false,
                error: 'Session invalidated. Please login again.',
                code: 'SESSION_INVALIDATED',
            };
        }
    }

    // 5. Load permissions
    const permissions = await getUserPermissions(prisma, payload.id);

    // 6. Return authenticated context
    return {
        success: true,
        user: {
            id: payload.id,
            email: payload.email,
            role: payload.role,
            roleId: payload.roleId,
            tokenVersion: payload.tokenVersion,
        },
        permissions,
    };
}

// ============================================
// PERMISSION HELPERS
// ============================================

/**
 * Check if user has a specific permission
 */
export function hasPermission(permissions: string[], required: string): boolean {
    if (permissions.includes(required)) return true;
    const [domain] = required.split(':');
    return permissions.includes(`${domain}:*`);
}

/**
 * Check if user has admin-level access
 */
export function hasAdminAccess(user: AuthenticatedUser, permissions: string[]): boolean {
    return user.role === 'admin' || permissions.includes('users:create');
}

// ============================================
// TOKEN EXTRACTION
// ============================================

/**
 * Helper to extract auth token from cookie
 *
 * Uses TanStack Start's getCookie utility which works for both
 * SSR requests and client-side Server Function calls.
 */
function getAuthToken(): string | undefined {
    try {
        // Use TanStack Start's getCookie - works for SSR and client-initiated Server Functions
        const token = getCookie('auth_token');

        // Debug logging for production troubleshooting
        if (process.env.NODE_ENV === 'production') {
            console.log('[AuthMiddleware] getCookie returned:', token ? 'token-present' : 'undefined');
        }

        return token;
    } catch (error) {
        // Fallback: try reading cookie header directly
        try {
            const cookieHeader = getRequestHeader('cookie');
            if (cookieHeader) {
                const match = cookieHeader.match(/auth_token=([^;]+)/);
                const token = match?.[1];
                if (process.env.NODE_ENV === 'production') {
                    console.log('[AuthMiddleware] Fallback cookie header:', token ? 'token-present' : 'undefined');
                }
                return token;
            }
        } catch {
            // Ignore fallback errors
        }

        if (process.env.NODE_ENV === 'production') {
            console.log('[AuthMiddleware] Error getting auth token:', error);
        }
        return undefined;
    }
}

// ============================================
// MIDDLEWARE EXPORTS
// ============================================

/**
 * Auth middleware that validates JWT from auth_token cookie
 *
 * Usage:
 * ```ts
 * export const protectedFn = createServerFn({ method: 'GET' })
 *   .middleware([authMiddleware])
 *   .handler(async ({ context }) => {
 *     const { user, permissions } = context;
 *   });
 * ```
 */
export const authMiddleware = createMiddleware({ type: 'function' }).server(
    async ({ next }) => {
        const token = getAuthToken();
        const prisma = await getPrisma();

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
 */
export const optionalAuthMiddleware = createMiddleware({ type: 'function' }).server(
    async ({ next }) => {
        const token = getAuthToken();

        let user: AuthenticatedUser | null = null;
        let permissions: string[] = [];

        if (token) {
            const prisma = await getPrisma();
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
 */
export const adminMiddleware = createMiddleware({ type: 'function' }).server(
    async ({ next }) => {
        const token = getAuthToken();
        const prisma = await getPrisma();
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
 */
export function requirePermission(permission: string) {
    return createMiddleware({ type: 'function' }).server(async ({ next }) => {
        const token = getAuthToken();
        const prisma = await getPrisma();
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
