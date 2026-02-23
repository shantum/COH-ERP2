/**
 * Authentication Core for Express routes
 *
 * Used by Express middleware (server/src/middleware/auth.ts).
 * NOTE: TanStack Server Functions middleware (client/src/server/middleware/auth.ts)
 * has its own copy of this logic due to build boundary constraints.
 * Keep both in sync when making auth changes.
 */

import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

// ============================================
// SCHEMAS & TYPES
// ============================================

/**
 * JWT payload schema - validates token structure
 */
export const JwtPayloadSchema = z.object({
    id: z.string(),
    email: z.string().email(),
    role: z.string(),
    roleId: z.string().nullable().optional(), // Can be null if user has no role
    tokenVersion: z.number().optional(),
    iat: z.number().optional(),
    exp: z.number().optional(),
});

export type JwtPayload = z.infer<typeof JwtPayloadSchema>;

/**
 * Authenticated user context - attached to requests/context
 */
export interface AuthenticatedUser {
    id: string;
    email: string;
    role: string;
    roleId: string | null;
    tokenVersion?: number;
    extraAccess?: string[];
}

/**
 * Full auth context with permissions
 */
export interface AuthContext {
    user: AuthenticatedUser;
    permissions: string[];
}

/**
 * Auth validation result
 */
export type AuthResult =
    | { success: true; user: AuthenticatedUser; permissions: string[]; extraAccess: string[] }
    | { success: false; error: string; code: 'NO_TOKEN' | 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'SESSION_INVALIDATED' };

// ============================================
// CORE VALIDATION FUNCTIONS
// ============================================

/**
 * Verify and decode a JWT token
 *
 * @param token - JWT token string
 * @param secret - JWT secret
 * @returns Decoded payload or null if invalid
 */
export function verifyToken(token: string, secret: string): JwtPayload | null {
    try {
        const decoded = jwt.verify(token, secret);
        const parsed = JwtPayloadSchema.safeParse(decoded);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/**
 * Validate token version against database
 *
 * Used for immediate session invalidation (e.g., password change, logout all devices)
 *
 * @param prisma - Prisma client
 * @param userId - User ID from token
 * @param tokenVersion - Token version from token
 * @returns true if valid, false if invalidated
 */
export async function validateTokenVersion(
    prisma: PrismaClient,
    userId: string,
    tokenVersion: number
): Promise<boolean> {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { tokenVersion: true },
        });

        if (!user) return false;

        // Token version must match current version
        return user.tokenVersion === tokenVersion;
    } catch {
        return false;
    }
}

/**
 * Get user permissions from database
 *
 * Combines:
 * 1. Role permissions (JSON array on Role model via userRole relation)
 * 2. Individual permission overrides (UserPermissionOverride)
 *
 * @param prisma - Prisma client
 * @param userId - User ID
 * @returns Array of permission strings
 */
export async function getUserPermissionsAndAccess(
    prisma: PrismaClient,
    userId: string
): Promise<{ permissions: string[]; extraAccess: string[] }> {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                userRole: true,
                permissionOverrides: true,
            },
        });

        if (!user) {
            return { permissions: [], extraAccess: [] };
        }

        // Start with role permissions (stored as JSON array)
        const rolePermissions: string[] = [];
        if (user.userRole?.permissions && Array.isArray(user.userRole.permissions)) {
            rolePermissions.push(...(user.userRole.permissions as string[]));
        }

        // Apply individual overrides
        const grantedOverrides = user.permissionOverrides
            .filter((o) => o.granted)
            .map((o) => o.permission);

        const revokedOverrides = new Set(
            user.permissionOverrides
                .filter((o) => !o.granted)
                .map((o) => o.permission)
        );

        // Combine: (role permissions - revoked) + granted overrides
        const finalPermissions = [
            ...rolePermissions.filter((p) => !revokedOverrides.has(p)),
            ...grantedOverrides,
        ];

        // Get extraAccess
        const extraAccess: string[] = Array.isArray(user.extraAccess)
            ? (user.extraAccess as string[])
            : [];

        return {
            permissions: [...new Set(finalPermissions)],
            extraAccess,
        };
    } catch {
        return { permissions: [], extraAccess: [] };
    }
}

/**
 * Full authentication validation
 *
 * This is the SINGLE SOURCE OF TRUTH for auth validation.
 * Both Express middleware and Server Functions middleware use this.
 *
 * Steps:
 * 1. Verify JWT signature and structure
 * 2. Validate token version (for session invalidation)
 * 3. Load user permissions
 *
 * @param token - JWT token string
 * @param prisma - Prisma client for DB queries
 * @returns AuthResult with user + permissions or error details
 */
export async function validateAuth(
    token: string | undefined,
    prisma: PrismaClient
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
    const payload = verifyToken(token, jwtSecret);
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

    // 5. Load permissions and extraAccess
    const { permissions, extraAccess } = await getUserPermissionsAndAccess(prisma, payload.id);

    // 6. Return authenticated context
    return {
        success: true,
        user: {
            id: payload.id,
            email: payload.email,
            role: payload.role,
            roleId: payload.roleId ?? null,
            tokenVersion: payload.tokenVersion,
            extraAccess,
        },
        permissions,
        extraAccess,
    };
}

// ============================================
// PERMISSION HELPERS
// ============================================

/**
 * Check if user has a specific permission
 */
export function hasPermission(permissions: string[], required: string): boolean {
    // Check exact match
    if (permissions.includes(required)) return true;

    // Check wildcard match (e.g., 'orders:*' matches 'orders:create')
    const [domain] = required.split(':');
    return permissions.includes(`${domain}:*`);
}

/**
 * Check if user has admin-level access
 * (legacy support + new permission system)
 */
export function hasAdminAccess(user: AuthenticatedUser, permissions: string[]): boolean {
    return user.role === 'admin' || permissions.includes('users:create');
}
