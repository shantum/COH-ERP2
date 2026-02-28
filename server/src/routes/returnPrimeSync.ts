/**
 * Return Prime Outbound Sync Route
 *
 * Handles syncing COH-ERP return data back to Return Prime:
 * - QC results (condition, notes)
 * - Status updates (received, inspected)
 *
 * NOTE: This is an Express route (not TanStack Server Function) because
 * it needs to import from server-only services (returnPrime.ts).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { syncReturnPrimeStatus } from '../utils/returnPrimeSync.js';
import { authenticateToken } from '../middleware/auth.js';
import { verifyInternalRequest } from './internal.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { syncLogger } from '../utils/logger.js';

const rpLogger = syncLogger.child({ domain: 'return-prime' });

const router: Router = Router();

// ============================================
// INPUT VALIDATION
// ============================================

const SyncOrderLineInputSchema = z.object({
    orderLineId: z.string().uuid(),
});

const SyncBatchInputSchema = z.object({
    batchNumber: z.string(),
});

const PushStatusInputSchema = z.object({
    orderLineId: z.string().uuid(),
    erpStatus: z.string(),
    extraData: z.record(z.string(), z.unknown()).optional(),
});

// ============================================
// ROUTES
// ============================================

/**
 * POST /api/returnprime/push-status
 * Fire-and-forget endpoint called by server functions after status transitions.
 * Dispatches async sync to Return Prime — returns immediately.
 */
router.post('/push-status', verifyInternalRequest, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = PushStatusInputSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ success: false, error: 'Invalid input' });
        return;
    }

    const { orderLineId, erpStatus, extraData } = validation.data;

    // Fire-and-forget — syncReturnPrimeStatus handles errors internally
    syncReturnPrimeStatus(orderLineId, erpStatus, extraData);

    res.json({ success: true, dispatched: true });
}));

/**
 * POST /api/returnprime/sync
 * Sync a single order line's return data to Return Prime
 */
router.post('/sync', authenticateToken, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = SyncOrderLineInputSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({
            success: false,
            error: 'Invalid input',
            details: validation.error.issues,
        });
        return;
    }

    const { orderLineId } = validation.data;

    try {
        const line = await req.prisma.orderLine.findUnique({
            where: { id: orderLineId },
            select: {
                id: true,
                returnPrimeRequestId: true,
                returnStatus: true,
                returnCondition: true,
                returnConditionNotes: true,
                returnReceivedAt: true,
            },
        });

        if (!line) {
            res.status(404).json({ success: false, error: 'Order line not found' });
            return;
        }

        if (!line.returnPrimeRequestId) {
            res.json({ success: true, skipped: true, reason: 'no_rp_request_id' });
            return;
        }

        // Dispatch sync for the line's current status (handles config check internally)
        syncReturnPrimeStatus(orderLineId, line.returnStatus || '');

        res.json({ success: true, dispatched: true });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        rpLogger.error({ orderLineId, err: message }, 'Sync failed for order line');
        res.json({ success: false, error: message });
    }
}));

/**
 * POST /api/returnprime/sync-batch
 * Sync all lines in a return batch to Return Prime
 */
router.post('/sync-batch', authenticateToken, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = SyncBatchInputSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({
            success: false,
            error: 'Invalid input',
            details: validation.error.issues,
        });
        return;
    }

    const { batchNumber } = validation.data;

    try {
        const lines = await req.prisma.orderLine.findMany({
            where: {
                returnBatchNumber: batchNumber,
                returnPrimeRequestId: { not: null },
            },
            select: {
                id: true,
                returnPrimeRequestId: true,
                returnStatus: true,
                returnCondition: true,
                returnConditionNotes: true,
                returnReceivedAt: true,
            },
        });

        if (lines.length === 0) {
            res.json({ success: true, skipped: true, reason: 'no_lines_with_rp_id' });
            return;
        }

        // Dispatch sync for each line's current status
        for (const line of lines) {
            syncReturnPrimeStatus(line.id, line.returnStatus || '');
        }

        res.json({
            success: true,
            dispatched: lines.length,
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        rpLogger.error({ batchNumber, err: message }, 'Batch sync failed');
        res.status(500).json({ success: false, error: message });
    }
}));

/**
 * GET /api/returnprime/sync-status
 * Get sync status for lines with Return Prime integration
 */
router.get('/sync-status', authenticateToken, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const [pendingSync, failedSync, totalWithRp] = await Promise.all([
            // Lines that need syncing (status changed locally but not synced to RP)
            req.prisma.orderLine.count({
                where: {
                    returnPrimeRequestId: { not: null },
                    returnStatus: { in: ['inspected', 'refunded', 'cancelled', 'rejected'] },
                    returnPrimeSyncedAt: null,
                },
            }),
            // Lines with sync errors
            req.prisma.orderLine.count({
                where: {
                    returnPrimeRequestId: { not: null },
                    returnPrimeSyncError: { not: null },
                },
            }),
            // Total lines with Return Prime integration
            req.prisma.orderLine.count({
                where: {
                    returnPrimeRequestId: { not: null },
                },
            }),
        ]);

        res.json({
            success: true,
            stats: {
                pendingSync,
                failedSync,
                totalWithRp,
            },
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        rpLogger.error({ err: message }, 'Return Prime sync stats failed');
        res.status(500).json({ success: false, error: message });
    }
}));

export default router;
