/**
 * Return Prime Admin Routes
 *
 * Administrative endpoints for managing Return Prime local data sync.
 * - GET /api/returnprime/admin/sync-status - Get current sync status
 * - POST /api/returnprime/admin/sync - Trigger manual sync
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
    syncReturnPrimeRequests,
    getSyncStatus,
    getDetailedSyncStatus,
} from '../services/returnPrimeInboundSync.js';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// ============================================
// INPUT SCHEMAS
// ============================================

const SyncOptionsSchema = z.object({
    dateFrom: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    dateTo: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    fullSync: z.boolean().optional(),
});

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/returnprime/admin/sync-status
 *
 * Get the current sync status including:
 * - Total records in local database
 * - Last sync timestamp
 * - Date range of stored data
 * - Breakdown by type and status
 */
router.get('/sync-status', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const status = await getDetailedSyncStatus();
        res.json({
            success: true,
            data: status,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ReturnPrimeAdmin] Error getting sync status:', message);
        res.status(500).json({
            success: false,
            error: message,
        });
    }
}));

/**
 * POST /api/returnprime/admin/sync
 *
 * Trigger a manual sync from Return Prime API.
 *
 * Body options:
 * - dateFrom: YYYY-MM-DD (optional, defaults to last 30 days)
 * - dateTo: YYYY-MM-DD (optional, defaults to today)
 * - fullSync: boolean (optional, if true syncs 12 months of history)
 */
router.post('/sync', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const validation = SyncOptionsSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({
                success: false,
                error: 'Invalid input',
                details: validation.error.issues,
            });
            return;
        }

        const { dateFrom, dateTo, fullSync } = validation.data;

        console.log('[ReturnPrimeAdmin] Manual sync triggered:', { dateFrom, dateTo, fullSync });

        // Get status before sync
        const statusBefore = await getSyncStatus();

        // Run the sync
        const result = await syncReturnPrimeRequests({ dateFrom, dateTo, fullSync });

        // Get status after sync
        const statusAfter = await getSyncStatus();

        res.json({
            success: result.success,
            data: {
                ...result,
                statusBefore: {
                    totalRecords: statusBefore.totalRecords,
                    lastSyncedAt: statusBefore.lastSyncedAt?.toISOString() || null,
                },
                statusAfter: {
                    totalRecords: statusAfter.totalRecords,
                    lastSyncedAt: statusAfter.lastSyncedAt?.toISOString() || null,
                },
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ReturnPrimeAdmin] Error during sync:', message);
        res.status(500).json({
            success: false,
            error: message,
        });
    }
}));

/**
 * GET /api/returnprime/admin/sync-status/simple
 *
 * Get a simple sync status (faster, fewer queries)
 */
router.get('/sync-status/simple', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const status = await getSyncStatus();
        res.json({
            success: true,
            data: {
                totalRecords: status.totalRecords,
                lastSyncedAt: status.lastSyncedAt?.toISOString() || null,
                oldestRecord: status.oldestRecord?.toISOString() || null,
                newestRecord: status.newestRecord?.toISOString() || null,
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            success: false,
            error: message,
        });
    }
}));

export default router;
