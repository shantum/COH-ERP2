# Google Sheets Hybrid System

The Google Sheets hybrid system bridges operations between Google Sheets (used by the ops team) and the ERP database. It handles three core flows:

1. **Move Shipped → Outward**: Copies shipped orders from "Orders from COH" to "Outward (Live)" buffer tab
2. **Ingest Buffer Tabs**: Reads "Inward (Live)" and "Outward (Live)" into ERP `InventoryTransaction` records, then deletes sheet rows
3. **Write Balances Back**: Pushes ERP `currentBalance` to Sheets (Inventory col R, Balance Final col F)

The system is designed so that **ingestion never causes double-counting** — the combined view formula automatically adjusts as rows move from sheet to ERP.

---

## 1. System Architecture

### Three Spreadsheets

| Name | Constant | ID | Key Tabs |
|------|----------|----|----------|
| **COH Orders Mastersheet** | `ORDERS_MASTERSHEET_ID` | `1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo` | Orders from COH, Inventory, Inward (Live), Outward (Live), Outward |
| **Office Ledger** | `OFFICE_LEDGER_ID` | `1ZZgzu4xPXhP9ba3-liXHxj5tY0HihoEnVC9-wLijD5E` | Inward (Final), Inward (Archive), Balance (Final), Returns/Exchange |
| **Barcode Mastersheet** | `BARCODE_MASTERSHEET_ID` | `1xlK4gO2Gxu8-8-WS4jFnR0uxYO35fEBPZiSbJobGVy8` | Main (SKU master), Fabric Balances |

### Two Buffer Tabs (in Mastersheet)

- **Inward (Live)**: Ops team enters new inward transactions (columns A-I: SKU, Qty, Product, Date, Source, Done By, Barcode, Tailor Number, Notes)
- **Outward (Live)**: Ops team enters outward transactions OR shipped orders are auto-moved here (columns A-N: SKU, Qty, [formula], Date, Destination, Order Number, Sampling Date, Order Note, COH Note, Courier, AWB, AWB Scan, Notes, Order Date)

Buffer tabs are in the Mastersheet so the Inventory tab formula can reference them via same-sheet SUMIF (no IMPORTRANGE needed).

### Data Flow

```
Shopify webhook (new order) ──[pushNewOrderToSheet]──► Orders from COH ──┐
                                                                          │
Orders from COH (shipped) ──[move_shipped_to_outward]──► Outward (Live) ──┤
                                                                           │
Ops team manual entry ──────────────────────────────────► Inward (Live) ──┤
                                                                           │
                          ┌────────────────────────────────────────────────┘
                          │
                          ▼
               ┌──────────────────────┐    ┌───────────────────────┐
               │  [ingest_inward]     │    │  [ingest_outward]     │
               │  Inward (Live) → DB  │    │  Outward (Live) → DB  │
               │  + balance + caches  │    │  + link OrderLines    │
               └──────────┬───────────┘    │  + balance + caches   │
                          │                └───────────┬───────────┘
                          ▼                            ▼
                  InventoryTransaction   ───────►  Sheet col R + col F
                    (ERP database)                (Inventory + Balance Final)
```

Three independent jobs replace the old monolithic `runOffloadSync()` (Phases A-D):
- **`ingest_inward`** -- Scheduled (30 min). Reads Inward (Live), creates INWARD transactions, updates balances, invalidates caches.
- **`move_shipped_to_outward`** -- Manual trigger only. Copies shipped rows from "Orders from COH" to "Outward (Live)". No balance updates.
- **`ingest_outward`** -- Scheduled (30 min). Reads Outward (Live), creates OUTWARD transactions, links to OrderLines (evidence-based fulfillment), updates balances, invalidates caches.

---

## 1b. Sheet Order Push (Webhook to Sheet)

**File:** `server/src/services/sheetOrderPush.ts`

When a new Shopify order arrives via webhook and is processed (action === 'created'), the ERP automatically appends one row per line item to the "Orders from COH" tab in the COH Orders Mastersheet. This lets the ops team start processing immediately without manual entry.

### Trigger

In `server/src/routes/webhooks.ts`, after `processShopifyOrderWebhook()` returns `action === 'created'`:

```typescript
if (result.action === 'created') {
    deferredExecutor.enqueue(async () => {
        await pushNewOrderToSheet(shopifyOrder);
    }, { orderId: result.orderId, action: 'push_order_to_sheet' });
}
```

**Important:** Shopify sometimes sends new orders as `orders/updated` (not `orders/create`), so the trigger checks `result.action` not the webhook topic.

### Column Mapping

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

### Formatting

After appending rows, adds a bottom border on the last row of the order (visual separator between orders). Uses `addBottomBorders()` from `googleSheetsClient.ts`.

### Design Decisions

- **Fire-and-forget** via `deferredExecutor` -- never blocks webhook response
- **No feature flag** -- always on (relies on Google Sheets auth being configured)
- **Channel uses `payment_gateway_names[0]`** not `source_name` (matches ops team expectations)
- **Errors logged but never block** order processing (try/catch with log.error)
- **Col H left empty** because the sheet has a VLOOKUP array formula that fills Product Name from SKU

### googleSheetsClient Changes

- `appendRows()` now returns the 0-based start row index (parsed from the API's `updatedRange` response)
- New export: `addBottomBorders(spreadsheetId, sheetId, rowIndices, endCol?)` -- applies bottom borders via Sheets `batchUpdate` API using `updateBorders` requests

---

## 2. The Combined View Formula

The key insight that makes the hybrid system safe: **a single formula bridges both systems, and ingestion never changes the displayed balance.**

### Inventory Tab (Mastersheet) Col C

```
=R{row} + SUMIF('Inward (Live)'!$A:$A, $A{row}, 'Inward (Live)'!$B:$B)
       - SUMIF('Outward (Live)'!$A:$A, $A{row}, 'Outward (Live)'!$B:$B)
```

- `R` = ERP `currentBalance` (written by the worker)
- SUMIF counts pending buffer tab rows not yet ingested

### Balance (Final) (Office Ledger) Col E

```
=F{row} + IFERROR(SUMIF(IMPORTRANGE("mastersheet-id","'Inward (Live)'!$A:$A"),
          $A{row}, IMPORTRANGE("mastersheet-id","'Inward (Live)'!$B:$B")),0)
        - IFERROR(SUMIF(IMPORTRANGE("mastersheet-id","'Outward (Live)'!$A:$A"),
          $A{row}, IMPORTRANGE("mastersheet-id","'Outward (Live)'!$B:$B")),0)
```

- `F` = ERP `currentBalance` (written by the worker)
- Uses IMPORTRANGE because live tabs are in a different spreadsheet (wrapped in IFERROR)

### Why Ingestion Never Double-Counts

When the worker ingests a buffer tab row:
1. The row is deleted from the sheet → SUMIF contribution drops by X
2. ERP `currentBalance` increases by X → col R/F increases by X
3. Net effect on the formula: `(R+X) + (SUMIF-X) = R + SUMIF` — **unchanged**

The formula template is defined in `config/sync/sheets.ts`:
```typescript
export const LIVE_BALANCE_FORMULA_TEMPLATE = (row: number) =>
    `=F${row}+IFERROR(SUMIF(IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$A:$A"),...`;
```

---

## 3. Move Shipped → Outward Flow

**Function:** `moveShippedToOutward()` in `sheetOffloadWorker.ts` (line ~1189)

This is the most operationally critical flow. It copies shipped orders from the "Orders from COH" tab to the "Outward (Live)" buffer tab, preparing them for ERP ingestion.

### Step-by-Step

1. **Read "Orders from COH"** — Reads range `'Orders from COH'!A:AE` from the Mastersheet. Uses `ORDERS_FROM_COH_COLS` for column indices.

2. **Filter shipped orders** — Iterates rows, selects where:
   - Col X (`SHIPPED`) = `'TRUE'` (case-insensitive)
   - Col AD (`OUTWARD_DONE`) is NOT `'1'`
   - SKU (col G) is non-empty

3. **Map columns** — For each shipped row, maps to Outward (Live) format:
   | Outward Col | Source | Notes |
   |-------------|--------|-------|
   | A (SKU) | Col G | |
   | B (Qty) | Col I | |
   | C | `''` | **Protected formula column — must be empty** |
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

4. **STEP 1 — Append to Outward (Live)** (SAFETY FIRST): `appendRows()` writes all rows at once. This happens FIRST so data is safe even if later steps fail.

5. **STEP 2 — Mark col AD**: Writes `'1'` to col AD of each source row. Uses `groupIntoRanges()` to batch contiguous rows (avoids API quota exhaustion from individual writes).

6. **STEP 3 — Delete source rows**: Uses `deleteRowsBatch()` which sorts rows descending (bottom-up to prevent index shift) and groups contiguous rows into range-based delete requests.

### Safety-First Write Order

```
Write to destination FIRST → Mark source → Delete source
```

If step 2 or 3 fails, the data is already safe in Outward (Live). The col AD mark prevents re-processing on the next run. This was validated in the first production test when deletion failed due to API quota but data was already safely written.

### Error Recovery

- Each step has its own try/catch
- Errors are collected in `result.errors[]`
- Returns `MoveShippedResult` with counts (found/written/deleted) plus errors and duration
- If append fails, the function returns immediately — no marking or deletion happens

---

## 4. Offload Worker (3 Independent Jobs)

**File:** `sheetOffloadWorker.ts` -- exports `{ start, stop, getStatus, triggerIngestInward, triggerIngestOutward, triggerMoveShipped, getBufferCounts }`

The worker manages 3 independently triggerable background jobs, each with its own `JobState<T>` (concurrency guard, `isRunning`, `lastRunAt`, `lastResult`, `recentRuns`). The scheduler runs `ingest_inward` then `ingest_outward` sequentially on a 30-min interval. `move_shipped_to_outward` is manual-trigger only. Requires `ENABLE_SHEET_OFFLOAD=true`.

### Result Types

| Type | Key Fields |
|------|------------|
| `IngestInwardResult` | `inwardIngested`, `skipped`, `rowsDeleted`, `skusUpdated`, `errors`, `durationMs`, `error`, `inwardValidationErrors` |
| `IngestOutwardResult` | `outwardIngested`, `ordersLinked`, `skipped`, `rowsDeleted`, `skusUpdated`, `errors`, `durationMs`, `error`, `outwardSkipReasons?` |
| `MoveShippedResult` | `shippedRowsFound`, `skippedRows`, `skipReasons`, `rowsWrittenToOutward`, `rowsVerified`, `rowsDeletedFromOrders`, `errors`, `durationMs` |

### Status Structure (`getStatus()`)

```typescript
interface OffloadStatus {
    ingestInward: JobState<IngestInwardResult>;
    ingestOutward: JobState<IngestOutwardResult>;
    moveShipped: JobState<MoveShippedResult>;
    schedulerActive: boolean;
    intervalMs: number;
}
```

### Job 1: Ingest Inward (`triggerIngestInward`)

**Function:** `ingestInwardLive()`

Structured as 5 clear steps:

1. **Step 1 -- Parse rows**: Reads `'Inward (Live)'!A:I` from Mastersheet. Skips rows with no SKU (col A). Extracts SKU, qty, date, source, doneBy, tailor. Builds content-based referenceIds: `sheet:inward-live:{sku}:{qty}:{date}:{source}`
2. **Step 2 -- Bulk lookup SKUs**: Queries ERP `Sku` table for all parsed SKU codes (used for validation in Step 3)
3. **Step 3 -- Validate each row**: Runs `validateInwardRow()` against 7 business rules (see below). Invalid rows are counted in `result.inwardValidationErrors` and added to `result.skipped`. **Invalid rows are NOT deleted from the sheet** -- they remain for the ops team to fix.
4. **Step 4 -- Dedup valid rows**: Checks valid rows against existing DB via `findExistingReferenceIds()` (chunked at 2,000)
5. **Step 5 -- Create transactions**: Creates `InventoryTransaction` records in batches:
   - `txnType: TXN_TYPE.INWARD`
   - `reason`: mapped via `INWARD_SOURCE_MAP` (sampling, production, tailor, repacking, return, etc.)
   - `metadata`: `{ source, performedBy, tailorNumber }`
6. If `ENABLE_SHEET_DELETION=true`: deletes only **valid** rows (ingested + already-ingested duplicates). Invalid rows stay on the sheet.

#### Inward Validation (`validateInwardRow()`)

**Function:** `validateInwardRow()` (line ~373)

Each parsed row is validated against 7 business rules. A row fails if ANY rule is violated. Failed rows accumulate reasons (a single row can fail multiple rules).

| Rule | Check | Failure Reason Example |
|------|-------|----------------------|
| 1. Required columns A-F | SKU, Qty, Product, Date, Source, Done By must all have data | `missing SKU (A)`, `missing Date (D)`, etc. |
| 2. Barcode for repacking | Col G (Barcode) required when source is `"repacking"` | `missing Barcode (G) for repacking` |
| 3. Tailor for sampling | Col H (Tailor Number) required when source is `"sampling"` | `missing Tailor Number (H) for sampling` |
| 4. Notes for adjustment | Col I (Notes) required when source is `"adjustment"` | `missing Notes (I) for adjustment` |
| 5. Valid source | Source must be one of `VALID_INWARD_LIVE_SOURCES` (`sampling`, `repacking`, `adjustment`) | `invalid Source "xyz"` |
| 6. SKU exists | SKU code must exist in ERP `Sku` table | `unknown SKU "ABC-123"` |
| 7. Positive quantity | Qty must be > 0 | `Qty must be > 0` |

**`VALID_INWARD_LIVE_SOURCES`** is defined in `server/src/config/sync/sheets.ts`:
```typescript
export const VALID_INWARD_LIVE_SOURCES = ['sampling', 'repacking', 'adjustment'] as const;
```

**`IngestInwardResult.inwardValidationErrors`** -- A required `Record<string, number>` field. Reports inward validation failures grouped by reason string, e.g. `{ "missing Date (D)": 3, "unknown SKU \"XYZ\"": 1 }`. Always populated (empty `{}` when no failures). Visible in OffloadMonitor UI and logs.

Each ingest job independently runs balance updates (`updateSheetBalances`) and cache invalidation (`invalidateCaches`) if any SKUs were affected.

### Job 2: Ingest Outward (`triggerIngestOutward`)

**Function:** `ingestOutwardLive()`

Same parse/dedup pattern as Phase A, but:
- Reads `'Outward (Live)'!A:AE` (cols 0-30, includes Outward Date in col AE)
- `txnType: TXN_TYPE.OUTWARD`
- Date priority: Outward Date (col AE) > Order Date (col A) > rejected if neither parseable
- If order number present: `reason = 'sale'`. Otherwise: maps via `OUTWARD_DESTINATION_MAP`
- `metadata`: `{ destination, orderNumber }`
- Also extracts **courier** (col J) and **AWB** (col K) for order linking
- Returns `{ affectedSkuIds, linkableItems }` — linkable items are outward entries with an order number

#### Pre-Ingestion Validation (`validateOutwardRows()`)

After dedup, all new outward rows pass through a two-pass validation before ingestion. Rows that fail validation are rejected with structured skip reasons instead of being silently skipped or falling back to defaults.

**Pass 1 -- Field-Level Checks:**

| Skip Reason | Condition |
|-------------|-----------|
| `empty_sku` | `skuCode` is empty |
| `zero_qty` | `qty <= 0` |
| `unknown_sku` | SKU code not found in ERP `Sku` table |
| `invalid_date` | No parseable date from either Outward Date or Order Date |

**Pass 2 -- Order-Level Checks (only for rows with an order number):**

| Skip Reason | Condition |
|-------------|-----------|
| `order_not_found` | Order number present but `Order` not found in ERP |
| `order_line_not_found` | Order exists but no `OrderLine` matches the SKU |

Non-order rows (no `orderNumber`) skip Pass 2 entirely.

The validation returns an `OutwardValidationResult` containing `validRows`, `skipReasons` (a `Record<string, number>` breakdown), and the `orderMap` for potential reuse.

**`IngestOutwardResult.outwardSkipReasons`** -- When any outward rows are skipped, the `outwardSkipReasons` field (optional `Record<string, number>`) is populated on the result, making skip reasons visible in the OffloadMonitor UI and logs.

### Outward Phase B2: Link Outward to OrderLines (Evidence-Based Fulfillment)

**Function:** `linkOutwardToOrders()`

**This is the core of evidence-based fulfillment.** Outward InventoryTransactions from sheets ARE the evidence of shipping — when an outward entry has an order number, the corresponding OrderLine is marked as shipped.

1. Groups linkable items by `orderNumber`
2. Batch-queries `Order` + `OrderLine` by order number
3. For each outward item, finds matching OrderLine by `skuId`:
   - Uses array-based SKU lookup to handle duplicate SKUs in same order (FIFO consumption)
   - Only updates lines in `LINKABLE_STATUSES`: `['pending', 'allocated', 'picked', 'packed']`
   - Skips already-shipped or cancelled lines
4. Builds update batch: `{ lineStatus: 'shipped', shippedAt, courier?, awbNumber? }`
5. Applies all updates in a single `prisma.$transaction()`
6. Reports: `{ linked, skippedAlreadyShipped, skippedNoOrder, skippedNoLine }`

**Key insight:** The team doesn't use ERP allocation/pick/pack mutations. They fulfill in Sheets, then the worker auto-ships OrderLines when outward evidence arrives.

### Balance Updates (per-job, not a separate phase)

**Function:** `updateSheetBalances(affectedSkuIds, result)`

Runs at the end of each ingest job (inward or outward) if any SKUs were affected. No longer a separate "Phase C".

1. Queries `Sku.currentBalance` for all affected SKUs
2. **Target 1 -- Inventory tab col R** (Mastersheet): reads SKU column, builds update array, writes via batched `groupIntoRanges()`
3. **Target 2 -- Balance (Final) col F** (Office Ledger): same approach

### Cache Invalidation (per-job, not a separate phase)

**Function:** `invalidateCaches()`

Runs at the end of each ingest job if anything was ingested. No longer a separate "Phase D".
- `inventoryBalanceCache.invalidateAll()`
- SSE broadcast: `{ type: 'inventory_updated' }`

### Scheduled Cycle

The scheduler (`runScheduledCycle`) runs both ingest jobs sequentially -- inward first, then outward -- to avoid Google API rate limit conflicts. `move_shipped_to_outward` is NOT part of the scheduled cycle (manual trigger only).

```
Scheduler (30 min interval):
  1. triggerIngestInward()  → Inward (Live) → DB + balance + caches
  2. triggerIngestOutward() → Outward (Live) → DB + link OrderLines + balance + caches

Manual trigger only:
  triggerMoveShipped() → Orders from COH → Outward (Live) [no balance updates]
```

---

## 5. Balance Verification

### The Invariant

At any point in time, the formula-displayed balance = ERP balance + pending buffer rows:

```
Displayed = currentBalance + SUMIF(Inward Live) - SUMIF(Outward Live)
```

After ingestion, `currentBalance` absorbs the buffer rows and SUMIF drops — net unchanged.

### Verification Methods

**Admin endpoint:** `GET /api/admin/sheet-offload/status` returns per-job status:
- Per-job state: `ingestInward`, `ingestOutward`, `moveShipped` (each with `isRunning`, `lastRunAt`, `lastResult`, `recentRuns`)
- `schedulerActive`, `intervalMs`
- `bufferCounts`: pending rows in Inward (Live) and Outward (Live)

**Scripts for manual verification:**
- `check-sheet-totals.ts` — row counts and qty totals per tab
- `verify-outward-totals.ts` — cross-check outward data consistency
- `switch-balance-formula.ts --dry-run` — compares formula values in temporary column

**Production validation results (Phase 3):**
- 6,098 SKUs verified, 0 mismatches
- 134K+ historical transactions ingested
- Cross-check: -13,257 (past) + 15,775 (inward) - 724 (outward) = 1,794 (matched sheet)

---

## 6. Deduplication

### Content-Based Reference IDs

**Function:** `buildReferenceId()` (line ~225)

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
| Historical inward | `sheet:inward-final` | `sheet:inward-final:{sku}:{qty}:{date}:{source}` |
| Historical outward | `sheet:ms-outward` | `sheet:ms-outward:{sku}:{qty}:{order#}:{date}` |

All prefixes defined in `REF_PREFIX` in `config/sync/sheets.ts`.

### Within-Batch Dedup

If the same referenceId appears twice in one batch (same SKU, qty, date, source), a counter suffix `:2`, `:3`, etc. is appended.

### Chunked Database Lookups

**Function:** `findExistingReferenceIds()` (line ~340)

```typescript
const DEDUP_CHUNK_SIZE = 2000;
```

Splits referenceIds into chunks of 2,000 for the `WHERE referenceId IN (...)` query. Prevents PostgreSQL from choking on 37K+ element IN clauses.

---

## 7. Configuration

All configuration in `server/src/config/sync/sheets.ts` (579 lines). Re-exported from `server/src/config/sync/index.ts`.

### Feature Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `ENABLE_SHEET_OFFLOAD` | `false` | Master switch — worker does nothing unless `true` |
| `ENABLE_SHEET_DELETION` | `false` | Delete ingested rows from buffer tabs |
| `ENABLE_FABRIC_LEDGER_PUSH` | `false` | Push fabric balances to Barcode Mastersheet |

### Timing

| Config | Value | Purpose |
|--------|-------|---------|
| `OFFLOAD_INTERVAL_MS` | 30 min | Interval between offload cycles |
| `STARTUP_DELAY_MS` | 5 min | Delay before first run |
| `API_CALL_DELAY_MS` | 200ms | Min delay between API calls (300/min quota) |
| `API_MAX_RETRIES` | 3 | Retries on transient errors (429, 500, 503) |
| `BATCH_SIZE` | 500 | Rows per ingestion batch |

### Column Mappings

Extensive per-tab column definitions:
- `ORDERS_FROM_COH_COLS` — 13 columns (A-AD) including SHIPPED, OUTWARD_DONE
- `INVENTORY_TAB` — tab name, data start row, ERP balance col (R), SKU col (A)
- `INWARD_LIVE_COLS` — 9 columns (A-I)
- `OUTWARD_LIVE_COLS` — 14 columns (A-N, includes Order Date for reversibility)
- `BALANCE_COLS` — 6 columns for Balance (Final) tab

### Source/Destination Maps

```typescript
// Valid sources for Inward (Live) — rows with other sources are rejected
VALID_INWARD_LIVE_SOURCES = ['sampling', 'repacking', 'adjustment'] as const

// Mapping for Inward (Live) sources to transaction reasons
INWARD_SOURCE_MAP: sampling → production, production → production, tailor → production,
                   repacking → return_receipt, return → return_receipt, adjustment → adjustment, ...
DEFAULT_INWARD_REASON = 'production'

// Mapping for Outward (Live) destinations to transaction reasons
OUTWARD_DESTINATION_MAP: customer → order_allocation, sampling → sampling,
                         warehouse → adjustment, office → adjustment, ...
DEFAULT_OUTWARD_REASON = 'sale'
```

**Note:** For Inward (Live), only sources in `VALID_INWARD_LIVE_SOURCES` are accepted. Historical tabs (Inward Final, Inward Archive) may have other source values and use the full `INWARD_SOURCE_MAP` mapping.

---

## 8. API Endpoints

### Sheet Offload (in `server/src/routes/admin.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/admin/sheet-offload/status` | Per-job status + buffer counts (see structure below) |
| `POST` | `/api/admin/sheet-offload/trigger` | **Deprecated** -- runs both ingest jobs. Use background-jobs endpoints instead. |

**Status response structure:**
```json
{
  "ingestInward": { "isRunning": false, "lastRunAt": "...", "lastResult": {...}, "recentRuns": [...] },
  "ingestOutward": { "isRunning": false, "lastRunAt": "...", "lastResult": {...}, "recentRuns": [...] },
  "moveShipped": { "isRunning": false, "lastRunAt": "...", "lastResult": {...}, "recentRuns": [...] },
  "schedulerActive": true,
  "intervalMs": 1800000,
  "bufferCounts": { "inward": 5, "outward": 12 }
}
```

### Background Jobs (in `server/src/routes/admin.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/admin/background-jobs` | List all jobs (includes `ingest_inward`, `ingest_outward`, `move_shipped_to_outward`) |
| `POST` | `/api/admin/background-jobs/:jobId/trigger` | Trigger any job by ID |

**Job IDs for sheet offload:**

| Job ID | Trigger Function | Schedule |
|--------|-----------------|----------|
| `ingest_inward` | `sheetOffloadWorker.triggerIngestInward()` | 30 min interval |
| `ingest_outward` | `sheetOffloadWorker.triggerIngestOutward()` | 30 min interval |
| `move_shipped_to_outward` | `sheetOffloadWorker.triggerMoveShipped()` | Manual only |

**Zod enum** in `client/src/server/functions/admin.ts`:
```typescript
z.enum(['shopify_sync', 'tracking_sync', 'cache_cleanup', 'ingest_inward', 'ingest_outward', 'move_shipped_to_outward'])
```

### Sheet Sync — CSV-based (in `server/src/routes/sheetSync.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/admin/sheet-sync/plan` | Parse CSVs, run plan functions |
| `POST` | `/api/admin/sheet-sync/execute` | Execute a planned sync job |
| `GET` | `/api/admin/sheet-sync/status` | Poll job progress |

---

## 9. Frontend

### OffloadMonitor (in `SheetSyncTab.tsx`)

Embedded at the top of the Sheet Sync tab. Now shows **per-job status** for all 3 jobs:
- Per-job cards: Ingest Inward, Move Shipped, Ingest Outward
- Each card shows: running state, last run time, last result summary, "Run Now" button
- Scheduler state (Active / Disabled)
- Interval, deletion enabled status
- Pending buffer rows (Inward, Outward)

Polls `GET /api/admin/sheet-offload/status` every 30 seconds.

### BackgroundJobsTab (in `BackgroundJobsTab.tsx`)

Lists all background jobs including the 3 sheet jobs (`ingest_inward`, `move_shipped_to_outward`, `ingest_outward`). Each job card shows:
- Icon, name, description, status badges (Running/Active/Disabled)
- Schedule/interval, last run time, next run
- Expandable details with per-job result renderers (different fields for each result type)
- "Run Now" button for triggerable jobs
- Enable/Disable toggle for cache cleanup

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
| `server/src/services/sheetOffloadWorker.ts` | Main worker: 3 independent jobs (triggerIngestInward, triggerIngestOutward, triggerMoveShipped), per-job state, start/stop/getStatus/getBufferCounts |
| `server/src/services/googleSheetsClient.ts` | Authenticated Sheets API client: JWT auth, rate limiter, retry, CRUD ops + border formatting |
| `server/src/services/sheetOrderPush.ts` | Push new Shopify orders to "Orders from COH" tab (one row per line item) |
| `server/src/config/sync/sheets.ts` | All config: spreadsheet IDs, tab names, column mappings, timing, formulas (579 lines) |
| `server/src/config/sync/index.ts` | Re-exports all sheets config |

### Routes & Server Functions

| File | Purpose |
|------|---------|
| `server/src/routes/admin.ts` | Offload status/trigger + background jobs endpoints |
| `server/src/routes/sheetSync.ts` | CSV-based sheet sync: plan/execute/status |
| `client/src/server/functions/admin.ts` | Server functions for background jobs |
| `client/src/server/functions/sheetSync.ts` | Server functions for sheet sync |

### Frontend

| File | Purpose |
|------|---------|
| `client/src/components/settings/tabs/SheetSyncTab.tsx` | OffloadMonitor + CSV sheet sync UI (913 lines) |
| `client/src/components/settings/tabs/BackgroundJobsTab.tsx` | Background jobs dashboard (419 lines) |

### Infrastructure

| File | Purpose |
|------|---------|
| `server/src/services/googleSheetsFetcher.ts` | Unauthenticated CSV fetcher (used by Sheet Sync, not offload) |
| `server/src/services/sheetSyncService.ts` | CSV-based sync orchestrator: 6-step plan/execute (Steps 1 & 4 disabled — evidence-based fulfillment) |
| `server/src/index.js` | Worker registration + shutdown handler |
| `server/src/utils/logger.ts` | `sheetsLogger` child logger |
| `server/config/google-service-account.json` | Service account key (gitignored) |

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
| `SHEETS_OFFLOAD.md` | Full design doc: vision, architecture, phases, data analysis, formulas (1551 lines) |
| `.claude/plans/google-sheet-hybrid.md` | Implementation plan with phase tracking |

---

## 11. Gotchas

### Google API

- **Error `code` is a STRING** — `googleapis` errors have `code` as string, not number. Always use `Number(error.code)` for comparison.
- **Sheet data types are mixed** — `values.get()` returns mixed types. Always coerce with `String(cell ?? '')`.
- **API quota: 300 requests/min** — Rate limiter in `googleSheetsClient.ts` enforces 200ms between calls. Batch operations with `groupIntoRanges()` to minimize API calls.
- **IMPORTRANGE vs same-sheet** — Live tabs in Mastersheet enable same-sheet SUMIF (fast). Balance (Final) in Office Ledger needs IMPORTRANGE (slower, must wrap in IFERROR).

### Data Handling

- **DD/MM/YYYY date parsing** — Indian locale dates must be parsed DD/MM FIRST, before `new Date()` fallback (which treats "01/02/2025" as Jan 2nd). Use `parseSheetDate()`.
- **Large IN clauses** — Prisma/PG chokes on 37K+ element IN clauses. Always chunk at 2,000 (`DEDUP_CHUNK_SIZE`).
- **Row-index referenceIds are UNSTABLE** — After row deletion, indices shift. Use content-based keys (SKU+qty+date+source) instead.
- **Col C in Outward (Live) is protected** — Contains a formula. When writing rows, set col C to empty string `''`.

### Worker

- **Per-job concurrency guards** — Each job has its own `JobState<T>` with `isRunning` boolean. If already running, the trigger function returns `null`. Jobs are independent -- ingest inward can run while move shipped is running.
- **setInterval timing** — Starts counting from `start()`, not from when startup timeout fires. Interval is started AFTER first run completes.
- **Admin user requirement** — `createdById` on InventoryTransaction is a required FK. Worker looks up first admin user by role and caches the ID.
- **Evidence-based fulfillment** — Phase B2 (`linkOutwardToOrders`) only updates lines in `LINKABLE_STATUSES` (`pending`, `allocated`, `picked`, `packed`). Already-shipped/cancelled lines are safely skipped. Uses FIFO consumption for duplicate SKUs in same order.
- **Manual sync conflict** — sheetSyncService Steps 1 (Ship & Release) and 4 (Sync Line Statuses) are DISABLED because they create duplicate outward transactions and bypass evidence-based flow.

### Tabs

- **Aggregate vs individual tabs** — Office Ledger "Orders Outward" is an IMPORTRANGE aggregate (SKU+Qty only, 3K rows). Must NOT be used for ingestion. Mastersheet "Outward" has individual rows with order numbers (39K rows).
- **Notes column difference** — Inward (Final) col H is "Tailor Number", but Inward (Archive) col H is "notes". Column mappings handle this.

---

## 12. Operational Runbook

### Running the Full Shipped --> Outward --> Ingest Flow

1. **Check buffer tab state** -- Go to Settings > Sheet Sync > OffloadMonitor. Note current pending row counts.

2. **Move shipped orders** -- Go to Settings > Background Jobs > "Move Shipped -> Outward" (`move_shipped_to_outward`) > Click "Run Now". Wait for completion. Check `MoveShippedResult`: how many rows found/written/verified/deleted.

3. **Verify in Sheets** -- Open the Mastersheet. Check that:
   - "Outward (Live)" has new rows
   - "Orders from COH" shipped rows are deleted (or marked col AD = 1)

4. **Run ingest inward** -- Go to Settings > Background Jobs > "Ingest Inward" (`ingest_inward`) > Click "Run Now". Or wait for the next scheduled cycle (30 min).

5. **Run ingest outward** -- Go to Settings > Background Jobs > "Ingest Outward" (`ingest_outward`) > Click "Run Now". Or wait for the next scheduled cycle (30 min). This also auto-ships OrderLines via evidence-based fulfillment.

6. **Verify ingestion** -- Check OffloadMonitor per-job results:
   - `IngestInwardResult`: inwardIngested count, skipped, inwardValidationErrors
   - `IngestOutwardResult`: outwardIngested count, ordersLinked, outwardSkipReasons
   - Buffer pending counts should drop to 0 (if deletion enabled)
   - skusUpdated count shows how many balances were written

7. **Cross-check balance** -- Open Inventory tab col C. The displayed balance should be unchanged before and after ingestion (the formula invariant).

### Emergency Stop

1. Set `ENABLE_SHEET_OFFLOAD=false` in config — stops the scheduled worker
2. The worker has a concurrency guard — if currently running, it will finish its current cycle but not start a new one
3. Data in buffer tabs is safe — it won't be deleted until `ENABLE_SHEET_DELETION=true`

### Debugging Discrepancies

1. **Check recent runs** — OffloadMonitor "Recent Runs" table shows last 10 runs with per-tab counts
2. **Check for skipped rows** — `skipped` count in results means rows failed validation. For inward rows, check `inwardValidationErrors` for a breakdown (e.g., `missing SKU (A)`, `unknown SKU "..."`, `invalid Source "..."`). For outward rows, check `outwardSkipReasons` (e.g., `unknown_sku`, `invalid_date`, `order_not_found`, `order_line_not_found`). Invalid inward rows remain on the sheet for ops to fix; outward skip reasons are also reported.
3. **Check dedup** — If ingested count is less than sheet row count, some rows were already ingested (matching referenceId exists)
4. **Manual balance check** — Run `check-sheet-totals.ts` to get row counts per tab, compare against ERP `InventoryTransaction` counts
5. **Formula check** — If displayed balance is wrong, check that col R (Inventory) and col F (Balance Final) have the correct ERP `currentBalance` value
