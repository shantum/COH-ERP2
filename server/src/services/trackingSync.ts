/**
 * Tracking Sync Service — Thin wrapper around TrackingCacheService
 *
 * Preserves the same public API (start/stop/getStatus/triggerSync) so that
 * the worker registry and internal routes need zero changes.
 *
 * All logic now lives in:
 *   - trackingCacheService.ts  — in-memory cache + refresh loop
 *   - trackingStatusSubscriber.ts — DB side effects on status changes
 */

import trackingCacheService from './trackingCacheService.js';
import { handleTrackingStatusChange } from './trackingStatusSubscriber.js';
import type { TrackingStatus } from '../config/types.js';
import type { RefreshResult, CacheStatus, OrderInfo } from './trackingCacheService.js';

// ============================================
// WIRE UP SUBSCRIBER
// ============================================

trackingCacheService.onStatusChange(handleTrackingStatusChange);

// ============================================
// COMPAT TYPES (for existing consumers)
// ============================================

/** Sync result — maps from RefreshResult for backwards compat */
interface SyncResult {
    startedAt: string;
    awbsChecked: number;
    updated: number;
    delivered: number;
    archived: number;
    rto: number;
    errors: number;
    apiCalls: number;
    durationMs: number;
    error: string | null;
}

interface SyncStatus {
    isRunning: boolean;
    schedulerActive: boolean;
    intervalMinutes: number;
    lastSyncAt: Date | null;
    lastSyncResult: SyncResult | null;
}

// ============================================
// PUBLIC API (same shape as before)
// ============================================

function start(): void {
    trackingCacheService.start();
}

function stop(): void {
    trackingCacheService.stop();
}

function getStatus(): SyncStatus {
    const cs = trackingCacheService.getStatus();
    return {
        isRunning: cs.isRefreshing,
        schedulerActive: cs.schedulerActive,
        intervalMinutes: 1, // refresh loop is every 60s now
        lastSyncAt: cs.lastRefreshAt,
        lastSyncResult: cs.lastRefreshResult ? {
            ...cs.lastRefreshResult,
            archived: 0, // not tracked separately anymore
        } : null,
    };
}

async function triggerSync(): Promise<SyncResult | null> {
    const result = await trackingCacheService.triggerRefresh();
    if (!result) return null;
    return { ...result, archived: 0 };
}

async function runTrackingSync(): Promise<SyncResult | null> {
    return triggerSync();
}

// ============================================
// EXPORTS
// ============================================

export default {
    start,
    stop,
    getStatus,
    triggerSync,
    runTrackingSync,
};

export type {
    TrackingStatus,
    SyncResult,
    SyncStatus,
    OrderInfo,
};
