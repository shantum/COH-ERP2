# Google Sheets Hybrid System

The Google Sheets hybrid system bridges operations between Google Sheets (used by the ops team) and the ERP database. It handles seven core flows:

1. **Move Shipped -> Outward**: Copies shipped orders from "Orders from COH" to "Outward (Live)" buffer tab
2. **Ingest Buffer Tabs**: Reads "Inward (Live)" and "Outward (Live)" into ERP `InventoryTransaction` records, marks rows as DONE
3. **Push Balances**: Pushes ERP `currentBalance` to Sheets (Inventory col R, Balance Final col F) via batch API
4. **Fabric Flows**: Push/import fabric balances, ingest fabric inward transactions
5. **Push Orders to Sheet**: Auto-pushes new Shopify and ERP-created orders to "Orders from COH"
6. **Cleanup DONE Rows**: Deletes ingested (DONE-marked) rows older than 7 days
7. **Migrate Formulas**: Rewrites sheet formulas from SUMIF to V2 SUMIFS (excludes DONE rows)

The system is designed so that **ingestion never causes double-counting** -- the combined view formula automatically adjusts as rows are marked DONE and balances update.

---

## 1. System Architecture

### Three Spreadsheets

| Name | Constant | ID | Key Tabs |
|------|----------|----|----------|
| **COH Orders Mastersheet** | `ORDERS_MASTERSHEET_ID` | `1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo` | Orders from COH, Inventory, Inward (Live), Outward (Live), Outward, Fabric Inward (Live) |
| **Office Ledger** | `OFFICE_LEDGER_ID` | `1ZZgzu4xPXhP9ba3-liXHxj5tY0HihoEnVC9-wLijD5E` | Inward (Final), Inward (Archive), Balance (Final), Returns/Exchange |
| **Barcode Mastersheet** | `BARCODE_MASTERSHEET_ID` | `1xlK4gO2Gxu8-8-WS4jFnR0uxYO35fEBPZiSbJobGVy8` | Main (SKU master), Fabric Balances |

### Three Buffer Tabs (in Mastersheet)

- **Inward (Live)**: Ops team enters new inward transactions (columns A-J: SKU, Qty, Product, Date, Source, Done By, Barcode, Tailor Number, Notes, Import Errors)
- **Outward (Live)**: Ops team enters outward transactions OR shipped orders are auto-moved here (columns A-AG: matches Orders from COH layout + Outward Date, Unique ID, Import Errors)
- **Fabric Inward (Live)**: Ops team enters fabric inward transactions (columns A-G: Fabric Code, Qty, Date, Source, Done By, Notes, Import Errors)

Buffer tabs are in the Mastersheet so the Inventory tab formula can reference them via same-sheet SUMIFS (no IMPORTRANGE needed).

### Non-Destructive DONE Marking

Instead of deleting ingested rows immediately, rows are marked with `DONE:{referenceId}` in their Import Errors column. This is safer -- data stays visible for verification. The V2 SUMIFS formulas exclude DONE rows, so the balance formula works correctly even with DONE rows present.

```
INGESTED_PREFIX = 'DONE:'   (from config/sync/sheets.ts)
CLEANUP_RETENTION_DAYS = 7  (DONE rows deleted after 7 days by cleanup job)
```

### Data Flow

```
Shopify webhook (new order) --[pushNewOrderToSheet]---> Orders from COH ---+
ERP-created order -----------[pushERPOrderToSheet]----> Orders from COH ---+
Self-healing reconciler -----[reconcileSheetOrders]---> Orders from COH ---+
                                                                            |
Orders from COH (shipped) --[move_shipped_to_outward]--> Outward (Live) ---+
                                                                            |
Ops team manual entry ----------------------------------------> Inward (Live) --+
Ops team fabric entry --------------------------------> Fabric Inward (Live) --+
                                                                                |
                          +-----------------------------------------------------+
                          |
                          v
               +-------------------------+    +----------------------------+
               |  [ingest_inward]        |    |  [ingest_outward]          |
               |  Inward (Live) -> DB    |    |  Outward (Live) -> DB      |
               |  + fabric deduction     |    |  + link OrderLines         |
               |  + mark DONE            |    |  + mark DONE               |
               +------------+------------+    +-------------+--------------+
                            |                               |
                            v                               v
               +-------------------------+    +----------------------------+
               |  [push_balances]        |    |  [push_fabric_balances]    |
               |  DB -> Inventory col R  |    |  DB -> Fabric Balances tab |
               |  DB -> Balance Final F  |    +----------------------------+
               +-------------------------+
                                              +----------------------------+
               +-------------------------+    |  [import_fabric_balances]  |
               |  [cleanup_done_rows]    |    |  Sheet -> DB reconcile     |
               |  Delete old DONE rows   |    +----------------------------+
               +-------------------------+
                                              +----------------------------+
               +-------------------------+    |  [ingest_fabric_inward]    |
               |  [migrate_sheet_formulas]|   |  Fabric Inward (Live)->DB  |
               |  SUMIF -> SUMIFS V2     |    +----------------------------+
               +-------------------------+
```

Nine independent jobs managed by `sheetOffloadWorker.ts`:
- **`ingest_inward`** -- Reads Inward (Live), creates INWARD transactions, deducts fabric for sampling, marks DONE, pushes balances, invalidates caches.
- **`ingest_outward`** -- Reads Outward (Live), creates OUTWARD transactions, links to OrderLines (evidence-based fulfillment), marks DONE, pushes balances, invalidates caches.
- **`move_shipped_to_outward`** -- Manual trigger only. Copies shipped rows from "Orders from COH" to "Outward (Live)" with verification step. No balance updates.
- **`push_balances`** -- Standalone job: pushes ERP `currentBalance` to Inventory col R and Balance Final col F via batch API.
- **`push_fabric_balances`** -- Pushes `FabricColour.currentBalance` to Fabric Balances tab in Barcode Mastersheet.
- **`import_fabric_balances`** -- Reads Fabric Balances tab from sheet, reconciles against ERP using time-aware historical balance calculation.
- **`ingest_fabric_inward`** -- Reads Fabric Inward (Live), creates `FabricColourTransaction` records, marks DONE.
- **`cleanup_done_rows`** -- Deletes rows marked `DONE:*` that are older than 7 days from Inward (Live) and Outward (Live).
- **`migrate_sheet_formulas`** -- Rewrites Inventory col C and Balance Final col E formulas from SUMIF to V2 SUMIFS (excludes DONE rows).

---

## 1b. Sheet Order Push (Webhook + ERP Orders to Sheet)

**File:** `server/src/services/sheetOrderPush.ts`

### Shopify Order Push

When a new Shopify order arrives via webhook and is processed (action === 'created'), the ERP automatically appends one row per line item to the "Orders from COH" tab. This lets the ops team start processing immediately without manual entry.

**Trigger** in `server/src/routes/webhooks.ts`:

```typescript
if (result.action === 'created') {
    deferredExecutor.enqueue(async () => {
        await pushNewOrderToSheet(shopifyOrder);
    }, { orderId: result.orderId, action: 'push_order_to_sheet' });
}
```

**Important:** Shopify sometimes sends new orders as `orders/updated` (not `orders/create`), so the trigger checks `result.action` not the webhook topic.

### ERP-Created Order Push

`pushERPOrderToSheet(orderId)` handles manual and exchange orders created directly in the ERP. Queries the order from DB with orderLines and maps to the same 30-column row format. Also writes "SHIP BY {date}" to col L (COH Notes) if `shipByDate` is set.

### Column Mapping (both Shopify and ERP orders)

Each line item becomes one row in "Orders from COH" (A:AD = 30 columns):

| Column | Index | Content | Source |
|--------|-------|---------|--------|
| A | 0 | Order Date | `created_at` formatted as `YYYY-MM-DD HH:MM:SS` in IST |
| B | 1 | Order # | `name` (e.g., `#1234`) |
| C | 2 | Customer Name | `shipping_address.first_name + last_name` |
| D | 3 | City | `shipping_address.city` |
| E | 4 | Phone | `shipping_address.phone` |
| F | 5 | Channel | `payment_gateway_names[0]` (e.g., "shopflo", "Cash on Delivery (COD)") |
| G | 6 | SKU | `line_items[].sku` |
| H | 7 | Product Name | **Left empty** -- populated by VLOOKUP array formula on the sheet |
| I | 8 | Qty | `line_items[].quantity` |
| K | 10 | Order Note | `note` |
| L | 11 | COH Notes | ERP orders only: "SHIP BY {date}" if shipByDate set |

### Formatting

After appending rows, adds a bottom border on the last row of the order (visual separator between orders). Uses `addBottomBorders()` from `googleSheetsClient.ts`.

### Self-Healing Reconciler

`reconcileSheetOrders()` finds orders that were never pushed to the sheet and pushes them. Runs as the `reconcile_sheet_orders` background job.

- Looks back `RECONCILE_LOOKBACK_DAYS` (3 days) for orders where `sheetPushedAt IS NULL`
- Pushes up to `RECONCILE_BATCH_LIMIT` (20) at a time, oldest first
- Uses `pushERPOrderToSheet()` which handles all mapping + stamping
- Returns `ReconcileResult` with `{ found, pushed, failed, errors, durationMs }`

### Stamping

After a successful push, `stampSheetPushed(orderId)` sets `order.sheetPushedAt = new Date()`. This prevents re-pushing and enables the reconciler to detect missed orders.

### Design Decisions

- **Fire-and-forget** via `deferredExecutor` -- never blocks webhook response
- **No feature flag** -- always on (relies on Google Sheets auth being configured)
- **Channel uses `payment_gateway_names[0]`** not `source_name` (matches ops team expectations)
- **Errors logged but never block** order processing (try/catch with log.error)
- **Col H left empty** because the sheet has a VLOOKUP array formula that fills Product Name from SKU

---

## 1c. "Orders from COH" Tab -- Complete Column Reference

The main orders tab in the COH Orders Mastersheet (~270 active rows). Each row = one order line item. This is where the ops team manages order fulfillment day-to-day.

### All Columns (A through AG)

**Data columns (pushed by ERP or filled by ops):**

| Col | Index | Header | Filled by | Description |
|-----|-------|--------|-----------|-------------|
| A | 0 | Order | ERP push | Order date (`YYYY-MM-DD HH:MM:SS` IST) |
| B | 1 | Order # | ERP push | Shopify order name or marketplace order ID (e.g. `64739`, `NYK-36324645...`) |
| C | 2 | Name | ERP push | Customer name |
| D | 3 | City | ERP push | Shipping city |
| E | 4 | Mob | ERP push | Customer phone |
| F | 5 | Channel | ERP push | Payment gateway or marketplace (`shopflo`, `Cash on Delivery (COD)`, `nykaa`, `ajio`) |
| G | 6 | SKU | ERP push | SKU code |
| I | 8 | Qty | ERP push | Line item quantity |
| J | 9 | Status | Ops manual | Order status (free-text) |
| K | 10 | Order Note | ERP push | Customer's note from Shopify |
| L | 11 | COH Note | Ops manual / ERP | Internal team notes. ERP writes "SHIP BY {date}" for orders with shipByDate |
| N | 13 | Assigned | Ops manual | Whether item is assigned (TRUE/FALSE) |
| O | 14 | Picked | Ops manual | Whether picked (TRUE/FALSE) |
| Q | 16 | source_ | Ops manual | Internal status like "Fabric Over" |
| R | 17 | samplingDate | Ops manual | Date when sampling was completed |
| T | 19 | *(empty)* | -- | Not used |
| U | 20 | Packed | Ops manual | Whether packed (TRUE/FALSE) |
| V | 21 | *(empty)* | -- | Not used |
| W | 22 | *(empty)* | -- | Not used |
| X | 23 | Shipped | Ops manual | Whether shipped (TRUE/FALSE) |
| AC | 28 | AWB Scan | Ops manual | Scan confirmation |

**Formula columns (all use ARRAYFORMULA in row 1, auto-fill every row):**

| Col | Index | Header | Formula | What it does |
|-----|-------|--------|---------|-------------|
| H | 7 | Product Name | `VLOOKUP(SKU, Barcodes!A:E, 5)` | Looks up product name from SKU via Barcodes tab |
| M | 12 | Qty Balance | `VLOOKUP(SKU, Inventory!A:G, 5)` | Current stock balance for this SKU. Shows "N/A" if not found |
| P | 15 | Order Age | `TODAY() - DATEVALUE(order_date)` | How old the order is -- "Today", "2d ago", "103d ago" |
| S | 18 | Fabric Stock | `VLOOKUP(channel, #REF!, 17)` | **BROKEN** -- references a deleted sheet. Currently shows nothing |
| Y | 24 | Shopify Status | `VLOOKUP(order_date, ShopifyAllOrderData!A:H, 4)` | Fulfillment status from ShopifyAllOrderData tab |
| Z | 25 | Courier | `VLOOKUP(order_date, ShopifyAllOrderData!A:G, 5)` | Courier name from ShopifyAllOrderData tab |
| AA | 26 | AWB | `VLOOKUP(order_date, ShopifyAllOrderData!A:G, 6)` | Airway bill / tracking number from ShopifyAllOrderData tab |
| AB | 27 | Ready To Ship | `COUNTIFS(order#, assigned=TRUE) = COUNTIFS(order#)` | TRUE only when ALL lines of the order are assigned |
| AD | 29 | Outward Done | `VLOOKUP(UniqueID, Outward!AE:AE, 1)` | Checks if row already exists in Outward tab. Returns 0 if not moved |
| AE | 30 | Unique ID | `Order# & SKU & Qty` | Fingerprint for dedup: order number + SKU + qty concatenated |
| AF | 31 | *(no header)* | `VLOOKUP(SKU, Barcodes!A:G, 7)` | Fabric code for this SKU (helper column) |
| AG | 32 | *(no header)* | `VLOOKUP(SKU, Barcodes!A:P, 16) * Qty` | Total fabric consumption needed (fabric per unit * qty) |

### Order Lifecycle on This Tab

```
New order lands (ERP push) -> Ops assigns (N=TRUE) -> Picks (O=TRUE) -> Packs (U=TRUE) -> Ships (X=TRUE)
    -> Worker moves to Outward (Live) -> Row deleted from this tab
```

### Move-to-Outward Eligibility

A row is eligible for `move_shipped_to_outward` when ALL of:
- Picked (O) = TRUE
- Packed (U) = TRUE
- Shipped (X) = TRUE
- Courier (Z) is filled
- AWB (AA) is filled
- AWB Scan (AC) is filled
- Outward Done (AD) != 1
- SKU (G) is non-empty

### Referenced Tabs

- **Barcodes** -- SKU master (product names, fabric codes, fabric consumption)
- **Inventory** -- Current stock balances per SKU
- **ShopifyAllOrderData** -- Shopify fulfillment status, courier, AWB
- **Outward** -- Historical outward data (used by Outward Done formula to check if already moved)

---

## 2. The Combined View Formula (V2 -- SUMIFS with DONE exclusion)

The key insight that makes the hybrid system safe: **a single formula bridges both systems, and ingestion never changes the displayed balance.**

### V2 Formula: SUMIFS with DONE Exclusion

V2 formulas use SUMIFS instead of SUMIF, adding a condition to exclude rows where the Import Errors column starts with "DONE:". This allows DONE-marked rows to remain on the sheet without affecting balances.

### Inventory Tab (Mastersheet) Col C

```
=R{row} + SUMIFS('Inward (Live)'!$B:$B, 'Inward (Live)'!$A:$A, $A{row},
                  'Inward (Live)'!$J:$J, "<>DONE:*")
        - SUMIFS('Outward (Live)'!$B:$B, 'Outward (Live)'!$A:$A, $A{row},
                  'Outward (Live)'!$AG:$AG, "<>DONE:*")
```

- `R` = ERP `currentBalance` (written by push_balances job)
- SUMIFS counts pending buffer tab rows not yet ingested (excludes DONE rows)

Template: `INVENTORY_BALANCE_FORMULA_TEMPLATE` in `config/sync/sheets.ts`

### Balance (Final) (Office Ledger) Col E

```
=F{row} + IFERROR(SUMIFS(IMPORTRANGE("mastersheet-id","'Inward (Live)'!$B:$B"),
          IMPORTRANGE("mastersheet-id","'Inward (Live)'!$A:$A"), $A{row},
          IMPORTRANGE("mastersheet-id","'Inward (Live)'!$J:$J"), "<>DONE:*"), 0)
        - IFERROR(SUMIFS(IMPORTRANGE("mastersheet-id","'Outward (Live)'!$B:$B"),
          IMPORTRANGE("mastersheet-id","'Outward (Live)'!$A:$A"), $A{row},
          IMPORTRANGE("mastersheet-id","'Outward (Live)'!$AG:$AG"), "<>DONE:*"), 0)
```

- `F` = ERP `currentBalance` (written by push_balances job)
- Uses IMPORTRANGE because live tabs are in a different spreadsheet (wrapped in IFERROR)

Template: `LIVE_BALANCE_FORMULA_V2_TEMPLATE` in `config/sync/sheets.ts`

### Why Ingestion Never Double-Counts

When the worker ingests a buffer tab row:
1. The row is marked `DONE:{referenceId}` -> SUMIFS excludes it (contribution drops by X)
2. ERP `currentBalance` increases by X -> col R/F increases by X (after push_balances runs)
3. Net effect on the formula: `(R+X) + (SUMIFS-X) = R + SUMIFS` -- **unchanged**

---

## 3. Move Shipped -> Outward Flow

**Function:** `moveShippedToOutward()` in `sheetOffloadWorker.ts`

This is the most operationally critical flow. It copies shipped orders from the "Orders from COH" tab to the "Outward (Live)" buffer tab, preparing them for ERP ingestion.

### Step-by-Step

1. **Read "Orders from COH"** -- Reads range `'Orders from COH'!A:AE` from the Mastersheet. Uses `ORDERS_FROM_COH_COLS` for column indices.

2. **Filter shipped orders** -- Iterates rows, selects where:
   - Col X (`SHIPPED`) = `'TRUE'` (case-insensitive)
   - Col AD (`OUTWARD_DONE`) is NOT `'1'`
   - SKU (col G) is non-empty

3. **Map columns** -- For each shipped row, maps to Outward (Live) format:
   | Outward Col | Source | Notes |
   |-------------|--------|-------|
   | A (SKU) | Col G | |
   | B (Qty) | Col I | |
   | C | `''` | **Protected formula column -- must be empty** |
   | D (Date) | Today's date | DD/MM/YYYY format |
   | E (Destination) | `'Customer'` | Fixed value |
   | F (Order #) | Col B | |
   | G (Sampling Date) | Col R | |
   | H (Order Note) | Col K | |
   | I (COH Note) | Col L | |
   | J (Courier) | Col Z | |
   | K (AWB) | Col AA | |
   | L (AWB Scan) | Col AC | |
   | M (Notes) | `''` | |
   | N (Order Date) | Col A | Original order date for reversibility |

4. **STEP 1 -- Append to Outward (Live)** (SAFETY FIRST): `appendRows()` writes all rows at once. This happens FIRST so data is safe even if later steps fail.

5. **STEP 2 -- Verify**: Reads back the appended rows from Outward (Live) to confirm they landed correctly. Reports `rowsVerified` count.

6. **STEP 3 -- Mark col AD**: Writes `'1'` to col AD of each source row. Uses `groupIntoRanges()` to batch contiguous rows.

7. **STEP 4 -- Delete source rows**: Uses `deleteRowsBatch()` which sorts rows descending (bottom-up to prevent index shift) and groups contiguous rows into range-based delete requests.

### Safety-First Write Order

```
Write to destination FIRST -> Verify -> Mark source -> Delete source
```

If any step fails, the data is already safe in Outward (Live). The col AD mark prevents re-processing on the next run.

### Worker Run Tracking

Move shipped operations are tracked via `trackWorkerRun()` which writes to the `WorkerRun` table for operational visibility in the Sheets Monitor.

---

## 4. Offload Worker (9 Independent Jobs)

**File:** `sheetOffloadWorker.ts`

**Exports:** `{ start, stop, getStatus, triggerIngestInward, triggerIngestOutward, triggerMoveShipped, triggerCleanupDoneRows, triggerMigrateFormulas, triggerPushBalances, triggerPushFabricBalances, triggerImportFabricBalances, getBufferCounts, previewIngestInward, previewIngestOutward, previewPushBalances, previewFabricInward, triggerFabricInward }`

The worker manages 9 independently triggerable background jobs + 4 preview (dry-run) jobs, each with its own `JobState<T>` (concurrency guard, `isRunning`, `lastRunAt`, `lastResult`, `recentRuns`). Requires `ENABLE_SHEET_OFFLOAD=true`.

### Result Types

| Type | Key Fields |
|------|------------|
| `IngestInwardResult` | `inwardIngested`, `skipped`, `rowsMarkedDone`, `skusUpdated`, `errors`, `durationMs`, `error`, `inwardValidationErrors`, `fabricDeductionResult?` |
| `IngestOutwardResult` | `outwardIngested`, `ordersLinked`, `skipped`, `rowsMarkedDone`, `skusUpdated`, `errors`, `durationMs`, `error`, `outwardSkipReasons?` |
| `IngestPreviewResult` | `tab`, `totalRows`, `valid`, `invalid`, `duplicates`, `validationErrors`, `skipReasons?`, `affectedSkuCodes`, `durationMs`, `balanceSnapshot?` |
| `MoveShippedResult` | `shippedRowsFound`, `skippedRows`, `skipReasons`, `rowsWrittenToOutward`, `rowsVerified`, `rowsDeletedFromOrders`, `errors`, `durationMs` |
| `CleanupDoneResult` | `inwardDeleted`, `outwardDeleted`, `errors`, `durationMs` |
| `MigrateFormulasResult` | `inventoryUpdated`, `balanceFinalUpdated`, `errors`, `durationMs` |
| `PushBalancesResult` | `skusUpdated`, `inventoryWritten`, `balanceFinalWritten`, `errors`, `durationMs` |
| `PushFabricBalancesResult` | `fabricColoursUpdated`, `rowsWritten`, `errors`, `durationMs` |
| `ImportFabricBalancesResult` | `rowsRead`, `matched`, `mismatches`, `mismatchDetails`, `errors`, `durationMs` |
| `PushBalancesPreviewResult` | `totalSkus`, `erpBalances`, `sheetBalances`, `mismatches`, `mismatchDetails`, `durationMs` |

### Status Structure (`getStatus()`)

```typescript
interface OffloadStatus {
    ingestInward: JobState<IngestInwardResult>;
    ingestOutward: JobState<IngestOutwardResult>;
    moveShipped: JobState<MoveShippedResult>;
    cleanupDone: JobState<CleanupDoneResult>;
    migrateFormulas: JobState<MigrateFormulasResult>;
    pushBalances: JobState<PushBalancesResult>;
    pushFabricBalances: JobState<PushFabricBalancesResult>;
    importFabricBalances: JobState<ImportFabricBalancesResult>;
    fabricInward: JobState<FabricInwardResult>;
    schedulerActive: boolean;
}
```

### Job 1: Ingest Inward (`triggerIngestInward`)

**Function:** `ingestInwardLive()`

Structured as clear steps:

1. **Parse rows**: Reads `'Inward (Live)'!A:J` from Mastersheet. Skips rows with no SKU (col A) and rows already marked DONE. Extracts SKU, qty, date, source, doneBy, tailor. Builds content-based referenceIds: `sheet:inward-live:{sku}:{qty}:{date}:{source}`
2. **Bulk lookup SKUs**: Queries ERP `Sku` table for all parsed SKU codes
3. **Validate each row**: Runs `validateInwardRow()` against 7 business rules (see below). Invalid rows get error written to Import Errors column.
4. **Dedup valid rows**: Checks valid rows against existing DB via `findExistingReferenceIds()` (chunked at 2,000)
5. **Create transactions**: Creates `InventoryTransaction` records in batches with `txnType: TXN_TYPE.INWARD`, `reason` mapped via `INWARD_SOURCE_MAP`
6. **Fabric deduction**: For sampling inwards, auto-deducts fabric via BOM lookup (see Fabric Auto-Deduction below)
7. **Mark DONE**: Writes `DONE:{referenceId}` to Import Errors column for ingested + already-deduped rows. Invalid rows keep their error message.
8. **Push balances + invalidate caches**: Updates sheet balances and invalidates caches if any SKUs were affected.

#### Inward Validation (`validateInwardRow()`)

| Rule | Check | Failure Reason Example |
|------|-------|----------------------|
| 1. Required columns A-F | SKU, Qty, Product, Date, Source, Done By must all have data | `missing SKU (A)`, `missing Date (D)`, etc. |
| 2. Barcode for repacking | Col G (Barcode) required when source is `"repacking"` | `missing Barcode (G) for repacking` |
| 3. Tailor for sampling | Col H (Tailor Number) required when source is `"sampling"` | `missing Tailor Number (H) for sampling` |
| 4. Notes for adjustment | Col I (Notes) required when source is `"adjustment"` | `missing Notes (I) for adjustment` |
| 5. Valid source | Source must be one of `VALID_INWARD_LIVE_SOURCES` (`sampling`, `repacking`, `adjustment`) | `invalid Source "xyz"` |
| 6. SKU exists | SKU code must exist in ERP `Sku` table | `unknown SKU "ABC-123"` |
| 7. Positive quantity | Qty must be > 0 | `Qty must be > 0` |

**`VALID_INWARD_LIVE_SOURCES`** = `['sampling', 'repacking', 'adjustment'] as const` in `config/sync/sheets.ts`.

#### Fabric Auto-Deduction for Sampling Inwards

**Function:** `deductFabricForSamplingRows()`

When inward source is `sampling` (configurable via `FABRIC_DEDUCT_SOURCES`), the worker:
1. Looks up the SKU's BOM (Bill of Materials) for FABRIC components
2. Finds the linked `FabricColour` via `VariationBomLine` -> `fabricColourId`
3. Creates a `FabricColourTransaction` with `txnType: OUTWARD`, `reason: production`
4. Qty deducted = inward qty * BOM component qty (fabric consumption per unit)

This automates fabric stock deduction -- when a tailor produces N units, the fabric consumed is automatically deducted.

### Job 2: Ingest Outward (`triggerIngestOutward`)

**Function:** `ingestOutwardLive()`

Same parse/dedup pattern as ingest inward, but:
- Reads `'Outward (Live)'!A:AG` (includes Import Errors col AG)
- Skips rows already marked DONE
- `txnType: TXN_TYPE.OUTWARD`
- Date priority: Outward Date (col AE) > Order Date (col A) > rejected if neither parseable
- If order number present: `reason = 'sale'`. Otherwise: maps via `OUTWARD_DESTINATION_MAP`
- `metadata`: `{ destination, orderNumber }`
- Also extracts **courier** (col J) and **AWB** (col K) for order linking
- **Order+SKU dedup**: Checks for `duplicate_order_sku` -- if an outward for the same `orderNumber|skuId` already exists in DB, the row is skipped
- Marks ingested rows with `DONE:{referenceId}`

#### Channel Order Matching

The outward ingestion handles marketplace order number formats:
- **Myntra**: May use UUID format or short numeric format. Both are checked.
- **Nykaa**: Order numbers may have `--1` suffix. Lookup tries with and without suffix.

#### Pre-Ingestion Validation (`validateOutwardRows()`)

Two-pass validation before ingestion:

**Pass 1 -- Field-Level Checks:**

| Skip Reason | Condition |
|-------------|-----------|
| `empty_sku` | `skuCode` is empty |
| `zero_qty` | `qty <= 0` |
| `unknown_sku` | SKU code not found in ERP `Sku` table |
| `invalid_date` | No parseable date from either Outward Date or Order Date |
| `duplicate_order_sku` | Same order+SKU combination already exists in DB |

**Pass 2 -- Order-Level Checks (only for rows with an order number):**

| Skip Reason | Condition |
|-------------|-----------|
| `order_not_found` | Order number present but `Order` not found in ERP |
| `order_line_not_found` | Order exists but no `OrderLine` matches the SKU |

### Outward Phase B2: Link Outward to OrderLines (Evidence-Based Fulfillment)

**Function:** `linkOutwardToOrders(items, result, preloadedOrderMap)`

**This is the core of evidence-based fulfillment.** Outward InventoryTransactions from sheets ARE the evidence of shipping -- when an outward entry has an order number, the corresponding OrderLine is marked as shipped.

1. Groups linkable items by `orderNumber`
2. Uses the pre-loaded `orderMap` from `validateOutwardRows()` (avoids duplicate DB query)
3. For each outward item, finds matching OrderLine by `skuId`:
   - Uses array-based SKU lookup to handle duplicate SKUs in same order (FIFO consumption)
   - Only updates lines in `LINKABLE_STATUSES`: `['pending', 'allocated', 'picked', 'packed']`
   - Skips already-shipped or cancelled lines
4. Builds update batch: `{ lineStatus: 'shipped', shippedAt, courier?, awbNumber? }`
5. Applies all updates in a single `prisma.$transaction()`
6. Reports: `{ linked, skippedAlreadyShipped, skippedNoOrder, skippedNoLine }`

**Key insight:** The team doesn't use ERP allocation/pick/pack mutations. They fulfill in Sheets, then the worker auto-ships OrderLines when outward evidence arrives.

### Job 3: Push Balances (`triggerPushBalances`)

**Function:** `pushBalancesToSheets()`

Standalone job that pushes ERP `currentBalance` for all SKUs to sheets via batch API:

1. Queries all SKUs with their `currentBalance` from DB
2. **Target 1 -- Inventory tab col R** (Mastersheet): Reads SKU column, builds SKU-to-row map, writes balances via `batchWriteRanges()` (single API call)
3. **Target 2 -- Balance (Final) col F** (Office Ledger): Same approach

Uses `batchWriteRanges()` from `googleSheetsClient.ts` which sends all range updates in a single `batchUpdate` API call, dramatically reducing API quota usage compared to individual writes.

**Preview mode** (`previewPushBalances`): Reads current sheet values and compares to ERP balances. Returns `PushBalancesPreviewResult` with mismatch details showing which SKUs are out of sync.

### Job 4: Push Fabric Balances (`triggerPushFabricBalances`)

Pushes `FabricColour.currentBalance` to the "Fabric Balances" tab in the Barcode Mastersheet. Maps fabric colour codes to sheet rows and writes balances.

### Job 5: Import Fabric Balances (`triggerImportFabricBalances`)

**Time-aware reconciliation**: Reads the Fabric Balances tab which includes a "Count Date/Time" column (`FABRIC_BALANCES_COUNT_DATETIME`). For each fabric colour:

1. Reads the physical count value and count datetime from the sheet
2. Calculates what the ERP balance was AT THAT COUNT TIME by replaying transactions:
   - Current balance - (transactions after count time)
3. Compares the historical ERP balance to the physical count
4. Reports mismatches with details

This handles the real-world scenario where physical counts happen at a specific time, but the ERP balance keeps changing as transactions flow in.

### Job 6: Ingest Fabric Inward (`triggerFabricInward`)

Reads "Fabric Inward (Live)" tab, creates `FabricColourTransaction` records with `txnType: INWARD`. Same parse/validate/dedup/mark-DONE pattern as inventory ingest jobs.

Column config: `FABRIC_INWARD_LIVE_COLS` and `FABRIC_INWARD_LIVE_HEADERS` in sheets.ts.

### Job 7: Cleanup DONE Rows (`triggerCleanupDoneRows`)

Deletes rows from Inward (Live) and Outward (Live) where the Import Errors column starts with `DONE:` and the row is older than `CLEANUP_RETENTION_DAYS` (7 days). Processes each tab independently. Returns `CleanupDoneResult` with counts per tab.

### Job 8: Migrate Sheet Formulas (`triggerMigrateFormulas`)

Rewrites formulas in Inventory tab col C and Balance (Final) col E from old SUMIF style to V2 SUMIFS style (with `"<>DONE:*"` exclusion). Reads existing formula cells, generates new formulas using the template functions, and writes back. Returns `MigrateFormulasResult` with counts of updated cells.

### Balance Verification (Before/After Snapshots)

**Functions:** `readInventorySnapshot()`, `compareSnapshots()`

Ingest jobs take a snapshot of the Inventory tab (SKU -> displayed balance) before and after ingestion. `compareSnapshots()` detects any drift -- if the displayed balance changed, it means the formula invariant was violated. This is reported in the job result for operational visibility.

Preview functions also include `balanceSnapshot` in their results, showing the current sync state between ERP and sheet.

### Cache Invalidation (per-job)

**Function:** `invalidateCaches()`

Runs at the end of each ingest job if anything was ingested.
- `inventoryBalanceCache.invalidateAll()`
- SSE broadcast: `{ type: 'inventory_updated' }`

### Buffer Counts

`getBufferCounts()` returns pending (non-DONE) row counts for Inward (Live) and Outward (Live). DONE rows are excluded from the count.

### Preview / Dry-Run Mode

Four preview functions: `previewIngestInward()`, `previewIngestOutward()`, `previewPushBalances()`, `previewFabricInward()`.

They run the same parse -> validate -> dedup pipeline as the real jobs but do NOT:
- Create transaction records
- Mark rows as DONE
- Update sheet balances
- Invalidate caches

They DO write Import Errors to the sheet so ops can see validation errors without data being committed. Preview results include `balanceSnapshot` showing ERP vs sheet balance state.

---

## 5. Balance Verification

### The Invariant

At any point in time, the formula-displayed balance = ERP balance + pending buffer rows:

```
Displayed = currentBalance + SUMIFS(Inward Live, excluding DONE) - SUMIFS(Outward Live, excluding DONE)
```

After ingestion (mark DONE), `currentBalance` absorbs the rows and SUMIFS excludes DONE -- net unchanged.

### Verification Methods

**Before/After Snapshots**: Ingest jobs automatically take Inventory tab snapshots before and after, comparing for drift.

**Preview Push Balances**: `previewPushBalances()` shows current ERP vs sheet mismatches without modifying anything.

**Admin endpoint:** `GET /api/admin/sheet-offload/status` returns per-job status for all 9 jobs.

**Sheet Monitor Stats:** `GET /api/admin/sheet-monitor/stats` returns comprehensive stats for the Sheets Monitor dashboard.

**Scripts for manual verification:**
- `check-sheet-totals.ts` -- row counts and qty totals per tab
- `verify-outward-totals.ts` -- cross-check outward data consistency
- `switch-balance-formula.ts --dry-run` -- compares formula values in temporary column

---

## 6. Deduplication

### Content-Based Reference IDs

**Function:** `buildReferenceId()`

```typescript
function buildReferenceId(prefix: string, skuCode: string, qty: number, dateStr: string, extra: string = ''): string {
    const datePart = dateStr.replace(/[/\-.\s]/g, '').slice(0, 8) || 'nodate';
    const extraPart = extra ? `:${extra.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '')}` : '';
    return `${prefix}:${skuCode}:${qty}:${datePart}${extraPart}`;
}
```

| Source | Prefix | Format |
|--------|--------|--------|
| Inward (Live) | `sheet:inward-live` | `sheet:inward-live:{sku}:{qty}:{date}:{source}` |
| Outward (Live) | `sheet:outward-live` | `sheet:outward-live:{sku}:{qty}:{date}:{dest_or_order#}` |
| Fabric Inward (Live) | `sheet:fabric-inward-live` | `sheet:fabric-inward-live:{fabricCode}:{qty}:{date}:{source}` |
| Historical inward | `sheet:inward-final` | `sheet:inward-final:{sku}:{qty}:{date}:{source}` |
| Historical outward | `sheet:ms-outward` | `sheet:ms-outward:{sku}:{qty}:{order#}:{date}` |

All prefixes defined in `REF_PREFIX` in `config/sync/sheets.ts`.

### Within-Batch Dedup

If the same referenceId appears twice in one batch (same SKU, qty, date, source), a counter suffix `:2`, `:3`, etc. is appended.

### Chunked Database Lookups

**Function:** `findExistingReferenceIds()`

```typescript
const DEDUP_CHUNK_SIZE = 2000;
```

Splits referenceIds into chunks of 2,000 for the `WHERE referenceId IN (...)` query. Prevents PostgreSQL from choking on 37K+ element IN clauses.

### Outward Order+SKU Dedup

For outward rows with an order number, checks the `duplicate_order_sku` skip reason: if an InventoryTransaction already exists for the same `orderNumber|skuId` combination, the row is skipped. This prevents duplicate shipment records.

---

## 7. Configuration

All configuration in `server/src/config/sync/sheets.ts` (~700 lines). Re-exported from `server/src/config/sync/index.ts`.

### Feature Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `ENABLE_SHEET_OFFLOAD` | `false` | Master switch -- worker does nothing unless `true` |
| `ENABLE_SHEET_DELETION` | `false` | **Deprecated** -- replaced by non-destructive DONE marking |
| `ENABLE_FABRIC_LEDGER_PUSH` | `false` | Push fabric balances to Barcode Mastersheet |

### Constants

| Config | Value | Purpose |
|--------|-------|---------|
| `INGESTED_PREFIX` | `'DONE:'` | Prefix written to Import Errors column on ingested rows |
| `CLEANUP_RETENTION_DAYS` | `7` | Days before DONE rows are deleted by cleanup job |
| `FABRIC_DEDUCT_SOURCES` | `['sampling']` | Inward sources that trigger automatic fabric deduction |

### Timing

| Config | Value | Purpose |
|--------|-------|---------|
| `OFFLOAD_INTERVAL_MS` | 30 min | Interval between scheduled cycles |
| `STARTUP_DELAY_MS` | 5 min | Delay before first run |
| `API_CALL_DELAY_MS` | 200ms | Min delay between API calls (300/min quota) |
| `API_MAX_RETRIES` | 3 | Retries on transient errors (429, 500, 503) |
| `BATCH_SIZE` | 500 | Rows per ingestion batch |

### Column Mappings

Extensive per-tab column definitions:
- `ORDERS_FROM_COH_COLS` -- 13 columns (A-AD) including SHIPPED, OUTWARD_DONE
- `INVENTORY_TAB` -- tab name, data start row, ERP balance col (R), SKU col (A)
- `INWARD_LIVE_COLS` -- 10 columns (A-J, including Import Errors)
- `OUTWARD_LIVE_COLS` -- 14 columns (A-N, includes Order Date for reversibility)
- `BALANCE_COLS` -- 6 columns for Balance (Final) tab
- `FABRIC_BALANCES_COLS` -- Fabric colour code, balance, count value, count datetime columns
- `FABRIC_BALANCES_HEADERS` -- Header names for fabric balances tab
- `FABRIC_INWARD_LIVE_COLS` -- 7 columns for Fabric Inward (Live) tab
- `FABRIC_INWARD_LIVE_HEADERS` -- Header names for fabric inward tab

### Formula Templates

```typescript
// V2 Inventory tab col C (same-sheet SUMIFS with DONE exclusion)
INVENTORY_BALANCE_FORMULA_TEMPLATE = (row: number) => `=R${row}+SUMIFS(...,"<>DONE:*")-SUMIFS(...,"<>DONE:*")`

// V2 Balance (Final) col E (cross-sheet IMPORTRANGE + SUMIFS with DONE exclusion)
LIVE_BALANCE_FORMULA_V2_TEMPLATE = (row: number) => `=F${row}+IFERROR(SUMIFS(IMPORTRANGE(...),...,"<>DONE:*"),0)-...`
```

### Source/Destination Maps

```typescript
// Valid sources for Inward (Live) -- rows with other sources are rejected
VALID_INWARD_LIVE_SOURCES = ['sampling', 'repacking', 'adjustment'] as const

// Mapping for Inward (Live) sources to transaction reasons
INWARD_SOURCE_MAP: sampling -> production, production -> production, tailor -> production,
                   repacking -> return_receipt, return -> return_receipt, adjustment -> adjustment, ...
DEFAULT_INWARD_REASON = 'production'

// Mapping for Outward (Live) destinations to transaction reasons
OUTWARD_DESTINATION_MAP: customer -> order_allocation, sampling -> sampling,
                         warehouse -> adjustment, office -> adjustment, ...
DEFAULT_OUTWARD_REASON = 'sale'

// Sources that trigger automatic fabric deduction on inward
FABRIC_DEDUCT_SOURCES = ['sampling']
```

### Tab Names

```typescript
MASTERSHEET_TABS = {
    ORDERS_FROM_COH, INVENTORY, INWARD_LIVE, OUTWARD_LIVE, OUTWARD,
    FABRIC_BALANCES, FABRIC_INWARD  // New tabs
}
LIVE_TABS = { INWARD, OUTWARD, FABRIC_INWARD }
```

---

## 8. API Endpoints

### Sheet Offload (in `server/src/routes/admin.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/admin/sheet-offload/status` | Per-job status for all 9 jobs + buffer counts |
| `POST` | `/api/admin/sheet-offload/trigger` | **Deprecated** -- use background-jobs endpoints instead |

**Status response** includes all 9 job states:
```json
{
  "ingestInward": { "isRunning": false, "lastRunAt": "...", "lastResult": {}, "recentRuns": [] },
  "ingestOutward": {},
  "moveShipped": {},
  "cleanupDone": {},
  "migrateFormulas": {},
  "pushBalances": {},
  "pushFabricBalances": {},
  "importFabricBalances": {},
  "fabricInward": {},
  "schedulerActive": true,
  "bufferCounts": { "inward": 5, "outward": 12 }
}
```

### Sheet Monitor Stats (in `server/src/routes/admin.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/admin/sheet-monitor/stats` | Comprehensive stats for Sheets Monitor dashboard |

### Background Jobs (in `server/src/routes/admin.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/admin/background-jobs` | List all jobs |
| `POST` | `/api/admin/background-jobs/:jobId/trigger` | Trigger any job by ID |

**Sheet-related Job IDs:**

| Job ID | Trigger Function | Schedule |
|--------|-----------------|----------|
| `ingest_inward` | `triggerIngestInward()` | 30 min interval |
| `ingest_outward` | `triggerIngestOutward()` | 30 min interval |
| `move_shipped_to_outward` | `triggerMoveShipped()` | Manual only |
| `push_balances` | `triggerPushBalances()` | Manual only |
| `push_fabric_balances` | `triggerPushFabricBalances()` | Manual only |
| `import_fabric_balances` | `triggerImportFabricBalances()` | Manual only |
| `ingest_fabric_inward` | `triggerFabricInward()` | Manual only |
| `cleanup_done_rows` | `triggerCleanupDoneRows()` | Manual only |
| `migrate_sheet_formulas` | `triggerMigrateFormulas()` | Manual only |
| `preview_ingest_inward` | `previewIngestInward()` | Manual only |
| `preview_ingest_outward` | `previewIngestOutward()` | Manual only |
| `preview_push_balances` | `previewPushBalances()` | Manual only |
| `preview_fabric_inward` | `previewFabricInward()` | Manual only |
| `reconcile_sheet_orders` | `reconcileSheetOrders()` | Manual only |

### Sheet Sync -- CSV-based (in `server/src/routes/sheetSync.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/admin/sheet-sync/plan` | Parse CSVs, run plan functions |
| `POST` | `/api/admin/sheet-sync/execute` | Execute a planned sync job |
| `GET` | `/api/admin/sheet-sync/status` | Poll job progress |

---

## 9. Frontend

### Sheets Monitor Dashboard (`/sheets-monitor`)

**File:** `client/src/pages/SheetsMonitor.tsx`

Dedicated page at `/sheets-monitor` that provides real-time visibility into the sheets system. Composes 3 queries at different poll intervals:

- **15s**: Buffer counts (Inward, Outward pending rows)
- **30s**: Job statuses for all 9 jobs
- **60s**: Sheet monitor stats (balance verification, fabric status)

Displays:
- Per-job cards with status, last run, last result summary, "Run Now" buttons
- Buffer tab row counts (excluding DONE rows)
- Balance verification results (before/after snapshots)
- Fabric balance sync state
- Preview results for inward, outward, push balances, fabric inward

### Client-Side Type Mirrors

**File:** `client/src/components/settings/jobs/sheetJobTypes.ts` (~206 lines)

Mirrors all server-side result types for the frontend:
- `IngestInwardResult`, `IngestOutwardResult`, `MoveShippedResult`
- `CleanupDoneResult`, `MigrateFormulasResult`
- `PushBalancesResult`, `PushFabricBalancesResult`, `ImportFabricBalancesResult`
- `PushBalancesPreviewResult`, `IngestPreviewResult`
- `OffloadStatusResponse` (all 9 job states + schedulerActive + bufferCounts)

### BackgroundJobsTab (in `BackgroundJobsTab.tsx`)

Lists all background jobs including sheet jobs. Each job card shows:
- Icon, name, description, status badges (Running/Active/Disabled)
- Schedule/interval, last run time, next run
- Expandable details with per-job result renderers (different fields for each result type)
- "Run Now" button for triggerable jobs

### Trigger Flow

1. User clicks "Run Now" on a job card
2. `triggerMutation` calls `startBackgroundJob({ data: { jobId } })`
3. Server function POSTs to `/api/admin/background-jobs/:jobId/trigger`
4. Express handler calls the appropriate worker function
5. Query key `['backgroundJobs']` is invalidated to refresh status

---

## 10. Key Files

### Core Implementation

| File | Purpose |
|------|---------|
| `server/src/services/sheetOffloadWorker.ts` | Main worker: 9 independent jobs, per-job state, start/stop/getStatus/getBufferCounts, balance verification, fabric deduction |
| `server/src/services/googleSheetsClient.ts` | Authenticated Sheets API client: JWT auth, rate limiter, retry, CRUD ops, border formatting, `batchWriteRanges()` |
| `server/src/services/sheetOrderPush.ts` | Push Shopify + ERP orders to "Orders from COH" tab, self-healing reconciler |
| `server/src/config/sync/sheets.ts` | All config: spreadsheet IDs, tab names, column mappings, timing, formulas, V2 templates (~700 lines) |
| `server/src/config/sync/index.ts` | Re-exports all sheets config |

### Routes & Server Functions

| File | Purpose |
|------|---------|
| `server/src/routes/admin.ts` | Offload status/trigger, background jobs endpoints, sheet monitor stats |
| `server/src/routes/sheetSync.ts` | CSV-based sheet sync: plan/execute/status |
| `client/src/server/functions/admin.ts` | Server functions for background jobs + sheet monitor |
| `client/src/server/functions/sheetSync.ts` | Server functions for sheet sync |

### Frontend

| File | Purpose |
|------|---------|
| `client/src/pages/SheetsMonitor.tsx` | Sheets Monitor dashboard at `/sheets-monitor` (3 query intervals) |
| `client/src/components/settings/jobs/sheetJobTypes.ts` | Client-side type mirrors for all 9 job result types |
| `client/src/components/settings/tabs/SheetSyncTab.tsx` | OffloadMonitor + CSV sheet sync UI |
| `client/src/components/settings/tabs/BackgroundJobsTab.tsx` | Background jobs dashboard |

### Infrastructure

| File | Purpose |
|------|---------|
| `server/src/services/googleSheetsFetcher.ts` | Unauthenticated CSV fetcher (used by Sheet Sync, not offload) |
| `server/src/services/sheetSyncService.ts` | CSV-based sync orchestrator: 6-step plan/execute (Steps 1 & 4 disabled) |
| `server/src/utils/workerRunTracker.ts` | Tracks worker runs to `WorkerRun` table for operational visibility |
| `server/src/index.js` | Worker registration + shutdown handler |
| `server/src/utils/logger.ts` | `sheetsLogger` child logger |

### Scripts

| Script | Purpose |
|--------|---------|
| `server/scripts/create-live-tabs.ts` | Create buffer tabs in Mastersheet |
| `server/scripts/switch-balance-formula.ts` | Write ERP balance to Balance Final col F, switch col E formula |
| `server/scripts/switch-inventory-formula.ts` | Add col R to Inventory tab, write ERP balance, switch col C formula |
| `server/scripts/setup-balance-formula.ts` | Update/restore col E formulas |
| `server/scripts/backup-sheets.ts` | Full snapshot of all tabs to JSON |
| `server/scripts/restore-sheets.ts` | Restore from backup |
| `server/scripts/check-sheet-totals.ts` | Row counts and qty totals per tab |
| `server/scripts/backfill-outward-order-numbers.ts` | Backfill `orderNumber` on historical ms-outward InventoryTransactions |
| `server/scripts/link-historical-outward-to-orders.ts` | Link historical outward txns to OrderLines (set shipped). `--write` to apply |

### Documentation

| File | Purpose |
|------|---------|
| `SHEETS_OFFLOAD.md` | Full design doc: vision, architecture, phases, data analysis, formulas |
| `.claude/plans/google-sheet-hybrid.md` | Implementation plan with phase tracking |

---

## 11. Gotchas

### Google API

- **Error `code` is a STRING** -- `googleapis` errors have `code` as string, not number. Always use `Number(error.code)` for comparison.
- **Sheet data types are mixed** -- `values.get()` returns mixed types. Always coerce with `String(cell ?? '')`.
- **API quota: 300 requests/min** -- Rate limiter in `googleSheetsClient.ts` enforces 200ms between calls. Use `batchWriteRanges()` for bulk writes (single API call).
- **IMPORTRANGE vs same-sheet** -- Live tabs in Mastersheet enable same-sheet SUMIFS (fast). Balance (Final) in Office Ledger needs IMPORTRANGE (slower, must wrap in IFERROR).
- **Credentials**: Loaded from env var `GOOGLE_SERVICE_ACCOUNT_JSON` first (Railway), then falls back to key file `server/config/google-service-account.json` (local dev). The env var contains the full JSON string.

### Data Handling

- **DD/MM/YYYY date parsing** -- Indian locale dates must be parsed DD/MM FIRST, before `new Date()` fallback (which treats "01/02/2025" as Jan 2nd). Use `parseSheetDate()`.
- **Large IN clauses** -- Prisma/PG chokes on 37K+ element IN clauses. Always chunk at 2,000 (`DEDUP_CHUNK_SIZE`).
- **Row-index referenceIds are UNSTABLE** -- After row deletion, indices shift. Use content-based keys (SKU+qty+date+source) instead.
- **Col C in Outward (Live) is protected** -- Contains a formula. When writing rows, set col C to empty string `''`.
- **DONE rows in formulas** -- V2 SUMIFS formulas must include `"<>DONE:*"` condition on the Import Errors column. Old SUMIF formulas do NOT exclude DONE rows and will double-count.

### Worker

- **Per-job concurrency guards** -- Each of the 9 jobs has its own `JobState<T>` with `isRunning` boolean. If already running, the trigger function returns `null`. Jobs are independent.
- **Non-destructive marking** -- `markRowsIngested()` writes `DONE:{referenceId}` to Import Errors column via `writeImportErrors()`. This replaces the old row deletion approach.
- **Admin user requirement** -- `createdById` on InventoryTransaction is a required FK. Worker looks up first admin user by role and caches the ID.
- **Evidence-based fulfillment** -- `linkOutwardToOrders` only updates lines in `LINKABLE_STATUSES` (`pending`, `allocated`, `picked`, `packed`). Already-shipped/cancelled lines are safely skipped. Uses FIFO consumption for duplicate SKUs in same order.
- **Fabric auto-deduction** -- Only triggers for sources in `FABRIC_DEDUCT_SOURCES` (currently `['sampling']`). Looks up BOM FABRIC components to calculate deduction qty.
- **Worker run tracking** -- Ingest and move jobs call `trackWorkerRun()` to persist results to the `WorkerRun` table, visible in the Sheets Monitor.
- **Time-aware fabric reconciliation** -- `importFabricBalances` uses `parseSheetDateTime()` to parse count timestamps and calculates historical ERP balance AT the count time.

### Tabs

- **Aggregate vs individual tabs** -- Office Ledger "Orders Outward" is an IMPORTRANGE aggregate (SKU+Qty only, 3K rows). Must NOT be used for ingestion. Mastersheet "Outward" has individual rows with order numbers (39K rows).
- **Notes column difference** -- Inward (Final) col H is "Tailor Number", but Inward (Archive) col H is "notes". Column mappings handle this.
- **Fabric Inward (Live)** -- New buffer tab for fabric transactions. Has its own column mapping (`FABRIC_INWARD_LIVE_COLS`) and headers.

---

## 12. Operational Runbook

### Running the Full Shipped -> Outward -> Ingest Flow

1. **Check buffer tab state** -- Go to Sheets Monitor or Settings > Sheet Sync > OffloadMonitor. Note current pending row counts.

2. **Move shipped orders** -- Trigger `move_shipped_to_outward` via Background Jobs. Check `MoveShippedResult`: rows found/written/verified/deleted.

3. **Verify in Sheets** -- Open the Mastersheet. Check that:
   - "Outward (Live)" has new rows
   - "Orders from COH" shipped rows are deleted (or marked col AD = 1)

4. **Run ingest inward** -- Trigger `ingest_inward`. Check `IngestInwardResult`: inwardIngested count, inwardValidationErrors, fabricDeductionResult.

5. **Run ingest outward** -- Trigger `ingest_outward`. Check `IngestOutwardResult`: outwardIngested, ordersLinked, outwardSkipReasons.

6. **Push balances** -- Trigger `push_balances`. Check `PushBalancesResult`: skusUpdated, inventoryWritten, balanceFinalWritten. (This is now separate from ingest jobs.)

7. **Cross-check balance** -- Open Inventory tab col C. The displayed balance should be unchanged before and after (the formula invariant). Check balance verification snapshots in the job results.

### Push Balances Flow

1. **Preview first** -- Trigger `preview_push_balances`. Review `PushBalancesPreviewResult` to see mismatches between ERP and sheet.
2. **Push** -- Trigger `push_balances`. Uses batch API for efficient writes.

### Fabric Reconciliation Flow

1. **Push fabric balances** -- Trigger `push_fabric_balances` to sync ERP fabric balances to sheet.
2. **Import fabric balances** -- Trigger `import_fabric_balances` to read physical counts and compare against time-aware ERP balances.
3. **Review mismatches** -- Check `ImportFabricBalancesResult.mismatchDetails` for discrepancies.

### Fabric Inward Flow

1. **Preview** -- Trigger `preview_fabric_inward` to validate rows without creating transactions.
2. **Ingest** -- Trigger `ingest_fabric_inward` to create `FabricColourTransaction` records and mark rows DONE.

### Cleanup Flow

1. **Trigger cleanup** -- Run `cleanup_done_rows` to delete DONE rows older than 7 days.
2. **Check result** -- `CleanupDoneResult` shows `inwardDeleted` and `outwardDeleted` counts.

### Emergency Stop

1. Set `ENABLE_SHEET_OFFLOAD=false` in config -- stops the worker
2. The worker has per-job concurrency guards -- if currently running, it will finish its current job but not start new ones
3. Data in buffer tabs is safe -- DONE rows remain visible, and pending rows are untouched

### Debugging Discrepancies

1. **Check recent runs** -- Sheets Monitor shows recent runs with per-job results
2. **Check for skipped rows** -- For inward: check `inwardValidationErrors`. For outward: check `outwardSkipReasons` (e.g., `unknown_sku`, `invalid_date`, `order_not_found`, `order_line_not_found`, `duplicate_order_sku`). Invalid rows remain on the sheet with their error.
3. **Check dedup** -- If ingested count is less than sheet row count, some rows were already ingested (matching referenceId or DONE-marked)
4. **Preview push balances** -- Run `preview_push_balances` to see exact ERP vs sheet balance differences
5. **Formula check** -- If displayed balance is wrong, check if formulas are V2 (SUMIFS with DONE exclusion). Run `migrate_sheet_formulas` if needed.
6. **Manual balance check** -- Run `check-sheet-totals.ts` to get row counts per tab, compare against ERP counts
