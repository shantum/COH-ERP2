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
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// Type for bcrypt module (dynamic import)
interface BcryptModule {
    compare(data: string, encrypted: string): Promise<boolean>;
    hash(data: string, saltOrRounds: number): Promise<string>;
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
    jobId: z.enum(['shopify_sync', 'tracking_sync', 'cache_cleanup']),
});

const cancelBackgroundJobSchema = z.object({
    jobId: z.enum(['shopify_sync', 'tracking_sync', 'cache_cleanup']),
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

export interface LogEntry {
    timestamp: string;
    level: string;
    message: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meta?: Record<string, any>;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lastResult?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config?: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stats?: any;
    note?: string;
}

// ============================================
// PRISMA HELPER
// ============================================

async function getPrisma() {
    const { PrismaClient } = await import('@prisma/client');
    const globalForPrisma = globalThis as unknown as {
        prisma: InstanceType<typeof PrismaClient> | undefined;
    };
    const prisma = globalForPrisma.prisma ?? new PrismaClient();
    if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.prisma = prisma;
    }
    return prisma;
}

// ============================================
// ADMIN CHECK HELPER
// ============================================

function requireAdminRole(userRole: string): void {
    if (userRole !== 'admin') {
        throw new Error('Admin access required');
    }
}

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
        }));

        return { success: true, data: usersWithRoleName };
    });

/**
 * Create a new user
 * Requires admin role
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

        const prisma = await getPrisma();
        // @ts-expect-error - bcryptjs is available on server via dynamic import
        const bcrypt = (await import('bcryptjs')) as unknown as BcryptModule;

        const { email, password, name, roleId } = data;

        // Check if email already exists
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return {
                success: false,
                error: { code: 'CONFLICT', message: 'Email already in use' },
            };
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

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                role: 'staff',
                roleId: roleId || null,
            },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                roleId: true,
                isActive: true,
                createdAt: true,
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
            },
        };
    });

/**
 * Update a user
 * Requires admin role
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

        const prisma = await getPrisma();
        // @ts-expect-error - bcryptjs is available on server via dynamic import
        const bcrypt = (await import('bcryptjs')) as unknown as BcryptModule;

        const { userId, email, name, isActive, password, roleId } = data;

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
        if (roleId !== undefined) {
            updateData.roleId = roleId;
            updateData.tokenVersion = { increment: 1 }; // Force re-login
        }
        if (password) {
            updateData.password = await bcrypt.hash(password, 10);
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
        const baseUrl = process.env.VITE_API_URL || 'http://localhost:3001';

        try {
            const response = await fetch(`${baseUrl}/api/admin/background-jobs`, {
                headers: {
                    'Content-Type': 'application/json',
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
 * Start/trigger a background job
 * Requires admin role
 */
export const startBackgroundJob = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => startBackgroundJobSchema.parse(input))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .handler(async ({ data, context }): Promise<MutationResult<{ triggered: boolean; result?: any }>> => {
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
        const baseUrl = process.env.VITE_API_URL || 'http://localhost:3001';

        try {
            const response = await fetch(`${baseUrl}/api/admin/background-jobs/${jobId}/trigger`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as { error?: string };
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: errorData.error || 'Failed to trigger job' },
                };
            }

            const result = await response.json() as { result?: unknown };
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
        const baseUrl = process.env.VITE_API_URL || 'http://localhost:3001';

        try {
            const response = await fetch(`${baseUrl}/api/admin/background-jobs/${jobId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any[];
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

        for (const config of tableConfigs) {
            try {
                // Use Prisma's count method for each model
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const count = await (prisma as any)[config.model]?.count?.() ?? 0;
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

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const model = (prisma as any)[tableName];

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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const model = (prisma as any)[tableName];
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
        const rolesWithStringDates = roles.map((role) => ({
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
