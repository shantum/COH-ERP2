'use server';

import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import { type MutationResult, type User, requireAdminRole, parsePermissionsArray, getApiBaseUrl } from './types';

// ============================================
// INPUT SCHEMAS
// ============================================

const createUserSchema = z.object({
    email: z.string().email('Invalid email address'),
    name: z.string().min(1, 'Name is required').trim(),
    phone: z.string().min(10, 'Phone number is required'),
    roleId: z.string().uuid().optional().nullable(),
});

const updateUserSchema = z.object({
    userId: z.string().uuid('Invalid user ID'),
    email: z.string().email().optional(),
    name: z.string().min(1).trim().optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(8).optional(),
    roleId: z.string().uuid().optional().nullable(),
    role: z.enum(['admin', 'staff', 'manager', 'owner']).optional(), // Controls access level
    extraAccess: z.array(z.string()).optional(), // Additional feature access beyond role
});

const deleteUserSchema = z.object({
    userId: z.string().uuid('Invalid user ID'),
});

const getUserPermissionsSchema = z.object({
    userId: z.string().uuid('Invalid user ID'),
});

const updateUserPermissionsSchema = z.object({
    userId: z.string().uuid('Invalid user ID'),
    overrides: z.array(z.object({
        permission: z.string().min(1, 'Permission key is required'),
        granted: z.boolean(),
    })),
});

const assignUserRoleSchema = z.object({
    userId: z.string().uuid('Invalid user ID'),
    roleId: z.string().uuid('Invalid role ID'),
});

// ============================================
// INTERFACES
// ============================================

export interface UserPermissionsData {
    userId: string;
    roleId: string | null;
    roleName: string | null;
    rolePermissions: string[];
    overrides: Array<{ permission: string; granted: boolean }>;
}

export interface Role {
    id: string;
    name: string;
    displayName: string;
    description: string | null;
    permissions: string[];
    isBuiltIn: boolean;
    createdAt: string;
    updatedAt: string;
}

// ============================================
// USER MANAGEMENT SERVER FUNCTIONS
// ============================================

/**
 * Get all users with their roles
 * Requires admin role
 */
export const getUsers = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<User[]>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();

        const users = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                roleId: true,
                isActive: true,
                createdAt: true,
                extraAccess: true,
                userRole: {
                    select: {
                        id: true,
                        name: true,
                        displayName: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        const usersWithRoleName = users.map((u: {
            id: string;
            email: string;
            name: string;
            role: string;
            roleId: string | null;
            isActive: boolean;
            createdAt: Date;
            extraAccess: unknown;
            userRole: { id: string; name: string; displayName: string } | null;
        }) => ({
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            roleId: u.roleId,
            roleName: u.userRole?.displayName || u.role,
            isActive: u.isActive,
            createdAt: u.createdAt.toISOString(),
            extraAccess: Array.isArray(u.extraAccess) ? u.extraAccess as string[] : [],
        }));

        return { success: true, data: usersWithRoleName };
    });

/**
 * Create a new user
 * Requires admin role
 * Delegates to Express endpoint to avoid bcryptjs bundler issues
 */
export const createUser = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createUserSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<User & { generatedPassword: string }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { email, name, phone, roleId } = data;

        // Delegate to Express endpoint which has bcryptjs working correctly
        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/users`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
                body: JSON.stringify({ email, name, phone, role: 'staff', roleId }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.message || errorData.error || `Request failed with status ${response.status}`;

                let code: 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'NOT_FOUND' = 'BAD_REQUEST';
                if (response.status === 400) code = 'BAD_REQUEST';
                else if (response.status === 409) code = 'CONFLICT';
                else if (response.status === 403) code = 'FORBIDDEN';
                else if (response.status === 404) code = 'NOT_FOUND';

                return {
                    success: false,
                    error: { code, message: errorMessage },
                };
            }

            const user = await response.json();

            return {
                success: true,
                data: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    roleId: user.roleId,
                    roleName: user.roleName || user.role,
                    isActive: user.isActive,
                    createdAt: typeof user.createdAt === 'string' ? user.createdAt : new Date(user.createdAt).toISOString(),
                    generatedPassword: user.generatedPassword,
                },
            };
        } catch (error) {
            console.error('[admin] createUser failed:', error);
            const message = error instanceof Error ? error.message : 'Unknown error creating user';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Update a user
 * Requires admin role
 * Delegates password updates to Express endpoint to avoid bcryptjs bundler issues
 */
export const updateUser = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateUserSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<User>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { userId, email, name, isActive, password, roleId, role, extraAccess } = data;

        // If password is being updated, delegate to Express endpoint
        // which has bcryptjs working correctly
        if (password) {
            const baseUrl = getApiBaseUrl();
            const authToken = getCookie('auth_token');

            try {
                const response = await fetch(`${baseUrl}/api/admin/users/${userId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                    },
                    body: JSON.stringify({ email, name, isActive, password }),
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const errorMessage = errorData.message || errorData.error || `Request failed with status ${response.status}`;

                    let code: 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'NOT_FOUND' | 'BAD_REQUEST' = 'BAD_REQUEST';
                    if (response.status === 400) code = 'BAD_REQUEST';
                    else if (response.status === 409) code = 'CONFLICT';
                    else if (response.status === 403) code = 'FORBIDDEN';
                    else if (response.status === 404) code = 'NOT_FOUND';

                    return {
                        success: false,
                        error: { code, message: errorMessage },
                    };
                }

                // If roleId also needs updating, do that via Prisma
                if (roleId !== undefined) {
                    const prisma = await getPrisma();
                    await prisma.user.update({
                        where: { id: userId },
                        data: {
                            roleId,
                            tokenVersion: { increment: 1 },
                        },
                    });
                }

                const user = await response.json();

                return {
                    success: true,
                    data: {
                        id: user.id,
                        email: user.email,
                        name: user.name,
                        role: user.role,
                        roleId: roleId !== undefined ? roleId : user.roleId,
                        roleName: user.roleName || user.role,
                        isActive: user.isActive,
                        createdAt: typeof user.createdAt === 'string' ? user.createdAt : new Date(user.createdAt).toISOString(),
                    },
                };
            } catch (error) {
                console.error('[admin] updateUser (password) failed:', error);
                const message = error instanceof Error ? error.message : 'Unknown error updating user';
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message },
                };
            }
        }

        // No password update - handle directly via Prisma
        const prisma = await getPrisma();

        // Get existing user
        const existing = await prisma.user.findUnique({ where: { id: userId } });
        if (!existing) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'User not found' },
            };
        }

        // Prevent disabling the last admin
        if (existing.role === 'admin' && isActive === false) {
            const adminCount = await prisma.user.count({
                where: { role: 'admin', isActive: true },
            });
            if (adminCount <= 1) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Cannot disable the last admin user' },
                };
            }
        }

        // Check email uniqueness if changing
        if (email && email !== existing.email) {
            const emailExists = await prisma.user.findUnique({ where: { email } });
            if (emailExists) {
                return {
                    success: false,
                    error: { code: 'CONFLICT', message: 'Email already in use' },
                };
            }
        }

        // Validate roleId if provided
        if (roleId) {
            const roleExists = await prisma.role.findUnique({ where: { id: roleId } });
            if (!roleExists) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Invalid roleId - role not found' },
                };
            }
        }

        // Build update data
        const updateData: Record<string, unknown> = {};
        if (email !== undefined) updateData.email = email;
        if (name !== undefined) updateData.name = name;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (role !== undefined) {
            // Prevent removing the last admin
            if (existing.role === 'admin' && role === 'staff') {
                const adminCount = await prisma.user.count({
                    where: { role: 'admin', isActive: true },
                });
                if (adminCount <= 1) {
                    return {
                        success: false,
                        error: { code: 'BAD_REQUEST', message: 'Cannot demote the last admin user' },
                    };
                }
            }
            updateData.role = role;
            updateData.tokenVersion = { increment: 1 }; // Force re-login
        }
        if (roleId !== undefined) {
            updateData.roleId = roleId;
            updateData.tokenVersion = { increment: 1 }; // Force re-login
        }
        if (extraAccess !== undefined) {
            updateData.extraAccess = extraAccess;
            updateData.tokenVersion = { increment: 1 }; // Force re-login
        }

        const user = await prisma.user.update({
            where: { id: userId },
            data: updateData,
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                roleId: true,
                isActive: true,
                createdAt: true,
                extraAccess: true,
                userRole: {
                    select: {
                        id: true,
                        name: true,
                        displayName: true,
                    },
                },
            },
        });

        return {
            success: true,
            data: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                roleId: user.roleId,
                roleName: user.userRole?.displayName || user.role,
                isActive: user.isActive,
                createdAt: user.createdAt.toISOString(),
                extraAccess: Array.isArray(user.extraAccess) ? user.extraAccess as string[] : [],
            },
        };
    });

/**
 * Delete a user
 * Requires admin role
 */
export const deleteUser = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteUserSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<{ deleted: boolean }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();
        const { userId } = data;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'User not found' },
            };
        }

        // Prevent deleting the last admin
        if (user.role === 'admin') {
            const adminCount = await prisma.user.count({ where: { role: 'admin' } });
            if (adminCount <= 1) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Cannot delete the last admin user' },
                };
            }
        }

        // Prevent self-deletion
        if (user.id === context.user.id) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Cannot delete your own account' },
            };
        }

        await prisma.user.delete({ where: { id: userId } });

        return { success: true, data: { deleted: true } };
    });

// ============================================
// USER PERMISSIONS SERVER FUNCTIONS
// ============================================

/**
 * Get user permissions with role data
 * Returns the user's role permissions and any overrides
 * Requires admin role
 */
export const getUserPermissions = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getUserPermissionsSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<UserPermissionsData>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();
        const { userId } = data;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                userRole: {
                    select: {
                        id: true,
                        name: true,
                        displayName: true,
                        permissions: true,
                    },
                },
                permissionOverrides: {
                    select: {
                        permission: true,
                        granted: true,
                    },
                },
            },
        });

        if (!user) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'User not found' },
            };
        }

        return {
            success: true,
            data: {
                userId: user.id,
                roleId: user.roleId,
                roleName: user.userRole?.displayName || null,
                rolePermissions: parsePermissionsArray(user.userRole?.permissions),
                overrides: user.permissionOverrides.map((o: { permission: string; granted: boolean }) => ({
                    permission: o.permission,
                    granted: o.granted,
                })),
            },
        };
    });

/**
 * Update user permission overrides
 * Allows granting/revoking permissions beyond what the role provides
 * Requires admin role
 */
export const updateUserPermissions = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateUserPermissionsSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<{ updated: boolean }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();
        const { userId, overrides } = data;

        // Verify user exists
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                userRole: {
                    select: { permissions: true },
                },
            },
        });

        if (!user) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'User not found' },
            };
        }

        // Get the role's permissions as a Set for quick lookup
        const rolePermissions = new Set(parsePermissionsArray(user.userRole?.permissions));

        // Filter overrides to only include those that differ from role defaults
        const effectiveOverrides = overrides.filter(o => {
            const roleHasPermission = rolePermissions.has(o.permission);
            // Only store override if it differs from role default
            return o.granted !== roleHasPermission;
        });

        // Delete existing overrides and create new ones in a transaction
        await prisma.$transaction([
            prisma.userPermissionOverride.deleteMany({
                where: { userId },
            }),
            ...effectiveOverrides.map(o =>
                prisma.userPermissionOverride.create({
                    data: {
                        userId,
                        permission: o.permission,
                        granted: o.granted,
                    },
                })
            ),
        ]);

        // Bump token version to force re-login
        await prisma.user.update({
            where: { id: userId },
            data: { tokenVersion: { increment: 1 } },
        });

        return { success: true, data: { updated: true } };
    });

/**
 * Assign a role to a user
 * Requires admin role
 */
export const assignUserRole = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => assignUserRoleSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<{ updated: boolean }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();
        const { userId, roleId } = data;

        // Verify user exists
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'User not found' },
            };
        }

        // Verify role exists
        const role = await prisma.role.findUnique({ where: { id: roleId } });
        if (!role) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Role not found' },
            };
        }

        // Update user's role and bump token version
        await prisma.user.update({
            where: { id: userId },
            data: {
                roleId,
                tokenVersion: { increment: 1 },
            },
        });

        return { success: true, data: { updated: true } };
    });

// ============================================
// ROLES SERVER FUNCTIONS
// ============================================

/**
 * Get all roles
 * Requires authentication
 */
export const getRoles = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<Role[]>> => {
        const prisma = await getPrisma();

        const roles = await prisma.role.findMany({
            select: {
                id: true,
                name: true,
                displayName: true,
                description: true,
                permissions: true,
                isBuiltIn: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: { displayName: 'asc' },
        });

        // Convert dates to ISO strings and parse permissions from JsonValue
        const rolesWithStringDates = roles.map((role: typeof roles[number]) => ({
            id: role.id,
            name: role.name,
            displayName: role.displayName,
            description: role.description,
            permissions: parsePermissionsArray(role.permissions),
            isBuiltIn: role.isBuiltIn,
            createdAt: role.createdAt.toISOString(),
            updatedAt: role.updatedAt.toISOString(),
        }));

        return { success: true, data: rolesWithStringDates };
    });
