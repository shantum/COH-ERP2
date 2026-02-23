/**
 * Shopify Inventory Management Routes
 *
 * Endpoints for managing Shopify inventory levels.
 * Used for syncing ERP stock to Shopify.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../../middleware/auth.js';
import shopifyClient from '../../services/shopify.js';
import { shopifyLogger } from '../../utils/logger.js';

const router = Router();

// ============================================
// SCHEMAS
// ============================================

const SetInventorySchema = z.object({
    sku: z.string().min(1, 'SKU is required'),
    locationId: z.string().min(1, 'Location ID is required'),
    quantity: z.number().int().min(0, 'Quantity must be non-negative'),
});

const ZeroOutSkusSchema = z.object({
    skus: z.array(z.string().min(1)).min(1, 'At least one SKU is required'),
    locationId: z.string().min(1, 'Location ID is required'),
});

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/shopify/inventory/locations
 * Get all Shopify inventory locations
 */
router.get('/locations', authenticateToken, async (_req: Request, res: Response): Promise<void> => {
    try {
        if (!shopifyClient.isConfigured()) {
            res.status(400).json({ error: 'Shopify is not configured' });
            return;
        }

        const locations = await shopifyClient.getLocations();
        res.json({ locations });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        shopifyLogger.error({ error: message }, 'Failed to get locations');
        res.status(500).json({ error: message });
    }
});

/**
 * GET /api/shopify/inventory/item/:sku
 * Get inventory item info by SKU
 */
router.get('/item/:sku', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    try {
        if (!shopifyClient.isConfigured()) {
            res.status(400).json({ error: 'Shopify is not configured' });
            return;
        }

        const sku = req.params.sku as string;
        const item = await shopifyClient.getInventoryItemBySku(sku);

        if (!item) {
            res.status(404).json({ error: `SKU not found: ${sku}` });
            return;
        }

        res.json({ item });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        shopifyLogger.error({ error: message }, 'Failed to get inventory item');
        res.status(500).json({ error: message });
    }
});

/**
 * POST /api/shopify/inventory/set
 * Set inventory quantity for a SKU at a location
 */
router.post('/set', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    try {
        if (!shopifyClient.isConfigured()) {
            res.status(400).json({ error: 'Shopify is not configured' });
            return;
        }

        const parseResult = SetInventorySchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(400).json({ error: parseResult.error.issues[0]?.message });
            return;
        }

        const { sku, locationId, quantity } = parseResult.data;
        const result = await shopifyClient.setInventoryQuantityBySku(sku, locationId, quantity);

        if (!result.success) {
            res.status(400).json({ error: result.error });
            return;
        }

        res.json(result);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        shopifyLogger.error({ error: message }, 'Failed to set inventory');
        res.status(500).json({ error: message });
    }
});

/**
 * POST /api/shopify/inventory/zero-out
 * Set inventory to zero for multiple SKUs (batch operation)
 * Use case: Zeroing out archived product stock
 */
router.post('/zero-out', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    try {
        if (!shopifyClient.isConfigured()) {
            res.status(400).json({ error: 'Shopify is not configured' });
            return;
        }

        const parseResult = ZeroOutSkusSchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(400).json({ error: parseResult.error.issues[0]?.message });
            return;
        }

        const { skus, locationId } = parseResult.data;

        shopifyLogger.info({ skuCount: skus.length, locationId }, 'Starting zero-out inventory batch');

        const results = await shopifyClient.zeroOutInventoryForSkus(skus, locationId);

        const successful = results.filter(r => r.result.success).length;
        const failed = results.filter(r => !r.result.success);

        shopifyLogger.info({ successful, failed: failed.length }, 'Zero-out inventory batch completed');

        res.json({
            success: true,
            summary: {
                total: skus.length,
                successful,
                failed: failed.length,
            },
            results,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        shopifyLogger.error({ error: message }, 'Failed to zero-out inventory');
        res.status(500).json({ error: message });
    }
});

export default router;
