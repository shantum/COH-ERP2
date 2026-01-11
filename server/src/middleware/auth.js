import jwt from 'jsonwebtoken';
import { validateTokenVersion, getUserPermissions } from './permissions.js';

export const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Token version validation for immediate session invalidation
        if (decoded.tokenVersion !== undefined) {
            const isValid = await validateTokenVersion(req.prisma, decoded.id, decoded.tokenVersion);
            if (!isValid) {
                return res.status(403).json({ error: 'Session invalidated. Please login again.' });
            }
        }

        req.user = decoded;

        // Attach permissions for downstream middleware
        req.userPermissions = await getUserPermissions(req.prisma, decoded.id);

        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

/**
 * @deprecated Use requirePermission('users:*') from permissions.js instead
 * Kept for backward compatibility during migration
 */
export const requireAdmin = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Token version validation
        if (decoded.tokenVersion !== undefined) {
            const isValid = await validateTokenVersion(req.prisma, decoded.id, decoded.tokenVersion);
            if (!isValid) {
                return res.status(403).json({ error: 'Session invalidated. Please login again.' });
            }
        }

        // Check legacy admin role OR new owner role permissions
        const permissions = await getUserPermissions(req.prisma, decoded.id);
        const isAdmin = decoded.role === 'admin' || permissions.includes('users:create');

        if (!isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        req.user = decoded;
        req.userPermissions = permissions;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

export const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Validate token version if present
            if (decoded.tokenVersion !== undefined) {
                const isValid = await validateTokenVersion(req.prisma, decoded.id, decoded.tokenVersion);
                if (isValid) {
                    req.user = decoded;
                    req.userPermissions = await getUserPermissions(req.prisma, decoded.id);
                }
            } else {
                req.user = decoded;
            }
        } catch (err) {
            // Invalid token - continue without auth
        }
    }
    next();
};
