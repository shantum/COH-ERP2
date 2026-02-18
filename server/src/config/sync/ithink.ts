/**
 * iThink Logistics Sync Configuration
 *
 * Defines all settings and rules for syncing tracking data with iThink Logistics.
 * Includes batch sizes, sync intervals, and status filtering rules.
 *
 * TO CHANGE ITHINK SYNC SETTINGS:
 * Simply update the values below. Changes take effect on next sync.
 */

import type { TrackingStatus } from '../types.js';

// ============================================
// API SETTINGS
// ============================================

/**
 * Maximum AWBs per tracking API request
 *
 * iThink API limits tracking requests to 10 AWBs per call.
 */
export const ITHINK_TRACKING_BATCH_SIZE = 10;

/**
 * API request timeout (ms)
 */
export const ITHINK_API_TIMEOUT_MS = 30000;

/**
 * Number of retries for failed API requests
 */
export const ITHINK_API_RETRIES = 2;

/**
 * Initial retry delay (ms) - doubles with each retry
 */
export const ITHINK_RETRY_DELAY_MS = 1000;

// ============================================
// SYNC TIMING
// ============================================

/**
 * Interval between background tracking syncs (minutes)
 */
export const ITHINK_SYNC_INTERVAL_MINUTES = 30;

/**
 * Delay between batches during sync (ms)
 *
 * Prevents overwhelming the iThink API.
 */
export const ITHINK_BATCH_DELAY_MS = 1000;

/**
 * Delay before first sync after server start (ms)
 */
export const ITHINK_STARTUP_DELAY_MS = 2 * 60 * 1000; // 2 minutes

// ============================================
// STATUS FILTERING
// ============================================

/**
 * Tracking statuses that trigger sync (need updates)
 *
 * Orders with these statuses are included in background tracking sync.
 * Terminal statuses (delivered, rto_delivered, cancelled) are excluded.
 */
export const ITHINK_SYNC_STATUSES: readonly TrackingStatus[] = [
    'manifested',
    'not_picked',
    'picked_up',
    'in_transit',
    'reached_destination',
    'out_for_delivery',
    'undelivered',
    // Note: delivered and rto_delivered are terminal - no sync needed
] as const;

/**
 * Terminal statuses - no further tracking updates expected
 */
export const ITHINK_TERMINAL_STATUSES: readonly TrackingStatus[] = [
    'delivered',
    'rto_delivered',
    'cancelled',
    'reverse_delivered',
] as const;

/**
 * Check if a status should be synced
 */
export function shouldSyncStatus(status: TrackingStatus | null | undefined): boolean {
    if (!status) return true; // Null status = needs initial sync
    return (ITHINK_SYNC_STATUSES as readonly string[]).includes(status);
}

/**
 * Check if a status is terminal
 */
export function isTerminalTrackingStatus(status: TrackingStatus): boolean {
    return (ITHINK_TERMINAL_STATUSES as readonly string[]).includes(status);
}

// ============================================
// BACKFILL SETTINGS
// ============================================

/**
 * Default days to look back for backfill operations
 */
export const ITHINK_BACKFILL_DEFAULT_DAYS = 30;

/**
 * Default limit for backfill operations
 */
export const ITHINK_BACKFILL_DEFAULT_LIMIT = 100;

// ============================================
// CIRCUIT BREAKER CONFIGURATION
// ============================================

/**
 * Circuit breaker for iThink API failure protection
 *
 * Prevents cascading failures when the iThink API is down.
 */
export const CIRCUIT_BREAKER_CONFIG = {
    /** Number of failures before opening circuit */
    failureThreshold: 5,
    /** Time before attempting to close circuit (ms) */
    resetTimeoutMs: 60000,
    /** Number of requests to allow when half-open */
    halfOpenMaxRequests: 3,
} as const;

// ============================================
// ORDER LOCK CONFIGURATION
// ============================================

/**
 * Lock timeout for preventing race conditions on orders
 *
 * When processing tracking updates, orders are locked to prevent
 * concurrent updates from webhooks and background sync.
 */
export const ORDER_LOCK_CONFIG = {
    /** Lock timeout (ms) */
    timeoutMs: parseInt(process.env.ORDER_LOCK_TIMEOUT_MS || '90000', 10),
} as const;

// ============================================
// REMITTANCE SYNC SETTINGS
// ============================================

/** Interval between remittance syncs (12 hours) */
export const ITHINK_REMITTANCE_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** Number of days to look back for new remittances */
export const ITHINK_REMITTANCE_LOOKBACK_DAYS = 7;

/** Delay before first remittance sync after server start (5 min) */
export const ITHINK_REMITTANCE_STARTUP_DELAY_MS = 5 * 60 * 1000;

/** Timeout for remittance detail endpoint (slower than summary — returns per-order data) */
export const ITHINK_REMITTANCE_DETAIL_TIMEOUT_MS = 120_000;
