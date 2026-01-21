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

interface PrismaGlobal {
    prisma: ReturnType<typeof createPrismaClient>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaClientType = any;

function createPrismaClient(): PrismaClientType {
    return null;
}

async function getPrisma(): Promise<PrismaClientType> {
    const { PrismaClient } = await import('@prisma/client');
    const globalForPrisma = globalThis as unknown as PrismaGlobal;
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
