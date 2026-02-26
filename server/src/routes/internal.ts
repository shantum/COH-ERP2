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
import { asyncHandler } from '../middleware/asyncHandler.js';
import { deferredExecutor } from '../services/deferredExecutor.js';
import { pushERPOrderToSheet } from '../services/sheetOrderPush.js';
import { updateSheetBalances } from '../services/sheetOffload/balances.js';
import scheduledSync from '../services/scheduledSync.js';
import trackingSync from '../services/trackingSync.js';
import cacheProcessor from '../services/cacheProcessor.js';
import cacheDumpWorker from '../services/cacheDumpWorker.js';
import driveFinanceSync from '../services/driveFinanceSync.js';
import sheetOffloadWorker from '../services/sheetOffload/index.js';
import stockSnapshotWorker from '../services/stockSnapshotWorker.js';
import payuSettlementSync from '../services/payuSettlementSync.js';
import remittanceSync from '../services/remittanceSync.js';

const router: Router = Router();

// Shared secret for internal API calls
// In production, this should be set via environment variable
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

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

    // Check 1: Valid secret header (skip if no secret configured)
    if (INTERNAL_API_SECRET && secret === INTERNAL_API_SECRET) {
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
 * Debounced SKU balance push — collects SKU IDs across rapid requests,
 * then fires a single updateSheetBalances after 3s of quiet.
 * Max wait 10s so balances aren't delayed indefinitely during sustained scanning.
 */
const DEBOUNCE_QUIET_MS = 3_000;  // wait 3s after last scan
const DEBOUNCE_MAX_MS = 10_000;   // but never wait more than 10s from first scan

let pendingSkuIds = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let firstRequestAt: number | null = null;

function flushSkuBalancePush(): void {
    const skuIds = pendingSkuIds;
    pendingSkuIds = new Set();
    debounceTimer = null;
    firstRequestAt = null;

    if (skuIds.size === 0) return;

    console.log(`[Internal API] Flushing sheet balance push for ${skuIds.size} SKUs`);
    deferredExecutor.enqueue(
        async () => {
            await updateSheetBalances(skuIds, { errors: 0, skusUpdated: 0 });
        },
        { action: 'push_sku_balances' }
    );
}

/**
 * POST /api/internal/push-sku-balances
 *
 * Pushes balance for specific SKUs to Google Sheets (Inventory col R + Balance Final col F).
 * Called by Server Functions after inventory mutations to keep sheets in sync.
 * Debounced: collects SKU IDs for 3s of quiet (max 10s) then pushes once.
 *
 * Body: { skuIds: string[] }
 */
router.post('/push-sku-balances', verifyInternalRequest, (req: Request, res: Response): void => {
    try {
        const { skuIds } = req.body as { skuIds: string[] };

        if (!skuIds || !Array.isArray(skuIds) || skuIds.length === 0) {
            res.status(400).json({ error: 'Missing or empty skuIds array' });
            return;
        }

        // Accumulate SKU IDs
        for (const id of skuIds) pendingSkuIds.add(id);
        const now = Date.now();
        if (!firstRequestAt) firstRequestAt = now;

        // Clear existing quiet timer
        if (debounceTimer) clearTimeout(debounceTimer);

        // If we've been accumulating for too long, flush now
        if (now - firstRequestAt >= DEBOUNCE_MAX_MS) {
            flushSkuBalancePush();
        } else {
            // Otherwise reset the quiet timer
            debounceTimer = setTimeout(flushSkuBalancePush, DEBOUNCE_QUIET_MS);
        }

        res.json({ success: true, skuCount: skuIds.length, pending: pendingSkuIds.size });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Internal API] Push SKU balances error:', message);
        res.status(500).json({ error: 'Failed to enqueue balance push' });
    }
});

/**
 * GET /api/internal/worker-status
 *
 * Returns lightweight status for all background workers.
 * Called by the dashboard server function to show sync timestamps.
 */
router.get('/worker-status', verifyInternalRequest, asyncHandler(async (_req: Request, res: Response): Promise<void> => {
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
}));

export default router;
