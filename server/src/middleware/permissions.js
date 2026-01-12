/**
 * Permission Middleware
 * Express middleware for checking user permissions
 */

import { ALL_PERMISSIONS } from '../utils/permissions.js';

/**
 * Get user's effective permissions
 * Combines role permissions with individual overrides
 */
export async function getUserPermissions(prisma, userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            userRole: true,
            permissionOverrides: true,
        },
    });

    if (!user) return [];

    // Start with role permissions
    const rolePermissions = new Set(
        Array.isArray(user.userRole?.permissions)
            ? user.userRole.permissions
            : []
    );

    // Fallback for legacy admin users without roleId
    // This ensures admin access even if seed-roles hasn't run
    if (rolePermissions.size === 0 && user.role === 'admin') {
        rolePermissions.add('*');
    }

    // Apply overrides
    for (const override of user.permissionOverrides || []) {
        if (override.granted) {
            rolePermissions.add(override.permission);
        } else {
            rolePermissions.delete(override.permission);
        }
    }

    return Array.from(rolePermissions);
}

/**
 * Check if user has a specific permission
 */
export function hasPermission(userPermissions, permission) {
    if (!userPermissions || !Array.isArray(userPermissions)) return false;

    // Direct match
    if (userPermissions.includes(permission)) return true;

    // Wildcard support with format validation: products:* matches products:view, products:edit, etc.
    const parts = permission.split(':');
    if (parts.length >= 2) {
        const domain = parts[0];
        if (userPermissions.includes(`${domain}:*`)) return true;
    }

    // Global admin wildcard
    if (userPermissions.includes('*')) return true;

    return false;
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(userPermissions, ...permissions) {
    return permissions.some(p => hasPermission(userPermissions, p));
}

/**
 * Check if user has all of the specified permissions
 */
export function hasAllPermissions(userPermissions, ...permissions) {
    return permissions.every(p => hasPermission(userPermissions, p));
}

/**
 * Middleware: Require a specific permission
 */
export const requirePermission = (permission) => async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    // Get permissions if not already attached
    if (!req.userPermissions) {
        req.userPermissions = await getUserPermissions(req.prisma, req.user.id);
    }

    if (!hasPermission(req.userPermissions, permission)) {
        // Log failed access attempt
        await logAuditEvent(req.prisma, {
            userId: req.user.id,
            action: 'access_denied',
            resource: permission,
            details: {
                path: req.path,
                method: req.method,
                required: permission,
            },
            ipAddress: req.ip,
        });

        return res.status(403).json({
            error: 'Access denied',
            required: permission,
        });
    }

    next();
};

/**
 * Middleware: Require any of multiple permissions
 */
export const requireAnyPermission = (...permissions) => async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.userPermissions) {
        req.userPermissions = await getUserPermissions(req.prisma, req.user.id);
    }

    if (!hasAnyPermission(req.userPermissions, ...permissions)) {
        await logAuditEvent(req.prisma, {
            userId: req.user.id,
            action: 'access_denied',
            resource: permissions.join(','),
            details: {
                path: req.path,
                method: req.method,
                requiredAny: permissions,
            },
            ipAddress: req.ip,
        });

        return res.status(403).json({
            error: 'Access denied',
            requiredAny: permissions,
        });
    }

    next();
};

/**
 * Middleware: Attach user permissions to request
 * Use early in request pipeline to avoid multiple DB lookups
 */
export const attachPermissions = async (req, res, next) => {
    if (req.user && !req.userPermissions) {
        req.userPermissions = await getUserPermissions(req.prisma, req.user.id);
    }
    next();
};

/**
 * Log audit event
 */
export async function logAuditEvent(prisma, event) {
    try {
        await prisma.permissionAuditLog.create({
            data: {
                userId: event.userId,
                action: event.action,
                resource: event.resource,
                resourceId: event.resourceId || null,
                details: event.details || null,
                ipAddress: event.ipAddress || null,
            },
        });
    } catch (error) {
        // Don't fail requests due to audit logging errors
        console.error('Audit log error:', error.message);
    }
}

/**
 * Filter confidential fields from data based on permissions
 */
export function filterConfidentialFields(data, userPermissions) {
    if (!data) return data;

    const isArray = Array.isArray(data);
    const items = isArray ? data : [data];

    const filtered = items.map(item => {
        const result = { ...item };

        // Cost fields - require products:view:cost
        if (!hasPermission(userPermissions, 'products:view:cost')) {
            delete result.fabricCost;
            delete result.laborCost;
            delete result.trimsCost;
            delete result.liningCost;
            delete result.packagingCost;
            delete result.totalCost;
            delete result.totalCogs;
            delete result.costMultiple;
            delete result.costPerUnit;
            delete result.laborRatePerMin;

            // Cascade cost fields (SKU -> Variation -> Product -> Global)
            delete result.skuTrimsCost;
            delete result.variationTrimsCost;
            delete result.productTrimsCost;
            delete result.skuLiningCost;
            delete result.variationLiningCost;
            delete result.productLiningCost;
            delete result.skuPackagingCost;
            delete result.variationPackagingCost;
            delete result.productPackagingCost;
            delete result.globalPackagingCost;
            delete result.skuLaborMinutes;
            delete result.variationLaborMinutes;
            delete result.productLaborMinutes;
            delete result.fabricCostPerUnit;
        }

        // Consumption fields - require products:view:consumption
        if (!hasPermission(userPermissions, 'products:view:consumption')) {
            delete result.fabricConsumption;
        }

        // Financial order data - require orders:view:financial
        if (!hasPermission(userPermissions, 'orders:view:financial')) {
            delete result.totalAmount;
            delete result.unitPrice;
            delete result.codRemittedAmount;
        }

        // Customer contact info - require customers:view:contact
        // Note: shippingAddress is NOT redacted as city is needed for logistics
        if (!hasPermission(userPermissions, 'customers:view:contact')) {
            delete result.customerEmail;
            delete result.customerPhone;
            delete result.email;
            delete result.phone;
        }

        return result;
    });

    return isArray ? filtered : filtered[0];
}

/**
 * Check token version for immediate session invalidation
 */
export async function validateTokenVersion(prisma, userId, tokenVersion) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { tokenVersion: true },
    });

    return user && user.tokenVersion === tokenVersion;
}

/**
 * Invalidate all tokens for a user
 */
export async function invalidateUserTokens(prisma, userId) {
    await prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
    });
}
