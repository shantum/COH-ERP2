/**
 * Spreadsheet IDs, tab names, and feature flags.
 */

// ============================================
// FEATURE FLAGS
// ============================================

/**
 * Master switch — worker doesn't start unless true.
 * Set via ENABLE_SHEET_OFFLOAD environment variable.
 */
export const ENABLE_SHEET_OFFLOAD = process.env.ENABLE_SHEET_OFFLOAD === 'true';

/**
 * Prefix written to the Import Status column when a row is successfully ingested.
 * Format: "DONE:{referenceId}" — fully traceable back to the InventoryTransaction.
 */
export const INGESTED_PREFIX = 'DONE:' as const;

/**
 * How many days to keep DONE rows before cleanup deletes them.
 */
export const CLEANUP_RETENTION_DAYS = 0;

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
    FABRIC_INWARD: 'Fabric Inward (Live)',
} as const;

export const MASTERSHEET_TABS = {
    ORDERS_FROM_COH: 'Orders from COH',
    INVENTORY: 'Inventory',
    OFFICE_INVENTORY: 'Office Inventory',
    OUTWARD: 'Outward',
    FABRIC_BALANCES: 'Fabric Balances',
} as const;

export const BARCODE_TABS = {
    MAIN: 'Sheet1',
    FABRIC_BALANCES: 'Fabric Balances',  // New tab — ERP pushes fabric data here
    PRODUCT_WEIGHTS: 'Product Weights',
} as const;
