import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { ValidationError } from '../../utils/errors.js';
import { DEFAULT_TIER_THRESHOLDS, recalculateAllCustomerLtvs } from '../../utils/tierUtils.js';
import type {
    Channel,
    TierThresholds,
    ChannelsUpdateBody,
    TierThresholdsUpdateBody,
} from './types.js';

const router = Router();

// NOTE: /stats and /clear endpoints removed — consolidated into server functions
// at client/src/server/functions/admin/database.ts

// Get order channels
router.get('/channels', asyncHandler(async (req: Request, res: Response) => {
    const setting = await req.prisma.systemSetting.findUnique({
        where: { key: 'order_channels' }
    });

    // Default channels if not configured
    const defaultChannels: Channel[] = [
        { id: 'offline', name: 'Offline' },
        { id: 'shopify', name: 'Shopify' },
        { id: 'nykaa', name: 'Nykaa' },
        { id: 'ajio', name: 'Ajio' },
        { id: 'myntra', name: 'Myntra' },
    ];

    let channels: Channel[];
    try {
        channels = setting?.value ? JSON.parse(setting.value) as Channel[] : defaultChannels;
    } catch {
        channels = defaultChannels;
    }
    res.json(channels);
}));

// Update order channels
router.put('/channels', asyncHandler(async (req: Request, res: Response) => {
    const { channels } = req.body as ChannelsUpdateBody;

    if (!Array.isArray(channels)) {
        throw new ValidationError('Channels must be an array');
    }

    // Validate channel format
    for (const channel of channels) {
        if (!channel.id || !channel.name) {
            throw new ValidationError('Each channel must have id and name');
        }
    }

    await req.prisma.systemSetting.upsert({
        where: { key: 'order_channels' },
        update: { value: JSON.stringify(channels) },
        create: { key: 'order_channels', value: JSON.stringify(channels) }
    });

    res.json({ success: true, channels });
}));

// Get sidebar section order
router.get('/sidebar-order', asyncHandler(async (req: Request, res: Response) => {
    const setting = await req.prisma.systemSetting.findUnique({
        where: { key: 'sidebar_section_order' }
    });

    // Return null if not configured (frontend will use default)
    let order: string[] | null;
    try {
        order = setting?.value ? JSON.parse(setting.value) as string[] : null;
    } catch {
        order = null;
    }
    res.json(order);
}));

// Update sidebar section order (admin only)
router.put('/sidebar-order', asyncHandler(async (req: Request, res: Response) => {
    const { order } = req.body as { order: string[] };

    if (!Array.isArray(order)) {
        throw new ValidationError('Order must be an array of section labels');
    }

    // Validate all items are strings
    for (const label of order) {
        if (typeof label !== 'string') {
            throw new ValidationError('Each item in order must be a string');
        }
    }

    await req.prisma.systemSetting.upsert({
        where: { key: 'sidebar_section_order' },
        update: { value: JSON.stringify(order) },
        create: { key: 'sidebar_section_order', value: JSON.stringify(order) }
    });

    res.json({ success: true, order });
}));

// Get tier thresholds
router.get('/tier-thresholds', asyncHandler(async (req: Request, res: Response) => {
    const setting = await req.prisma.systemSetting.findUnique({
        where: { key: 'tier_thresholds' }
    });

    let thresholds: TierThresholds;
    try {
        thresholds = setting?.value ? JSON.parse(setting.value) as TierThresholds : DEFAULT_TIER_THRESHOLDS;
    } catch {
        thresholds = DEFAULT_TIER_THRESHOLDS;
    }
    res.json(thresholds);
}));

// Update tier thresholds
router.put('/tier-thresholds', asyncHandler(async (req: Request, res: Response) => {
    const { platinum, gold, silver } = req.body as TierThresholdsUpdateBody;

    // Validate thresholds
    if (typeof platinum !== 'number' || typeof gold !== 'number' || typeof silver !== 'number') {
        throw new ValidationError('All thresholds must be numbers');
    }

    if (platinum <= gold || gold <= silver || silver <= 0) {
        throw new ValidationError('Thresholds must be: platinum > gold > silver > 0');
    }

    const thresholds: TierThresholds = { platinum, gold, silver };

    await req.prisma.systemSetting.upsert({
        where: { key: 'tier_thresholds' },
        update: { value: JSON.stringify(thresholds) },
        create: { key: 'tier_thresholds', value: JSON.stringify(thresholds) }
    });

    res.json({ success: true, thresholds });
}));

/**
 * Batch update all customer tiers based on LTV
 * @route POST /api/admin/update-customer-tiers
 * @returns {Object} { total, updated, upgrades: [{ customerId, oldTier, newTier, ltv }] }
 * @description Recalculates tier for all customers. Use after threshold changes or data migration.
 */
router.post('/update-customer-tiers', asyncHandler(async (req: Request, res: Response) => {
    const result = await recalculateAllCustomerLtvs(req.prisma);

    res.json({
        message: `Updated ${result.updated} of ${result.total} customer tiers`,
        ...result
    });
}));

// Reset and reseed database (Admin only)
router.post('/reseed', asyncHandler(async (req: Request, res: Response) => {
    const { confirmPhrase } = req.body as { confirmPhrase: string };

    if (confirmPhrase !== 'RESEED DATABASE') {
        throw new ValidationError('Invalid confirmation phrase');
    }

    // This would typically call your seed script
    // For now, just return instructions
    res.json({
        message: 'To reseed the database, run: npm run db:seed in the server directory',
        note: 'Automatic reseeding from API is disabled for safety',
    });
}));

export default router;
