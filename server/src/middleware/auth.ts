import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { JwtPayload } from '../types/express.js';
import { validateTokenVersion, getUserPermissions } from './permissions.js';

/**
 * Middleware to authenticate JWT token
 * Supports both Authorization header and HttpOnly cookie
 * Attaches user and permissions to request
 */
export const authenticateToken = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const authHeader = req.headers['authorization'];
    // Check both Authorization header AND auth_token cookie
    const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.auth_token;

    if (!token) {
        res.status(401).json({ error: 'Access token required' });
        return;
    }

    try {
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET as string
        ) as JwtPayload;

        // Token version validation for immediate session invalidation
        if (decoded.tokenVersion !== undefined) {
            const isValid = await validateTokenVersion(
                req.prisma,
                decoded.id,
                decoded.tokenVersion
            );
            if (!isValid) {
                res.status(403).json({
                    error: 'Session invalidated. Please login again.',
                });
                return;
            }
        }

        req.user = decoded;

        // Attach permissions for downstream middleware
        req.userPermissions = await getUserPermissions(req.prisma, decoded.id);

        next();
    } catch (err) {
        res.status(403).json({ error: 'Invalid or expired token' });
        return;
    }
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
    const authHeader = req.headers['authorization'];
    // Check both Authorization header AND auth_token cookie
    const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.auth_token;

    if (!token) {
        res.status(401).json({ error: 'Access token required' });
        return;
    }

    try {
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET as string
        ) as JwtPayload;

        // Token version validation
        if (decoded.tokenVersion !== undefined) {
            const isValid = await validateTokenVersion(
                req.prisma,
                decoded.id,
                decoded.tokenVersion
            );
            if (!isValid) {
                res.status(403).json({
                    error: 'Session invalidated. Please login again.',
                });
                return;
            }
        }

        // Check legacy admin role OR new owner role permissions
        const permissions = await getUserPermissions(req.prisma, decoded.id);
        const isAdmin =
            decoded.role === 'admin' || permissions.includes('users:create');

        if (!isAdmin) {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        req.user = decoded;
        req.userPermissions = permissions;
        next();
    } catch (err) {
        res.status(403).json({ error: 'Invalid or expired token' });
        return;
    }
};

/**
 * Optional authentication middleware
 * Attaches user if token is valid, continues without auth otherwise
 * Supports both Authorization header and HttpOnly cookie
 */
export const optionalAuth = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const authHeader = req.headers['authorization'];
    // Check both Authorization header AND auth_token cookie
    const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.auth_token;

    if (token) {
        try {
            const decoded = jwt.verify(
                token,
                process.env.JWT_SECRET as string
            ) as JwtPayload;

            if (decoded.tokenVersion !== undefined) {
                const isValid = await validateTokenVersion(
                    req.prisma,
                    decoded.id,
                    decoded.tokenVersion
                );
                if (!isValid) {
                    // Token invalidated - continue without auth
                    next();
                    return;
                }
            }

            // Always set both user AND permissions
            req.user = decoded;
            req.userPermissions = await getUserPermissions(
                req.prisma,
                decoded.id
            );
        } catch (err) {
            // Invalid token - continue without auth
        }
    }
    next();
};
