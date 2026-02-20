---
name: google-sheets
description: "Google Sheets hybrid system — bridges Sheets (ops team) and ERP DB. Buffer tabs, ingest jobs, balance push, order push, DONE marking."
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash(git *)
---

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

## Combined View Formula (V2)
**Invariant:** `Displayed = currentBalance + SUMIFS(pending Inward) - SUMIFS(pending Outward)`. When DONE: SUMIFS drops X, currentBalance gains X after push -> net unchanged.
- **Inventory col C** (same-sheet): `=R{row} + SUMIFS('Inward (Live)'!$B:$B,...,$A{row},...,"<>DONE:*") - SUMIFS('Outward (Live)'!$B:$B,...,$A{row},...,"<>DONE:*")`
- **Balance Final col E** (cross-sheet): Same but IMPORTRANGE wrapped in IFERROR

## Jobs
| Job | Interval | Summary |
|-----|----------|---------|
| `ingest_inward` | 30 min | Inward (Live) -> DB txns, fabric deduction for sampling, mark DONE |
| `ingest_outward` | 30 min | Outward (Live) -> DB txns, link OrderLines, mark DONE |
| `move_shipped_to_outward` | manual | Copy shipped rows from Orders from COH -> Outward (Live) |
| `push_balances` | manual | Push ERP `currentBalance` to Inventory col R + Balance Final col F |
| `push_fabric_balances` | manual | Push `FabricColour.currentBalance` to Fabric Balances tab |
| `import_fabric_balances` | manual | Read physical counts, time-aware reconcile, create adjustments |
| `ingest_fabric_inward` | manual | Fabric Inward (Live) -> DB, auto-create suppliers |
| `cleanup_done_rows` | manual | Delete DONE rows from all 3 buffer tabs |
| `migrate_sheet_formulas` | manual | Rewrite SUMIF -> SUMIFS V2 (DONE exclusion) |
| `inward_cycle` | manual | Full pipeline: balance check -> CSV backup -> push -> ingest -> verify -> cleanup |
| `outward_cycle` | manual | Same as inward cycle + link orders step |
| `reconcile_sheet_orders` | manual | Push missed orders (3-day lookback, batch 20) |
- Preview jobs: `previewIngest{Inward,Outward}()`, `previewPushBalances()`, `previewFabricInward()` — dry-run, no DB writes

## Sheet Order Push (`server/src/services/sheetOrderPush.ts`)
- **Shopify**: Webhook `result.action==='created'` -> `pushNewOrderToSheet()` via `deferredExecutor`. Note: Shopify sometimes sends new orders as `orders/updated`
- **ERP-created**: `pushERPOrderToSheet(orderId)` — also writes status/courier/AWB to Y/Z/AA at push time
- **Reconciler**: `reconcileSheetOrders()` finds `sheetPushedAt IS NULL` (3-day lookback, batch 20)
- **Status sync**: `syncSheetOrderStatus()` scheduled, updates Y/Z/AA. `syncSingleOrderToSheet(orderNumber)` on-demand
- **Channel details**: `updateSheetChannelDetails(updates)` writes marketplace status/courier/AWB after CSV import

## Gotchas
- **Error `code` is STRING** — use `Number(error.code)` for comparison
- **Sheet data types mixed** — always `String(cell ?? '')`
- **API quota 300/min** — rate limiter at 250ms. Use batchRead/Write
- **Credentials (Sheets)**: env `GOOGLE_SERVICE_ACCOUNT_JSON` (production) -> fallback `server/config/google-service-account.json` (local)
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

---
*Detailed reference: [reference.md](./reference.md) — column mappings, eligibility rules, ingest details, dedup formats, config, API endpoints, key files.*
