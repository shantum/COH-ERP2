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
Orders from COH (shipped) ──moveShippedToOutward──► Outward (Live) ──┐
                                                                      │
Ops team manual entry ──────────────────────────────► Inward (Live) ──┤
                                                                      │
                                                                      ▼
                                              Offload Worker (Phases A-D)
                                                      │
                                    ┌─────────────────┼─────────────────┐
                                    ▼                 ▼                 ▼
                            InventoryTransaction   Sheet col R      Sheet col F
                              (ERP database)     (Inventory tab)  (Balance Final)
```

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

**Function:** `moveShippedToOutward()` in `sheetOffloadWorker.ts` (lines 758-912)

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

## 4. Offload Worker (5 Phases)

**Function:** `runOffloadSync()` in `sheetOffloadWorker.ts`

Runs on a configurable interval (default 30 min). Requires `ENABLE_SHEET_OFFLOAD=true`.

### Phase A: Ingest Inward (Live)

**Function:** `ingestInwardLive()`

1. Reads `'Inward (Live)'!A:I` from Mastersheet
2. Parses rows: extracts SKU, qty, date, source, doneBy, tailor
3. Builds content-based referenceIds: `sheet:inward-live:{sku}:{qty}:{date}:{source}`
4. Deduplicates against existing DB via `findExistingReferenceIds()` (chunked at 2,000)
5. Looks up SKU IDs in bulk
6. Creates `InventoryTransaction` records:
   - `txnType: TXN_TYPE.INWARD`
   - `reason`: mapped via `INWARD_SOURCE_MAP` (sampling, production, tailor, repacking, return, etc.)
   - `metadata`: `{ source, performedBy, tailorNumber }`
7. If `ENABLE_SHEET_DELETION=true`: deletes ALL parsed rows (including already-ingested duplicates)

### Phase B: Ingest Outward (Live)

**Function:** `ingestOutwardLive()`

Same parse/dedup pattern as Phase A, but:
- Reads `'Outward (Live)'!A:M`
- `txnType: TXN_TYPE.OUTWARD`
- If order number present: `reason = 'sale'`. Otherwise: maps via `OUTWARD_DESTINATION_MAP`
- `metadata`: `{ destination, orderNumber }`
- Also extracts **courier** (col J) and **AWB** (col K) for order linking
- Returns `{ affectedSkuIds, linkableItems }` — linkable items are outward entries with an order number

### Phase B2: Link Outward to OrderLines (Evidence-Based Fulfillment)

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

### Phase C: Update Sheet Balances

**Function:** `updateSheetBalances()`

Only runs if Phases A/B affected any SKUs.

1. Queries `Sku.currentBalance` for all affected SKUs
2. **Target 1 — Inventory tab col R** (Mastersheet): reads SKU column, builds update array, writes via batched `groupIntoRanges()`
3. **Target 2 — Balance (Final) col F** (Office Ledger): same approach

### Phase D: Invalidate Caches

**Function:** `invalidateCaches()`

Only runs if something was ingested.
- `inventoryBalanceCache.invalidateAll()`
- SSE broadcast: `{ type: 'inventory_updated' }`

### Sync Cycle Summary

```
Phase A:  Ingest Inward (Live) → InventoryTransactions
Phase B:  Ingest Outward (Live) → InventoryTransactions + collect linkable items
Phase B2: Link outward to OrderLines → mark as shipped (evidence-based fulfillment)
Phase C:  Write ERP balance → Sheet col R (Inventory) + col F (Balance Final)
Phase D:  Invalidate caches + SSE broadcast
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

**Admin endpoint:** `GET /api/admin/sheet-offload/status` returns:
- Worker status (running, enabled, lastRunAt)
- Buffer counts: pending rows in Inward (Live) and Outward (Live)
- Recent run results with ingested/skipped counts

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

**Function:** `buildReferenceId()` (lines 207-217)

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

**Function:** `findExistingReferenceIds()` (lines 231-246)

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
INWARD_SOURCE_MAP: sampling → sampling, production → production, tailor → production,
                   repacking → adjustment, return → return, ...
OUTWARD_DESTINATION_MAP: customer → sale, sampling → sampling, office → internal_transfer, ...
DEFAULT_INWARD_REASON = 'production'
DEFAULT_OUTWARD_REASON = 'sale'
```

---

## 8. API Endpoints

### Sheet Offload (in `server/src/routes/admin.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/admin/sheet-offload/status` | Worker status + buffer counts |
| `POST` | `/api/admin/sheet-offload/trigger` | Trigger offload sync manually |

### Background Jobs (in `server/src/routes/admin.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/admin/background-jobs` | List all jobs (includes `sheet_offload`, `shipped_to_outward`) |
| `POST` | `/api/admin/background-jobs/:jobId/trigger` | Trigger any job by ID |

### Sheet Sync — CSV-based (in `server/src/routes/sheetSync.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/admin/sheet-sync/plan` | Parse CSVs, run plan functions |
| `POST` | `/api/admin/sheet-sync/execute` | Execute a planned sync job |
| `GET` | `/api/admin/sheet-sync/status` | Poll job progress |

---

## 9. Frontend

### OffloadMonitor (in `SheetSyncTab.tsx`, lines 160-475)

Embedded at the top of the Sheet Sync tab. Shows:
- Scheduler state (Active / Running / Disabled)
- Interval, last run time, deletion enabled status
- Pending buffer rows (Inward, Outward)
- Last run results: ingested counts, skipped, SKUs updated, errors, duration
- "Recent Runs" expandable table
- "Run Now" button to trigger offload sync

Polls `GET /api/admin/sheet-offload/status` every 30 seconds and `getBackgroundJobs()` every 15 seconds.

### BackgroundJobsTab (in `BackgroundJobsTab.tsx`, 419 lines)

Lists all background jobs including `sheet_offload` and `shipped_to_outward`. Each job card shows:
- Icon, name, description, status badges (Running/Active/Disabled)
- Schedule/interval, last run time, next run
- Expandable details with last run results
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
| `server/src/services/sheetOffloadWorker.ts` | Main worker: Phases A-D, moveShippedToOutward, start/stop/getStatus (1018 lines) |
| `server/src/services/googleSheetsClient.ts` | Authenticated Sheets API client: JWT auth, rate limiter, retry, CRUD ops (325 lines) |
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

- **Concurrency guard** — Module-level `isRunning` boolean prevents concurrent runs. If already running, `runOffloadSync()` returns `null`.
- **setInterval timing** — Starts counting from `start()`, not from when startup timeout fires. Interval is started AFTER first run completes.
- **Admin user requirement** — `createdById` on InventoryTransaction is a required FK. Worker looks up first admin user by role and caches the ID.
- **Evidence-based fulfillment** — Phase B2 (`linkOutwardToOrders`) only updates lines in `LINKABLE_STATUSES` (`pending`, `allocated`, `picked`, `packed`). Already-shipped/cancelled lines are safely skipped. Uses FIFO consumption for duplicate SKUs in same order.
- **Manual sync conflict** — sheetSyncService Steps 1 (Ship & Release) and 4 (Sync Line Statuses) are DISABLED because they create duplicate outward transactions and bypass evidence-based flow.

### Tabs

- **Aggregate vs individual tabs** — Office Ledger "Orders Outward" is an IMPORTRANGE aggregate (SKU+Qty only, 3K rows). Must NOT be used for ingestion. Mastersheet "Outward" has individual rows with order numbers (39K rows).
- **Notes column difference** — Inward (Final) col H is "Tailor Number", but Inward (Archive) col H is "notes". Column mappings handle this.

---

## 12. Operational Runbook

### Running the Full Shipped → Outward → Ingest Flow

1. **Check buffer tab state** — Go to Settings > Sheet Sync > OffloadMonitor. Note current pending row counts.

2. **Move shipped orders** — Go to Settings > Background Jobs > "Move Shipped → Outward" > Click "Run Now". Wait for completion. Check result: how many rows found/written/deleted.

3. **Verify in Sheets** — Open the Mastersheet. Check that:
   - "Outward (Live)" has new rows
   - "Orders from COH" shipped rows have col AD = 1 (or are deleted)

4. **Run offload ingestion** — Go to Settings > Background Jobs > "Sheet Offload" > Click "Run Now". Or wait for the next scheduled cycle (30 min).

5. **Verify ingestion** — Check OffloadMonitor:
   - Inward/Outward ingested counts should match buffer rows
   - Buffer pending counts should drop to 0 (if deletion enabled)
   - SKUs updated count shows how many balances were written

6. **Cross-check balance** — Open Inventory tab col C. The displayed balance should be unchanged before and after ingestion (the formula invariant).

### Emergency Stop

1. Set `ENABLE_SHEET_OFFLOAD=false` in config — stops the scheduled worker
2. The worker has a concurrency guard — if currently running, it will finish its current cycle but not start a new one
3. Data in buffer tabs is safe — it won't be deleted until `ENABLE_SHEET_DELETION=true`

### Debugging Discrepancies

1. **Check recent runs** — OffloadMonitor "Recent Runs" table shows last 10 runs with per-tab counts
2. **Check for skipped rows** — `skipped` count in results means rows had invalid SKU or failed parsing
3. **Check dedup** — If ingested count is less than sheet row count, some rows were already ingested (matching referenceId exists)
4. **Manual balance check** — Run `check-sheet-totals.ts` to get row counts per tab, compare against ERP `InventoryTransaction` counts
5. **Formula check** — If displayed balance is wrong, check that col R (Inventory) and col F (Balance Final) have the correct ERP `currentBalance` value
