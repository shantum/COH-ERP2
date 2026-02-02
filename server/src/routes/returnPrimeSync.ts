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
import { getReturnPrimeClient } from '../services/returnPrime.js';
import { authenticateToken } from '../middleware/auth.js';

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

// ============================================
// ROUTES
// ============================================

/**
 * POST /api/returnprime/sync
 * Sync a single order line's return data to Return Prime
 */
router.post('/sync', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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

        const rpClient = await getReturnPrimeClient();

        if (!rpClient.isConfigured()) {
            console.warn('[ReturnPrime] Sync skipped - client not configured');
            res.json({ success: true, skipped: true, reason: 'client_not_configured' });
            return;
        }

        // Sync based on current status
        if (line.returnStatus === 'received') {
            await rpClient.updateRequestStatus(line.returnPrimeRequestId, 'received', {
                received_at: line.returnReceivedAt?.toISOString() || new Date().toISOString(),
                condition: line.returnCondition || undefined,
                notes: line.returnConditionNotes || undefined,
            });
        }

        // Update sync timestamp
        await req.prisma.orderLine.update({
            where: { id: orderLineId },
            data: {
                returnPrimeSyncedAt: new Date(),
                returnPrimeSyncError: null,
            },
        });

        console.log(`[ReturnPrime] Synced order line ${orderLineId} to Return Prime`);
        res.json({ success: true });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[ReturnPrime] Sync failed for ${orderLineId}:`, message);

        // Store error for retry
        await req.prisma.orderLine.update({
            where: { id: orderLineId },
            data: { returnPrimeSyncError: message.slice(0, 500) },
        });

        res.json({ success: false, error: message });
    }
});

/**
 * POST /api/returnprime/sync-batch
 * Sync all lines in a return batch to Return Prime
 */
router.post('/sync-batch', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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

        const rpClient = await getReturnPrimeClient();

        if (!rpClient.isConfigured()) {
            res.json({ success: true, skipped: true, reason: 'client_not_configured' });
            return;
        }

        const results: { lineId: string; success: boolean; error?: string }[] = [];

        for (const line of lines) {
            try {
                if (line.returnStatus === 'received' && line.returnPrimeRequestId) {
                    await rpClient.updateRequestStatus(line.returnPrimeRequestId, 'received', {
                        received_at: line.returnReceivedAt?.toISOString() || new Date().toISOString(),
                        condition: line.returnCondition || undefined,
                        notes: line.returnConditionNotes || undefined,
                    });

                    await req.prisma.orderLine.update({
                        where: { id: line.id },
                        data: {
                            returnPrimeSyncedAt: new Date(),
                            returnPrimeSyncError: null,
                        },
                    });

                    results.push({ lineId: line.id, success: true });
                }
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                await req.prisma.orderLine.update({
                    where: { id: line.id },
                    data: { returnPrimeSyncError: message.slice(0, 500) },
                });
                results.push({ lineId: line.id, success: false, error: message });
            }
        }

        const successCount = results.filter(r => r.success).length;
        console.log(`[ReturnPrime] Batch sync complete: ${successCount}/${lines.length} succeeded`);

        res.json({
            success: true,
            total: lines.length,
            synced: successCount,
            failed: lines.length - successCount,
            results,
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[ReturnPrime] Batch sync failed for ${batchNumber}:`, message);
        res.status(500).json({ success: false, error: message });
    }
});

/**
 * GET /api/returnprime/sync-status
 * Get sync status for lines with Return Prime integration
 */
router.get('/sync-status', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    try {
        const [pendingSync, failedSync, totalWithRp] = await Promise.all([
            // Lines that need syncing (received locally but not synced to RP)
            req.prisma.orderLine.count({
                where: {
                    returnPrimeRequestId: { not: null },
                    returnStatus: 'received',
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
        res.status(500).json({ success: false, error: message });
    }
});

export default router;
