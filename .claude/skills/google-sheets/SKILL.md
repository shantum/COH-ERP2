# Google Sheets Hybrid System

Bridges Google Sheets (ops team) and ERP DB. 9 jobs + 2 cycle runners. Dedup via DONE marking + SUMIFS exclusion.

## Spreadsheets
- **COH Orders Mastersheet** (`ORDERS_MASTERSHEET_ID`): `1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo` — Orders from COH, Inventory, Inward (Live), Outward (Live), Outward, Fabric Inward (Live)
- **Office Ledger** (`OFFICE_LEDGER_ID`): `1ZZgzu4xPXhP9ba3-liXHxj5tY0HihoEnVC9-wLijD5E` — Inward (Final), Inward (Archive), Balance (Final), Returns/Exchange
- **Barcode Mastersheet** (`BARCODE_MASTERSHEET_ID`): `1xlK4gO2Gxu8-8-WS4jFnR0uxYO35fEBPZiSbJobGVy8` — Main (SKU master), Fabric Balances, Product Weights

## Buffer Tabs (in Mastersheet)
- **Inward (Live)** A-J: SKU, Qty, Product, Date, Source, Done By, Barcode, Tailor Number, Notes, Import Errors
- **Outward (Live)** A-AG: Orders from COH layout + Outward Date, Unique ID, Import Errors
- **Fabric Inward (Live)** A-K: Material, Fabric, Colour, Fabric Code, Qty, Unit, Cost Per Unit, Supplier, Date, Notes, Status
- Buffer tabs in Mastersheet so Inventory formula uses same-sheet SUMIFS (no IMPORTRANGE)

## DONE Marking
Ingested rows marked `DONE:{referenceId}` in Import Errors column. V2 SUMIFS exclude DONE rows. `CLEANUP_RETENTION_DAYS=0` (immediate delete). Config: `INGESTED_PREFIX='DONE:'` in `config/sync/sheets.ts`.

## Jobs
- `ingest_inward` (30 min) — Inward (Live) -> DB txns, fabric deduction for sampling, mark DONE
- `ingest_outward` (30 min) — Outward (Live) -> DB txns, link OrderLines (evidence-based fulfillment), mark DONE
- `move_shipped_to_outward` (manual) — Copy shipped rows from Orders from COH -> Outward (Live)
- `push_balances` (manual) — Push ERP `currentBalance` to Inventory col R + Balance Final col F
- `push_fabric_balances` (manual) — Push `FabricColour.currentBalance` to Fabric Balances tab
- `import_fabric_balances` (manual) — Read physical counts, time-aware reconcile, create adjustments
- `ingest_fabric_inward` (manual) — Fabric Inward (Live) -> DB, auto-create suppliers
- `cleanup_done_rows` (manual) — Delete DONE rows from all 3 buffer tabs
- `migrate_sheet_formulas` (manual) — Rewrite SUMIF -> SUMIFS V2 (DONE exclusion)
- `inward_cycle` (manual) — Full pipeline: balance check -> CSV backup -> push -> health check -> read -> validate -> write -> mark DONE -> push -> verify -> cleanup
- `outward_cycle` (manual) — Same as inward cycle + link orders step
- Preview jobs: `previewIngest{Inward,Outward}()`, `previewPushBalances()`, `previewFabricInward()` — dry-run, no DB writes
- `reconcile_sheet_orders` (manual) — Push missed orders (3-day lookback, batch 20)

## Combined View Formula (V2)
**Invariant:** `Displayed = currentBalance + SUMIFS(pending Inward) - SUMIFS(pending Outward)`. When DONE: SUMIFS drops X, currentBalance gains X after push -> net unchanged.
- **Inventory col C** (same-sheet): `=R{row} + SUMIFS('Inward (Live)'!$B:$B,...,$A{row},...,"<>DONE:*") - SUMIFS('Outward (Live)'!$B:$B,...,$A{row},...,"<>DONE:*")`
- **Balance Final col E** (cross-sheet): Same but IMPORTRANGE wrapped in IFERROR
- Templates: `INVENTORY_BALANCE_FORMULA_TEMPLATE`, `LIVE_BALANCE_FORMULA_V2_TEMPLATE` in `config/sync/sheets.ts`

## Sheet Order Push (`server/src/services/sheetOrderPush.ts`)
- **Shopify**: Webhook `result.action==='created'` -> `pushNewOrderToSheet()` via `deferredExecutor`. Note: Shopify sometimes sends new orders as `orders/updated`
- **ERP-created**: `pushERPOrderToSheet(orderId)` — also writes status/courier/AWB to Y/Z/AA at push time
- **Reconciler**: `reconcileSheetOrders()` finds `sheetPushedAt IS NULL` (3-day lookback, batch 20)
- **Status sync**: `syncSheetOrderStatus()` scheduled, updates Y/Z/AA. `syncSingleOrderToSheet(orderNumber)` on-demand
- **Channel details**: `updateSheetChannelDetails(updates)` writes marketplace status/courier/AWB after CSV import

### Column Mapping (Orders from COH, A:AD = 30 cols)
- **ERP-pushed:** A=Order Date, B=Order#, C=Name, D=City, E=Phone, F=Channel (`payment_gateway_names[0]`), G=SKU, H=empty (VLOOKUP), I=Qty, K=Order Note, L=COH Notes ("SHIP BY {date}"), Y=Status, Z=Courier, AA=AWB
- **Formula cols:** H=VLOOKUP product, M=qty balance, P=order age, S=fabric stock (BROKEN), Y/Z/AA=ShopifyAllOrderData VLOOKUP, AB=ready to ship, AD=outward done, AE=unique ID (order#+SKU+qty), AF=fabric code, AG=fabric consumption
- **Ops manual:** J=Status, K=Order Note, L=COH Note, N=Assigned, O=Picked, Q=source_, R=samplingDate, U=Packed, X=Shipped, AC=AWB Scan
- After push: `stampSheetPushed(orderId)` sets `order.sheetPushedAt`. Bottom border via `addBottomBorders()`

### Move-to-Outward Eligibility
ALL required: Picked(O)=TRUE, Packed(U)=TRUE, Shipped(X)=TRUE, Courier(Z) filled, AWB(AA) filled, AWB Scan(AC) filled, Outward Done(AD)!=1, SKU(G) non-empty. Safety: write Outward (Live) FIRST -> verify -> mark AD -> delete source rows (bottom-up).

## Ingest Inward
1. Read `'Inward (Live)'!A:J` via `readRangeWithSerials()`
2. Bulk lookup SKUs, validate (9 rules), dedup via `findExistingReferenceIds()` (chunked 2K)
3. Create `InventoryTransaction` (txnType: INWARD, reason from INWARD_SOURCE_MAP)
4. Fabric auto-deduction for sampling (BOM lookup -> `FabricColourTransaction` OUTWARD)
5. Mark DONE, push balances, invalidate caches

### Inward Validation Rules
1. Required: SKU, Qty, Product, Date, Source, Done By
2. Barcode required for `repacking`
3. Tailor Number required for `sampling`
4. Notes required for `adjustment`
5. Source in `VALID_INWARD_LIVE_SOURCES`: sampling, repacking, adjustment, rto, return
6. SKU must exist in DB
7. Qty > 0, 8. Qty <= MAX_QTY_PER_ROW (500), 9. Date within MAX_PAST_DAYS (365) to MAX_FUTURE_DAYS (3)

### Fabric Auto-Deduction
For `sampling` inwards (configurable: `FABRIC_DEDUCT_SOURCES`): SKU BOM -> FABRIC components -> `FabricColour` via `VariationBomLine.fabricColourId` -> `FabricColourTransaction` OUTWARD (qty = inward qty * BOM qty).

## Ingest Outward
Same parse/dedup pattern. Reads `'Outward (Live)'!A:AG`.
- Date priority: Outward Date (col AE) > Order Date (col A)
- With order#: `reason='sale'`, else maps via `OUTWARD_DESTINATION_MAP`
- Extracts courier (col J) + AWB (col K) for order linking
- Order+SKU dedup: skips if same `orderNumber|skuId` already in DB
- Channel matching: Myntra UUID/short format, Nykaa `--1` suffix
- **Pass 1 validation:** empty_sku, zero_qty, unknown_sku, invalid_date, duplicate_order_sku, qty_too_large, date_out_of_range
- **Pass 2 validation:** order_not_found, order_line_not_found

### Evidence-Based Fulfillment (`linkOutwardToOrders`)
Outward txns = shipping evidence. Groups by order, finds matching OrderLine by skuId (FIFO for dupes). Only `LINKABLE_STATUSES`: pending, allocated, picked, packed. Updates: `lineStatus:'shipped', shippedAt, courier?, awbNumber?` in single `prisma.$transaction()`. Team fulfills in Sheets, worker auto-ships OrderLines from outward evidence.

## Deduplication — Content-Based Reference IDs (`buildReferenceId()`)
- Inward (Live): `sheet:inward-live:{sku}:{qty}:{date}:{source}`
- Outward (Live): `sheet:outward-live:{sku}:{qty}:{date}:{dest_or_order#}`
- Fabric Inward (Live): `sheet:fabric-inward-live:{fabricCode}:{qty}:{date}:{source}`
- Historical inward: `sheet:inward-final:{sku}:{qty}:{date}:{source}`
- Historical outward: `sheet:ms-outward:{sku}:{qty}:{order#}:{date}`
- Prefixes in `REF_PREFIX` (`config/sync/sheets.ts`). Within-batch dedup: counter suffix `:2`,`:3`. DB lookup chunked at `DEDUP_CHUNK_SIZE=2000`.

## Configuration (`server/src/config/sync/sheets.ts`, ~720 lines, re-exported from `config/sync/index.ts`)
- **Feature flags:** `ENABLE_SHEET_OFFLOAD=false` (master switch), `ENABLE_FABRIC_LEDGER_PUSH=false`
- **Timing:** `OFFLOAD_INTERVAL_MS=30min`, `STARTUP_DELAY_MS=5min`, `API_CALL_DELAY_MS=250ms` (300/min quota, ~20% margin), `API_MAX_RETRIES=3` (429/500/503), `BATCH_SIZE=500`
- **Source maps:** INWARD_SOURCE_MAP: sampling/production/tailor->production, repacking/return->return_receipt, adjustment->adjustment, rto->rto_received, reject->damage. DEFAULT_INWARD_REASON='production'
- **Dest maps:** OUTWARD_DESTINATION_MAP: customer->order_allocation, sampling->sampling, warehouse/office->adjustment. DEFAULT_OUTWARD_REASON='sale'. FABRIC_DEDUCT_SOURCES=['sampling']
- **Column mappings:** `ORDERS_FROM_COH_COLS`, `INVENTORY_TAB`, `INWARD_LIVE_COLS`, `OUTWARD_LIVE_COLS`, `BALANCE_COLS`, `FABRIC_BALANCES_COLS/HEADERS`, `FABRIC_INWARD_LIVE_COLS/HEADERS`
- **Tab names:** MASTERSHEET_TABS={ORDERS_FROM_COH, INVENTORY, OFFICE_INVENTORY, OUTWARD, FABRIC_BALANCES}, LIVE_TABS={INWARD, OUTWARD, FABRIC_INWARD}, BARCODE_TABS={MAIN:'Sheet1', FABRIC_BALANCES, PRODUCT_WEIGHTS}

## API Endpoints
- `GET /api/admin/sheet-offload/status` — all 9 job states + buffer counts
- `GET /api/admin/sheet-monitor/stats` — Sheets Monitor dashboard stats
- `GET /api/admin/background-jobs` — list all jobs
- `POST /api/admin/background-jobs/:jobId/trigger` — trigger any job by ID
- `POST /api/admin/sheet-sync/plan` — parse CSVs, run plan
- `POST /api/admin/sheet-sync/execute` — execute planned sync
- `GET /api/admin/sheet-sync/status` — poll progress

## Google Drive Finance Sync (`server/src/services/driveFinanceSync.ts`)
Auto-uploads invoice/payment files to Drive for CA access. One-way sync (ERP is truth).
- **Folder:** `COH Finance/ (DRIVE_FINANCE_FOLDER_ID)` -> `Vendor Invoices/ -> Party Name/ -> FY 2025-26/ -> PartyName_INV-1801_2025-06-15.pdf` | `_Unlinked/ -> FY 2025-26/`
- **Functions:** `uploadInvoiceFile(invoiceId)` / `uploadPaymentFile(paymentId)` — fetch, resolve folder, upload, save driveFileId/driveUrl/driveUploadedAt. `syncAllPendingFiles()` — batch find with fileData but no driveFileId
- **Config** (`config/sync/drive.ts`): `DRIVE_FINANCE_FOLDER_ID`=env, `DRIVE_API_CALL_DELAY_MS=200ms`, `DRIVE_API_MAX_RETRIES=3`, `DRIVE_SYNC_BATCH_SIZE=10`, `DRIVE_UNLINKED_FOLDER_NAME='_Unlinked'`, `DRIVE_VENDOR_INVOICES_FOLDER_NAME='Vendor Invoices'`, `getFinancialYear(date)` returns "FY 2025-26" (Indian Apr-Mar)
- Worker pattern: start/stop/getStatus/triggerSync. 30-min interval + 3-min startup delay

## Key Files
- `server/src/services/sheetOffloadWorker.ts` — main worker: 9 jobs + 2 cycles, per-job state, balance verification, fabric deduction
- `server/src/services/googleSheetsClient.ts` — Sheets API: JWT auth, rate limiter, retry, batchRead/Write, readRangeWithSerials, serialToDate
- `server/src/services/googleDriveClient.ts` — Drive API v3 (OAuth2): upload, ensureFolder, listFolder, moveFile, trashFile
- `server/src/services/sheetOrderPush.ts` — push orders, reconciler, status sync, channel details
- `server/src/services/driveFinanceSync.ts` — Drive finance sync worker
- `server/src/config/sync/sheets.ts` — all sheet config (~720 lines)
- `server/src/config/sync/drive.ts` — Drive config
- `server/src/routes/admin.ts` — offload status, background jobs, sheet monitor, cycle progress
- `server/src/routes/sheetSync.ts` — CSV-based sheet sync
- `client/src/pages/SheetsMonitor.tsx` — dashboard: 15s buffer counts, 30s job status, 60s stats, cycle progress modal
- `client/src/components/settings/jobs/sheetJobTypes.ts` — client-side type mirrors
- `client/src/components/settings/tabs/BackgroundJobsTab.tsx` — background jobs dashboard
- Scripts: `switch-balance-formula.ts`, `switch-inventory-formula.ts`, `check-sheet-totals.ts`, `backup-sheets.ts`/`restore-sheets.ts`, `backfill-outward-order-numbers.ts`, `link-historical-outward-to-orders.ts` (all in `server/scripts/`)

## Gotchas
- **Error `code` is STRING** — use `Number(error.code)` for comparison
- **Sheet data types mixed** — always `String(cell ?? '')`
- **API quota 300/min** — rate limiter at 250ms. Use batchRead/Write
- **Credentials (Sheets)**: env `GOOGLE_SERVICE_ACCOUNT_JSON` (Railway) -> fallback `server/config/google-service-account.json` (local)
- **Credentials (Drive)**: OAuth2, NOT service account (zero storage quota). Needs `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`
- **Two auth methods**: Sheets=service account JWT, Drive=OAuth2 refresh token. Don't mix
- **Date serial numbers** — Sheets stores as serials (days since Dec 30, 1899). Use `readRangeWithSerials()` + `serialToDate()`
- **DD/MM/YYYY** — parse DD/MM FIRST before `new Date()` fallback. Or use readRangeWithSerials
- **Large IN clauses** — chunk at DEDUP_CHUNK_SIZE=2000 (PG chokes on 37K+)
- **Row-index referenceIds UNSTABLE** — use content-based keys (SKU+qty+date+source)
- **Col C in Outward (Live) is protected** — formula column, set to `''` when writing
- **DONE rows in formulas** — V2 SUMIFS must have `"<>DONE:*"`. Old SUMIF will double-count
- **Per-job concurrency guards** — each job has `JobState<T>` with `isRunning`, returns null if running
- **Cycle runners guard ALL operations** — won't start if ANY job is running
- **Admin user required** — `createdById` on InventoryTransaction is required FK. Worker caches admin user ID (role='admin')
- **No ledger booking** — finance computed from source records, `ledgerService.ts` removed
- **Worker run tracking** — `trackWorkerRun()` persists to `WorkerRun` table
- **Time-aware fabric reconciliation** — `importFabricBalances` calculates historical ERP balance AT count time
- **Fabric inward auto-creates suppliers** — new supplier names become Party records
- **Serial date parsing** — all ingest jobs use `readRangeWithSerials()` (two parallel API calls: FORMATTED + UNFORMATTED)
- **Office Ledger "Orders Outward"** is aggregate IMPORTRANGE (SKU+Qty, 3K rows) — NOT for ingestion. Use Mastersheet "Outward" (individual rows, 39K)
- **Cleanup covers 3 tabs** — Inward (Live), Outward (Live), Fabric Inward (Live)

## Operational Runbook
- **Preferred:** Use `inward_cycle`/`outward_cycle` — wraps all steps with real-time progress. Trigger from Background Jobs page
- **Manual:** Check buffer counts -> `move_shipped_to_outward` -> `ingest_inward` -> `ingest_outward` -> `push_balances` -> verify Inventory col C unchanged
- **Fabric:** `push_fabric_balances` -> `import_fabric_balances` (creates adjustments) -> review
- **Emergency stop:** Set `ENABLE_SHEET_OFFLOAD=false`. Buffer tab data is safe
- **Debug discrepancies:** Check validation errors/skip reasons in job results -> check dedup counts -> `preview_push_balances` for ERP vs sheet diffs -> `migrate_sheet_formulas` if old SUMIF -> `check-sheet-totals.ts` for row counts
