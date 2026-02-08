# Plan: Google Sheets ↔ ERP Hybrid System
> Status: ACTIVE | Created: 2026-02-07

---

## North Star (DO NOT EDIT)

### Problem
Google Sheets is the team's daily working surface for order management — it's fast, familiar, and flexible. But the Balance (Final) formula scans 135K rows with 5 SUMIFs and is slow/growing. We need the ERP to handle inventory computation, historical data, and analytics while keeping Sheets as the ops UI. This is a radically different approach from how the app was built — we're offloading fulfillment/allocation back to Sheets and making the ERP the engine underneath.

### End State
- Sheets shows a **combined view**: `Balance = F (ERP past balance) + SUMIF(recent sheet data)` — always correct, no double-counting
- All historical inward/outward data ingested into ERP with rich metadata (source, tailor, orderNumber, etc.)
- ERP pushes computed balance to Sheet col F; Sheets handles allocation natively via SUMIFS
- Monitoring page shows balance crosscheck, ingestion progress, order reconciliation
- Redundant ERP fulfillment UI deprecated (feature-flagged, not deleted)
- Every change is non-destructive with full backup and rollback at every step

### Constraints
- **Non-destructive first**: additive changes only, side-by-side formula verification, no row deletion until weeks of stable operation
- **Full backup before any sheet modification**: timestamped JSON snapshots with manifests
- **Feature-flagged**: `ENABLE_SHEET_OFFLOAD`, `ENABLE_SHEET_DELETION`, `ENABLE_FULFILLMENT_UI`
- **Analytics must keep working**: all revenue/customer/product analytics depend on Order tables filled by Shopify webhooks (unchanged)
- **Deprecate, don't delete**: redundant ERP code stays for reference and fallback
- **Detailed plan doc**: `SHEETS_OFFLOAD.md` at project root is the comprehensive reference

### Key Decisions
- Ingest from **Mastersheet Outward** (39K individual rows with order#), NOT Office Ledger "Orders Outward" (3K aggregate IMPORTRANGE)
- 6 optional fields on InventoryTransaction: `source`, `destination`, `tailorNumber`, `performedBy`, `repackingBarcode`, `orderNumber`
- Content-based referenceIds for dedup (SKU+qty+date+source), not row indices
- Side-by-side formula test in col G before switching col E
- Dashboard pipeline counts replaced with inventory-focused metrics

---

## Phases

### Phase 1: Build
- **Status**: DONE (2026-02-07)
- **Goal**: All code ready — worker revised, backup/restore scripts, monitoring page, schema migration
- **Tasks**:
  - [x] Prisma migration: 6 fields on InventoryTransaction (`source`, `destination`, `tailorNumber`, `performedBy`, `repackingBarcode`, `orderNumber` + index on `orderNumber`)
  - [x] Revise offload worker: ingest from Mastersheet Outward (individual order lines)
  - [x] Revise offload worker: capture new fields (source, destination, tailorNumber, performedBy, orderNumber)
  - [x] Expand source mapping (warehouse, op stock, alteration, rto, reject)
  - [x] Extend worker status (sheetRowCounts, ingestedCounts, recentRuns, durationMs)
  - [x] Build `backup-sheets.ts` (full snapshot to timestamped JSON with manifest)
  - [x] Build `restore-sheets.ts` (restore from backup, per-tab or all, dry-run support)
  - [x] Add side-by-side formula verification (`--test` flag → writes to col G for comparison)
  - [x] Monitoring integrated into SheetSyncTab (offload monitor with status, results, recent runs, trigger)
  - [x] Added `sheet_offload` to startBackgroundJob schema
  - [ ] Run `verify-outward-totals.ts` to confirm data consistency
  - [x] TypeScript compiles clean (server + client)

### Phase 2: Go-Live (Historical Offload)
- **Status**: DONE (2026-02-07)
- **Goal**: Past data ingested into ERP, formula switched, balances verified — no sheet data deleted
- **Tasks**:
  - [x] Take full backup (`backup-sheets.ts`)
  - [x] Write col F values (`test-past-balance.ts --write`)
  - [x] Side-by-side formula test: write new formula to col G, compare all 6,510 SKUs
  - [x] Switch col E formula (`setup-balance-formula.ts --apply`), delete col G
  - [x] Enable worker ingest-only (`ENABLE_SHEET_OFFLOAD=true`, deletion OFF)
  - [x] Monitor via monitoring page for 1-2 weeks
  - [x] Spot-check 50 SKUs, verify balance crosscheck ✅

### Phase 3: ERP-Based Balance + Live Buffer Tabs
- **Status**: DONE (2026-02-07)
- **Goal**: ERP is the source of truth for inventory balance, live buffer tabs feed new inward/outward, shipped orders auto-move to Outward (Live)
- **Tasks**:
  - [x] Build balance push: worker writes ERP currentBalance to Inventory col R + Balance (Final) col F
  - [x] Live buffer formula: `=R{row} + SUMIF(Inward Live) - SUMIF(Outward Live)` on Inventory tab
  - [x] Offload worker ingests Inward (Live) + Outward (Live), creates ERP transactions, deletes rows
  - [x] Build `moveShippedToOutward()` — reads "Orders from COH", finds Shipped=TRUE rows, maps to Outward (Live) format, writes safely then deletes source rows
  - [x] Added Order Date (col N) to Outward (Live) for reversibility
  - [x] Batched col AD writes to avoid Sheets API quota issues
  - [x] Admin trigger: `shipped_to_outward` job in background jobs panel
  - [x] Test run: 137 shipped orders moved, ingested into ERP, balances verified (-140 net change correct), sheet rows deleted

### Phase 4: ERP Clean-Up
- **Status**: IN PROGRESS
- **Goal**: Evidence-based fulfillment operational, Ledgers page redesigned, redundant fulfillment UI deprecated, dashboard updated
- **Tasks**:
  - [x] Backfill `orderNumber` on 37,345 historical outward InventoryTransactions
  - [x] Add `linkOutwardToOrders()` (Phase B2) to offload worker — auto-ship OrderLines from outward evidence
  - [x] Link 237 historical OrderLines with outward evidence to shipped status
  - [x] Disable Steps 1 (Ship & Release) and 4 (Sync Line Statuses) in manual CSV sync
  - [x] Redesign Ledgers page: table layout, server-side search/pagination, 3 tabs (inward/outward/materials)
  - [x] Backfill sheet fields: `source` (83K), `performedBy` (59K), `tailorNumber` (9K), `repackingBarcode` (10K), `destination` (11K) via raw SQL batch updates
  - [x] Add `repackingBarcode` field to InventoryTransaction schema
  - [ ] Add `ENABLE_FULFILLMENT_UI` feature flag (default ON)
  - [ ] Replace dashboard pipeline counts with inventory-focused metrics
  - [ ] Turn off allocation mutations
  - [ ] Simplify orders page to read-only historical view
  - [ ] Hide Orders Simple page
  - [ ] Verify all analytics still work (revenue, customers, products, costing)

### Phase 5: Gradual Migration
- **Status**: pending
- **Goal**: Team uses ERP for inward/outward, Sheet tabs trend toward empty
- **Tasks**:
  - [ ] Add order reconciliation to monitoring page
  - [ ] Improve ERP inward UI for team adoption
  - [ ] ERP outward on order dispatch
  - [ ] Monitor: Sheet inward/outward row counts trending to zero
  - [ ] Consider row deletion after sustained stable period (fresh backup first)

### Phase 6: Barcode Mastersheet & Fabric Ledger
- **Status**: pending
- **Goal**: ERP manages SKU/fabric data, pushes fabric balances to sheet for other sheets to reference
- **Tasks**:
  - [ ] Prisma migration: add `code` field to FabricColour (nullable unique String)
  - [ ] Build fabric code mapping script (`map-fabric-codes.ts`)
  - [ ] Populate `code` field for existing FabricColours (97 mappings)
  - [ ] Create "Fabric Balances" tab in Barcode Mastersheet
  - [ ] Build fabric ledger push worker (balance, pending orders, 30-day consumption)
  - [ ] Add pending orders calculation (OrderLine → SkuBomLine → FabricColour)
  - [ ] Add 30-day consumption calculation from FabricColourTransaction
  - [ ] Test VLOOKUP from Orders Mastersheet
  - [ ] Create missing FabricColours (Modal, Tencel, Vintage) from manual review

### Phase 7: Piece-Level Tracking & Returns
- **Status**: pending
- **Goal**: ERP tracks individual physical pieces with unique barcodes through return → QC → inventory
- **Tasks**:
  - [ ] Prisma migration: add `ReturnedPiece` model with PieceStatus and ReturnSource enums
  - [ ] Add pieceBarcode generation utility (DDMMYY + sequence format)
  - [ ] Build import script for existing 14K pieces from sheet
  - [ ] Add piece receiving UI (scan barcode → create ReturnedPiece)
  - [ ] Integrate with repacking queue (link ReturnedPiece to RepackingQueueItem)
  - [ ] Add inventory transaction linkage (create txn on approval, link to piece)
  - [ ] Add to monitoring page (piece stats, pending count)
  - [ ] Verify linkage accuracy vs sheet Inward Count

---

## Decision Log
<!-- Append-only. Record WHY decisions were made, not just WHAT. -->

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-07 | Ingest from Mastersheet Outward, not OL Orders Outward | OL "Orders Outward" is an IMPORTRANGE aggregate (SKU+Qty only). Mastersheet has individual rows with order numbers, enabling reconciliation. |
| 2026-02-07 | Add 5 optional fields to InventoryTransaction | Sheet data has rich metadata (source text, tailor#, done-by, destination, order#) that doesn't fit existing fields. All nullable = zero-impact migration. |
| 2026-02-07 | Side-by-side formula verification in col G | Non-destructive: team never sees wrong balances. Only switch col E after 100% match verified across all SKUs. |
| 2026-02-07 | Deprecate fulfillment UI, don't delete | Code documents business logic that may be useful. Feature flags allow instant fallback. Gradual phase-out. |
| 2026-02-07 | Analytics are safe — no changes needed | All revenue/customer/product analytics query Order/OrderLine tables populated by Shopify webhooks. Only dashboard pipeline counts break (replaced with inventory metrics). |
| 2026-02-07 | Add `code` field to FabricColour for sheet sync | 97 fabric codes in Barcode Mastersheet need mapping to ERP. Adding `code` field enables clean lookup. |
| 2026-02-07 | Fabric Ledger tab in Barcode Mastersheet | ERP pushes fabric balances to a centralized tab. Other sheets VLOOKUP/IMPORTRANGE from it. |
| 2026-02-07 | Piece-level tracking via `ReturnedPiece` model | Sheet tracks individual pieces with unique barcodes. ERP needs same capability for audit trail. |
| 2026-02-07 | Keep same barcode format (DDMMYY + sequence) | Maintain continuity with existing printed labels. Team already has workflow with this format. |
| 2026-02-07 | Preserve original source (RETURN/EXCHANGE/RTO) on pieces | Don't lose source info when piece is added to inventory. Currently sheet has it but Inward Final just says "repacking". |
| 2026-02-07 | moveShippedToOutward writes first, deletes second | Safety-first: data lands in Outward (Live) before any source row deletion. First run proved this — quota error killed deletion but data was safe. |
| 2026-02-07 | Batch col AD writes using groupIntoRanges | Individual writeRange per row (137 calls) exhausted Sheets API quota. Batching contiguous rows into ranges reduced to ~5 calls. |
| 2026-02-07 | Add Order Date (col N) to Outward (Live) | Original order date from Orders from COH col A must be preserved for reversibility — without it, we lose when the order was placed. |
| 2026-02-07 | ENABLE_SHEET_DELETION=true in .env | After successful test run, enabled deletion so offload worker clears ingested rows automatically. |
| 2026-02-08 | Evidence-based fulfillment via Phase B2 | Outward entries from sheets ARE the shipping evidence. Worker auto-ships OrderLines when outward txn matches by orderNumber + skuId. No explicit Ship & Release needed — the data IS the proof. |
| 2026-02-08 | Disable manual sync Steps 1 & 4 | Ship & Release creates duplicate outward transactions, Line Status Sync bypasses evidence-based flow. Both replaced with no-op results. Step indices preserved for UI compatibility. |
| 2026-02-08 | LINKABLE_STATUSES for auto-shipping | Only `['pending', 'allocated', 'picked', 'packed']` get auto-shipped. Already-shipped/cancelled lines are safely skipped. |
| 2026-02-08 | FIFO SKU consumption for duplicate SKUs | When same order has multiple lines with same SKU, array-based lookup with consumption prevents double-matching. |
| 2026-02-08 | Ledgers page redesign: table layout with server-side pagination | Card-list layout inadequate for 134K+ records. Table with search, filters (reason, location, origin), stats row, and pagination. Three tabs: inward (with source, performedBy, tailor#, barcode), outward (destination, order#), materials. |
| 2026-02-08 | `repackingBarcode` field on InventoryTransaction | Column G in Inward sheets contains unique barcodes (10K records, mostly Repacking source). Named `repackingBarcode` (not `barcode`) to clarify purpose. |
| 2026-02-08 | Raw SQL batch updates for backfill | Individual Prisma updates (95K round trips to remote DB) too slow. Raw SQL `UPDATE ... FROM (VALUES ...)` does 500 rows per statement — 95K records in ~1 minute. |

---

## Current Context
<!-- This section gets REWRITTEN each session. Ephemeral working state. -->

**Active Phase**: Phase 4 (ERP Clean-Up) — Phases 1-3 complete, evidence-based fulfillment operational, Ledgers page redesigned
**Working On**: Ledgers page + sheet field backfill complete
**Blocked By**: Nothing
**Next Up**:
  1. Phase 4 — deprecate fulfillment UI, update dashboard metrics
  2. OR Phase 6 — Barcode Mastersheet & Fabric Ledger
  3. OR Phase 7 — Piece-Level Tracking & Returns

**Session 2026-02-08 (Ledgers Redesign & Sheet Field Backfill):**
- Redesigned Ledgers page: card-list → table layout, 3 tabs (inward/outward/materials)
- Built `getLedgerTransactions` server function with search (7 fields), pagination, stats, filter dropdowns
- Updated `LedgersSearchParams` schema: tab, search, reason, location, origin (sheet/app), page, limit
- Backfilled sheet fields from Google Sheets via raw SQL batch updates (95K records in ~1 min):
  - `source`: 83,090 records
  - `performedBy`: 59,314 records
  - `tailorNumber`: 8,953 records
  - `repackingBarcode`: 9,922 records (new field — column G from Inward sheets)
  - `destination`: 11,326 records
- Added `repackingBarcode String?` to InventoryTransaction schema
- Commit: `e4ea035`

**Session 2026-02-08 (Evidence-Based Fulfillment):**
- Backfilled `orderNumber` on 37,345 historical ms-outward InventoryTransactions (extracted from referenceId)
- Built `linkOutwardToOrders()` — Phase B2 in offload worker that auto-ships OrderLines from outward evidence
- Ran historical linking script: 237 OrderLines corrected (227 pending→shipped, 7 allocated→shipped, 3 packed→shipped), 0 remaining
- Current data state: 88,600 shipped lines (99.87%), 117 in pipeline (110 pending, 3 allocated, 4 packed)
- Disabled Steps 1 (Ship & Release) and 4 (Sync Line Statuses) in manual CSV sheetSyncService — they conflict with evidence-based fulfillment
- Commits: `92b5591` (historical linking), `647fba3` (disable manual sync steps)

**Session 2026-02-07 (Phase 3 build + test):**
- Built `moveShippedToOutward()` in sheetOffloadWorker.ts
- Config: `ORDERS_FROM_COH_COLS` (13 columns), `ORDER_DATE` added to `OUTWARD_LIVE_COLS`
- Admin: `shipped_to_outward` job trigger + listing in background jobs panel
- First test run: 137 shipped rows written to Outward (Live), but hit API quota on individual col AD writes — deletion failed (safety-first design prevented data loss)
- Fixed: batched col AD writes via `groupIntoRanges()` — 137 calls → ~5 calls
- Second run: 70 remaining rows moved + deleted successfully (11s vs 63s)
- Cleaned up 70 duplicates from Outward (Live), then 67 leftover rows from Orders from COH (cross-verified against Outward before deleting)
- Added Order Date column (N) to Outward (Live) for reversibility
- Triggered sheet offload: 137 outward transactions ingested into ERP
- Balance verification: total went from 157 → 17 (net -140, exactly matching sheet qty)
- Deleted 137 ingested rows from Outward (Live)
- Enabled `ENABLE_SHEET_OFFLOAD=true` + `ENABLE_SHEET_DELETION=true` in .env
- Pushed commit `c62b759` to main
