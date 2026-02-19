import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { ValidationError } from '../../utils/errors.js';
import scheduledSync from '../../services/scheduledSync.js';
import trackingSync from '../../services/trackingSync.js';
import { runAllCleanup, getCacheStats } from '../../utils/cacheCleanup.js';
import sheetOffloadWorker from '../../services/sheetOffload/index.js';
import stockSnapshotWorker from '../../services/stockSnapshotWorker.js';
import remittanceSync from '../../services/remittanceSync.js';
import payuSettlementSync from '../../services/payuSettlementSync.js';
import driveFinanceSync from '../../services/driveFinanceSync.js';
import { reconcileSheetOrders, syncSheetOrderStatus, syncSheetAwb, getReconcilerStatus } from '../../services/sheetOrderPush.js';
import { trackWorkerRun } from '../../utils/workerRunTracker.js';
import type { BackgroundJob, JobId, CleanupResult, JobUpdateBody } from './types.js';

const router = Router();

/**
 * Get status of all background jobs with last run times
 * @route GET /api/admin/background-jobs
 * @returns {Object} { jobs: [{ id, name, description, enabled, intervalMinutes?, schedule?, isRunning, lastRunAt, lastResult }] }
 * @description Jobs: shopify_sync (24hr lookback), tracking_sync (30min updates), cache_cleanup (daily 2AM), auto_archive (on startup).
 */
router.get('/background-jobs', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    // Get sync service statuses
    const shopifyStatus = scheduledSync.getStatus();
    const trackingStatus = trackingSync.getStatus();
    const offloadStatus = sheetOffloadWorker.getStatus();

    // Get cache stats for cleanup job context
    const cacheStats = await getCacheStats();

    // Get any stored settings from database
    const settings = await req.prisma.systemSetting.findUnique({
        where: { key: 'background_jobs' }
    });
    const savedSettings = settings?.value ? JSON.parse(settings.value) as Record<string, unknown> : {};

    const jobs: BackgroundJob[] = [
        {
            id: 'shopify_sync',
            name: 'Shopify Order Sync',
            description: 'Fetches orders from the last 24 hours from Shopify and processes any that were missed by webhooks. Ensures ERP stays in sync with Shopify.',
            enabled: shopifyStatus.schedulerActive,
            intervalMinutes: shopifyStatus.intervalMinutes,
            isRunning: shopifyStatus.isRunning,
            lastRunAt: shopifyStatus.lastSyncAt,
            lastResult: shopifyStatus.lastSyncResult,
            config: {
                lookbackHours: shopifyStatus.lookbackHours || 24,
            }
        },
        {
            id: 'tracking_sync',
            name: 'Tracking Status Sync',
            description: 'Updates delivery status for shipped orders via iThink Logistics API. Tracks deliveries, RTOs, and updates order status automatically.',
            enabled: trackingStatus.schedulerActive,
            intervalMinutes: trackingStatus.intervalMinutes,
            isRunning: trackingStatus.isRunning,
            lastRunAt: trackingStatus.lastSyncAt,
            lastResult: trackingStatus.lastSyncResult,
        },
        {
            id: 'cache_cleanup',
            name: 'Cache Cleanup',
            description: 'Removes old Shopify cache entries, webhook logs, and completed sync records to prevent database bloat. Runs daily at 2 AM.',
            enabled: savedSettings.cacheCleanupEnabled !== false,
            schedule: 'Daily at 2:00 AM',
            lastRunAt: savedSettings.lastCacheCleanupAt as string | null || null,
            lastResult: savedSettings.lastCacheCleanupResult || null,
            stats: cacheStats,
        },
        {
            id: 'auto_archive',
            name: 'Auto-Archive Old Orders',
            description: 'Archives shipped/delivered orders older than 90 days on server startup. Reduces clutter in active order views.',
            enabled: true,
            schedule: 'On server startup',
            lastRunAt: savedSettings.lastAutoArchiveAt as string | null || null,
            note: 'Runs automatically when server starts',
        },
        {
            id: 'ingest_inward',
            name: 'Ingest Inward',
            description: 'Reads Inward (Live) buffer tab, creates INWARD inventory transactions, and marks ingested rows as DONE. Updates sheet balances after ingestion.',
            enabled: offloadStatus.schedulerActive,
            isRunning: offloadStatus.ingestInward.isRunning,
            lastRunAt: offloadStatus.ingestInward.lastRunAt,
            lastResult: offloadStatus.ingestInward.lastResult,
            stats: {
                recentRuns: offloadStatus.ingestInward.recentRuns,
            },
        },
        {
            id: 'move_shipped_to_outward',
            name: 'Move Shipped → Outward',
            description: 'Moves shipped orders from "Orders from COH" to "Outward (Live)". Finds rows where Shipped=TRUE and Outward Done≠1, writes to Outward (Live), then deletes source rows.',
            enabled: true,
            isRunning: offloadStatus.moveShipped.isRunning,
            lastRunAt: offloadStatus.moveShipped.lastRunAt,
            lastResult: offloadStatus.moveShipped.lastResult,
            note: 'Manual trigger only — no scheduled interval',
            stats: {
                recentRuns: offloadStatus.moveShipped.recentRuns,
            },
        },
        {
            id: 'ingest_outward',
            name: 'Ingest Outward',
            description: 'Reads Outward (Live) buffer tab, creates OUTWARD inventory transactions, links to OrderLines, and marks ingested rows as DONE. Updates sheet balances after ingestion.',
            enabled: offloadStatus.schedulerActive,
            isRunning: offloadStatus.ingestOutward.isRunning,
            lastRunAt: offloadStatus.ingestOutward.lastRunAt,
            lastResult: offloadStatus.ingestOutward.lastResult,
            stats: {
                recentRuns: offloadStatus.ingestOutward.recentRuns,
            },
        },
        {
            id: 'preview_ingest_inward',
            name: 'Preview Ingest Inward',
            description: 'Dry run of inward ingestion: parses, validates, and dedup-checks rows without creating transactions or deleting rows. Writes Import Errors column.',
            enabled: offloadStatus.schedulerActive,
            isRunning: offloadStatus.ingestInward.isRunning,
            lastRunAt: null,
            note: 'Preview only — no data changes',
        },
        {
            id: 'preview_ingest_outward',
            name: 'Preview Ingest Outward',
            description: 'Dry run of outward ingestion: parses, validates orders, and dedup-checks rows without creating transactions or deleting rows. Writes Import Errors column.',
            enabled: offloadStatus.schedulerActive,
            isRunning: offloadStatus.ingestOutward.isRunning,
            lastRunAt: null,
            note: 'Preview only — no data changes',
        },
        {
            id: 'cleanup_done_rows',
            name: 'Cleanup DONE Rows',
            description: 'Deletes rows marked "DONE" that are older than 7 days from Inward (Live) and Outward (Live). Safe to run — only removes already-ingested rows.',
            enabled: true,
            isRunning: offloadStatus.cleanupDone.isRunning,
            lastRunAt: offloadStatus.cleanupDone.lastRunAt,
            lastResult: offloadStatus.cleanupDone.lastResult,
            note: 'Manual trigger only — removes old DONE rows to keep sheets clean',
            stats: {
                recentRuns: offloadStatus.cleanupDone.recentRuns,
            },
        },
        {
            id: 'migrate_sheet_formulas',
            name: 'Migrate Sheet Formulas',
            description: 'One-time migration: rewrites Inventory col C and Balance (Final) col E formulas from SUMIF to SUMIFS with DONE-row exclusion. Safe to re-run.',
            enabled: true,
            isRunning: offloadStatus.migrateFormulas.isRunning,
            lastRunAt: offloadStatus.migrateFormulas.lastRunAt,
            lastResult: offloadStatus.migrateFormulas.lastResult,
            note: 'One-time setup — idempotent, safe to re-run',
            stats: {
                recentRuns: offloadStatus.migrateFormulas.recentRuns,
            },
        },
        {
            id: 'preview_fabric_inward',
            name: 'Preview Fabric Inward',
            description: 'Dry run of fabric inward import: validates fabric codes, quantities, costs, suppliers, dates. Writes status to column K without creating transactions.',
            enabled: true,
            isRunning: offloadStatus.fabricInward.isRunning,
            lastRunAt: null,
            note: 'Preview only — no data changes',
        },
        {
            id: 'ingest_fabric_inward',
            name: 'Import Fabric Inward',
            description: 'Reads Fabric Inward (Live) tab, creates FabricColourTransactions for supplier receipts, finds/creates suppliers, marks rows as DONE.',
            enabled: true,
            isRunning: offloadStatus.fabricInward.isRunning,
            lastRunAt: offloadStatus.fabricInward.lastRunAt,
            lastResult: offloadStatus.fabricInward.lastResult,
            note: 'Manual trigger only — Preview first, then Import',
            stats: {
                recentRuns: offloadStatus.fabricInward.recentRuns,
            },
        },
        {
            id: 'snapshot_compute',
            name: 'Stock Snapshot (Monthly)',
            description: 'Computes the stock snapshot for the last completed month: Opening + Inward - Outward = Closing, with reason breakdowns.',
            enabled: true,
            isRunning: stockSnapshotWorker.getStatus().isRunning,
            lastRunAt: stockSnapshotWorker.getStatus().lastRunAt,
            lastResult: stockSnapshotWorker.getStatus().lastRunResult,
            note: 'Manual trigger only — computes last completed month',
        },
        {
            id: 'snapshot_backfill',
            name: 'Stock Snapshot Backfill',
            description: 'Backfills all historical monthly snapshots from the earliest transaction to last month. Runs sequentially (each month depends on previous closing).',
            enabled: true,
            isRunning: stockSnapshotWorker.getStatus().isRunning,
            lastRunAt: stockSnapshotWorker.getStatus().lastRunAt,
            lastResult: stockSnapshotWorker.getStatus().lastRunResult,
            note: 'One-time setup — run once to populate historical data',
        },
        {
            id: 'reconcile_sheet_orders',
            name: 'Reconcile Sheet Orders',
            description: 'Finds orders that never got pushed to the Google Sheet (e.g. due to a crash) and pushes them. Looks back 3 days, up to 20 orders per run.',
            enabled: true,
            isRunning: getReconcilerStatus().isRunning,
            lastRunAt: getReconcilerStatus().lastRunAt,
            lastResult: getReconcilerStatus().lastResult,
            note: 'Runs on startup + every 15 min — can also trigger manually',
        },
        {
            id: 'sync_sheet_awb',
            name: 'Sync Sheet AWBs',
            description: 'Reads AWB numbers from the Google Sheet, validates via iThink (Shopify/offline) or links directly (Myntra/Ajio/Nykaa), and updates OrderLines.',
            enabled: true,
            intervalMinutes: 30,
            isRunning: false,
            lastRunAt: null,
            lastResult: null,
            note: 'Runs every 30 min — can also trigger manually',
        },
        {
            id: 'remittance_sync',
            name: 'COD Remittance Sync',
            description: 'Fetches COD remittance data from iThink Logistics API, matches to orders, marks COD as paid, and triggers Shopify payment sync.',
            enabled: remittanceSync.getStatus().schedulerActive,
            intervalMinutes: remittanceSync.getStatus().intervalHours * 60,
            isRunning: remittanceSync.getStatus().isRunning,
            lastRunAt: remittanceSync.getStatus().lastSyncAt,
            lastResult: remittanceSync.getStatus().lastSyncResult,
        },
        {
            id: 'payu_settlement_sync',
            name: 'PayU Settlement Sync',
            description: 'Fetches prepaid payment settlement data from PayU API and matches settlements to HDFC bank deposits by UTR.',
            enabled: payuSettlementSync.getStatus().schedulerActive,
            intervalMinutes: payuSettlementSync.getStatus().intervalHours * 60,
            isRunning: payuSettlementSync.getStatus().isRunning,
            lastRunAt: payuSettlementSync.getStatus().lastSyncAt,
            lastResult: payuSettlementSync.getStatus().lastSyncResult,
        },
        {
            id: 'drive_finance_sync',
            name: 'Drive Finance Sync',
            description: 'Uploads invoice files to Google Drive, organized by party and financial year. On-demand only.',
            enabled: driveFinanceSync.getStatus().schedulerActive,
            isRunning: driveFinanceSync.getStatus().isRunning,
            lastRunAt: driveFinanceSync.getStatus().lastSyncAt,
            lastResult: driveFinanceSync.getStatus().lastSyncResult,
            config: {
                configured: driveFinanceSync.getStatus().configured,
            },
        },
    ];

    res.json({ jobs });
}));

/**
 * Manually trigger background job
 * @route POST /api/admin/background-jobs/:jobId/trigger
 * @param {string} jobId - 'shopify_sync', 'tracking_sync', 'cache_cleanup'
 * @returns {Object} { message, result }
 * @description Saves cache_cleanup result to SystemSetting for persistence.
 */
router.post('/background-jobs/:jobId/trigger', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params as { jobId: JobId };

    switch (jobId) {
        case 'shopify_sync': {
            const result = await scheduledSync.triggerSync();
            res.json({
                message: 'Shopify sync triggered',
                result,
            });
            break;
        }
        case 'tracking_sync': {
            const result = await trackingSync.triggerSync();
            res.json({
                message: 'Tracking sync triggered',
                result,
            });
            break;
        }
        case 'cache_cleanup': {
            const result = await runAllCleanup() as CleanupResult;

            // Save result to settings
            const existingSettings = await req.prisma.systemSetting.findUnique({
                where: { key: 'background_jobs' }
            });
            const savedSettings = existingSettings?.value ? JSON.parse(existingSettings.value) as Record<string, unknown> : {};
            savedSettings.lastCacheCleanupAt = new Date().toISOString();
            savedSettings.lastCacheCleanupResult = result.summary;

            await req.prisma.systemSetting.upsert({
                where: { key: 'background_jobs' },
                update: { value: JSON.stringify(savedSettings) },
                create: { key: 'background_jobs', value: JSON.stringify(savedSettings) }
            });

            res.json({
                message: 'Cache cleanup completed',
                result,
            });
            break;
        }
        case 'ingest_inward': {
            const result = await trackWorkerRun('sheet_ingest_inward', () => sheetOffloadWorker.triggerIngestInward(), 'manual');
            res.json({ message: 'Ingest inward triggered', result });
            break;
        }
        case 'ingest_outward': {
            const result = await trackWorkerRun('sheet_ingest_outward', () => sheetOffloadWorker.triggerIngestOutward(), 'manual');
            res.json({ message: 'Ingest outward triggered', result });
            break;
        }
        case 'run_inward_cycle': {
            sheetOffloadWorker.resetCycleProgress();
            const result = await trackWorkerRun('sheet_inward_cycle', () => sheetOffloadWorker.runInwardCycle(), 'manual');
            res.json({ message: 'Inward cycle triggered', result });
            break;
        }
        case 'run_outward_cycle': {
            sheetOffloadWorker.resetCycleProgress();
            const result = await trackWorkerRun('sheet_outward_cycle', () => sheetOffloadWorker.runOutwardCycle(), 'manual');
            res.json({ message: 'Outward cycle triggered', result });
            break;
        }
        case 'move_shipped_to_outward': {
            const result = await trackWorkerRun('sheet_move_shipped', () => sheetOffloadWorker.triggerMoveShipped(), 'manual');
            res.json({ message: 'Move shipped → outward completed', result });
            break;
        }
        case 'preview_ingest_inward': {
            const result = await sheetOffloadWorker.previewIngestInward();
            res.json({ message: 'Preview ingest inward completed', result });
            break;
        }
        case 'preview_ingest_outward': {
            const result = await sheetOffloadWorker.previewIngestOutward();
            res.json({ message: 'Preview ingest outward completed', result });
            break;
        }
        case 'cleanup_done_rows': {
            const result = await sheetOffloadWorker.triggerCleanupDoneRows();
            res.json({ message: 'Cleanup DONE rows completed', result });
            break;
        }
        case 'migrate_sheet_formulas': {
            const result = await sheetOffloadWorker.triggerMigrateFormulas();
            res.json({ message: 'Formula migration completed', result });
            break;
        }
        case 'snapshot_compute': {
            const result = await stockSnapshotWorker.triggerSnapshot();
            res.json({ message: 'Stock snapshot computed', result });
            break;
        }
        case 'snapshot_backfill': {
            const result = await stockSnapshotWorker.triggerBackfill();
            res.json({ message: 'Stock snapshot backfill completed', result });
            break;
        }
        case 'push_balances': {
            const result = await sheetOffloadWorker.triggerPushBalances();
            res.json({ message: 'Push balances to sheets completed', result });
            break;
        }
        case 'preview_push_balances': {
            const result = await sheetOffloadWorker.previewPushBalances();
            res.json({ message: 'Push balances preview completed', result });
            break;
        }
        case 'push_fabric_balances': {
            const result = await sheetOffloadWorker.triggerPushFabricBalances();
            res.json({ message: 'Fabric balances pushed to sheet', result });
            break;
        }
        case 'import_fabric_balances': {
            const result = await sheetOffloadWorker.triggerImportFabricBalances();
            res.json({ message: 'Fabric balances imported from sheet', result });
            break;
        }
        case 'preview_fabric_inward': {
            const result = await sheetOffloadWorker.previewFabricInward();
            res.json({ message: 'Preview fabric inward completed', result });
            break;
        }
        case 'ingest_fabric_inward': {
            const result = await sheetOffloadWorker.triggerFabricInward();
            res.json({ message: 'Fabric inward import completed', result });
            break;
        }
        case 'reconcile_sheet_orders': {
            const result = await reconcileSheetOrders();
            res.json({ message: 'Sheet order reconciliation completed', result });
            break;
        }
        case 'sync_sheet_status': {
            const result = await syncSheetOrderStatus();
            res.json({ message: 'Sheet order status sync completed', result });
            break;
        }
        case 'sync_sheet_awb': {
            const result = await trackWorkerRun('sync_sheet_awb', syncSheetAwb, 'manual');
            res.json({ message: 'Sheet AWB sync completed', result });
            break;
        }
        case 'remittance_sync': {
            remittanceSync.triggerSync().catch(() => {});
            res.json({ message: 'COD remittance sync triggered. Check status for progress.' });
            break;
        }
        case 'payu_settlement_sync': {
            payuSettlementSync.triggerSync().catch(() => {});
            res.json({ message: 'PayU settlement sync triggered. Check status for progress.' });
            break;
        }
        case 'drive_finance_sync': {
            driveFinanceSync.triggerSync().catch(() => {});
            res.json({ message: 'Drive finance sync triggered. Check status for progress.' });
            break;
        }
        default:
            throw new ValidationError(`Unknown job: ${jobId}`);
    }
}));

/**
 * Update background job settings
 * Currently just tracks enabled/disabled state for cache cleanup
 * (Shopify and tracking sync are controlled by their services)
 */
router.put('/background-jobs/:jobId', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { enabled } = req.body as JobUpdateBody;

    // Get existing settings
    const existingSettings = await req.prisma.systemSetting.findUnique({
        where: { key: 'background_jobs' }
    });
    const savedSettings = existingSettings?.value ? JSON.parse(existingSettings.value) as Record<string, unknown> : {};

    switch (jobId) {
        case 'cache_cleanup':
            savedSettings.cacheCleanupEnabled = enabled;
            break;
        // Note: shopify_sync and tracking_sync are always running
        // They can only be stopped/started at server level
        default:
            throw new ValidationError(`Cannot update settings for ${jobId}. Sync services are managed at server level.`);
    }

    await req.prisma.systemSetting.upsert({
        where: { key: 'background_jobs' },
        update: { value: JSON.stringify(savedSettings) },
        create: { key: 'background_jobs', value: JSON.stringify(savedSettings) }
    });

    res.json({
        message: 'Job settings updated',
        jobId,
        enabled,
    });
}));

export default router;
