import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { ValidationError, NotFoundError, BusinessLogicError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';
import type { RoleAssignmentBody, PermissionOverride, PermissionsUpdateBody } from './types.js';

const log = logger.child({ module: 'admin' });

const router = Router();

/**
 * List all roles with their permissions
 * @route GET /api/admin/roles
 * @returns {Object[]} roles - [{ id, name, displayName, permissions, createdAt }]
 */
router.get('/roles', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const roles = await req.prisma.role.findMany({
        orderBy: { createdAt: 'asc' },
    });
    res.json(roles);
}));

// Get single role with user count
router.get('/roles/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const role = await req.prisma.role.findUnique({
        where: { id },
        include: {
            _count: { select: { users: true } },
        },
    });

    if (!role) {
        throw new NotFoundError('Role not found', 'Role', id);
    }

    res.json(role);
}));

/**
 * Assign role to user (increments tokenVersion to force re-login)
 * @route PUT /api/admin/users/:id/role
 * @param {string} body.roleId - Role UUID to assign
 * @returns {Object} user - Updated user with roleName
 * @description Prevents changing last Owner role. Forces re-login to apply new permissions.
 */
router.put('/users/:id/role', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { roleId } = req.body as RoleAssignmentBody;
    const id = req.params.id as string;

    if (!roleId) {
        throw new ValidationError('roleId is required');
    }

    const user = await req.prisma.user.findUnique({
        where: { id },
    });

    if (!user) {
        throw new NotFoundError('User not found', 'User', id);
    }

    const role = await req.prisma.role.findUnique({
        where: { id: roleId },
    });

    if (!role) {
        throw new NotFoundError('Role not found', 'Role', roleId);
    }

    // Prevent changing the last Owner's role
    // First get the user's current role to check if they're an owner
    const userWithRole = await req.prisma.user.findUnique({
        where: { id },
        include: { userRole: true },
    });

    if (userWithRole?.userRole?.name === 'owner') {
        const ownerRole = await req.prisma.role.findFirst({ where: { name: 'owner' } });
        if (ownerRole) {
            const ownerCount = await req.prisma.user.count({
                where: { roleId: ownerRole.id, isActive: true },
            });
            if (ownerCount <= 1 && roleId !== ownerRole.id) {
                throw new BusinessLogicError('Cannot change role of the last Owner', 'last_owner_protection');
            }
        }
    }

    // Update user role and invalidate their tokens
    const updated = await req.prisma.$transaction(async (tx) => {
        const result = await tx.user.update({
            where: { id },
            data: {
                roleId,
                tokenVersion: { increment: 1 }, // Force re-login
            },
            include: {
                userRole: { select: { id: true, name: true, displayName: true } },
            },
        });
        return result;
    });

    log.info({ userEmail: user.email, newRole: role.displayName }, 'Role changed for user');

    res.json({
        ...updated,
        roleName: updated.userRole?.displayName,
    });
}));

/**
 * Get user's effective permissions (role + overrides)
 * @route GET /api/admin/users/:id/permissions
 * @returns {Object} { userId, roleId, roleName, rolePermissions[], overrides: [{ permission, granted }] }
 */
router.get('/users/:id/permissions', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const user = await req.prisma.user.findUnique({
        where: { id },
        include: {
            userRole: { select: { id: true, name: true, displayName: true, permissions: true } },
            permissionOverrides: true,
        },
    });

    if (!user) {
        throw new NotFoundError('User not found', 'User', id);
    }

    // Get role permissions as array
    const rolePermissions = Array.isArray(user.userRole?.permissions)
        ? user.userRole.permissions as string[]
        : [];

    // Build map of overrides: permission -> granted
    const overrideMap = new Map<string, boolean>();
    for (const override of user.permissionOverrides) {
        overrideMap.set(override.permission, override.granted);
    }

    res.json({
        userId: user.id,
        roleId: user.userRole?.id || null,
        roleName: user.userRole?.displayName || null,
        rolePermissions,
        overrides: user.permissionOverrides.map(o => ({
            permission: o.permission,
            granted: o.granted,
        })),
    });
}));

/**
 * Update per-user permission overrides (increments tokenVersion)
 * @route PUT /api/admin/users/:id/permissions
 * @param {Object[]} body.overrides - [{ permission: 'orders:read', granted: true }]
 * @description Only stores overrides that differ from role defaults. Auto-deletes overrides matching role. Forces re-login.
 */
router.put('/users/:id/permissions', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { overrides } = req.body as PermissionsUpdateBody;
    const id = req.params.id as string;

    if (!Array.isArray(overrides)) {
        throw new ValidationError('overrides must be an array');
    }

    // Validate each override
    for (const override of overrides) {
        if (!override.permission || typeof override.permission !== 'string') {
            throw new ValidationError('Each override must have a permission string');
        }
        if (typeof override.granted !== 'boolean') {
            throw new ValidationError('Each override must have a granted boolean');
        }
    }

    const user = await req.prisma.user.findUnique({
        where: { id },
        include: {
            userRole: { select: { id: true, permissions: true } },
        },
    });

    if (!user) {
        throw new NotFoundError('User not found', 'User', id);
    }

    // Get role permissions for comparison
    const rolePermissions = new Set<string>(
        Array.isArray(user.userRole?.permissions) ? user.userRole.permissions as string[] : []
    );

    // Determine which overrides to create/update and which to delete
    const toUpsert: PermissionOverride[] = [];
    const toDelete: string[] = [];

    for (const override of overrides) {
        const roleHasPermission = rolePermissions.has(override.permission);

        // If override matches role default, we should delete it (no need to store)
        if ((override.granted && roleHasPermission) || (!override.granted && !roleHasPermission)) {
            toDelete.push(override.permission);
        } else {
            // Override differs from role default, store it
            toUpsert.push(override);
        }
    }

    // Execute in transaction
    await req.prisma.$transaction(async (tx) => {
        // Delete overrides that now match role defaults
        if (toDelete.length > 0) {
            await tx.userPermissionOverride.deleteMany({
                where: {
                    userId: id,
                    permission: { in: toDelete },
                },
            });
        }

        // Upsert overrides that differ from role defaults
        for (const override of toUpsert) {
            await tx.userPermissionOverride.upsert({
                where: {
                    userId_permission: {
                        userId: id,
                        permission: override.permission,
                    },
                },
                update: { granted: override.granted },
                create: {
                    userId: id,
                    permission: override.permission,
                    granted: override.granted,
                },
            });
        }

        // Increment token version to force re-login with new permissions
        await tx.user.update({
            where: { id },
            data: { tokenVersion: { increment: 1 } },
        });
    });

    // Fetch updated overrides
    const updatedOverrides = await req.prisma.userPermissionOverride.findMany({
        where: { userId: id },
    });

    log.info({ userEmail: user.email, set: toUpsert.length, cleared: toDelete.length }, 'Permission overrides updated');

    res.json({
        message: 'Permission overrides updated successfully',
        overrides: updatedOverrides.map(o => ({
            permission: o.permission,
            granted: o.granted,
        })),
    });
}));

export default router;
