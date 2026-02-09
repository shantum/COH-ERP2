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
 * @deprecated No longer used by ingestion — replaced by non-destructive DONE marking.
 * Kept for reference only. Ingestion now writes "DONE:{referenceId}" to the status column.
 */
export const ENABLE_SHEET_DELETION = process.env.ENABLE_SHEET_DELETION === 'true';

/**
 * Prefix written to the Import Status column when a row is successfully ingested.
 * Format: "DONE:{referenceId}" — fully traceable back to the InventoryTransaction.
 */
export const INGESTED_PREFIX = 'DONE:' as const;

/**
 * How many days to keep DONE rows before cleanup deletes them.
 */
export const CLEANUP_RETENTION_DAYS = 7;

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

/**
 * Barcode Mastersheet
 * Contains: SKU master data (barcode, style code, fabric code), Fabric Balances tab
 */
export const BARCODE_MASTERSHEET_ID = '1xlK4gO2Gxu8-8-WS4jFnR0uxYO35fEBPZiSbJobGVy8';

// ============================================
// FEATURE FLAGS (FABRIC LEDGER)
// ============================================

/**
 * Enable fabric ledger push — when true, ERP pushes fabric balances to Barcode Mastersheet.
 */
export const ENABLE_FABRIC_LEDGER_PUSH = process.env.ENABLE_FABRIC_LEDGER_PUSH === 'true';

/**
 * Fabric ledger push interval (ms) — how often to push fabric balances.
 * Default: 15 minutes.
 */
export const FABRIC_LEDGER_PUSH_INTERVAL_MS = parseInt(
    process.env.FABRIC_LEDGER_PUSH_INTERVAL_MS || String(15 * 60 * 1000),
    10
);

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
    RETURN_EXCHANGE_PENDING: 'Return & Exchange Pending Pieces',
} as const;

/**
 * Live buffer tabs in the COH Orders Mastersheet (not Office Ledger).
 * Ops team enters new inward/outward here. Worker ingests + deletes rows.
 */
export const LIVE_TABS = {
    INWARD: 'Inward (Live)',
    OUTWARD: 'Outward (Live)',
} as const;

export const MASTERSHEET_TABS = {
    ORDERS_FROM_COH: 'Orders from COH',
    INVENTORY: 'Inventory',
    OFFICE_INVENTORY: 'Office Inventory',
    OUTWARD: 'Outward',
} as const;

export const BARCODE_TABS = {
    MAIN: 'Sheet1',
    FABRIC_BALANCES: 'Fabric Balances',  // New tab — ERP pushes fabric data here
    PRODUCT_WEIGHTS: 'Product Weights',
} as const;

// ============================================
// COLUMN MAPPINGS — Orders from COH (Mastersheet)
// ============================================

/**
 * Orders from COH tab — open orders with allocation.
 * Col O = "Picked", Col U = "Packed", Col X = "Shipped" (TRUE/FALSE),
 * Col AD = "Outward Done" (1 = already moved), Col AE = "Unique ID" (formula: =B&G&I).
 * A row is eligible for move to Outward (Live) when Picked+Packed+Shipped all TRUE,
 * Outward Done≠1, and AWB/Courier/AWB Scan are present.
 *
 * Relevant columns for the move:
 * B: Order Number, G: SKU, I: Qty, K: Order Note, L: COH Note,
 * O: Picked, R: Sampling Date, U: Packed, X: Shipped,
 * Z: Courier, AA: AWB, AC: AWB Scan, AD: Outward Done, AE: Unique ID
 */
export const ORDERS_FROM_COH_COLS = {
    ORDER_DATE: 0,      // A — "Order" (date the order was placed)
    ORDER_NO: 1,        // B
    SKU: 6,             // G
    QTY: 8,             // I
    ORDER_NOTE: 10,     // K
    COH_NOTE: 11,       // L
    PICKED: 14,         // O
    SAMPLING_DATE: 17,  // R
    PACKED: 20,         // U
    SHIPPED: 23,        // X
    COURIER: 25,        // Z
    AWB: 26,            // AA
    AWB_SCAN: 28,       // AC
    OUTWARD_DONE: 29,   // AD
    UNIQUE_ID: 30,      // AE — formula: =B&G&I (order#+sku+qty)
} as const;

// ============================================
// COLUMN MAPPINGS — Inventory tab (Mastersheet)
// ============================================

/**
 * Inventory tab in COH Orders Mastersheet.
 * Col R = ERP currentBalance (written by worker).
 * Col C = R + SUMIF(Inward Live) - SUMIF(Outward Live) (formula).
 * Col D = allocated from Orders from COH.
 * Col E = C - D (net balance).
 * Data starts at row 4 (rows 1-3 are headers/sums).
 */
export const INVENTORY_TAB = {
    NAME: 'Inventory',
    DATA_START_ROW: 4,
    ERP_BALANCE_COL: 'R',     // col R = ERP currentBalance
    BALANCE_COL: 'C',         // col C = total balance (formula)
    SKU_COL: 'A',             // col A = SKU/barcode
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
// COLUMN MAPPINGS — Inward (Live) (Mastersheet)
// ============================================

/**
 * Inward (Live) — buffer tab in COH Orders Mastersheet.
 * Same structure as Inward (Final) + Notes column + Import Errors.
 * A: SKU, B: Qty, C: Product Details, D: Inward Date,
 * E: Source, F: Done By, G: Unique Barcode, H: Tailor Number, I: Notes,
 * J: Import Errors
 */
export const INWARD_LIVE_COLS = {
    SKU: 0,         // A
    QTY: 1,         // B
    PRODUCT: 2,     // C
    DATE: 3,        // D
    SOURCE: 4,      // E
    DONE_BY: 5,     // F
    BARCODE: 6,     // G
    TAILOR: 7,      // H
    NOTES: 8,       // I
    IMPORT_ERRORS: 9, // J
} as const;

// ============================================
// COLUMN MAPPINGS — Outward (Live) (Mastersheet)
// ============================================

/**
 * Outward (Live) — buffer tab in COH Orders Mastersheet.
 * Layout matches "Orders from COH" (cols A-AD) + Outward Date at AE + Unique ID at AF + Import Errors at AG.
 * This allows simple copy-paste from Orders from COH for emergency outward.
 *
 * A: Order Date, B: Order#, C: Name, D: City, E: Mob, F: Channel,
 * G: SKU, H: Product Name, I: Qty, J: Status, K: Order Note, L: COH Note,
 * M-P: (Qty Balance, Assigned, Picked, Order Age), Q: source_, R: samplingDate,
 * S: Fabric Stock, T: (empty), U: Packed, V-W: (empty), X: Shipped,
 * Y: Shopify Status, Z: Courier, AA: AWB, AB: Ready To Ship,
 * AC: AWB Scan, AD: Outward Done, AE: Outward Date, AF: Unique ID,
 * AG: Import Errors
 */
export const OUTWARD_LIVE_COLS = {
    ORDER_DATE: 0,      // A — order placement date
    ORDER_NO: 1,        // B
    NAME: 2,            // C
    CITY: 3,            // D
    MOB: 4,             // E
    CHANNEL: 5,         // F
    SKU: 6,             // G
    PRODUCT: 7,         // H — Product Name (value, not formula)
    QTY: 8,             // I
    STATUS: 9,          // J
    ORDER_NOTE: 10,     // K
    COH_NOTE: 11,       // L
    // M-T: not used by ingestion (Qty Balance, Assigned, Picked, Order Age, source_, samplingDate, Fabric Stock, empty)
    SAMPLING_DATE: 17,  // R
    COURIER: 25,        // Z
    AWB: 26,            // AA
    AWB_SCAN: 28,       // AC
    OUTWARD_DONE: 29,   // AD
    OUTWARD_DATE: 30,   // AE — outward/dispatch date
    UNIQUE_ID: 31,      // AF — generated: order#+sku+qty (for move verification)
    IMPORT_ERRORS: 32,  // AG
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
// COLUMN MAPPINGS — Barcode Mastersheet (Sheet1)
// ============================================

/**
 * Barcode Mastersheet main tab — SKU master data.
 * A: Barcode, B: Product Title, C: Color, D: Size, E: name,
 * F: Style Code, G: Fabric Code, H: Product Status, ...
 */
export const BARCODE_MAIN_COLS = {
    BARCODE: 0,         // A — SKU/barcode identifier
    PRODUCT_TITLE: 1,   // B
    COLOR: 2,           // C
    SIZE: 3,            // D
    NAME: 4,            // E — Full SKU name
    STYLE_CODE: 5,      // F
    FABRIC_CODE: 6,     // G
    STATUS: 7,          // H — "Inactive" or empty
    SKU_COUNT: 8,       // I
    DATE_ADDED: 9,      // J
    GENDER: 10,         // K
    WEBSITE_COLOUR: 11, // L
    MRP: 12,            // M
} as const;

// ============================================
// COLUMN MAPPINGS — Fabric Balances (new tab in Barcode Mastersheet)
// ============================================

/**
 * Fabric Balances tab — ERP pushes fabric data here.
 * Other sheets can VLOOKUP/IMPORTRANGE from this tab.
 */
export const FABRIC_BALANCES_COLS = {
    FABRIC_CODE: 0,         // A — unique fabric code (e.g., Pima-SJ-Black)
    FABRIC_NAME: 1,         // B — full name
    MATERIAL: 2,            // C
    CURRENT_BALANCE: 3,     // D
    UNIT: 4,                // E — meters or kg
    COST_PER_UNIT: 5,       // F
    SUPPLIER: 6,            // G
    LEAD_TIME_DAYS: 7,      // H
    PENDING_ORDERS_QTY: 8,  // I — fabric allocated to unfulfilled orders
    AVAILABLE_BALANCE: 9,   // J — formula: =D-I
    CONSUMPTION_30D: 10,    // K — 30-day usage
    REORDER_POINT: 11,      // L — formula: =K*H/30
    LAST_UPDATED: 12,       // M — ISO timestamp
} as const;

/**
 * Header row for Fabric Balances tab
 */
export const FABRIC_BALANCES_HEADERS = [
    'Fabric Code',
    'Fabric Name',
    'Material',
    'Current Balance',
    'Unit',
    'Cost per Unit',
    'Supplier',
    'Lead Time (days)',
    'Pending Orders Qty',
    'Available Balance',
    '30-Day Consumption',
    'Reorder Point',
    'Last Updated',
] as const;

// ============================================
// COLUMN MAPPINGS — Return & Exchange Pending Pieces (Office Ledger)
// ============================================

/**
 * Return & Exchange Pending Pieces tab — piece-level tracking.
 * A: uniqueBarcode, B: Product Barcode (SKU), C: productName,
 * D: Qty, E: Source, F: Order ID, G: Return ID, H: Customer Name,
 * I: Date Received, J: (empty), K: Note, L: Inward Count, M: timestamp
 */
export const RETURN_EXCHANGE_COLS = {
    UNIQUE_BARCODE: 0,   // A — unique ID per physical piece
    SKU: 1,              // B — Product Barcode (SKU)
    PRODUCT_NAME: 2,     // C — (often #REF!)
    QTY: 3,              // D — always 1
    SOURCE: 4,           // E — Return, Exchange, RTO, etc.
    ORDER_ID: 5,         // F — Shopify order number
    RETURN_ID: 6,        // G — Return Prime / marketplace ID
    CUSTOMER_NAME: 7,    // H
    DATE_RECEIVED: 8,    // I
    NOTE: 10,            // K
    INWARD_COUNT: 11,    // L — 0=pending, 1=inwarded
    TIMESTAMP: 12,       // M
} as const;

/**
 * Maps Return & Exchange Source values to normalized enum.
 */
export const RETURN_SOURCE_MAP: Record<string, 'RETURN' | 'EXCHANGE' | 'RTO' | 'REPACKING' | 'OTHER'> = {
    return: 'RETURN',
    'return ': 'RETURN',
    retrun: 'RETURN',
    retunr: 'RETURN',
    returm: 'RETURN',
    exchange: 'EXCHANGE',
    'exchange ': 'EXCHANGE',
    exchnage: 'EXCHANGE',
    excahnge: 'EXCHANGE',
    exchagne: 'EXCHANGE',
    exchnge: 'EXCHANGE',
    exchangeq: 'EXCHANGE',
    rto: 'RTO',
    'rto - used': 'RTO',
    repacking: 'REPACKING',
    other: 'OTHER',
    refund: 'OTHER',
    nykaa: 'OTHER',
    pima: 'OTHER',
};

export const DEFAULT_RETURN_SOURCE = 'OTHER' as const;

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

/**
 * Valid sources for Inward (Live) entries.
 * Rows with sources not in this list are rejected during ingestion.
 */
export const VALID_INWARD_LIVE_SOURCES = ['sampling', 'repacking', 'adjustment'] as const;

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
 * Interval between offload cycles (ms) — every 30 minutes for live buffer tabs
 */
export const OFFLOAD_INTERVAL_MS = 30 * 60 * 1000;

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
    INWARD_LIVE: 'sheet:inward-live',
    OUTWARD_LIVE: 'sheet:outward-live',
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
 * Phase 2 formula — used ERP Past Balance + remaining active sheet tabs.
 * Kept for reference / rollback to Phase 2 state.
 */
export const PHASE2_BALANCE_FORMULA = `=F3+SUMIF('Inward (Final)'!$A:$A,$A3,'Inward (Final)'!$B:$B)-SUMIF(Outward!$A:$A,$A3,Outward!$B:$B)-SUMIF('Orders Outward'!$A:$A,$A3,'Orders Outward'!$B:$B)`;

/**
 * Phase 3 formula — ERP currentBalance (col F) + pending buffer entries.
 * Col F is written by the worker after each ingestion cycle.
 * Live tabs are in COH Orders Mastersheet (IMPORTRANGE or same-sheet reference).
 *
 * NOTE: Live tabs are in the COH Orders Mastersheet, so Balance (Final) in Office Ledger
 * needs IMPORTRANGE. The formula uses the Mastersheet ID for cross-sheet references.
 *
 * Outward (Live) layout matches Orders from COH (A-AD) + AE=Outward Date.
 * SKU is in col G (not A), Qty is in col I (not B) — hence $G:$G and $I:$I.
 */
export const LIVE_BALANCE_FORMULA_TEMPLATE = (row: number) =>
    `=F${row}+IFERROR(SUMIF(IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$A:$A"),$A${row},IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$B:$B")),0)-IFERROR(SUMIF(IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$G:$G"),$A${row},IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$I:$I")),0)`;

/**
 * V2 Inventory balance formula — Mastersheet Inventory col C.
 * Uses SUMIFS with "<>DONE:*" to exclude ingested rows from live buffer counts.
 * Same spreadsheet (no IMPORTRANGE needed).
 */
export const INVENTORY_BALANCE_FORMULA_TEMPLATE = (row: number) =>
    `=R${row}+SUMIFS('Inward (Live)'!$B:$B,'Inward (Live)'!$A:$A,$A${row},'Inward (Live)'!$J:$J,"<>DONE:*")-SUMIFS('Outward (Live)'!$I:$I,'Outward (Live)'!$G:$G,$A${row},'Outward (Live)'!$AG:$AG,"<>DONE:*")`;

/**
 * V2 Balance (Final) formula — Office Ledger col E.
 * Uses SUMIFS with IMPORTRANGE + "<>DONE:*" to exclude ingested rows.
 * "id" placeholder is replaced with the Mastersheet ID at runtime.
 */
export const LIVE_BALANCE_FORMULA_V2_TEMPLATE = (row: number) =>
    `=F${row}+IFERROR(SUMIFS(IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$B:$B"),IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$A:$A"),$A${row},IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$J:$J"),"<>DONE:*"),0)-IFERROR(SUMIFS(IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$I:$I"),IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$G:$G"),$A${row},IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$AG:$AG"),"<>DONE:*"),0)`;
