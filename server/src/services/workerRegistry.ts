/**
 * Worker Registry — single source of truth for all background workers.
 *
 * index.js calls startAllWorkers() / stopAllWorkers() on startup/shutdown.
 * Adding a new worker here automatically registers it for startup and graceful shutdown.
 */

import scheduledSync from './scheduledSync.js';
import trackingSync from './trackingSync.js';
import cacheProcessor from './cacheProcessor.js';
import cacheDumpWorker from './cacheDumpWorker.js';
import sheetOffloadWorker from './sheetOffload/index.js';
import stockSnapshotWorker from './stockSnapshotWorker.js';
import driveFinanceSync from './driveFinanceSync.js';
import remittanceSync from './remittanceSync.js';
import payuSettlementSync from './payuSettlementSync.js';
import returnPrimeSyncWorker from './returnPrimeSyncWorker.js';
import { returnPrimeInboundSyncWorker } from './returnPrimeInboundSync.js';
import { pulseBroadcaster } from './pulseBroadcaster.js';
import { sseEventBridge } from './sseEventBridge.js';
import { reconcileSheetOrders, syncSheetOrderStatus, syncSheetAwb } from './sheetOrderPush.js';
import { runAllCleanup } from '../utils/cacheCleanup.js';
import { cleanupStaleRuns, trackWorkerRun } from '../utils/workerRunTracker.js';
import shutdownCoordinator from '../utils/shutdownCoordinator.js';
import prisma from '../lib/prisma.js';

interface WorkerEntry {
  name: string;
  start: () => void;
  stop: () => void | Promise<void>;
  shutdownTimeout?: number;
}

// Standard workers with start/stop lifecycle
const workers: WorkerEntry[] = [
  { name: 'scheduledSync',       start: () => scheduledSync.start(),       stop: () => scheduledSync.stop() },
  { name: 'trackingSync',        start: () => trackingSync.start(),        stop: () => trackingSync.stop() },
  { name: 'cacheProcessor',      start: () => cacheProcessor.start(),      stop: () => cacheProcessor.stop() },
  { name: 'cacheDumpWorker',     start: () => cacheDumpWorker.start(),     stop: () => cacheDumpWorker.stop() },
  { name: 'sheetOffloadWorker',  start: () => sheetOffloadWorker.start(),  stop: () => sheetOffloadWorker.stop() },
  { name: 'stockSnapshotWorker', start: () => stockSnapshotWorker.start(), stop: () => stockSnapshotWorker.stop() },
  { name: 'driveFinanceSync',    start: () => driveFinanceSync.start(),    stop: () => driveFinanceSync.stop() },
  { name: 'remittanceSync',      start: () => remittanceSync.start(),      stop: () => remittanceSync.stop() },
  { name: 'payuSettlementSync',  start: () => payuSettlementSync.start(),  stop: () => payuSettlementSync.stop() },
  { name: 'returnPrimeSyncWorker', start: () => returnPrimeSyncWorker.start(), stop: () => returnPrimeSyncWorker.stop() },
  { name: 'returnPrimeInboundSync', start: () => returnPrimeInboundSyncWorker.start(), stop: () => returnPrimeInboundSyncWorker.stop() },
];

// Interval handles for cleanup
let reconcileInterval: ReturnType<typeof setInterval> | null = null;
let statusSyncInterval: ReturnType<typeof setInterval> | null = null;
let awbSyncInterval: ReturnType<typeof setInterval> | null = null;
let cacheCleanupInterval: ReturnType<typeof setInterval> | null = null;
// Startup timeout handles (must be cancellable on shutdown)
let reconcileStartupTimeout: ReturnType<typeof setTimeout> | null = null;
let cleanupStartupTimeout: ReturnType<typeof setTimeout> | null = null;

function startIntervalWorkers(): void {
  // Sheet order reconciler — catches orders missed due to crashes/downtime
  // Runs immediately on startup (with delay), then every 2 min
  reconcileStartupTimeout = setTimeout(() => {
    reconcileStartupTimeout = null;
    console.log('[SheetReconciler] Running startup reconciliation...');
    reconcileSheetOrders().catch((err) => console.error('[SheetReconciler] Startup reconciliation failed:', err));
  }, 15_000);
  reconcileInterval = setInterval(() => {
    reconcileSheetOrders().catch((err) => console.error('[SheetReconciler] Scheduled reconciliation failed:', err));
  }, 2 * 60 * 1000);

  // Sheet order status sync — updates status/courier/AWB in sheet from ERP
  // Every 5 min
  statusSyncInterval = setInterval(() => {
    syncSheetOrderStatus().catch((err) => console.error('[SheetStatusSync] Scheduled status sync failed:', err));
  }, 5 * 60 * 1000);

  // Sheet AWB sync — reads AWBs from sheet, validates/links to order lines
  // Every 30 min
  awbSyncInterval = setInterval(() => {
    trackWorkerRun('sync_sheet_awb', syncSheetAwb, 'scheduled').catch((err) => console.error('[SheetAwbSync] Scheduled AWB sync failed:', err));
  }, 30 * 60 * 1000);

  // Cache cleanup — daily at 2 AM, plus startup run
  cacheCleanupInterval = setInterval(async () => {
    if (new Date().getHours() === 2) {
      console.log('[CacheCleanup] Running scheduled daily cleanup...');
      await trackWorkerRun('cache_cleanup', () => runAllCleanup() as Promise<unknown>, 'scheduled');
    }
  }, 60 * 60 * 1000);

  cleanupStartupTimeout = setTimeout(() => {
    cleanupStartupTimeout = null;
    console.log('[CacheCleanup] Running startup cleanup...');
    trackWorkerRun('cache_cleanup', () => runAllCleanup() as Promise<unknown>, 'startup').catch(err =>
      console.error('[CacheCleanup] Startup cleanup error:', err)
    );
  }, 30_000);

  // Register interval and startup timeout shutdown handlers
  shutdownCoordinator.register('sheetReconciler', () => {
    if (reconcileStartupTimeout) clearTimeout(reconcileStartupTimeout);
    if (reconcileInterval) clearInterval(reconcileInterval);
  }, 1000);
  shutdownCoordinator.register('sheetStatusSync', () => { if (statusSyncInterval) clearInterval(statusSyncInterval); }, 1000);
  shutdownCoordinator.register('sheetAwbSync', () => { if (awbSyncInterval) clearInterval(awbSyncInterval); }, 1000);
  shutdownCoordinator.register('cacheCleanup', () => {
    if (cleanupStartupTimeout) clearTimeout(cleanupStartupTimeout);
    if (cacheCleanupInterval) clearInterval(cacheCleanupInterval);
  }, 1000);
}

export async function startAllWorkers(): Promise<void> {
  // Clean up stale WorkerRun records from previous boot
  await cleanupStaleRuns();

  // Warn about missing Return Prime webhook secret
  if (!process.env.RETURNPRIME_WEBHOOK_SECRET) {
    console.warn('⚠️  RETURNPRIME_WEBHOOK_SECRET not set — webhooks accepted without signature verification. Get the secret from the Return Prime dashboard.');
  }

  const disableWorkers = process.env.DISABLE_BACKGROUND_WORKERS === 'true';

  if (disableWorkers) {
    console.log('⚠️  Background workers disabled (DISABLE_BACKGROUND_WORKERS=true)');
  } else {
    for (const w of workers) {
      w.start();
      shutdownCoordinator.register(w.name, w.stop, w.shutdownTimeout ?? 5000);
    }
    startIntervalWorkers();
  }

  // Pulse broadcaster is always enabled — SSE needs it
  pulseBroadcaster.start();
  shutdownCoordinator.register('pulseBroadcaster', () => pulseBroadcaster.shutdown(), 5000);

  // SSE event bridge — listens on coh_erp_events for cross-process SSE dispatch
  sseEventBridge.start();
  shutdownCoordinator.register('sseEventBridge', () => sseEventBridge.shutdown(), 5000);

  // Prisma disconnect on shutdown (always)
  shutdownCoordinator.register('prisma', () => prisma.$disconnect(), 10000);
}

export async function stopAllWorkers(): Promise<void> {
  await shutdownCoordinator.shutdown();
}
