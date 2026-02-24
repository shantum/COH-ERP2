/**
 * Timing, batch sizes, validation limits, auth config, and reference ID prefixes.
 */

import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ============================================
// TIMING
// ============================================

/**
 * Interval between offload cycles (ms) — every 30 minutes for live buffer tabs
 */
export const OFFLOAD_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Delay before first offload after server start (ms) — let server settle
 */
export const STARTUP_DELAY_MS = 5 * 60 * 1000;

/**
 * Delay between Google Sheets API calls (ms) — stay under 300/min quota.
 * 250ms = max 240 calls/min, giving a ~20% safety margin.
 */
export const API_CALL_DELAY_MS = 250;

/**
 * Max retries for transient API errors (429, 500, 503)
 */
export const API_MAX_RETRIES = 3;

/**
 * Rows per ingestion batch — controls memory and DB batch size
 */
export const BATCH_SIZE = 500;

// ============================================
// INGESTION VALIDATION LIMITS
// ============================================

/**
 * Maximum quantity per row. Anything higher is likely a typo.
 * Rejects rows with qty > this value during inward/outward/fabric ingestion.
 */
export const MAX_QTY_PER_ROW = 500;

/**
 * Maximum days in the future a date can be.
 * Catches typos like 2027 instead of 2026.
 */
export const MAX_FUTURE_DAYS = 3;

/**
 * Maximum days in the past a date can be.
 * Catches very old dates that are clearly wrong.
 */
export const MAX_PAST_DAYS = 365;

// ============================================
// AUTH
// ============================================

/**
 * Path to Google service account key file
 */
export const GOOGLE_SERVICE_ACCOUNT_PATH = resolve(__dirname, '../../../../config/google-service-account.json');

/**
 * Google Sheets API scope — needs read + write for offload
 */
export const SHEETS_API_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// ============================================
// REFERENCE ID PREFIXES
// ============================================

/**
 * Prefixes for referenceId on InventoryTransactions created by offload.
 * Makes them trivially identifiable for rollback: DELETE WHERE referenceId LIKE 'sheet:%'
 */
export const REF_PREFIX = {
    INWARD_FINAL: 'sheet:inward-final',
    INWARD_ARCHIVE: 'sheet:inward-archive',
    OUTWARD: 'sheet:outward',
    ORDERS_OUTWARD: 'sheet:orders-outward',
    MASTERSHEET_OUTWARD: 'sheet:ms-outward',
    INWARD_LIVE: 'sheet:inward-live',
    OUTWARD_LIVE: 'sheet:outward-live',
    FABRIC_INWARD_LIVE: 'sheet:fabric-inward-live',
} as const;

/**
 * Notes prefix for offloaded transactions — searchable for rollback
 */
export const OFFLOAD_NOTES_PREFIX = '[sheet-offload]';
