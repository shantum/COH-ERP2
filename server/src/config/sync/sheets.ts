/**
 * Google Sheets Offload Configuration
 *
 * Defines spreadsheet IDs, tab names, column mappings, and timing for the
 * sheet offload worker that ingests historical data from Google Sheets into the ERP.
 *
 * TO CHANGE OFFLOAD SETTINGS:
 * Simply update the values below. Changes take effect on next sync cycle.
 */

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import type { TxnReason } from '../../utils/patterns/types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ============================================
// FEATURE FLAGS
// ============================================

/**
 * Master switch — worker doesn't start unless true.
 * Set via ENABLE_SHEET_OFFLOAD environment variable.
 */
export const ENABLE_SHEET_OFFLOAD = process.env.ENABLE_SHEET_OFFLOAD === 'true';

/**
 * Deletion switch — when false, worker ingests data but does NOT delete sheet rows.
 * Phase 1: ingest-only. Phase 2: enable deletion after verifying data.
 */
export const ENABLE_SHEET_DELETION = process.env.ENABLE_SHEET_DELETION === 'true';

// ============================================
// SPREADSHEET IDS
// ============================================

/**
 * COH Orders Mastersheet
 * Contains: Orders from COH, Inventory, Office Inventory
 */
export const ORDERS_MASTERSHEET_ID = '1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo';

/**
 * Office Ledger spreadsheet
 * Contains: Inward (Final), Inward (Archive), Outward, Orders Outward, Balance (Final)
 */
export const OFFICE_LEDGER_ID = '1ZZgzu4xPXhP9ba3-liXHxj5tY0HihoEnVC9-wLijD5E';

// ============================================
// TAB NAMES
// ============================================

export const LEDGER_TABS = {
    INWARD_FINAL: 'Inward (Final)',
    INWARD_ARCHIVE: 'Inward (Archive)',
    OUTWARD: 'Outward',
    ORDERS_OUTWARD: 'Orders Outward',
    ORDERS_OUTWARD_OLD: 'Orders Outward 12728-41874',
    BALANCE_FINAL: 'Balance (Final)',
} as const;

export const MASTERSHEET_TABS = {
    ORDERS_FROM_COH: 'Orders from COH',
    INVENTORY: 'Inventory',
    OFFICE_INVENTORY: 'Office Inventory',
    OUTWARD: 'Outward',
} as const;

// ============================================
// COLUMN MAPPINGS — Inward (Final) & Inward (Archive)
// ============================================

/**
 * Inward (Final) and Inward (Archive) share the same structure.
 * A: SKU (barcode), B: Qty, C: Product Details, D: Inward Date,
 * E: Source, F: Inward Done By, G: Unique Barcode, H: Tailor Number
 */
export const INWARD_COLS = {
    SKU: 0,         // A — barcode / SKU code
    QTY: 1,         // B
    PRODUCT: 2,     // C
    DATE: 3,        // D — "Inward Date"
    SOURCE: 4,      // E — "Sampling", "Repacking", etc.
    DONE_BY: 5,     // F
    BARCODE: 6,     // G — unique barcode (may differ from col A)
    TAILOR: 7,      // H
} as const;

// ============================================
// COLUMN MAPPINGS — Outward (Office Ledger)
// ============================================

/**
 * Outward tab — ~11K rows, has dates.
 * A: SKU, B: Qty, C: Product Details, D: Outward Date, E: Destination, F: Notes
 */
export const OUTWARD_COLS = {
    SKU: 0,
    QTY: 1,
    PRODUCT: 2,
    DATE: 3,
    DESTINATION: 4,
    NOTES: 5,
} as const;

// ============================================
// COLUMN MAPPINGS — Orders Outward (Office Ledger)
// ============================================

/**
 * Orders Outward tab — ~3K rows, no headers, no dates.
 * Just SKU (col A) + Qty (col B) pairs.
 */
export const ORDERS_OUTWARD_COLS = {
    SKU: 0,
    QTY: 1,
} as const;

// ============================================
// COLUMN MAPPINGS — Orders Outward 12728-41874 (Office Ledger)
// ============================================

/**
 * Old orders outward — ~37K rows, no headers, full order rows.
 * SKU in col N (index 13), Qty in col O (index 14).
 * Balance formula uses: SUMIF(N:N, A:A, O:O)
 */
export const ORDERS_OUTWARD_OLD_COLS = {
    SKU: 13,    // N
    QTY: 14,    // O
} as const;

// ============================================
// COLUMN MAPPINGS — Mastersheet Outward
// ============================================

/**
 * Mastersheet Outward tab — individual order lines with order numbers.
 * Reading range A:I — columns are:
 * A: Date, B: Order Number, C: Customer, D: Product Name, E: Size,
 * F: (empty/notes), G: SKU, H: (empty), I: Qty
 *
 * NOTE: Column indices verified from verify-outward-totals.ts which reads B:I.
 * In that script, SKU is at index 5 (col G) and Qty at index 7 (col I).
 * When reading A:I (our range), add 1: SKU=6 (G), Qty=8 (I).
 */
export const MASTERSHEET_OUTWARD_COLS = {
    DATE: 0,        // A
    ORDER_NO: 1,    // B — Shopify order # or prefix (FN/NYK/etc.)
    CUSTOMER: 2,    // C
    PRODUCT: 3,     // D
    SIZE: 4,        // E
    SKU: 6,         // G
    QTY: 8,         // I
} as const;

// ============================================
// COLUMN MAPPINGS — Balance (Final)
// ============================================

/**
 * A: SKU (barcode), B: Product Name, C: Inward total, D: Outward total,
 * E: Balance, F: ERP Past Balance (NEW — written by ERP)
 */
export const BALANCE_COLS = {
    SKU: 0,
    PRODUCT_NAME: 1,
    INWARD_TOTAL: 2,
    OUTWARD_TOTAL: 3,
    BALANCE: 4,
    ERP_PAST_BALANCE: 5,    // col F — written by offload worker
} as const;

// ============================================
// SOURCE MAPPING
// ============================================

/**
 * Maps inward source (col E) to TXN_REASON values.
 * Unknown sources default to 'production'.
 */
export const INWARD_SOURCE_MAP: Record<string, TxnReason> = {
    sampling: 'production',
    production: 'production',
    tailor: 'production',
    repacking: 'return_receipt',
    return: 'return_receipt',
    adjustment: 'adjustment',
    received: 'production',
    warehouse: 'adjustment',
    'op stock': 'adjustment',
    alteration: 'production',
    rto: 'rto_received',
    reject: 'damage',
};

/**
 * Default reason when source is empty or unknown
 */
export const DEFAULT_INWARD_REASON: TxnReason = 'production';

// ============================================
// OUTWARD DESTINATION MAPPING
// ============================================

/**
 * Maps outward destination (col E) to TXN_REASON values.
 * Used for non-order outward rows (OL Outward tab).
 */
export const OUTWARD_DESTINATION_MAP: Record<string, TxnReason> = {
    'op stock': 'adjustment',
    warehouse: 'adjustment',
    customer: 'order_allocation',
    tailor: 'adjustment',
};

/**
 * Default reason when destination is empty or unknown
 */
export const DEFAULT_OUTWARD_REASON: TxnReason = 'sale';

// ============================================
// TIMING
// ============================================

/**
 * Interval between offload cycles (ms) — hourly, not time-critical
 */
export const OFFLOAD_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Only ingest rows older than this many days
 */
export const OFFLOAD_AGE_DAYS = 30;

/**
 * Delay before first offload after server start (ms) — let server settle
 */
export const STARTUP_DELAY_MS = 5 * 60 * 1000;

/**
 * Delay between Google Sheets API calls (ms) — stay under 300/min quota
 */
export const API_CALL_DELAY_MS = 200;

/**
 * Max retries for transient API errors (429, 500, 503)
 */
export const API_MAX_RETRIES = 3;

/**
 * Rows per ingestion batch — controls memory and DB batch size
 */
export const BATCH_SIZE = 500;

// ============================================
// AUTH
// ============================================

/**
 * Path to Google service account key file
 */
export const GOOGLE_SERVICE_ACCOUNT_PATH = resolve(__dirname, '../../../config/google-service-account.json');

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
    ORDERS_OUTWARD_OLD: 'sheet:orders-outward-old',
    MASTERSHEET_OUTWARD: 'sheet:ms-outward',
} as const;

/**
 * Notes prefix for offloaded transactions — searchable for rollback
 */
export const OFFLOAD_NOTES_PREFIX = '[sheet-offload]';

// ============================================
// ROLLBACK — ORIGINAL FORMULA
// ============================================

/**
 * Original Balance (Final) formula before ERP offload.
 * Saved here so it can be restored if offload is rolled back.
 *
 * Row 3 example (adjust row as needed):
 * =SUMIF('Inward (Final)'!$A:$A,$A3,'Inward (Final)'!$B:$B)
 *  +SUMIF('Inward (Archive)'!$A:$A,$A3,'Inward (Archive)'!$B:$B)
 *  -SUMIF(Outward!$A:$A,$A3,Outward!$B:$B)
 *  -SUMIF('Orders Outward'!$A:$A,$A3,'Orders Outward'!$B:$B)
 *  -SUMIF('Orders Outward 12728-41874'!$N:$N,$A3,'Orders Outward 12728-41874'!$O:$O)
 */
export const ORIGINAL_BALANCE_FORMULA = `=SUMIF('Inward (Final)'!$A:$A,$A3,'Inward (Final)'!$B:$B)+SUMIF('Inward (Archive)'!$A:$A,$A3,'Inward (Archive)'!$B:$B)-SUMIF(Outward!$A:$A,$A3,Outward!$B:$B)-SUMIF('Orders Outward'!$A:$A,$A3,'Orders Outward'!$B:$B)-SUMIF('Orders Outward 12728-41874'!$N:$N,$A3,'Orders Outward 12728-41874'!$O:$O)`;

/**
 * New Balance formula after offload — uses ERP Past Balance + recent data only.
 * Removes Archive and old outward SUMIFs (those live in ERP now).
 */
export const NEW_BALANCE_FORMULA = `=F3+SUMIF('Inward (Final)'!$A:$A,$A3,'Inward (Final)'!$B:$B)-SUMIF(Outward!$A:$A,$A3,Outward!$B:$B)-SUMIF('Orders Outward'!$A:$A,$A3,'Orders Outward'!$B:$B)`;
