/**
 * Google Sheets Offload Configuration
 *
 * Defines spreadsheet IDs, tab names, column mappings, and timing for the
 * sheet offload worker that ingests historical data from Google Sheets into the ERP.
 *
 * TO CHANGE OFFLOAD SETTINGS:
 * Simply update the values in the relevant sub-module. Changes take effect on next sync cycle.
 */

export {
    // Feature flags
    ENABLE_SHEET_OFFLOAD,
    INGESTED_PREFIX,
    CLEANUP_RETENTION_DAYS,
    // Spreadsheet IDs
    ORDERS_MASTERSHEET_ID,
    OFFICE_LEDGER_ID,
    BARCODE_MASTERSHEET_ID,
    // Fabric ledger flags
    ENABLE_FABRIC_LEDGER_PUSH,
    FABRIC_LEDGER_PUSH_INTERVAL_MS,
    // Tab names
    LEDGER_TABS,
    LIVE_TABS,
    MASTERSHEET_TABS,
    BARCODE_TABS,
} from './spreadsheets.js';

export {
    // Column mappings
    ORDERS_FROM_COH_COLS,
    INVENTORY_TAB,
    INWARD_COLS,
    INWARD_LIVE_COLS,
    OUTWARD_LIVE_COLS,
    OUTWARD_COLS,
    ORDERS_OUTWARD_COLS,
    MASTERSHEET_OUTWARD_COLS,
    BARCODE_MAIN_COLS,
    FABRIC_BALANCES_COLS,
    FABRIC_BALANCES_COUNT_DATETIME,
    FABRIC_BALANCES_HEADERS,
    FABRIC_INWARD_LIVE_COLS,
    FABRIC_INWARD_LIVE_HEADERS,
    RETURN_EXCHANGE_COLS,
    BALANCE_COLS,
} from './columns.js';

export {
    // Return source mapping
    RETURN_SOURCE_MAP,
    DEFAULT_RETURN_SOURCE,
    // Inward source mapping
    INWARD_SOURCE_MAP,
    DEFAULT_INWARD_REASON,
    VALID_INWARD_LIVE_SOURCES,
    FABRIC_DEDUCT_SOURCES,
    PRODUCTION_BOOKING_SOURCES,
    // Outward destination mapping
    OUTWARD_DESTINATION_MAP,
    DEFAULT_OUTWARD_REASON,
} from './mappings.js';

export {
    // Timing
    OFFLOAD_INTERVAL_MS,
    STARTUP_DELAY_MS,
    API_CALL_DELAY_MS,
    API_MAX_RETRIES,
    BATCH_SIZE,
    // Validation limits
    MAX_QTY_PER_ROW,
    MAX_FUTURE_DAYS,
    MAX_PAST_DAYS,
    // Auth
    GOOGLE_SERVICE_ACCOUNT_PATH,
    SHEETS_API_SCOPE,
    // Reference ID prefixes
    REF_PREFIX,
    OFFLOAD_NOTES_PREFIX,
} from './timing.js';

export {
    // Formulas
    ORIGINAL_BALANCE_FORMULA,
    PHASE2_BALANCE_FORMULA,
    LIVE_BALANCE_FORMULA_TEMPLATE,
    INVENTORY_BALANCE_FORMULA_TEMPLATE,
    LIVE_BALANCE_FORMULA_V2_TEMPLATE,
} from './formulas.js';
