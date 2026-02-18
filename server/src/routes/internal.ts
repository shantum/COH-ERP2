/**
 * Internal API endpoints for Server Functions to call Express services
 *
 * These endpoints are NOT for external clients. They enable Server Functions
 * running in TanStack Start to communicate with Express-only features like SSE.
 *
 * Security: Uses a shared secret header to prevent external abuse.
 * In production, Server Functions and Express run on the same server,
 * so this is server-to-server communication.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { broadcastOrderUpdate } from './sse.js';
import type { OrderUpdateEvent } from './sse.js';
import { deferredExecutor } from '../services/deferredExecutor.js';
import { pushERPOrderToSheet } from '../services/sheetOrderPush.js';
import scheduledSync from '../services/scheduledSync.js';
import trackingSync from '../services/trackingSync.js';
import cacheProcessor from '../services/cacheProcessor.js';
import cacheDumpWorker from '../services/cacheDumpWorker.js';
import driveFinanceSync from '../services/driveFinanceSync.js';
import sheetOffloadWorker from '../services/sheetOffloadWorker.js';
import stockSnapshotWorker from '../services/stockSnapshotWorker.js';
import payuSettlementSync from '../services/payuSettlementSync.js';
import remittanceSync from '../services/remittanceSync.js';

const router: Router = Router();

// Shared secret for internal API calls
// In production, this should be set via environment variable
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'coh-internal-api-secret-dev';

/**
 * Middleware to verify internal API calls
 * Checks for either:
 * 1. X-Internal-Secret header matching the secret
 * 2. Request from localhost (for dev/same-server calls)
 */
function verifyInternalRequest(req: Request, res: Response, next: NextFunction): void {
    const secret = req.headers['x-internal-secret'];
    const forwardedFor = req.headers['x-forwarded-for'];
    const remoteAddress = req.socket?.remoteAddress || req.ip;

    // Check 1: Valid secret header
    if (secret === INTERNAL_API_SECRET) {
        next();
        return;
    }

    // Check 2: Localhost request (same server)
    // In production with reverse proxy, check x-forwarded-for
    const isLocalhost =
        remoteAddress === '127.0.0.1' ||
        remoteAddress === '::1' ||
        remoteAddress === '::ffff:127.0.0.1' ||
        (forwardedFor === undefined && remoteAddress?.includes('127.0.0.1'));

    if (isLocalhost) {
        next();
        return;
    }

    // Reject external requests without valid secret
    console.warn(`[Internal API] Rejected request from ${remoteAddress} - missing or invalid secret`);
    res.status(403).json({ error: 'Forbidden - internal endpoint' });
}

/**
 * POST /api/internal/sse-broadcast
 *
 * Broadcasts an SSE event to all connected clients.
 * Called by Server Functions after mutations to notify other users.
 *
 * Body: { event: OrderUpdateEvent, excludeUserId?: string }
 */
router.post('/sse-broadcast', verifyInternalRequest, (req: Request, res: Response): void => {
    try {
        const { event, excludeUserId } = req.body as {
            event: OrderUpdateEvent;
            excludeUserId?: string;
        };

        if (!event || !event.type) {
            res.status(400).json({ error: 'Missing event or event.type' });
            return;
        }

        // Broadcast to all connected SSE clients
        broadcastOrderUpdate(event, excludeUserId || null);

        res.json({ success: true, eventType: event.type });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Internal API] SSE broadcast error:', message);
        res.status(500).json({ error: 'Failed to broadcast event' });
    }
});

/**
 * POST /api/internal/push-order-to-sheet
 *
 * Pushes an ERP-created order (manual/exchange) to the "Orders from COH" sheet.
 * Called by Server Functions after createOrder to sync with the ops sheet.
 *
 * Body: { orderId: string }
 */
router.post('/push-order-to-sheet', verifyInternalRequest, (req: Request, res: Response): void => {
    try {
        const { orderId } = req.body as { orderId: string };

        if (!orderId) {
            res.status(400).json({ error: 'Missing orderId' });
            return;
        }

        deferredExecutor.enqueue(
            async () => { await pushERPOrderToSheet(orderId); },
            { orderId, action: 'push_erp_order_to_sheet' }
        );

        res.json({ success: true, orderId });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Internal API] Push order to sheet error:', message);
        res.status(500).json({ error: 'Failed to enqueue sheet push' });
    }
});

/**
 * GET /api/internal/worker-status
 *
 * Returns lightweight status for all background workers.
 * Called by the dashboard server function to show sync timestamps.
 */
router.get('/worker-status', verifyInternalRequest, async (_req: Request, res: Response): Promise<void> => {
    try {
        const shopify = scheduledSync.getStatus();
        const tracking = trackingSync.getStatus();
        const processor = cacheProcessor.getStatus();
        const drive = driveFinanceSync.getStatus();
        const snapshot = stockSnapshotWorker.getStatus();
        const offload = sheetOffloadWorker.getStatus();
        const dump = await cacheDumpWorker.getStatus();
        const payu = payuSettlementSync.getStatus();
        const remittance = remittanceSync.getStatus();

        const workers = [
            {
                id: 'shopify_sync',
                name: 'Shopify Sync',
                interval: `${shopify.intervalMinutes}m`,
                isRunning: shopify.isRunning,
                schedulerActive: shopify.schedulerActive,
                lastSyncAt: shopify.lastSyncAt,
                lastError: shopify.lastSyncResult?.error ?? null,
            },
            {
                id: 'tracking_sync',
                name: 'Tracking Sync',
                interval: `${tracking.intervalMinutes}m`,
                isRunning: tracking.isRunning,
                schedulerActive: tracking.schedulerActive,
                lastSyncAt: tracking.lastSyncAt,
                lastError: tracking.lastSyncResult?.error ?? null,
            },
            {
                id: 'cache_processor',
                name: 'Order Processor',
                interval: `${processor.config.pollIntervalSeconds}s`,
                isRunning: processor.isRunning,
                schedulerActive: processor.isRunning,
                lastSyncAt: processor.stats.lastBatchAt,
                lastError: processor.stats.lastError,
            },
            {
                id: 'drive_sync',
                name: 'Drive Sync',
                interval: `${drive.intervalMinutes}m`,
                isRunning: drive.isRunning,
                schedulerActive: drive.schedulerActive,
                lastSyncAt: drive.lastSyncAt,
                lastError: null,
            },
            {
                id: 'cache_dump',
                name: 'Shopify Dump',
                interval: 'on-demand',
                isRunning: dump.workerRunning,
                schedulerActive: dump.workerRunning,
                lastSyncAt: dump.recentJobs[0]?.completedAt ?? dump.recentJobs[0]?.startedAt ?? null,
                lastError: dump.recentJobs[0]?.lastError ?? null,
            },
            {
                id: 'sheet_offload',
                name: 'Sheet Offload',
                interval: 'on-demand',
                isRunning: offload.ingestInward.isRunning || offload.ingestOutward.isRunning,
                schedulerActive: offload.schedulerActive,
                lastSyncAt: offload.ingestInward.lastRunAt ?? offload.ingestOutward.lastRunAt ?? null,
                lastError: null,
            },
            {
                id: 'stock_snapshot',
                name: 'Stock Snapshot',
                interval: 'manual',
                isRunning: snapshot.isRunning,
                schedulerActive: false,
                lastSyncAt: snapshot.lastRunAt,
                lastError: null,
            },
            {
                id: 'payu_settlement',
                name: 'PayU Settlement',
                interval: `${payu.intervalHours}h`,
                isRunning: payu.isRunning,
                schedulerActive: payu.schedulerActive,
                lastSyncAt: payu.lastSyncAt,
                lastError: payu.lastSyncResult?.error ?? null,
            },
            {
                id: 'cod_remittance',
                name: 'COD Remittance',
                interval: `${remittance.intervalHours}h`,
                isRunning: remittance.isRunning,
                schedulerActive: remittance.schedulerActive,
                lastSyncAt: remittance.lastSyncAt,
                lastError: remittance.lastSyncResult?.error ?? null,
            },
        ];

        res.json({ workers });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Internal API] Worker status error:', message);
        res.status(500).json({ error: 'Failed to get worker status' });
    }
});

export default router;
