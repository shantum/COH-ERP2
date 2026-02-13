/**
 * Google Drive Finance Sync Configuration
 *
 * Settings for auto-pushing finance documents (invoices, payment receipts)
 * to Google Drive for CA access.
 *
 * TO CHANGE DRIVE SYNC SETTINGS:
 * Simply update the values below. Changes take effect on next sync.
 */


// ============================================
// DRIVE FOLDER
// ============================================

/**
 * Root Google Drive folder ID for "COH Finance"
 *
 * This folder is shared with the CA and service account.
 * Set via DRIVE_FINANCE_FOLDER_ID environment variable.
 */
export const DRIVE_FINANCE_FOLDER_ID = process.env.DRIVE_FINANCE_FOLDER_ID ?? '';

// ============================================
// API SETTINGS
// ============================================

/**
 * Google Drive API scope — full access needed for Shared Drives
 */
export const DRIVE_API_SCOPE = 'https://www.googleapis.com/auth/drive';

/**
 * Minimum delay between API calls (ms)
 */
export const DRIVE_API_CALL_DELAY_MS = 200;

/**
 * Max retries on transient errors (429, 500, 503)
 */
export const DRIVE_API_MAX_RETRIES = 3;

// ============================================
// SYNC SETTINGS
// ============================================

/**
 * How many files to upload per sync batch
 */
export const DRIVE_SYNC_BATCH_SIZE = 10;

/**
 * Folder name for invoices/payments without a linked party
 */
export const DRIVE_UNLINKED_FOLDER_NAME = '_Unlinked';

/**
 * Folder name for all vendor/party invoice folders.
 * Party subfolders are created inside this folder (not at the root).
 */
export const DRIVE_VENDOR_INVOICES_FOLDER_NAME = 'Vendor Invoices';

// ============================================
// HELPERS
// ============================================

/**
 * Get the Indian financial year string for a date.
 * FY runs April to March — e.g. Jan 2026 → "FY 2025-26", May 2025 → "FY 2025-26"
 */
export function getFinancialYear(date: Date): string {
    const month = date.getMonth(); // 0-indexed (0=Jan)
    const year = date.getFullYear();

    // April (3) onwards = current year start; Jan-Mar = previous year start
    const startYear = month >= 3 ? year : year - 1;
    const endYear = startYear + 1;

    return `FY ${startYear}-${String(endYear).slice(2)}`;
}
