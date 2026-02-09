/**
 * Permission Middleware
 * Express middleware for checking user permissions
 */

/// <reference path="../types/express.d.ts" />
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { PrismaClient, UserPermissionOverride, Role } from '@prisma/client';

/**
 * User with role and permission overrides from Prisma
 */
interface UserWithPermissions {
    id: string;
    role: string;
    userRole: Role | null;
    permissionOverrides: UserPermissionOverride[];
}

/**
 * Audit event structure for permission logging
 */
interface AuditEvent {
    userId: string;
    action: string;
    resource: string;
    resourceId?: string | null;
    details?: Record<string, unknown> | null;
    ipAddress?: string | null;
}

/**
 * Get user's effective permissions
 * Combines role permissions with individual overrides
 */
export async function getUserPermissions(
    prisma: PrismaClient,
    userId: string
): Promise<string[]> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            userRole: true,
            permissionOverrides: true,
        },
    }) as UserWithPermissions | null;

    if (!user) return [];

    // Start with role permissions
    const rolePermissions = new Set<string>(
        Array.isArray(user.userRole?.permissions)
            ? (user.userRole.permissions as string[])
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
export function hasPermission(
    userPermissions: string[] | undefined,
    permission: string
): boolean {
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
export function hasAnyPermission(
    userPermissions: string[] | undefined,
    ...permissions: string[]
): boolean {
    return permissions.some((p) => hasPermission(userPermissions, p));
}

/**
 * Check if user has all of the specified permissions
 */
export function hasAllPermissions(
    userPermissions: string[] | undefined,
    ...permissions: string[]
): boolean {
    return permissions.every((p) => hasPermission(userPermissions, p));
}

/**
 * Middleware: Require a specific permission
 */
export const requirePermission = (
    permission: string
): RequestHandler => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
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

            res.status(403).json({
                error: 'Access denied',
                required: permission,
            });
            return;
        }

        next();
    };
};

/**
 * Middleware: Require any of multiple permissions
 */
export const requireAnyPermission = (
    ...permissions: string[]
): RequestHandler => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
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

            res.status(403).json({
                error: 'Access denied',
                requiredAny: permissions,
            });
            return;
        }

        next();
    };
};

/**
 * Middleware: Attach user permissions to request
 * Use early in request pipeline to avoid multiple DB lookups
 */
export const attachPermissions: RequestHandler = async (
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> => {
    if (req.user && !req.userPermissions) {
        req.userPermissions = await getUserPermissions(req.prisma, req.user.id);
    }
    next();
};

/**
 * Log audit event
 * Note: permissionAuditLog model may not exist - errors are caught silently
 */
export async function logAuditEvent(
    prisma: PrismaClient,
    event: AuditEvent
): Promise<void> {
    try {
        // PermissionAuditLog model may not exist in schema yet — cast to access dynamically
        await (prisma as unknown as Record<string, { create: (args: unknown) => Promise<unknown> }>).permissionAuditLog.create({
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
        console.error('Audit log error:', (error as Error).message);
    }
}

/**
 * Data object with potential confidential fields
 */
type DataWithConfidentialFields = Record<string, unknown>;

/**
 * Filter confidential fields from data based on permissions
 */
export function filterConfidentialFields<T extends DataWithConfidentialFields>(
    data: T | T[] | null | undefined,
    userPermissions: string[] | undefined
): T | T[] | null | undefined {
    if (!data) return data;

    const isArray = Array.isArray(data);
    const items = isArray ? data : [data];

    const filtered = items.map((item) => {
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
export async function validateTokenVersion(
    prisma: PrismaClient,
    userId: string,
    tokenVersion: number
): Promise<boolean> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { tokenVersion: true },
    });

    return user !== null && user.tokenVersion === tokenVersion;
}

/**
 * Invalidate all tokens for a user
 */
export async function invalidateUserTokens(
    prisma: PrismaClient,
    userId: string
): Promise<void> {
    await prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
    });
}
