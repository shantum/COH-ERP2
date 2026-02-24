/**
 * Column mappings and header arrays for all Google Sheets tabs.
 */

// ============================================
// COLUMN MAPPINGS — Orders from COH (Mastersheet)
// ============================================

/**
 * Orders from COH tab — open orders with allocation.
 * Col O = "Picked", Col U = "Packed", Col X = "Shipped" (TRUE/FALSE),
 * Col AD = "Outward Done" (1 = already moved), Col AE = "Unique ID" (formula: =B&G&I).
 * A row is eligible for move to Outward (Live) when Picked+Packed+Shipped all TRUE,
 * Outward Done!=1, and AWB/Courier/AWB Scan are present.
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
    CHANNEL_STATUS: 24, // Y — channel fulfillment status (e.g. "shipped", "delivered")
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
// COLUMN MAPPINGS — Fabric Balances (COH Orders Mastersheet)
// ============================================

/**
 * Fabric Balances tab — lives in COH Orders Mastersheet.
 * Lists all active fabric colours with system balances.
 * Users enter physical counts in col G for reconciliation.
 */
export const FABRIC_BALANCES_COLS = {
    FABRIC_CODE: 0,         // A — unique fabric code (e.g., LIN-60L-NVY)
    MATERIAL: 1,            // B — material name
    FABRIC: 2,              // C — fabric name
    COLOUR: 3,              // D — colour name
    UNIT: 4,                // E — meters or kg
    SYSTEM_BALANCE: 5,      // F — ERP currentBalance (auto-updated)
    PHYSICAL_COUNT: 6,      // G — **USER ENTERS** physical stock count
    VARIANCE: 7,            // H — formula: =IF(G="","",G-F)
    NOTES: 8,               // I — **USER ENTERS** notes
    STATUS: 9,              // J — import status (DONE:timestamp after import)
} as const;

/**
 * Cells where the team enters when the physical count was taken.
 * Import calculates balance AS OF this date+time, so entries
 * after the count don't affect the adjustment.
 *
 * L1 = "Count Date:" label,  M1 = date (calendar picker)
 * N1 = "Time:" label,        O1 = time (dropdown: 6:00 AM – 11:30 PM)
 */
export const FABRIC_BALANCES_COUNT_DATETIME = {
    DATE_CELL: 'M1',
    TIME_CELL: 'O1',
} as const;

/**
 * Header row for Fabric Balances tab
 */
export const FABRIC_BALANCES_HEADERS = [
    'Fabric Code',
    'Material',
    'Fabric',
    'Colour',
    'Unit',
    'System Balance',
    'Physical Count',
    'Variance',
    'Notes',
    'Status',
] as const;

// ============================================
// COLUMN MAPPINGS — Fabric Inward (Live) (Mastersheet)
// ============================================

/**
 * Fabric Inward (Live) — buffer tab in COH Orders Mastersheet.
 * Team enters fabric receipts from suppliers. ERP validates & imports.
 * A: Material (dropdown), B: Fabric (dropdown), C: Colour (dropdown),
 * D: Fabric Code (auto-fill), E: Qty, F: Unit (auto-fill),
 * G: Cost Per Unit, H: Supplier, I: Date, J: Notes, K: Status
 */
export const FABRIC_INWARD_LIVE_COLS = {
    MATERIAL: 0,      // A — dropdown (team picks)
    FABRIC: 1,        // B — dropdown (team picks)
    COLOUR: 2,        // C — dropdown (team picks)
    FABRIC_CODE: 3,   // D — auto-fill from Material+Fabric+Colour
    QTY: 4,           // E — team enters
    UNIT: 5,          // F — auto-fill from Fabric Code
    COST_PER_UNIT: 6, // G — team enters (₹)
    SUPPLIER: 7,      // H — free text
    DATE: 8,          // I — DD/MM/YYYY
    NOTES: 9,         // J — optional
    STATUS: 10,       // K — ERP writes: ok / error / DONE:{refId}
} as const;

/**
 * Header row for Fabric Inward (Live) tab
 */
export const FABRIC_INWARD_LIVE_HEADERS = [
    'Material',
    'Fabric',
    'Colour',
    'Fabric Code',
    'Qty',
    'Unit',
    'Cost Per Unit',
    'Supplier',
    'Date',
    'Notes',
    'Status',
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
