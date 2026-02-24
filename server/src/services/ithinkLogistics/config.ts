/**
 * iThink Logistics — Config management (load/update/check credentials)
 */

import prisma from '../../lib/prisma.js';
import { shippingLogger } from '../../utils/logger.js';
import type { IThinkConfig, ConfigStatus, ClientContext } from './types.js';

/**
 * Load credentials — prefers env vars, falls back to database
 */
export async function loadFromDatabase(ctx: ClientContext): Promise<void> {
    // If env vars are fully configured, skip database
    if (ctx.accessToken && ctx.secretKey) {
        shippingLogger.debug('Using iThink credentials from environment variables');
        return;
    }

    // Fall back to database only if env vars not set
    try {
        const settings = await prisma.systemSetting.findMany({
            where: {
                key: {
                    in: [
                        'ithink_access_token',
                        'ithink_secret_key',
                        'ithink_pickup_address_id',
                        'ithink_return_address_id',
                        'ithink_default_logistics'
                    ]
                }
            }
        });

        let loadedFromDb = false;
        for (const setting of settings) {
            if (setting.key === 'ithink_access_token' && !ctx.accessToken) {
                ctx.accessToken = setting.value;
                loadedFromDb = true;
            } else if (setting.key === 'ithink_secret_key' && !ctx.secretKey) {
                ctx.secretKey = setting.value;
                loadedFromDb = true;
            } else if (setting.key === 'ithink_pickup_address_id' && !ctx.pickupAddressId) {
                ctx.pickupAddressId = setting.value;
            } else if (setting.key === 'ithink_return_address_id' && !ctx.returnAddressId) {
                ctx.returnAddressId = setting.value;
            } else if (setting.key === 'ithink_default_logistics') {
                ctx.defaultLogistics = setting.value;
            }
        }

        if (loadedFromDb) {
            shippingLogger.warn('Using iThink credentials from database. Consider moving to environment variables.');
        }
    } catch (error: unknown) {
        shippingLogger.error({ error: (error instanceof Error ? error.message : String(error)) }, 'Error loading iThink Logistics config');
    }
}

/**
 * Update credentials in database
 * Note: For production, credentials should be set via environment variables
 */
export async function updateConfig(ctx: ClientContext, config: IThinkConfig): Promise<void> {
    // Warn if trying to update while env vars are set
    if (process.env.ITHINK_ACCESS_TOKEN) {
        shippingLogger.warn('iThink credentials are set via environment variables. Database update will be ignored on restart.');
    }

    const { accessToken, secretKey, pickupAddressId, returnAddressId, defaultLogistics } = config;

    const updates = [];

    if (accessToken !== undefined) {
        updates.push(prisma.systemSetting.upsert({
            where: { key: 'ithink_access_token' },
            update: { value: accessToken },
            create: { key: 'ithink_access_token', value: accessToken }
        }));
        ctx.accessToken = accessToken;
    }

    if (secretKey !== undefined) {
        updates.push(prisma.systemSetting.upsert({
            where: { key: 'ithink_secret_key' },
            update: { value: secretKey },
            create: { key: 'ithink_secret_key', value: secretKey }
        }));
        ctx.secretKey = secretKey;
    }

    if (pickupAddressId !== undefined) {
        updates.push(prisma.systemSetting.upsert({
            where: { key: 'ithink_pickup_address_id' },
            update: { value: pickupAddressId },
            create: { key: 'ithink_pickup_address_id', value: pickupAddressId }
        }));
        ctx.pickupAddressId = pickupAddressId;
    }

    if (returnAddressId !== undefined) {
        updates.push(prisma.systemSetting.upsert({
            where: { key: 'ithink_return_address_id' },
            update: { value: returnAddressId },
            create: { key: 'ithink_return_address_id', value: returnAddressId }
        }));
        ctx.returnAddressId = returnAddressId;
    }

    if (defaultLogistics !== undefined) {
        updates.push(prisma.systemSetting.upsert({
            where: { key: 'ithink_default_logistics' },
            update: { value: defaultLogistics },
            create: { key: 'ithink_default_logistics', value: defaultLogistics }
        }));
        ctx.defaultLogistics = defaultLogistics;
    }

    if (updates.length > 0) {
        await prisma.$transaction(updates);
    }
}

export function isConfigured(ctx: ClientContext): boolean {
    return !!(ctx.accessToken && ctx.secretKey);
}

export function isFullyConfigured(ctx: ClientContext): boolean {
    return !!(ctx.accessToken && ctx.secretKey && ctx.pickupAddressId && ctx.returnAddressId);
}

export function getConfig(ctx: ClientContext): ConfigStatus {
    return {
        hasCredentials: isConfigured(ctx),
        hasWarehouseConfig: !!(ctx.pickupAddressId && ctx.returnAddressId),
        pickupAddressId: ctx.pickupAddressId,
        returnAddressId: ctx.returnAddressId,
        defaultLogistics: ctx.defaultLogistics,
    };
}
