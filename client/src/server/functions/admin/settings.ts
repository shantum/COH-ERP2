'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import { type MutationResult, type Channel, type TierThresholds, requireAdminRole } from './types';

// ============================================
// INPUT SCHEMAS
// ============================================

const updateChannelsSchema = z.object({
    channels: z.array(z.object({
        id: z.string().min(1, 'Channel ID is required'),
        name: z.string().min(1, 'Channel name is required'),
    })),
});

const updateTierThresholdsSchema = z.object({
    platinum: z.number().positive('Platinum threshold must be positive'),
    gold: z.number().positive('Gold threshold must be positive'),
    silver: z.number().positive('Silver threshold must be positive'),
});

const updateCostConfigSchema = z.object({
    laborRatePerMin: z.number().nonnegative().optional(),
    defaultPackagingCost: z.number().nonnegative().optional(),
    gstThreshold: z.number().nonnegative().optional(),
    gstRateAbove: z.number().min(0).max(100).optional(),
    gstRateBelow: z.number().min(0).max(100).optional(),
});

const updateSidebarOrderSchema = z.object({
    order: z.array(z.string()),
});

// ============================================
// INTERFACES
// ============================================

export interface CostConfig {
    id: string;
    laborRatePerMin: number;
    defaultPackagingCost: number;
    gstThreshold: number;
    gstRateAbove: number;
    gstRateBelow: number;
    lastUpdated: string;
}

// ============================================
// CONSTANTS
// ============================================

const DEFAULT_TIER_THRESHOLDS: TierThresholds = {
    platinum: 50000,
    gold: 25000,
    silver: 10000,
};

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

        let channels: Channel[];
        try {
            channels = setting?.value ? (JSON.parse(setting.value) as Channel[]) : defaultChannels;
        } catch {
            channels = defaultChannels;
        }

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
            requireAdminRole(context.user.role, context.permissions);
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

        let thresholds: TierThresholds;
        try {
            thresholds = setting?.value ? (JSON.parse(setting.value) as TierThresholds) : DEFAULT_TIER_THRESHOLDS;
        } catch {
            thresholds = DEFAULT_TIER_THRESHOLDS;
        }

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
            requireAdminRole(context.user.role, context.permissions);
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
// COST CONFIG SERVER FUNCTIONS
// ============================================

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
            requireAdminRole(context.user.role, context.permissions);
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

        try {
            return { success: true, data: JSON.parse(setting.value) as string[] };
        } catch {
            return { success: true, data: null };
        }
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
            requireAdminRole(context.user.role, context.permissions);
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
