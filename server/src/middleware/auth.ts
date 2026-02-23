/**
 * Express Auth Middleware
 *
 * Uses authCore for validation logic.
 * NOTE: TanStack Server Functions middleware has its own copy
 * (client/src/server/middleware/auth.ts) due to build boundary.
 */

import type { Request, Response, NextFunction } from 'express';
import {
    validateAuth,
    hasAdminAccess,
} from '../utils/authCore.js';

// Re-export types for convenience
export type { AuthenticatedUser, AuthContext, AuthResult } from '../utils/authCore.js';

/**
 * Extract auth token from request — cookie-first, header fallback
 */
function extractToken(req: Request): string | undefined {
    const authHeader = req.headers['authorization'];
    return req.cookies?.auth_token || (authHeader && authHeader.split(' ')[1]);
}

/**
 * Middleware to authenticate JWT token
 *
 * Uses unified validateAuth() from authCore - same logic as Server Functions.
 * Attaches user and permissions to request.
 */
export const authenticateToken = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const token = extractToken(req);
    const result = await validateAuth(token, req.prisma);

    if (!result.success) {
        const status = result.code === 'NO_TOKEN' ? 401 : 403;
        res.status(status).json({ error: result.error });
        return;
    }

    req.user = result.user;
    req.userPermissions = result.permissions;
    next();
};

/**
 * @deprecated Use requirePermission('users:*') from permissions.js instead
 * Kept for backward compatibility during migration
 */
export const requireAdmin = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const token = extractToken(req);
    const result = await validateAuth(token, req.prisma);

    if (!result.success) {
        const status = result.code === 'NO_TOKEN' ? 401 : 403;
        res.status(status).json({ error: result.error });
        return;
    }

    // Check admin access using unified logic
    if (!hasAdminAccess(result.user, result.permissions)) {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }

    req.user = result.user;
    req.userPermissions = result.permissions;
    next();
};

/**
 * Optional authentication middleware
 *
 * Attaches user if token is valid, continues without auth otherwise.
 * Uses unified validateAuth() from authCore.
 */
export const optionalAuth = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const token = extractToken(req);

    if (token) {
        const result = await validateAuth(token, req.prisma);
        if (result.success) {
            req.user = result.user;
            req.userPermissions = result.permissions;
        }
        // If invalid, continue without auth (don't error)
    }

    next();
};
