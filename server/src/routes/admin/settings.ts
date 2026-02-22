import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { ValidationError } from '../../utils/errors.js';
import { DEFAULT_TIER_THRESHOLDS, updateAllCustomerTiers } from '../../utils/tierUtils.js';
import { chunkProcess } from '../../utils/asyncUtils.js';
import type {
    Channel,
    TierThresholds,
    ClearTablesBody,
    ChannelsUpdateBody,
    TierThresholdsUpdateBody,
    DeleteOperation,
} from './types.js';

const router = Router();

/**
 * Get database entity counts for dashboard
 * @route GET /api/admin/stats
 * @returns {Object} { products, variations, skus, orders, customers, fabrics, inventoryTransactions }
 */
router.get('/stats', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const [
        productCount,
        variationCount,
        skuCount,
        orderCount,
        customerCount,
        fabricCount,
        inventoryTxnCount,
    ] = await Promise.all([
        req.prisma.product.count(),
        req.prisma.variation.count(),
        req.prisma.sku.count(),
        req.prisma.order.count(),
        req.prisma.customer.count(),
        req.prisma.fabric.count(),
        req.prisma.inventoryTransaction.count(),
    ]);

    res.json({
        products: productCount,
        variations: variationCount,
        skus: skuCount,
        orders: orderCount,
        customers: customerCount,
        fabrics: fabricCount,
        inventoryTransactions: inventoryTxnCount,
    });
}));

/**
 * Bulk delete data from specified tables (requires 'DELETE ALL DATA' phrase)
 * @route POST /api/admin/clear
 * @param {string[]} body.tables - Table names to clear (or ['all'])
 * @param {string} body.confirmPhrase - Must be exactly 'DELETE ALL DATA'
 * @returns {Object} { message, deleted: { tableName: count } }
 * @description Respects FK constraints (deletes children first). Uses transaction for atomicity.
 */
router.post('/clear', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { tables, confirmPhrase } = req.body as ClearTablesBody;

    // Require confirmation phrase
    if (confirmPhrase !== 'DELETE ALL DATA') {
        throw new ValidationError('Invalid confirmation phrase');
    }

    if (!tables || !Array.isArray(tables) || tables.length === 0) {
        throw new ValidationError('No tables specified');
    }

    const results: Record<string, number | string> = {};

    // Use a transaction for PostgreSQL to ensure all deletes succeed or none do
    await req.prisma.$transaction(async (prisma) => {
        // Clear in correct order to respect foreign key constraints
        const deleteOperations: DeleteOperation[] = [
            // Order-related (references customers, SKUs)
            { name: 'orderLines', model: prisma.orderLine },
            { name: 'orders', model: prisma.order },
            // Production (references SKUs)
            { name: 'productionBatches', model: prisma.productionBatch },
            // Inventory (references SKUs)
            { name: 'inventoryTransactions', model: prisma.inventoryTransaction },
            { name: 'shopifyInventoryCache', model: prisma.shopifyInventoryCache },
            // Feedback (references SKUs, products, variations)
            { name: 'feedbackProductLinks', model: prisma.feedbackProductLink },
            { name: 'feedbackMedia', model: prisma.feedbackMedia },
            { name: 'feedbackTags', model: prisma.feedbackTag },
            { name: 'feedbackContents', model: prisma.feedbackContent },
            { name: 'feedbackRatings', model: prisma.feedbackRating },
            { name: 'feedback', model: prisma.feedback },
            // SKU related
            { name: 'skus', model: prisma.sku },
            // Variations and Products
            { name: 'variations', model: prisma.variation },
            { name: 'products', model: prisma.product },
            // Customers
            { name: 'customers', model: prisma.customer },
            // Fabric related
            // NOTE: fabricTransaction and fabricType removed - using FabricColour hierarchy now
            { name: 'fabricOrders', model: prisma.fabricOrder },
            { name: 'fabrics', model: prisma.fabric },
            // Other
            { name: 'costConfigs', model: prisma.costConfig },
            { name: 'tailors', model: prisma.tailor },
            { name: 'parties', model: prisma.party },
        ];

        for (const { name, model } of deleteOperations) {
            if (tables.includes(name) || tables.includes('all')) {
                try {
                    const count = await model.count();
                    await model.deleteMany();
                    results[name] = count;
                } catch (tableError) {
                    const errorMessage = tableError instanceof Error ? tableError.message : String(tableError);
                    console.error(`Error deleting ${name}:`, errorMessage);
                    results[name] = `Error: ${errorMessage}`;
                }
            }
        }
    }, {
        timeout: 60000, // 60 second timeout for large deletes
    });

    res.json({
        message: 'Database cleared',
        deleted: results,
    });
}));

// Get order channels
router.get('/channels', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
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

    const channels = setting?.value ? JSON.parse(setting.value) as Channel[] : defaultChannels;
    res.json(channels);
}));

// Update order channels
router.put('/channels', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
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
router.get('/sidebar-order', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const setting = await req.prisma.systemSetting.findUnique({
        where: { key: 'sidebar_section_order' }
    });

    // Return null if not configured (frontend will use default)
    const order = setting?.value ? JSON.parse(setting.value) as string[] : null;
    res.json(order);
}));

// Update sidebar section order (admin only)
router.put('/sidebar-order', authenticateToken, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
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
router.get('/tier-thresholds', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const setting = await req.prisma.systemSetting.findUnique({
        where: { key: 'tier_thresholds' }
    });

    const thresholds = setting?.value ? JSON.parse(setting.value) as TierThresholds : DEFAULT_TIER_THRESHOLDS;
    res.json(thresholds);
}));

// Update tier thresholds
router.put('/tier-thresholds', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
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
router.post('/update-customer-tiers', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const result = await updateAllCustomerTiers(req.prisma);

    res.json({
        message: `Updated ${result.updated} of ${result.total} customer tiers`,
        ...result
    });
}));

// Reset and reseed database (Admin only)
router.post('/reseed', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
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
