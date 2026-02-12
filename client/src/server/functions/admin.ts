/**
 * Admin Server Functions
 *
 * TanStack Start Server Functions for admin operations:
 * - User management (CRUD)
 * - Sales channels configuration
 * - Customer tier thresholds
 * - User preferences (grid preferences)
 * - Server logs
 * - Background jobs management
 *
 * All functions require authentication via authMiddleware.
 * Admin-only functions include role checks in the handler.
 */
'use server';

import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';


/**
 * Get API base URL for internal server-to-server calls
 */
function getApiBaseUrl(): string {
    const port = process.env.PORT || '3001';
    return process.env.NODE_ENV === 'production'
        ? `http://127.0.0.1:${port}` // Same server on Railway
        : 'http://localhost:3001'; // Separate dev server
}

// ============================================
// INPUT SCHEMAS
// ============================================

// User Management
const createUserSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    name: z.string().min(1, 'Name is required').trim(),
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

// Channels
const updateChannelsSchema = z.object({
    channels: z.array(z.object({
        id: z.string().min(1, 'Channel ID is required'),
        name: z.string().min(1, 'Channel name is required'),
    })),
});

// Tier Thresholds
const updateTierThresholdsSchema = z.object({
    platinum: z.number().positive('Platinum threshold must be positive'),
    gold: z.number().positive('Gold threshold must be positive'),
    silver: z.number().positive('Silver threshold must be positive'),
});

// User Preferences (Grid Preferences)
const getUserPreferencesSchema = z.object({
    gridId: z.string().min(1, 'Grid ID is required'),
});

const updateUserPreferencesSchema = z.object({
    gridId: z.string().min(1, 'Grid ID is required'),
    visibleColumns: z.array(z.string()),
    columnOrder: z.array(z.string()),
    columnWidths: z.record(z.string(), z.number()),
    adminVersion: z.string().optional(),
});

// Server Logs
const getServerLogsSchema = z.object({
    level: z.enum(['error', 'warn', 'info', 'all']).optional().default('all'),
    limit: z.number().int().positive().max(1000).optional().default(100),
    offset: z.number().int().nonnegative().optional().default(0),
    search: z.string().optional().nullable(),
});

// Background Jobs
const startBackgroundJobSchema = z.object({
    jobId: z.enum(['shopify_sync', 'tracking_sync', 'cache_cleanup', 'ingest_inward', 'ingest_outward', 'move_shipped_to_outward', 'preview_ingest_inward', 'preview_ingest_outward', 'cleanup_done_rows', 'migrate_sheet_formulas', 'snapshot_compute', 'snapshot_backfill', 'push_balances', 'preview_push_balances', 'push_fabric_balances', 'import_fabric_balances', 'preview_fabric_inward', 'ingest_fabric_inward', 'reconcile_sheet_orders', 'sync_sheet_status']),
});

const cancelBackgroundJobSchema = z.object({
    jobId: z.enum(['shopify_sync', 'tracking_sync', 'cache_cleanup', 'ingest_inward', 'ingest_outward', 'move_shipped_to_outward', 'preview_ingest_inward', 'preview_ingest_outward', 'cleanup_done_rows', 'migrate_sheet_formulas', 'snapshot_compute', 'snapshot_backfill', 'push_balances', 'preview_push_balances', 'push_fabric_balances', 'import_fabric_balances', 'preview_fabric_inward', 'ingest_fabric_inward', 'reconcile_sheet_orders', 'sync_sheet_status']),
});

const updateBackgroundJobSchema = z.object({
    jobId: z.string(),
    enabled: z.boolean(),
});

// ============================================
// RESULT TYPES
// ============================================

export interface MutationResult<T> {
    success: boolean;
    data?: T;
    error?: {
        code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'UNAUTHORIZED';
        message: string;
    };
}

export interface User {
    id: string;
    email: string;
    name: string;
    role: string;
    roleId: string | null;
    roleName: string | null;
    isActive: boolean;
    createdAt: string;
    extraAccess?: string[]; // Additional feature access beyond role
}

export interface Channel {
    id: string;
    name: string;
}

export interface TierThresholds {
    platinum: number;
    gold: number;
    silver: number;
}

export interface UserPreferences {
    visibleColumns: string[];
    columnOrder: string[];
    columnWidths: Record<string, number>;
    adminVersion: string | null;
}

/** JSON-safe value type for serializable server function data */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface LogEntry {
    timestamp: string;
    level: string;
    message: string;
    meta?: Record<string, JsonValue>;
}

export interface LogsResult {
    logs: LogEntry[];
    total: number;
    level: string;
    limit: number;
    offset: number;
}

export interface BackgroundJob {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    intervalMinutes?: number;
    schedule?: string;
    isRunning?: boolean;
    lastRunAt?: string | null;
    lastResult?: Record<string, JsonValue>;
    config?: Record<string, JsonValue>;
    stats?: Record<string, JsonValue>;
    note?: string;
}

// ============================================
// ACCESS CHECK HELPERS
// ============================================

import { hasAccess as checkFeatureAccess, type AccessFeature } from '@coh/shared/config/access';

/**
 * Legacy admin check - use for backward compatibility
 * Checks if user has admin/owner role
 */
function requireAdminRole(userRole: string): void {
    if (userRole !== 'admin' && userRole !== 'owner') {
        throw new Error('Admin access required');
    }
}

/**
 * Check if user has access to a feature
 * Uses new simplified access system
 * @internal For future use when migrating from requireAdminRole
 */
function _requireAccess(
    userRole: string,
    extraAccess: string[] | undefined,
    feature: AccessFeature
): void {
    if (!checkFeatureAccess(userRole, extraAccess ?? [], feature)) {
        throw new Error(`Access denied: ${feature} permission required`);
    }
}
// Export for use in other modules
export { _requireAccess as requireAccess };

// ============================================
// JSON VALUE HELPERS
// ============================================

/**
 * Safely converts a Prisma JsonValue to string[].
 * Used for Role.permissions which is stored as Json in the database.
 */
function parsePermissionsArray(jsonValue: unknown): string[] {
    if (!jsonValue) return [];
    if (!Array.isArray(jsonValue)) return [];
    return jsonValue.filter((item): item is string => typeof item === 'string');
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
    .handler(async ({ data, context }): Promise<MutationResult<User>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { email, password, name, roleId } = data;

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
                body: JSON.stringify({ email, password, name, role: 'staff', roleId }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.message || errorData.error || `Request failed with status ${response.status}`;

                // Map HTTP status to error code
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
                },
            };
        } catch (error) {
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
// CHANNELS SERVER FUNCTIONS
// ============================================

/**
 * Get sales channels configuration
 */
export const getChannels = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<Channel[]>> => {
        const prisma = await getPrisma();

        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'order_channels' },
        });

        const defaultChannels: Channel[] = [
            { id: 'offline', name: 'Offline' },
            { id: 'shopify', name: 'Shopify' },
            { id: 'nykaa', name: 'Nykaa' },
            { id: 'ajio', name: 'Ajio' },
            { id: 'myntra', name: 'Myntra' },
        ];

        const channels = setting?.value
            ? (JSON.parse(setting.value) as Channel[])
            : defaultChannels;

        return { success: true, data: channels };
    });

/**
 * Update sales channels configuration
 * Requires admin role
 */
export const updateChannels = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateChannelsSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<Channel[]>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();
        const { channels } = data;

        await prisma.systemSetting.upsert({
            where: { key: 'order_channels' },
            update: { value: JSON.stringify(channels) },
            create: { key: 'order_channels', value: JSON.stringify(channels) },
        });

        return { success: true, data: channels };
    });

// ============================================
// TIER THRESHOLDS SERVER FUNCTIONS
// ============================================

const DEFAULT_TIER_THRESHOLDS: TierThresholds = {
    platinum: 50000,
    gold: 25000,
    silver: 10000,
};

/**
 * Get customer tier thresholds
 */
export const getTierThresholds = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<TierThresholds>> => {
        const prisma = await getPrisma();

        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'tier_thresholds' },
        });

        const thresholds = setting?.value
            ? (JSON.parse(setting.value) as TierThresholds)
            : DEFAULT_TIER_THRESHOLDS;

        return { success: true, data: thresholds };
    });

/**
 * Update customer tier thresholds
 * Requires admin role
 */
export const updateTierThresholds = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateTierThresholdsSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<TierThresholds>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { platinum, gold, silver } = data;

        // Validate thresholds order
        if (platinum <= gold || gold <= silver) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Thresholds must be: platinum > gold > silver' },
            };
        }

        const prisma = await getPrisma();
        const thresholds: TierThresholds = { platinum, gold, silver };

        await prisma.systemSetting.upsert({
            where: { key: 'tier_thresholds' },
            update: { value: JSON.stringify(thresholds) },
            create: { key: 'tier_thresholds', value: JSON.stringify(thresholds) },
        });

        return { success: true, data: thresholds };
    });

// ============================================
// USER PREFERENCES SERVER FUNCTIONS
// ============================================

/**
 * Get user's grid preferences
 */
export const getUserPreferences = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getUserPreferencesSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<UserPreferences | null>> => {
        const prisma = await getPrisma();
        const { gridId } = data;
        const userId = context.user.id;

        const userPref = await prisma.userGridPreference.findUnique({
            where: { userId_gridId: { userId, gridId } },
        });

        if (!userPref) {
            return { success: true, data: null };
        }

        return {
            success: true,
            data: {
                visibleColumns: JSON.parse(userPref.visibleColumns),
                columnOrder: JSON.parse(userPref.columnOrder),
                columnWidths: JSON.parse(userPref.columnWidths),
                adminVersion: userPref.adminVersion?.toISOString() ?? null,
            },
        };
    });

/**
 * Update user's grid preferences
 */
export const updateUserPreferences = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateUserPreferencesSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<{ updated: boolean }>> => {
        const prisma = await getPrisma();
        const { gridId, visibleColumns, columnOrder, columnWidths, adminVersion } = data;
        const userId = context.user.id;

        await prisma.userGridPreference.upsert({
            where: { userId_gridId: { userId, gridId } },
            update: {
                visibleColumns: JSON.stringify(visibleColumns),
                columnOrder: JSON.stringify(columnOrder),
                columnWidths: JSON.stringify(columnWidths),
                adminVersion: adminVersion ? new Date(adminVersion) : undefined,
            },
            create: {
                userId,
                gridId,
                visibleColumns: JSON.stringify(visibleColumns),
                columnOrder: JSON.stringify(columnOrder),
                columnWidths: JSON.stringify(columnWidths),
                adminVersion: adminVersion ? new Date(adminVersion) : null,
            },
        });

        return { success: true, data: { updated: true } };
    });

/**
 * Delete user's grid preferences (reset to defaults)
 */
export const deleteUserPreferences = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getUserPreferencesSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<{ deleted: boolean }>> => {
        const prisma = await getPrisma();
        const { gridId } = data;
        const userId = context.user.id;

        try {
            await prisma.userGridPreference.delete({
                where: { userId_gridId: { userId, gridId } },
            });
            return { success: true, data: { deleted: true } };
        } catch {
            // No preference existed
            return { success: true, data: { deleted: false } };
        }
    });

// ============================================
// ADMIN GRID PREFERENCES SERVER FUNCTIONS
// ============================================

const updateAdminGridPreferencesSchema = z.object({
    gridId: z.string().min(1, 'Grid ID is required'),
    visibleColumns: z.array(z.string()),
    columnOrder: z.array(z.string()),
    columnWidths: z.record(z.string(), z.number()).optional(),
});

export interface AdminGridPreferences {
    visibleColumns: string[];
    columnOrder: string[];
    columnWidths: Record<string, number>;
    updatedAt: string | null;
}

/**
 * Get admin default grid preferences for all users
 */
export const getAdminGridPreferences = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getUserPreferencesSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<AdminGridPreferences | null>> => {
        const prisma = await getPrisma();
        const { gridId } = data;

        const setting = await prisma.systemSetting.findUnique({
            where: { key: `grid_prefs_${gridId}` },
        });

        if (!setting?.value) {
            return { success: true, data: null };
        }

        try {
            const prefs = JSON.parse(setting.value) as AdminGridPreferences;
            return {
                success: true,
                data: {
                    visibleColumns: prefs.visibleColumns || [],
                    columnOrder: prefs.columnOrder || [],
                    columnWidths: prefs.columnWidths || {},
                    updatedAt: prefs.updatedAt || setting.updatedAt?.toISOString() || null,
                },
            };
        } catch {
            return { success: true, data: null };
        }
    });

/**
 * Save admin default grid preferences for all users
 * Requires admin role
 */
export const updateAdminGridPreferences = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateAdminGridPreferencesSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<AdminGridPreferences>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();
        const { gridId, visibleColumns, columnOrder, columnWidths } = data;
        const now = new Date().toISOString();

        const prefs: AdminGridPreferences = {
            visibleColumns,
            columnOrder,
            columnWidths: columnWidths || {},
            updatedAt: now,
        };

        await prisma.systemSetting.upsert({
            where: { key: `grid_prefs_${gridId}` },
            update: { value: JSON.stringify(prefs) },
            create: { key: `grid_prefs_${gridId}`, value: JSON.stringify(prefs) },
        });

        return { success: true, data: prefs };
    });

// ============================================
// SERVER LOGS SERVER FUNCTIONS
// ============================================

/**
 * Get server logs with filtering
 * Uses the Express backend API since logs are stored on the server
 */
export const getServerLogs = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getServerLogsSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<LogsResult>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { level, limit, offset, search } = data;

        // Call the Express backend API for logs
        const baseUrl = process.env.VITE_API_URL || 'http://localhost:3001';
        const params = new URLSearchParams();
        params.set('level', level);
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        if (search) params.set('search', search);

        try {
            const response = await fetch(`${baseUrl}/api/admin/logs?${params.toString()}`, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch logs' },
                };
            }

            const result = await response.json() as LogsResult;
            return { success: true, data: result };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to log service' },
            };
        }
    });

// ============================================
// BACKGROUND JOBS SERVER FUNCTIONS
// ============================================

/**
 * Get all background jobs status
 * Uses the Express backend API since jobs are managed on the server
 */
export const getBackgroundJobs = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<BackgroundJob[]>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        // Call the Express backend API for background jobs
        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/background-jobs`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch background jobs' },
                };
            }

            const result = await response.json() as { jobs: BackgroundJob[] };
            return { success: true, data: result.jobs };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to job service' },
            };
        }
    });

/**
 * Get sheet offload worker status including buffer counts
 * Wraps GET /api/admin/sheet-offload/status
 */
export const getSheetOffloadStatus = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<Record<string, JsonValue>>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/sheet-offload/status`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch sheet offload status' },
                };
            }

            const result = await response.json() as Record<string, JsonValue>;
            return { success: true, data: result };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to sheet offload service' },
            };
        }
    });

/**
 * Start/trigger a background job
 * Requires admin role
 */
export const startBackgroundJob = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => startBackgroundJobSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<{ triggered: boolean; result?: JsonValue }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { jobId } = data;

        // Call the Express backend API to trigger the job
        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/background-jobs/${jobId}/trigger`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as { error?: string };
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: errorData.error || 'Failed to trigger job' },
                };
            }

            const result = await response.json() as { result?: JsonValue };
            return { success: true, data: { triggered: true, result: result.result } };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to job service' },
            };
        }
    });

/**
 * Cancel/disable a background job
 * Requires admin role
 * Note: This updates the job settings, not actually cancels a running job
 */
export const cancelBackgroundJob = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => cancelBackgroundJobSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<{ cancelled: boolean }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { jobId } = data;

        // Call the Express backend API to update job settings (disable)
        const baseUrl = process.env.VITE_API_URL || 'http://localhost:3001';

        try {
            const response = await fetch(`${baseUrl}/api/admin/background-jobs/${jobId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ enabled: false }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as { error?: string };
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: errorData.error || 'Failed to cancel job' },
                };
            }

            return { success: true, data: { cancelled: true } };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to job service' },
            };
        }
    });

/**
 * Update background job enabled state
 * Requires admin role
 */
export const updateBackgroundJob = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateBackgroundJobSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<{ updated: boolean }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { jobId, enabled } = data;

        // Call the Express backend API to update job settings
        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/background-jobs/${jobId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
                body: JSON.stringify({ enabled }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as { error?: string };
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: errorData.error || 'Failed to update job' },
                };
            }

            return { success: true, data: { updated: true } };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to job service' },
            };
        }
    });

// ============================================
// WORKER RUN HISTORY SERVER FUNCTIONS
// ============================================

export interface WorkerRunEntry {
    id: string;
    workerName: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
    result: Record<string, JsonValue> | null;
    error: string | null;
    triggeredBy: string;
    createdAt: string;
}

export interface WorkerRunSummaryEntry {
    last24h: { total: number; succeeded: number; failed: number };
    avgDurationMs: number | null;
    lastRunAt: string | null;
    lastStatus: string | null;
}

const getWorkerRunHistorySchema = z.object({
    workerName: z.string().optional(),
    status: z.string().optional(),
    limit: z.number().int().positive().max(200).optional().default(50),
    offset: z.number().int().nonnegative().optional().default(0),
});

/**
 * Get worker run history
 */
export const getWorkerRunHistory = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getWorkerRunHistorySchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<{ runs: WorkerRunEntry[]; total: number }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        const params = new URLSearchParams();
        if (data.workerName) params.set('workerName', data.workerName);
        if (data.status) params.set('status', data.status);
        params.set('limit', String(data.limit));
        params.set('offset', String(data.offset));

        try {
            const response = await fetch(`${baseUrl}/api/admin/worker-runs?${params.toString()}`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch worker run history' },
                };
            }

            const result = await response.json() as { runs: WorkerRunEntry[]; total: number };
            return { success: true, data: result };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to worker run service' },
            };
        }
    });

/**
 * Get worker run summary (per-worker stats)
 */
export const getWorkerRunSummary = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<Record<string, WorkerRunSummaryEntry>>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/worker-runs/summary`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch worker run summary' },
                };
            }

            const result = await response.json() as Record<string, WorkerRunSummaryEntry>;
            return { success: true, data: result };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to worker run service' },
            };
        }
    });

// ============================================
// SHEETS MONITOR STATS SERVER FUNCTIONS
// ============================================

export interface SheetsMonitorStats {
    inventory: {
        totalSkus: number;
        totalBalance: number;
        inStock: number;
        outOfStock: number;
    };
    ingestion: {
        totalInwardLive: number;
        totalOutwardLive: number;
        historicalInward: number;
        historicalOutward: number;
    };
    recentTransactions: Array<{
        id: string;
        skuCode: string;
        txnType: string;
        quantity: number;
        reason: string | null;
        referenceId: string | null;
        createdAt: string;
    }>;
}

/**
 * Get sheets monitor stats (inventory, ingestion, recent transactions)
 * Requires admin role
 */
export const getSheetsMonitorStats = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<SheetsMonitorStats>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/sheet-monitor/stats`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch sheet monitor stats' },
                };
            }

            const result = await response.json() as SheetsMonitorStats;
            return { success: true, data: result };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to sheet monitor service' },
            };
        }
    });

// ============================================
// COST CONFIG SERVER FUNCTIONS
// ============================================

const updateCostConfigSchema = z.object({
    laborRatePerMin: z.number().nonnegative().optional(),
    defaultPackagingCost: z.number().nonnegative().optional(),
    gstThreshold: z.number().nonnegative().optional(),
    gstRateAbove: z.number().min(0).max(100).optional(),
    gstRateBelow: z.number().min(0).max(100).optional(),
});

export interface CostConfig {
    id: string;
    laborRatePerMin: number;
    defaultPackagingCost: number;
    gstThreshold: number;
    gstRateAbove: number;
    gstRateBelow: number;
    lastUpdated: string;
}

/**
 * Get cost configuration
 */
export const getCostConfig = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<CostConfig>> => {
        const prisma = await getPrisma();

        const config = await prisma.costConfig.findFirst();

        // Default values if no config exists
        const defaultConfig: CostConfig = {
            id: 'default',
            laborRatePerMin: 2.5,
            defaultPackagingCost: 50,
            gstThreshold: 2500,
            gstRateAbove: 18,
            gstRateBelow: 5,
            lastUpdated: new Date().toISOString(),
        };

        if (!config) {
            return { success: true, data: defaultConfig };
        }

        return {
            success: true,
            data: {
                id: config.id,
                laborRatePerMin: config.laborRatePerMin,
                defaultPackagingCost: config.defaultPackagingCost,
                gstThreshold: config.gstThreshold ?? 2500,
                gstRateAbove: config.gstRateAbove ?? 18,
                gstRateBelow: config.gstRateBelow ?? 5,
                lastUpdated: config.lastUpdated.toISOString(),
            },
        };
    });

/**
 * Update cost configuration
 * Requires admin role
 */
export const updateCostConfig = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateCostConfigSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<CostConfig>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();

        // Build update object from provided fields
        const updateData: Record<string, unknown> = {};
        if (data.laborRatePerMin !== undefined) updateData.laborRatePerMin = data.laborRatePerMin;
        if (data.defaultPackagingCost !== undefined) updateData.defaultPackagingCost = data.defaultPackagingCost;
        if (data.gstThreshold !== undefined) updateData.gstThreshold = data.gstThreshold;
        if (data.gstRateAbove !== undefined) updateData.gstRateAbove = data.gstRateAbove;
        if (data.gstRateBelow !== undefined) updateData.gstRateBelow = data.gstRateBelow;

        // Find existing config or create new
        const existingConfig = await prisma.costConfig.findFirst();

        let config;
        if (existingConfig) {
            config = await prisma.costConfig.update({
                where: { id: existingConfig.id },
                data: updateData,
            });
        } else {
            config = await prisma.costConfig.create({
                data: {
                    laborRatePerMin: data.laborRatePerMin ?? 2.5,
                    defaultPackagingCost: data.defaultPackagingCost ?? 50,
                    gstThreshold: data.gstThreshold ?? 2500,
                    gstRateAbove: data.gstRateAbove ?? 18,
                    gstRateBelow: data.gstRateBelow ?? 5,
                },
            });
        }

        return {
            success: true,
            data: {
                id: config.id,
                laborRatePerMin: config.laborRatePerMin,
                defaultPackagingCost: config.defaultPackagingCost,
                gstThreshold: config.gstThreshold ?? 2500,
                gstRateAbove: config.gstRateAbove ?? 18,
                gstRateBelow: config.gstRateBelow ?? 5,
                lastUpdated: config.lastUpdated.toISOString(),
            },
        };
    });

// ============================================
// SIDEBAR ORDER SERVER FUNCTIONS
// ============================================

const updateSidebarOrderSchema = z.object({
    order: z.array(z.string()),
});

/**
 * Get sidebar section order
 */
export const getSidebarOrder = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<string[] | null>> => {
        const prisma = await getPrisma();

        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'sidebar_order' },
        });

        if (!setting?.value) {
            return { success: true, data: null };
        }

        return { success: true, data: JSON.parse(setting.value) as string[] };
    });

/**
 * Update sidebar section order
 * Requires admin role
 */
export const updateSidebarOrder = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateSidebarOrderSchema.parse(input))
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
        const { order } = data;

        await prisma.systemSetting.upsert({
            where: { key: 'sidebar_order' },
            update: { value: JSON.stringify(order) },
            create: { key: 'sidebar_order', value: JSON.stringify(order) },
        });

        return { success: true, data: { updated: true } };
    });

// ============================================
// DATABASE STATS SERVER FUNCTIONS
// ============================================

export interface DatabaseStats {
    products: number;
    skus: number;
    orders: number;
    customers: number;
    fabrics: number;
    variations: number;
    inventoryTransactions: number;
}

/**
 * Get database statistics
 * Requires admin role
 */
export const getDatabaseStats = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<DatabaseStats>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();

        const [
            products,
            skus,
            orders,
            customers,
            fabrics,
            variations,
            inventoryTransactions,
        ] = await Promise.all([
            prisma.product.count(),
            prisma.sku.count(),
            prisma.order.count(),
            prisma.customer.count(),
            prisma.fabricColour.count(),
            prisma.variation.count(),
            prisma.inventoryTransaction.count(),
        ]);

        return {
            success: true,
            data: {
                products,
                skus,
                orders,
                customers,
                fabrics,
                variations,
                inventoryTransactions,
            },
        };
    });

// ============================================
// DATABASE CLEAR SERVER FUNCTIONS
// ============================================

const clearTablesSchema = z.object({
    tables: z.array(z.string()),
    confirmPhrase: z.string(),
});

export interface ClearTablesResult {
    deleted: Record<string, number>;
}

/**
 * Clear database tables (danger zone)
 * Requires admin role and confirmation phrase
 */
export const clearTables = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => clearTablesSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<ClearTablesResult>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { tables, confirmPhrase } = data;

        if (confirmPhrase !== 'DELETE ALL DATA') {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Invalid confirmation phrase' },
            };
        }

        const prisma = await getPrisma();
        const deleted: Record<string, number> = {};

        // Process tables in order to respect foreign key constraints
        if (tables.includes('all') || tables.includes('orders')) {
            // Delete order lines first (child table)
            const orderLinesResult = await prisma.orderLine.deleteMany();
            deleted.orderLines = orderLinesResult.count;

            const ordersResult = await prisma.order.deleteMany();
            deleted.orders = ordersResult.count;
        }

        if (tables.includes('all') || tables.includes('inventoryTransactions')) {
            const txnsResult = await prisma.inventoryTransaction.deleteMany();
            deleted.inventoryTransactions = txnsResult.count;
        }

        if (tables.includes('all') || tables.includes('customers')) {
            const customersResult = await prisma.customer.deleteMany();
            deleted.customers = customersResult.count;
        }

        if (tables.includes('all') || tables.includes('products')) {
            // Delete in order: SKU BOM → SKU → Variation → Product
            const skuBomResult = await prisma.skuBomLine.deleteMany();
            deleted.skuBom = skuBomResult.count;

            const skusResult = await prisma.sku.deleteMany();
            deleted.skus = skusResult.count;

            const variationsResult = await prisma.variation.deleteMany();
            deleted.variations = variationsResult.count;

            const productsResult = await prisma.product.deleteMany();
            deleted.products = productsResult.count;
        }

        if (tables.includes('all') || tables.includes('fabrics')) {
            // Delete in order: FabricColour → Fabric → Material
            const coloursResult = await prisma.fabricColour.deleteMany();
            deleted.fabricColours = coloursResult.count;

            const fabricsResult = await prisma.fabric.deleteMany();
            deleted.fabrics = fabricsResult.count;

            const materialsResult = await prisma.material.deleteMany();
            deleted.materials = materialsResult.count;
        }

        return { success: true, data: { deleted } };
    });

// ============================================
// LOG STATS SERVER FUNCTIONS
// ============================================

export interface LogStats {
    total: number;
    maxSize: number;
    byLevel: { error: number; warn: number; info: number; debug: number };
    lastHour: { total: number; byLevel: { error: number; warn: number } };
    last24Hours: { total: number; byLevel: { error: number; warn: number } };
    isPersistent: boolean;
    retentionHours: number;
    fileSizeKB?: number;
    fileSizeMB?: number;
    oldestLog?: string;
    newestLog?: string;
    nextCleanup?: string;
}

/**
 * Get log statistics
 * Requires admin role
 */
export const getLogStats = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<LogStats>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        // Call the Express backend API for log stats
        const baseUrl = process.env.VITE_API_URL || 'http://localhost:3001';

        try {
            const response = await fetch(`${baseUrl}/api/admin/logs/stats`, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch log stats' },
                };
            }

            const result = await response.json() as LogStats;
            return { success: true, data: result };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to log service' },
            };
        }
    });

/**
 * Clear all server logs
 * Requires admin role
 */
export const clearLogs = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<{ cleared: boolean }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        // Call the Express backend API to clear logs
        const baseUrl = process.env.VITE_API_URL || 'http://localhost:3001';

        try {
            const response = await fetch(`${baseUrl}/api/admin/logs`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to clear logs' },
                };
            }

            return { success: true, data: { cleared: true } };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to log service' },
            };
        }
    });

// ============================================
// DATABASE INSPECTOR SERVER FUNCTIONS
// ============================================

export interface TableInfo {
    name: string;
    displayName: string;
    count: number;
}

export interface InspectResult {
    data: Record<string, JsonValue>[];
    total: number;
    table: string;
}

const inspectTableSchema = z.object({
    tableName: z.string().min(1, 'Table name is required'),
    limit: z.number().int().positive().max(2000).optional().default(100),
    offset: z.number().int().nonnegative().optional().default(0),
});

/**
 * Get all database tables with counts
 * Requires admin role
 */
export const getTables = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<{ tables: TableInfo[] }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();

        // Define table name mappings (Prisma model name to display name)
        const tableConfigs: { model: string; displayName: string }[] = [
            { model: 'order', displayName: 'Order' },
            { model: 'orderLine', displayName: 'Order Line' },
            { model: 'customer', displayName: 'Customer' },
            { model: 'product', displayName: 'Product' },
            { model: 'variation', displayName: 'Variation' },
            { model: 'sku', displayName: 'SKU' },
            { model: 'material', displayName: 'Material' },
            { model: 'fabric', displayName: 'Fabric' },
            { model: 'fabricColour', displayName: 'Fabric Colour' },
            { model: 'inventoryTransaction', displayName: 'Inventory Transaction' },
            { model: 'shopifyOrderCache', displayName: 'Shopify Order Cache' },
            { model: 'shopifyProductCache', displayName: 'Shopify Product Cache' },
            { model: 'user', displayName: 'User' },
            { model: 'role', displayName: 'Role' },
            { model: 'systemSetting', displayName: 'System Setting' },
            { model: 'returnRequest', displayName: 'Return Request' },
            { model: 'trim', displayName: 'Trim' },
            { model: 'externalService', displayName: 'External Service' },
            { model: 'supplier', displayName: 'Supplier' },
        ];

        const tables: TableInfo[] = [];

        // Dynamic model access — Prisma Client doesn't expose a string-indexed type
        const prismaModels = prisma as unknown as Record<string, { count?: () => Promise<number> }>;

        for (const config of tableConfigs) {
            try {
                const count = await prismaModels[config.model]?.count?.() ?? 0;
                tables.push({
                    name: config.model,
                    displayName: config.displayName,
                    count,
                });
            } catch {
                // Skip tables that don't exist or have errors
                tables.push({
                    name: config.model,
                    displayName: config.displayName,
                    count: 0,
                });
            }
        }

        // Sort by count descending
        tables.sort((a, b) => b.count - a.count);

        return { success: true, data: { tables } };
    });

/**
 * Inspect a database table
 * Requires admin role
 */
export const inspectTable = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => inspectTableSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<InspectResult>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();
        const { tableName, limit, offset } = data;

        // Dynamic model access — Prisma Client doesn't expose a string-indexed type
        type DynamicModel = {
            findMany: (args: Record<string, unknown>) => Promise<Record<string, JsonValue>[]>;
            count: () => Promise<number>;
        };
        const prismaModels = prisma as unknown as Record<string, DynamicModel | undefined>;

        try {
            const model = prismaModels[tableName];

            if (!model || typeof model.findMany !== 'function') {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: `Table '${tableName}' not found` },
                };
            }

            const [rows, total] = await Promise.all([
                model.findMany({
                    take: limit,
                    skip: offset,
                    orderBy: { createdAt: 'desc' },
                }),
                model.count(),
            ]);

            return {
                success: true,
                data: {
                    data: rows,
                    total,
                    table: tableName,
                },
            };
        } catch (err) {
            // Try without ordering if createdAt doesn't exist
            try {
                const model = prismaModels[tableName]!;
                const [rows, total] = await Promise.all([
                    model.findMany({
                        take: limit,
                        skip: offset,
                    }),
                    model.count(),
                ]);

                return {
                    success: true,
                    data: {
                        data: rows,
                        total,
                        table: tableName,
                    },
                };
            } catch {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: `Failed to query table '${tableName}'` },
                };
            }
        }
    });

// ============================================
// USER PERMISSIONS SERVER FUNCTIONS
// ============================================

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

export interface UserPermissionsData {
    userId: string;
    roleId: string | null;
    roleName: string | null;
    rolePermissions: string[];
    overrides: Array<{ permission: string; granted: boolean }>;
}

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
