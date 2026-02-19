'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import { type MutationResult, type UserPreferences, requireAdminRole } from './types';

// ============================================
// INPUT SCHEMAS
// ============================================

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

const updateAdminGridPreferencesSchema = z.object({
    gridId: z.string().min(1, 'Grid ID is required'),
    visibleColumns: z.array(z.string()),
    columnOrder: z.array(z.string()),
    columnWidths: z.record(z.string(), z.number()).optional(),
});

// ============================================
// INTERFACES
// ============================================

export interface AdminGridPreferences {
    visibleColumns: string[];
    columnOrder: string[];
    columnWidths: Record<string, number>;
    updatedAt: string | null;
}

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

        try {
            return {
                success: true,
                data: {
                    visibleColumns: JSON.parse(userPref.visibleColumns),
                    columnOrder: JSON.parse(userPref.columnOrder),
                    columnWidths: JSON.parse(userPref.columnWidths),
                    adminVersion: userPref.adminVersion?.toISOString() ?? null,
                },
            };
        } catch {
            // Corrupted preference data — return null to use defaults
            return { success: true, data: null };
        }
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
