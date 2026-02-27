/**
 * Shopify Metafields Routes
 *
 * Endpoints for pushing metafields and product category from ERP to Shopify.
 * All push operations require explicit field selection — nothing is pushed automatically.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import shopifyClient from '../../services/shopify/index.js';
import { shopifyLogger } from '../../utils/logger.js';
import { METAFIELD_SYNC_FIELDS } from '@coh/shared/config/shopifyMetafieldSync';

const router = Router();

// ============================================
// SCHEMAS
// ============================================

const PushMetafieldsSchema = z.object({
    shopifyProductId: z.string().min(1, 'Shopify product ID is required'),
    fields: z.record(z.string(), z.string()).refine(
        obj => Object.keys(obj).length > 0,
        'At least one field is required',
    ),
});

const PushCategorySchema = z.object({
    shopifyProductId: z.string().min(1, 'Shopify product ID is required'),
    googleCategoryId: z.number().int().positive('Google category ID must be a positive integer'),
});

// ============================================
// ROUTES
// ============================================

/**
 * POST /api/shopify/metafields/push
 * Push specific metafield values from ERP to Shopify.
 * Body: { shopifyProductId: string, fields: { [fieldKey]: value } }
 */
router.post('/push', authenticateToken, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!shopifyClient.isConfigured()) {
        res.status(400).json({ error: 'Shopify is not configured' });
        return;
    }

    const parsed = PushMetafieldsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
        return;
    }

    const { shopifyProductId, fields } = parsed.data;
    const fieldKeys = Object.keys(fields);

    // Validate all field keys exist in config
    for (const key of fieldKeys) {
        if (!METAFIELD_SYNC_FIELDS[key]) {
            res.status(400).json({ error: `Unknown metafield key: ${key}` });
            return;
        }
    }

    shopifyLogger.info({ shopifyProductId, fieldKeys }, 'Pushing metafields to Shopify');
    const result = await shopifyClient.setProductMetafields(shopifyProductId, fieldKeys, fields);
    res.json(result);
}));

/**
 * POST /api/shopify/metafields/push-category
 * Push Google product category to Shopify via taxonomy node.
 * Body: { shopifyProductId: string, googleCategoryId: number }
 */
router.post('/push-category', authenticateToken, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!shopifyClient.isConfigured()) {
        res.status(400).json({ error: 'Shopify is not configured' });
        return;
    }

    const parsed = PushCategorySchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
        return;
    }

    const { shopifyProductId, googleCategoryId } = parsed.data;
    shopifyLogger.info({ shopifyProductId, googleCategoryId }, 'Pushing product category to Shopify');
    const result = await shopifyClient.setProductCategory(shopifyProductId, googleCategoryId);
    res.json(result);
}));

/**
 * GET /api/shopify/metafields/config
 * Return the sync field configuration (for UI to show available fields).
 */
router.get('/config', authenticateToken, (_req: Request, res: Response): void => {
    const fields = Object.entries(METAFIELD_SYNC_FIELDS).map(([key, config]) => ({
        key,
        label: config.label,
        shopifyNamespace: config.shopifyNamespace,
        shopifyKey: config.shopifyKey,
        shopifyType: config.shopifyType,
        pullEnabled: config.pullEnabled,
        pushEnabled: config.pushEnabled,
    }));
    res.json({ fields });
});

export default router;
