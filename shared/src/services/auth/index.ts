/**
 * Auth Core — Single Source of Truth
 *
 * All auth validation logic lives here. Both Express middleware
 * (server/src/middleware/auth.ts) and TanStack Server Functions middleware
 * (client/src/server/middleware/auth.ts) import from this module.
 *
 * ⚠️  DYNAMIC IMPORTS ONLY — see services/index.ts for bundling rules.
 */

import { z } from 'zod';
import type { PrismaInstance } from '../db/prisma.js';

// ============================================
// SCHEMAS & TYPES
// ============================================

export const JwtPayloadSchema = z.object({
    id: z.string(),
    email: z.string().email(),
    role: z.string(),
    roleId: z.string().nullable().optional(),
    tokenVersion: z.number().optional(),
    iat: z.number().optional(),
    exp: z.number().optional(),
});

export type JwtPayload = z.infer<typeof JwtPayloadSchema>;

export interface AuthenticatedUser {
    id: string;
    email: string;
    role: string;
    roleId: string | null;
    tokenVersion?: number;
    extraAccess?: string[];
}

/** Backward-compat alias */
export type AuthUser = AuthenticatedUser;

export interface AuthContext {
    user: AuthenticatedUser;
    permissions: string[];
}

export interface OptionalAuthContext {
    user: AuthenticatedUser | null;
    permissions: string[];
}

export type AuthResult =
    | { success: true; user: AuthenticatedUser; permissions: string[]; extraAccess: string[] }
    | { success: false; error: string; code: 'NO_TOKEN' | 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'SESSION_INVALIDATED' };

// ============================================
// LAZY IMPORTS (avoid bundling server code)
// ============================================

async function getJwt() {
    const jwt = await import('jsonwebtoken');
    return jwt.default || jwt;
}

// ============================================
// CORE VALIDATION FUNCTIONS
// ============================================

/**
 * Verify and decode a JWT token
 */
export async function verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
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
export async function validateTokenVersion(
    prisma: PrismaInstance,
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
 * Get user permissions and extraAccess from database
 */
export async function getUserPermissionsAndAccess(
    prisma: PrismaInstance,
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

        if (!user) return { permissions: [], extraAccess: [] };

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
 * Full authentication validation — THE single source of truth.
 *
 * Steps:
 * 1. Verify JWT signature and structure
 * 2. Validate token version (for session invalidation)
 * 3. Load user permissions
 */
export async function validateAuth(
    token: string | undefined,
    prisma: PrismaInstance
): Promise<AuthResult> {
    if (!token) {
        return { success: false, error: 'Access token required', code: 'NO_TOKEN' };
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        throw new Error('JWT_SECRET not configured');
    }

    const payload = await verifyToken(token, jwtSecret);
    if (!payload) {
        return { success: false, error: 'Invalid or expired token', code: 'INVALID_TOKEN' };
    }

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

    const { permissions, extraAccess } = await getUserPermissionsAndAccess(prisma, payload.id);

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
