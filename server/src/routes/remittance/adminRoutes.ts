/**
 * Admin routes for COD remittance (reset, fix-payment-method, trigger-sync, backfill, match-unprocessed, sync-status)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import remittanceSync from '../../services/remittanceSync.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { ValidationError } from '../../utils/errors.js';

const router: Router = Router();

/**
 * POST /api/remittance/reset
 * Reset remittance data for specific orders (admin only, for testing)
 */
router.post('/reset', asyncHandler(async (req: Request, res: Response) => {
    const { orderNumbers, clearDateRange } = req.body as { orderNumbers?: string[]; clearDateRange?: boolean };

    if (!orderNumbers || !Array.isArray(orderNumbers)) {
        throw new ValidationError('orderNumbers array required');
    }

    const result = await req.prisma.order.updateMany({
        where: {
            orderNumber: { in: orderNumbers.map(String) }
        },
        data: {
            codRemittedAt: null,
            codRemittanceUtr: null,
            codRemittedAmount: null,
            codShopifySyncStatus: null,
            codShopifySyncError: null,
            codShopifySyncedAt: null,
        }
    });

    // Also clear date range if requested
    if (clearDateRange) {
        await req.prisma.systemSetting.deleteMany({
            where: {
                key: { in: ['cod_remittance_earliest_date', 'cod_remittance_latest_date'] }
            }
        });
    }

    res.json({
        success: true,
        message: `Reset ${result.count} orders`,
        count: result.count,
    });
}));

/**
 * Fix payment method for orders with COD remittance but labeled Prepaid
 * @route POST /api/remittance/fix-payment-method
 * @returns {Object} { success, message, fixed, cacheFixed, orders[] }
 * @description Finds orders with codRemittedAt but paymentMethod='Prepaid', sets to 'COD'. Also fixes ShopifyOrderCache.
 */
router.post('/fix-payment-method', asyncHandler(async (req: Request, res: Response) => {
    // Find orders with COD remittance data but wrong payment method
    const affectedOrders = await req.prisma.order.findMany({
        where: {
            codRemittedAt: { not: null },
            paymentMethod: 'Prepaid',
        },
        select: {
            id: true,
            orderNumber: true,
            paymentMethod: true,
            codRemittedAt: true,
        }
    });

    if (affectedOrders.length === 0) {
        res.json({
            success: true,
            message: 'No orders need fixing',
            fixed: 0,
        });
        return;
    }

    // Fix them - set to COD
    const result = await req.prisma.order.updateMany({
        where: {
            codRemittedAt: { not: null },
            paymentMethod: 'Prepaid',
        },
        data: {
            paymentMethod: 'COD',
        }
    });

    // Also fix the ShopifyOrderCache entries
    const orderNumbers = affectedOrders.map(o => o.orderNumber);
    const cacheResult = await req.prisma.shopifyOrderCache.updateMany({
        where: {
            orderNumber: { in: orderNumbers },
        },
        data: {
            paymentMethod: 'COD',
        }
    });

    res.json({
        success: true,
        message: `Fixed ${result.count} orders from Prepaid to COD`,
        fixed: result.count,
        cacheFixed: cacheResult.count,
        orders: affectedOrders.map(o => o.orderNumber),
    });
}));

// ============================================
// API SYNC ROUTES (iThink Remittance API)
// ============================================

/**
 * Manually trigger remittance sync (fire-and-forget)
 * @route POST /api/remittance/trigger-sync
 * @returns {Object} { success, message } -- sync runs in background
 */
router.post('/trigger-sync', asyncHandler(async (_req: Request, res: Response) => {
    // Fire-and-forget: sync can take minutes, don't block the HTTP request
    remittanceSync.triggerSync().catch((err) => console.error('[remittance] Trigger sync failed:', err));
    res.json({ success: true, message: 'Remittance sync triggered. Check /sync-status for progress.' });
}));

/**
 * Backfill remittances for a date range (fire-and-forget)
 * @route POST /api/remittance/backfill
 * @body { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", downloadOnly?: boolean }
 * downloadOnly=true: just fetch from API and store (no order matching)
 * downloadOnly=false (default): full processing with order matching + Shopify sync
 * Resumable: skips dates whose remittances already exist.
 */
router.post('/backfill', asyncHandler(async (req: Request, res: Response) => {
    const { startDate, endDate, downloadOnly } = req.body;
    if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate required (YYYY-MM-DD)' });
        return;
    }
    if (isNaN(Date.parse(startDate)) || isNaN(Date.parse(endDate))) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
    }
    const mode = downloadOnly ? 'download-only' : 'full';
    remittanceSync.triggerBackfill(startDate, endDate, !!downloadOnly).catch((err) => console.error('[remittance] Trigger backfill failed:', err));
    res.json({ success: true, message: `Backfill (${mode}) triggered for ${startDate} to ${endDate}. Check /sync-status for progress.` });
}));

/**
 * Match orders for previously downloaded (unprocessed) remittances
 * @route POST /api/remittance/match-unprocessed
 * Finds CodRemittance records with ordersProcessed=0, runs order matching + Shopify sync.
 */
router.post('/match-unprocessed', asyncHandler(async (_req: Request, res: Response) => {
    remittanceSync.triggerMatchUnprocessed().catch((err) => console.error('[remittance] Trigger match unprocessed failed:', err));
    res.json({ success: true, message: 'Match unprocessed triggered. Check /sync-status for progress.' });
}));

/**
 * Get remittance sync worker status + recent CodRemittance records
 * @route GET /api/remittance/sync-status
 * @returns {Object} { status, recentRemittances }
 */
router.get('/sync-status', asyncHandler(async (req: Request, res: Response) => {
    const status = remittanceSync.getStatus();

    const recentRemittances = await req.prisma.codRemittance.findMany({
        orderBy: { remittanceDate: 'desc' },
        take: 10,
    });

    res.json({ status, recentRemittances });
}));

export default router;
