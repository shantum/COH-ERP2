# Google Sheets ↔ ERP Hybrid System

## Vision

Google Sheets remains the team's daily working surface for **order management** — it's fast, familiar, and flexible. The ERP handles the **heavy lifting**: inventory engine, historical data, analytics, and Shopify integration. The two systems stay in sync through targeted data flows.

```
┌─────────────────────────────────────────────┐     ┌─────────────────────────────┐
│     COH Orders Mastersheet (Ops UI)          │     │        ERP (Engine)          │
│                                              │     │                             │
│  Orders from COH  ← GCF webhooks ←────────────── Shopify                       │
│    (open orders, fulfillment, dispatch)      │     │                             │
│                                              │     │  All orders (archive)       │
│  Inventory tab                               │     │  All inventory transactions │
│    Col R: ERP Balance  ◄── worker writes ────────  currentBalance per SKU      │
│    Col C: = R + Inward(Live) - Outward(Live) │     │                             │
│    Col D: Allocated (SUMIFS on orders)       │     │                             │
│    Col E: Available = C - D                  │     │                             │
│                                              │     │                             │
│  Inward (Live) ──── worker ingests ──────────────→ InventoryTransactions        │
│  Outward (Live) ──── worker ingests ─────────────→ InventoryTransactions        │
│    (buffer tabs: team enters, worker clears) │     │                             │
│                                              │     │                             │
├──────────────────────────────────────────────┤     │                             │
│     Office Ledger (backward compat)          │     │                             │
│  Balance (Final)                             │     │                             │
│    Col F: ERP Balance  ◄── worker writes ────────  currentBalance per SKU      │
│    Col E: = F + IMPORTRANGE(Live tabs)       │     │                             │
└──────────────────────────────────────────────┘     └─────────────────────────────┘
```

### Who Owns What

| Domain | Owner | Other system's role |
|--------|-------|-------------------|
| **Open orders / fulfillment** | Sheets | ERP stores archive, provides analytics |
| **Inventory balance** | **ERP (source of truth)** | Sheets displays via col R/F (worker pushes `currentBalance`) |
| **Allocation** | Sheets (formulas) | ERP doesn't track allocation |
| **Inward (production received)** | **Sheets → ERP** | Team enters in "Inward (Live)" buffer tab, worker ingests to ERP |
| **Outward (dispatch)** | **Sheets → ERP** | Team enters in "Outward (Live)" buffer tab, worker ingests to ERP |
| **Historical data** | ERP | Sheets keeps only recent/active data + buffer tabs |
| **Shopify orders** | ERP (via webhooks) | GCF writes line items to Sheets for ops |

---

## Current Sheet Architecture (Explored 2026-02-07)

### Two Spreadsheets

**1. Orders Mastersheet** (`1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo`)

| Tab | Rows | Purpose |
|-----|------|---------|
| **Orders from COH** | ~219 | Active open orders. Line-level: order#, customer, SKU, qty, status, assigned, picked, packed, shipped. GCF webhook writes new orders here. |
| **Inventory** | 6,510 | Per-SKU balance + allocation. Col R = ERP balance (worker writes), Col C = R + Live SUMIFs, Col D = allocated, Col E = available. |
| **Inward (Live)** | buffer | Team enters inward here. Worker ingests rows → ERP → deletes. Cols: SKU, Qty, Product, Date, Source, Done By, Barcode, Tailor#, Notes. |
| **Outward (Live)** | buffer | Team enters outward here. Worker ingests rows → ERP → deletes. Layout matches "Orders from COH" (A-AD) + AE=Outward Date. SKU in col G, Qty in col I. Enables simple copy-paste from Orders from COH. |
| **Office Inventory** | 6,510 | Mirror of Balance (Final) from ledger (legacy — Inventory tab no longer depends on this). |
| **Outward** | 39,424 | Dispatched order lines (frozen — all future outward goes to "Outward (Live)"). |
| **ShopifyAllOrderData** | 40,670 | Order-level data from GCF webhook #2. |
| Dashboard, Sampling Plan, Fabric Status, etc. | Various | Other operational tabs. |

**2. Office Ledger** (`1ZZgzu4xPXhP9ba3-liXHxj5tY0HihoEnVC9-wLijD5E`)

| Tab | Rows | Purpose |
|-----|------|---------|
| **Inward (Final)** | 38,150 | Production received. Cols: SKU, Qty, Product, Date, Source, Done By, Tailor Number. |
| **Inward (Archive)** | 46,089 | Old inward rows (manually archived). Col H is "notes" (NOT "Tailor Number"). |
| **Outward** | 11,425 | Non-order outward (transfers, samples, adjustments, sourcing). Has dates + destination. |
| **Orders Outward** | 3,183 | **AGGREGATE** — IMPORTRANGE from Mastersheet "Outward Summary" tab. SKU + Qty only. NOT individual transactions. |
| **Orders Outward 12728-41874** | 37,093 | Historical order dispatch. Cols A-I = individual order data (date, order#, customer, city, phone, payment, SKU, product, qty). Cols N-O = summary (SKU+Qty). |
| **Balance (Final)** | 6,510 | Per-SKU balance. Formula: SUMIF(all inward) - SUMIF(all outward). |

> **CRITICAL DISCOVERY:** Office Ledger "Orders Outward" is an **IMPORTRANGE aggregate** from Mastersheet's "Outward Summary" tab — it contains only SKU + Qty totals, NOT individual dispatch rows. The actual per-order dispatch data lives in **Mastersheet "Outward"** (39K rows with order numbers, dates, SKUs).

### Key Formulas

#### Current (Phase 3 — ERP-based)

**Balance (Final) Col E** — ERP base + IMPORTRANGE to live buffer tabs:
```
=F{row}+IFERROR(SUMIF(IMPORTRANGE("mastersheet-id","'Inward (Live)'!$A:$A"),$A{row},IMPORTRANGE("mastersheet-id","'Inward (Live)'!$B:$B")),0)-IFERROR(SUMIF(IMPORTRANGE("mastersheet-id","'Outward (Live)'!$G:$G"),$A{row},IMPORTRANGE("mastersheet-id","'Outward (Live)'!$I:$I")),0)
```
Where F = ERP `currentBalance` (written by worker after each ingestion cycle).
Note: Outward (Live) uses G:G (SKU) and I:I (Qty) because its layout matches Orders from COH.

**Inventory Tab Col C** (Balance) — ERP base + same-sheet SUMIF on live tabs:
```
=R{row}+SUMIF('Inward (Live)'!$A:$A,$A{row},'Inward (Live)'!$B:$B)-SUMIF('Outward (Live)'!$G:$G,$A{row},'Outward (Live)'!$I:$I)
```
Where R = ERP `currentBalance` (written by worker). No IMPORTRANGE needed — live tabs are in the same spreadsheet.
Note: Outward (Live) layout matches Orders from COH — SKU is in col G, Qty in col I.

**Inventory Tab Col D** (Allocated) — counts assigned order qty (unchanged):
```
=SUMIFS('Orders from COH'!I:I, 'Orders from COH'!G:G, A4, 'Orders from COH'!N:N, TRUE)
```

**Inventory Tab Col E** (Available, unchanged):
```
=C4-D4
```

#### Original (pre-Phase 3, for reference/rollback)

**Balance (Final) Col E** — 5 SUMIFs scanning ~135K rows:
```
=SUMIF('Inward (Final)'!$A:$A,$A3,'Inward (Final)'!$B:$B)
+SUMIF('Inward (Archive)'!$A:$A,$A3,'Inward (Archive)'!$B:$B)
-SUMIF(Outward!$A:$A,$A3,Outward!$B:$B)
-SUMIF('Orders Outward'!$A:$A,$A3,'Orders Outward'!$B:$B)
-SUMIF('Orders Outward 12728-41874'!$N:$N,$A3,'Orders Outward 12728-41874'!$O:$O)
```

**Inventory Tab Col C** — looked up Office Inventory (Office Ledger dependency):
```
=SUMIF('Office Inventory'!A:E, A4, 'Office Inventory'!E:E)
```

**Orders from COH Col M** (Qty Balance) — VLOOKUP to Inventory tab showing available stock per SKU.

### Data Flow: Order Lifecycle

```
1. Shopify order placed
2. GCF webhook #1 → writes order-level data to "ShopifyAllOrderData"
3. GCF webhook #2 → writes line items to "Orders from COH" (SKU, qty, customer, etc.)
4. Inventory tab auto-updates: SUMIFS counts allocated qty (col N = Assigned flag)
5. Team works in "Orders from COH": assigns, picks, packs
6. On dispatch: shipped rows auto-move to "Outward (Live)" (1:1 copy + Outward Date)
   - Via moveShippedToOutward() (ERP admin trigger) or Apps Script (manual menu)
   - Outward (Live) layout matches Orders from COH — simple copy-paste for emergencies
7. Worker ingests Outward (Live) → ERP InventoryTransactions → auto-ships OrderLines
8. Balance recalculates: ERP balance updated, SUMIF(Outward Live) clears after ingestion
```

### Outward (Live) Column Layout

Matches "Orders from COH" (A-AD) + Outward Date at AE. This enables simple copy-paste for emergency outward.

| Col | Index | Field | Used by ingestion? |
|-----|-------|-------|--------------------|
| A | 0 | Order Date | Yes (fallback date) |
| B | 1 | Order # | Yes (order linking) |
| C | 2 | Name | No |
| D | 3 | City | No |
| E | 4 | Mob | No |
| F | 5 | Channel | No |
| G | 6 | **SKU** | **Yes** |
| H | 7 | Product Name | No |
| I | 8 | **Qty** | **Yes** |
| J | 9 | Status | No |
| K | 10 | Order Note | No |
| L | 11 | COH Note | No |
| M-P | 12-15 | Qty Balance, Assigned, Picked, Order Age | No |
| Q | 16 | source_ | No |
| R | 17 | samplingDate | No |
| S | 18 | Fabric Stock | No |
| T | 19 | (empty) | No |
| U | 20 | Packed | No |
| V-W | 21-22 | (empty) | No |
| X | 23 | Shipped | No |
| Y | 24 | Shopify Status | No |
| Z | 25 | **Courier** | **Yes** |
| AA | 26 | **AWB** | **Yes** |
| AB | 27 | Ready To Ship | No |
| AC | 28 | **AWB Scan** | **Yes** |
| AD | 29 | Outward Done | No |
| AE | 30 | **Outward Date** | **Yes** (primary date) |

---

## Deep Data Analysis (2026-02-07)

Full column-level analysis of all tabs. Run via `explore-data-patterns.ts`.

### Inward (Final) — 38,149 data rows

| Column | Field | Coverage | Notes |
|--------|-------|----------|-------|
| A | SKU | 100% | Barcode/SKU code |
| B | Qty | 100% | Always present |
| C | Product Name | 100% | |
| D | Date | 100% | DD/MM/YYYY format |
| E | Source | 99.9% (38,111) | See source values below |
| F | Done By | 46.4% (17,694) | Person who processed |
| G | Barcode | ~same as A | Occasionally different from col A |
| H | **Tailor Number** | **23.2%** (8,852) | Only populated for tailored items |

**Source values (Final):** sampling (29,072), repacking (7,927), return (530), production (277), tailor (178), received (55), adjustment (39), alteration (17), other (10), rto (3), warehouse (3)

### Inward (Archive) — 46,088 data rows

| Column | Field | Coverage | Notes |
|--------|-------|----------|-------|
| A-G | Same as Final | Similar | |
| H | **"notes"** (NOT Tailor Number!) | **0.2%** (107) | Different header than Final! |

**Source values (Archive):** sampling (28,340), production (7,497), tailor (4,671), repacking (1,930), **warehouse (1,901)**, **op stock (1,346)**, received (522), **alteration (444)**, **rto (203)**, **reject (41)**, **other (149)** plus more

> **Key difference:** Archive has a **much richer source vocabulary** than Final. Sources like `warehouse`, `op stock`, `alteration`, `rto`, `reject` appear frequently in Archive but rarely/never in Final.

### Outward (Office Ledger) — 11,424 data rows

| Column | Field | Coverage | Notes |
|--------|-------|----------|-------|
| A | SKU | 100% | |
| B | Qty | 100% | |
| C | Product Name | 100% | |
| D | Date | 73.3% | DD/MM/YYYY |
| E | Destination | 72.9% | See values below |
| F | Notes | 16.1% | Free text |

**Destination values:** `for order` (75% — old 2022-era dispatches before order# tracking), sourcing, adjust, office, exchange, damage, sample, shoot, tailor, store, return, etc.

> **Note:** The "for order" rows are from ~2022 before the team started tracking order numbers separately. These are NOT duplicates of "Orders Outward" — they represent a different era of bookkeeping.

### Orders Outward (Office Ledger) — 3,183 rows

Only cols A (SKU) and B (Qty) have data (plus col O with some data). This is an IMPORTRANGE aggregate — no dates, no order numbers, no customer info. **Not suitable for individual transaction ingestion.**

### Orders Outward Old (12728-41874) — 37,093 rows

Two data regions in this tab:

| Region | Columns | Data |
|--------|---------|------|
| Individual | A-I | Date, Order#, Customer Name, City, Phone, Payment Type, SKU, Product, Qty |
| Summary | N-O | SKU, Qty (aggregate by SKU) |

Individual total: 35,221 rows, 37,406 qty. Summary total: 2,280 rows, 37,672 qty.

### Mastersheet Outward — 37,389 data rows

| Column | Index | Field |
|--------|-------|-------|
| A | 0 | (unknown — likely row#) |
| B | 1 | **Order Number** |
| C | 2 | Date |
| D | 3 | Customer Name |
| E | 4 | City |
| F | 5 | Product Name |
| G | 6 | **SKU** |
| H | 7 | (unknown) |
| I | 8 | **Qty** |

**Order number patterns:**
- Numeric (Shopify order#): **29,816** (79.7%)
- Non-numeric: **7,573** (20.3%) — FN prefix = Flipkart, NYK = Nykaa, R = Return, etc.
- Empty: 0

**This is the correct source for order-level outward ingestion** — has individual rows with order numbers that can be linked to Shopify orders in the ERP.

### Source Vocabulary (Complete Mapping)

All unique `source` values found across Inward (Final) + Inward (Archive):

| Sheet Source | ERP `reason` | Notes |
|-------------|-------------|-------|
| sampling | `production` | Most common (~57K rows) |
| production | `production` | Direct production |
| tailor | `production` | Tailor-made items |
| repacking | `production` | Repacking existing items |
| return | `return_receipt` | Customer returns |
| rto | `rto_received` | Return to origin |
| received | `received` | Goods received |
| adjustment | `adjustment` | Manual adjustments |
| warehouse | `transfer` | Transfer from warehouse |
| op stock | `transfer` | Opening stock / transfer |
| alteration | `production` | Altered items |
| reject | `damage` | Rejected items |
| other | `adjustment` | Catch-all |

---

### Allocation Model (Balance ↔ Orders)

```
Ledger Balance (1,794 total)
  └─ Inventory Tab
       Col C: Balance per SKU (from ledger)     = 1,794
       Col D: Assigned to open orders (SUMIFS)   = 111
       Col E: Available = C - D                  = 1,683
```

This is elegant: the ERP only needs to provide the **balance** number. Sheets handles allocation natively via SUMIFS against the open orders tab. When orders get dispatched, they leave the orders tab (reducing allocated) and enter outward (reducing balance) — the math self-corrects.

---

## Phase 0: Historical Offload (BUILT)

Move old data from Sheets into ERP so the ERP can compute authoritative balances.

### Problem
Balance (Final) scans 135K rows with 5 SUMIFs — slow and growing.

### Solution
Ingest old rows into `InventoryTransaction` table, write net past balance to col F, switch formula to 3 SUMIFs + F.

```
Before:  Balance = SUMIF(all inward) - SUMIF(all outward)     [5 SUMIFs, 135K rows]
After:   Balance = F (ERP past bal) + SUMIF(recent inward) - SUMIF(recent outward)  [3 SUMIFs]
```

### Data Volume (verified 2026-02-07)

**Inward sources (Office Ledger):**

| Tab | Total Rows | Offload Eligible | Qty |
|-----|-----------|-----------------|-----|
| Inward (Final) | 38,150 | 22,242 (>30d old) | 22,322 |
| Inward (Archive) | 46,089 | 46,037 (all) | 50,705 |

**Outward sources:**

| Tab | Spreadsheet | Total Rows | Offload Eligible | Qty | Individual? |
|-----|------------|-----------|-----------------|-----|-------------|
| Outward | Office Ledger | 11,425 | 10,674 (>30d old) | 11,206 | Yes (non-order: transfers, samples, etc.) |
| **Outward** | **Mastersheet** | **37,389** | **all** | **~37K** | **Yes (order dispatches with order#)** |
| ~~Orders Outward~~ | ~~Office Ledger~~ | ~~3,183~~ | ~~N/A~~ | ~~N/A~~ | ~~No — AGGREGATE, don't ingest~~ |
| Orders Outward Old | Office Ledger | 37,093 | 2,280 (summary) | 37,406 | Partial (cols A-I individual, N-O summary) |

**Grand totals:** Inward 73,027 · Outward 86,284 · Net -13,257

**Cross-check:** -13,257 (past) + 15,775 (recent inward) - 724 (recent outward) = **1,794** ✓ (matches sheet)

### Components

| Component | File | Status |
|-----------|------|--------|
| Config (IDs, tabs, cols, timing, formulas) | `server/src/config/sync/sheets.ts` | ✅ Done |
| Google Sheets API client (auth, rate limit, retry) | `server/src/services/googleSheetsClient.ts` | ✅ Done |
| Offload worker (3 independent jobs) | `server/src/services/sheetOffloadWorker.ts` | ✅ Done (split into `ingest_inward`, `ingest_outward`, `move_shipped_to_outward`) |
| Logger (`sheetsLogger`) | `server/src/utils/logger.ts` | ✅ Done |
| Config re-exports | `server/src/config/sync/index.ts` | ✅ Done |
| Server integration (start/stop/shutdown) | `server/src/index.js` | ✅ Done |
| Admin dashboard (background jobs) | `server/src/routes/admin.ts` | ✅ Done |
| Formula update script | `server/scripts/setup-balance-formula.ts` | ✅ Done |
| Past balance preview/write | `server/scripts/test-past-balance.ts` | ✅ Done |
| Diagnostic scripts | `server/scripts/check-*.ts` | ✅ Done |

### Worker Architecture (3 Independent Jobs)

The monolithic `runOffloadSync()` (Phases A-D) has been replaced by 3 independently triggerable jobs, each with its own `JobState<T>` (concurrency guard, state, result history). The scheduler runs `ingest_inward` then `ingest_outward` sequentially on a 30-min interval. `move_shipped_to_outward` is manual-trigger only.

**Exports:** `{ start, stop, getStatus, triggerIngestInward, triggerIngestOutward, triggerMoveShipped, getBufferCounts }`

| Job ID | Function | Schedule | Balance Updates? |
|--------|----------|----------|-----------------|
| `ingest_inward` | `triggerIngestInward()` | 30 min interval | Yes |
| `move_shipped_to_outward` | `triggerMoveShipped()` | Manual only | No |
| `ingest_outward` | `triggerIngestOutward()` | 30 min interval | Yes |

1. **Ingest Inward (`ingest_inward`):** Read Inward (Live) buffer tab, **validate rows** (`validateInwardRow()` -- 7 rules: required columns A-F, barcode for repacking, tailor# for sampling, notes for adjustment, source in `VALID_INWARD_LIVE_SOURCES`, SKU exists in ERP, qty > 0), create InventoryTransactions from valid rows, report failures in `inwardValidationErrors`, **invalid rows remain on sheet** for ops team to fix, delete only valid rows. Then: update sheet balances + invalidate caches.
2. **Move Shipped (`move_shipped_to_outward`):** Copy shipped rows from "Orders from COH" to "Outward (Live)". No ERP transactions created. No balance updates.
3. **Ingest Outward (`ingest_outward`):** Read Outward (Live) buffer tab, **validate rows** (`validateOutwardRows()` -- rejects empty SKUs, zero qty, unknown SKUs, invalid dates, missing orders/order-lines), create InventoryTransactions from valid rows, extract linkable items (with order numbers), report skip reasons in `outwardSkipReasons`, delete ingested rows. Then: link outward to OrderLines (evidence-based fulfillment), update sheet balances + invalidate caches.

> **Evidence-based fulfillment** is part of `ingest_outward`. Outward entries from sheets ARE the shipping evidence. When an outward entry has an order number, the corresponding OrderLine is automatically set to `shipped`. Only lines in LINKABLE_STATUSES (`pending`, `allocated`, `picked`, `packed`) are updated. Already-shipped or cancelled lines are skipped.

### Deduplication
- Content-based `referenceId`: `sheet:{tab}:{sku}:{qty}:{date}:{source}` — stable across row deletions
- For Mastersheet Outward, referenceId includes order#: `sheet:outward:{sku}:{qty}:{order#}:{date}`
- On each run, existing referenceIds are checked in DB — already-ingested rows are skipped
- Chunked IN clauses (2,000 per query) to avoid PG limits

### Feature Flags

| Env Variable | Default | Purpose |
|-------------|---------|---------|
| `ENABLE_SHEET_OFFLOAD` | `false` | Master switch — worker does nothing unless true |
| `ENABLE_SHEET_DELETION` | `false` | When true, deletes ingested rows from sheet after ingestion |

### Non-Destructive Change Strategy

Every change should be **additive first, switchable second, destructive never** (until explicitly decided weeks later).

| Change | Approach | Reversible? |
|--------|----------|-------------|
| Col F (ERP past balance) | **New column** — doesn't touch existing data | Yes — clear col F |
| Col E formula | **Side-by-side first:** write new formula to col G, compare with col E. Only switch E after verification | Yes — `--restore` flag |
| Ingestion to DB | **Additive** — creates new InventoryTransaction rows, doesn't modify existing | Yes — `DELETE WHERE notes LIKE '[sheet-offload]%'` |
| Sheet row deletion | **NEVER automatic.** Disabled by default. Only manual after weeks of stable operation | No — requires backup restore |

#### Formula Change: Side-by-Side Verification

Instead of switching col E directly, first write the new formula to a **temporary col G**:

```
Step 1: Write col F values (ERP past balance)
Step 2: Write NEW formula to col G (for every data row)
Step 3: Compare col E vs col G — they should be IDENTICAL for every SKU
Step 4: If matched → switch col E formula (safe, verified)
Step 5: Delete col G (temporary, no longer needed)
```

This means at no point does the team see wrong balances. Col E stays untouched until we've proven the new formula produces identical results.

### Data Backup Plan

#### Pre-Migration Full Snapshot

Before ANY sheet modifications, take a complete snapshot of all sheet data:

```bash
npx tsx server/scripts/backup-sheets.ts
```

**What it backs up:**

| Tab | Spreadsheet | What's saved |
|-----|------------|-------------|
| Inward (Final) | Office Ledger | All rows (SKU, Qty, Product, Date, Source, DoneBy, Barcode, TailorNumber) |
| Inward (Archive) | Office Ledger | All rows |
| Outward | Office Ledger | All rows (SKU, Qty, Product, Date, Destination, Notes) |
| Orders Outward | Office Ledger | All rows (SKU, Qty) |
| Orders Outward Old | Office Ledger | All rows (both A-I individual + N-O summary) |
| Balance (Final) | Office Ledger | All rows (SKU, Product, Inward, Outward, Balance) + **col E formulas** |
| Outward | Mastersheet | All rows (Order#, Date, Customer, City, Product, SKU, Qty) |

**Output format:** Timestamped JSON files in `backups/sheets/`:
```
backups/sheets/
  2026-02-07T14-30-00/
    office-ledger--inward-final.json        (data rows)
    office-ledger--inward-archive.json
    office-ledger--outward.json
    office-ledger--orders-outward.json
    office-ledger--orders-outward-old.json
    office-ledger--balance-final--values.json
    office-ledger--balance-final--formulas.json  (preserves original formulas)
    mastersheet--outward.json
    manifest.json                           (row counts, checksums, timestamp)
```

**Manifest file** records row counts and qty totals for each tab, so restore can verify completeness.

#### Restore Script

```bash
# Restore a specific tab from backup
npx tsx server/scripts/restore-sheets.ts --backup 2026-02-07T14-30-00 --tab inward-final

# Restore all tabs (full rollback)
npx tsx server/scripts/restore-sheets.ts --backup 2026-02-07T14-30-00 --all

# Dry run (show what would be restored, don't write)
npx tsx server/scripts/restore-sheets.ts --backup 2026-02-07T14-30-00 --all --dry-run
```

#### Backup Schedule

| When | What | Why |
|------|------|-----|
| **Before first col F write** | Full snapshot of all tabs | Baseline before any modifications |
| **Before formula switch** | Balance (Final) formulas + values | Can restore original formulas |
| **Before each worker run** (first 2 weeks) | Row counts + totals per tab | Detect unexpected changes |
| **Weekly** (ongoing) | Full snapshot | Rolling safety net |

#### Database as Backup

Once data is ingested into the ERP, the database itself is a backup:
- Every ingested row has `referenceId` starting with `sheet:` and `notes` starting with `[sheet-offload]`
- Original sheet data is preserved in the transaction fields (`source`, `destination`, `tailorNumber`, `performedBy`, `repackingBarcode`, `orderNumber`)
- A restore script can read from DB and write back to sheets if needed

### Go-Live Steps (Safety-First Sequence)

```
Step 0: BACKUP
├── Run backup-sheets.ts → full snapshot saved to backups/sheets/
├── Verify manifest: row counts match expected totals
└── Confirm backup files are readable (spot-check a few)

Step 1: WRITE COL F (additive, non-destructive)
├── Run test-past-balance.ts --write
├── Verify: col F has values, col E is UNCHANGED
└── Spot-check 10 SKUs: F value matches expected past balance

Step 2: SIDE-BY-SIDE FORMULA TEST (non-destructive)
├── Write new formula to temporary col G (every data row)
├── Compare col E vs col G for ALL 6,510 SKUs
├── Expected: 100% match (E == G for every row)
├── If any mismatch → investigate before proceeding
└── Document: "All 6,510 SKUs match" in monitoring page

Step 3: SWITCH COL E FORMULA (reversible)
├── Run setup-balance-formula.ts --apply
├── Verify: col E values unchanged (same numbers, new formula)
├── Delete temporary col G
└── Take second backup of Balance (Final) with new formulas

Step 4: ENABLE INGEST-ONLY WORKER (additive to DB, non-destructive to sheets)
├── Set ENABLE_SHEET_OFFLOAD=true
├── Worker ingests old rows → creates InventoryTransaction records in DB
├── Sheet rows are NOT deleted (ENABLE_SHEET_DELETION stays false)
├── Watch via monitoring page: ingestion progress, balance crosscheck
└── Run for 1-2 weeks in this mode

Step 5: VERIFY (before considering any deletion)
├── Monitoring page shows: balance crosscheck ✅, all rows ingested
├── Spot-check 50 SKUs: ERP balance == Sheet balance
├── Run reconciliation: compare per-SKU totals
└── Document: "Ingestion verified, X rows in DB, balances match"

Step 6: CONSIDER DELETION (weeks later, only if needed)
├── Take fresh full backup
├── Enable ENABLE_SHEET_DELETION=true for ONE tab only (e.g., Inward Archive)
├── Verify: sheet row count decreases, balances still match
├── If anything looks wrong → restore from backup, disable deletion
└── Gradually enable for other tabs
```

### Rollback at Any Step

| Step failed | Rollback action | Data loss? |
|-------------|----------------|-----------|
| Step 1 (col F) | Clear col F values | None |
| Step 2 (col G test) | Delete col G | None |
| Step 3 (formula switch) | `setup-balance-formula.ts --restore` | None |
| Step 4 (ingestion) | `DELETE FROM "InventoryTransaction" WHERE notes LIKE '[sheet-offload]%'` | None (sheet rows untouched) |
| Step 6 (deletion) | `restore-sheets.ts --backup <timestamp> --tab <tab>` | None (restored from backup) |

**At no point during Steps 0-5 is any sheet data modified or deleted.** The only sheet writes are:
- Col F: new column, was empty
- Col G: temporary test column, deleted after verification
- Col E: formula change only (same values), reversible

Sheet row deletion (Step 6) only happens after weeks of verified stable operation, with a fresh backup taken immediately before.

---

## Schema Changes (NEEDED)

### New Fields on InventoryTransaction

The existing `InventoryTransaction` model needs **6 optional fields** to capture metadata from sheet data that doesn't fit into the current schema:

```prisma
model InventoryTransaction {
  // ... existing fields ...

  // Optional fields for sheet-imported data
  source            String?   // Original source text from sheet (e.g. "sampling", "warehouse")
  destination       String?   // Outward destination (e.g. "for order", "sourcing", "office")
  tailorNumber      String?   // Tailor identifier (23% of Final inward rows have this)
  performedBy       String?   // "Done By" column from inward sheets
  repackingBarcode  String?   // Unique barcode from col G (Repacking source inward rows)
  orderNumber       String?   // Shopify order# or marketplace order ID (from Mastersheet Outward)
}
```

**Why these fields?**

| Field | Source | Why not existing fields? |
|-------|--------|------------------------|
| `source` | Inward col E | Too granular for `reason` (e.g. "sampling" vs "warehouse" both map to a reason but are different sources) |
| `destination` | Outward col E | No existing field for outward destination |
| `tailorNumber` | Inward (Final) col H | Links to tailor entity for production tracking |
| `performedBy` | Inward col F | Different from `createdById` (system user) — this is the actual person who did the inward |
| `repackingBarcode` | Inward col G | Unique barcode for repacked pieces — links inward transaction to piece in Return & Exchange Pending Pieces tab |
| `orderNumber` | Mastersheet Outward col B | Enables linking dispatch records to Shopify orders for reconciliation |

**Migration:** Simple `ALTER TABLE ADD COLUMN` — all nullable. Fields backfilled from sheets via `backfill-sheet-fields.ts` (raw SQL batch updates).

**Backfill Results (2026-02-08):**

| Field | Records populated |
|-------|------------------|
| `source` | 83,090 |
| `performedBy` | 59,314 |
| `tailorNumber` | 8,953 |
| `repackingBarcode` | 9,922 |
| `destination` | 11,326 |
| `orderNumber` | 37,345 (separate backfill script) |

### Reconciliation via `orderNumber`

With `orderNumber` on outward transactions, we can:
1. **Match dispatches to ERP orders:** `WHERE orderNumber = shopifyOrder.orderNumber`
2. **Find unmatched orders:** Orders in ERP with no outward transaction
3. **Find unmatched dispatches:** Sheet outward rows with order numbers not in ERP
4. **Cross-marketplace:** Nykaa (NYK prefix), Flipkart (FN prefix) orders can be linked too

---

## The Combined View Model (Core Principle)

The sheet always shows a **combined view** of ERP data + any local sheet data. This is the key insight that makes the transition seamless.

### The Formula IS the Bridge

```
Sheet Balance = F (ERP balance) + SUMIF(sheet inward) - SUMIF(sheet outward)
```

This formula — which we already built for Phase 0 — naturally supports **both systems operating simultaneously**:

| Action | What changes | Net effect on balance |
|--------|-------------|----------------------|
| Inward entered **in app** | ERP balance (F) increases | Balance goes up |
| Inward entered **in sheet** | SUMIF(sheet inward) increases | Balance goes up |
| Outward entered **in app** | ERP balance (F) decreases | Balance goes down |
| Outward entered **in sheet** | SUMIF(sheet outward) increases | Balance goes down |
| **ERP ingests sheet rows** | F goes up by X, SUMIF goes down by X | **Net unchanged** |

There is **no double-counting** and **no transition gap**. Whether a transaction lives in the sheet or the ERP, it's counted exactly once. When the ERP ingests sheet rows, the balance seamlessly shifts from formula-counted to ERP-counted.

### Walkthrough: Mixed Inward

Starting state: ERP balance (F) = 100, no sheet inward rows. Balance = 100.

1. **Team enters 20 units inward in the Sheet** (Inward Final tab)
   - Balance = 100 (F) + 20 (SUMIF) = **120** ✓
2. **Team enters 10 units inward in the ERP app**
   - ERP pushes F = 110 to sheet
   - Balance = 110 (F) + 20 (SUMIF) = **130** ✓
3. **ERP ingests the 20 sheet inward rows** (periodic sync)
   - ERP balance becomes 130, pushes F = 130
   - Sheet rows ingested → SUMIF drops by 20 (rows deleted or already counted)
   - Balance = 130 (F) + 0 (SUMIF) = **130** ✓ (unchanged)

At every step, the balance is correct. The team doesn't need to care which system they used.

### Walkthrough: Order Dispatch Flow

Starting state: ERP balance = 100, 10 open orders allocated in sheet.

1. Inventory tab: Balance=100, Allocated=10, Available=90
2. Team dispatches 5 orders → copies to Orders Outward, deletes from Orders tab
3. Sheet immediately: Balance = 100 - 5 (new outward SUMIF) = **95**, Allocated=5, Available=**90** ✓
4. ERP ingests the 5 outward rows → ERP balance becomes 95 → pushes F=95
5. Sheet rows ingested → SUMIF(outward) drops by 5
6. Balance = 95 (F) + 0 = **95**, Allocated=5, Available=**90** ✓

### The Sync Operation

To "match" or reconcile the two systems at any point:

1. **ERP ingests all sheet inward/outward rows** (the offload worker already does this)
2. **ERP pushes updated balance to col F** (Phase C of the worker already does this)
3. **Result:** SUMIF contributions drop to zero, F absorbs everything, balance unchanged

This can run hourly, daily, or on-demand. It's always safe because the formula guarantees consistency.

---

## Phase 1: ERP Balance Push (NOT YET BUILT)

The ERP needs to push its computed balance to the sheet so that app-side transactions are reflected. This is the other direction of the bridge — Phase 0 moves data Sheet→ERP, Phase 1 moves data ERP→Sheet.

### What Gets Written

The ERP writes a **single number per SKU** to Balance (Final) col F. This is the net balance of all inventory transactions the ERP knows about — both ingested-from-sheet and entered-in-app.

The Inventory tab's allocation formula stays untouched — it already references this balance and subtracts allocated orders via SUMIFS.

### When It Runs

**Option A: Periodic push (simpler, recommended to start)**
- Worker writes all SKU balances to col F every 10-15 minutes
- Uses existing `googleSheetsClient.writeRange()`
- Pro: Simple, predictable, low API usage
- Con: Up to 15 min delay for app-entered transactions to appear in sheet

**Option B: On-change push (real-time)**
- Every inward/outward transaction in the ERP triggers a col F update for that SKU
- Pro: Near-instant sheet update
- Con: More API calls, need to batch/debounce

**Recommendation:** Start with Option A. The team is used to sheets recalculating periodically. 15 min delay is acceptable for balance numbers since allocation (the time-critical part) is handled locally by sheet formulas.

### Target Cell

Col F of **Balance (Final)** in the Office Ledger. This is the same column Phase 0 already writes to. The Inventory tab in the Mastersheet already reads from here (via Office Inventory mirror).

### What Needs Building

| Component | Description |
|-----------|-------------|
| Balance push worker | Queries ERP for per-SKU balance, writes to col F. Could be a new phase in the existing offload worker or a standalone worker. |
| Trigger on app inward/outward | After `InventoryTransaction.create()`, schedule a balance push (debounced) |

---

## Phase 2: Gradual Inward/Outward Migration (NOT YET BUILT)

Move inward and outward recording from Sheets to the ERP app, at the team's pace.

### Why This Is Safe

Because of the combined-view formula, there is **no migration cutover date needed**. The team can:
- Do some inward in the app, some in the sheet
- Switch fully to the app whenever they're comfortable
- Go back to sheet entry if the app has issues

The balance stays correct regardless. The periodic ingestion (Phase 0 worker) reconciles the two systems.

### Inward Migration Path

| Step | Team does inward in... | Balance source |
|------|----------------------|----------------|
| **Now** | Sheet only | SUMIF(sheet inward) |
| **Transition** | Both app + sheet | F (app) + SUMIF(sheet) |
| **End state** | App only | F (app), sheet inward tab empty |

1. Build/improve ERP inward UI (barcode scan, production batch integration)
2. Team starts using ERP for some inward entries
3. ERP pushes updated balance → sheet reflects it immediately
4. Sheet inward entries still counted via SUMIF
5. Periodic ingestion absorbs sheet entries into ERP → SUMIF drops, F rises
6. Eventually team does all inward in app → sheet inward tab stays empty → SUMIF = 0

### Outward Migration Path

| Step | Team does outward in... | Balance source |
|------|------------------------|----------------|
| **Now** | Sheet only (copy from orders → outward tab) | SUMIF(sheet outward) |
| **Transition** | Both app + sheet | F (app) + SUMIF(sheet outward) |
| **End state** | App only | F (app), sheet outward tabs empty |

Similar path. The outward workflow is now simplified because Outward (Live) matches the Orders from COH layout:
- Currently: shipped rows are copied 1:1 from "Orders from COH" → "Outward (Live)" (via `moveShippedToOutward()` or Apps Script), worker ingests → auto-ships OrderLines
- For emergencies: team can manually copy-paste rows directly from "Orders from COH" → "Outward (Live)" (same layout)
- Future: ERP records outward when order is marked shipped

### Reconciliation / Matching

At any point, to verify both systems agree:

```bash
# 1. Run the offload worker (ingests sheet → ERP)
# Admin dashboard → Background Jobs → Ingest Inward / Ingest Outward → Trigger

# 2. Compare ERP balance vs sheet balance
# (diagnostic script can be built to diff per-SKU)
```

If there's a discrepancy, the ingestion logs show exactly which rows were processed, skipped, or errored. All offloaded transactions have `referenceId` starting with `sheet:` and `notes` starting with `[sheet-offload]` for easy identification.

---

## Monitoring Page (`/settings/sheets` or `/sheets-monitor`)

A dedicated admin page to monitor the hybrid system — useful during migration and as an ongoing health check.

### Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Sheets ↔ ERP Monitor                                    [Sync Now] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─ BALANCE CROSSCHECK ──────────────────────────────────────────┐  │
│  │  ERP Total Balance:    1,794     Sheet Total Balance:  1,794  │  │
│  │  Status: ✅ MATCHED              Last checked: 2 min ago      │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ INGESTION PROGRESS ─────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  Inward (Final)      ████████████░░░░  22,242 / 38,150  58%  │  │
│  │  Inward (Archive)    ████████████████  46,037 / 46,089  100% │  │
│  │  Outward (OL)        ████████████░░░░  10,674 / 11,425  93%  │  │
│  │  Outward (MS)        ░░░░░░░░░░░░░░░░       0 / 37,389   0% │  │
│  │                                                               │  │
│  │  Total ingested: 78,953 / 132,000 rows                       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ DATA LOCATION (per-SKU breakdown) ──────────────────────────┐  │
│  │                                                               │  │
│  │  Balance source:  ERP (col F): 85%  │  Sheet (SUMIF): 15%    │  │
│  │                   ████████████░░░                              │  │
│  │                                                               │  │
│  │  SKUs 100% in ERP:  5,200 / 6,510                            │  │
│  │  SKUs with sheet-only data:  1,310                            │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ LAST SYNC ──────────────────────────────────────────────────┐  │
│  │  Ran: 15 min ago  │  Duration: 45s  │  Status: ✅ Success    │  │
│  │  Rows processed: 234  │  Skipped (dedup): 22,008  │  Err: 0 │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ SKU DISCREPANCIES (ERP ≠ Sheet) ────────────────────────────┐  │
│  │  ┌─────────────┬────────────┬──────────────┬───────────────┐ │  │
│  │  │ SKU         │ ERP Balance│ Sheet Balance │ Delta         │ │  │
│  │  ├─────────────┼────────────┼──────────────┼───────────────┤ │  │
│  │  │ COH-BLK-S   │     12     │      14      │    -2         │ │  │
│  │  │ COH-WHT-M   │      8     │       8      │     0 ✅      │ │  │
│  │  └─────────────┴────────────┴──────────────┴───────────────┘ │  │
│  │  Showing 0 mismatched SKUs (filterable, searchable)          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ ORDER RECONCILIATION ───────────────────────────────────────┐  │
│  │  Orders with outward dispatch:  29,816                        │  │
│  │  Orders without dispatch:       142                           │  │
│  │  Dispatches without ERP order:  7,573 (marketplace orders)   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ RECENT ACTIVITY ────────────────────────────────────────────┐  │
│  │  Feb 7, 14:30  Ingested 234 inward rows from Inward (Final) │  │
│  │  Feb 7, 14:30  Pushed balance to col F (6,510 SKUs)         │  │
│  │  Feb 7, 13:30  Ingested 0 rows (all deduped)                │  │
│  │  Feb 7, 12:15  Manual trigger from admin dashboard           │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Data Sources

| Section | Data source | How |
|---------|------------|-----|
| **Balance Crosscheck** | ERP: `SUM(Sku.currentBalance)`. Sheet: read Balance (Final) col E total (cached from last worker run). | Worker caches sheet totals in its status object. ERP total is a simple aggregate. |
| **Ingestion Progress** | ERP: `COUNT(InventoryTransaction) WHERE referenceId LIKE 'sheet:%'` grouped by tab prefix. Sheet: row counts cached from last worker run. | Worker already reads all rows — cache the per-tab counts. |
| **Data Location** | Per SKU: compare col F value (ERP-contributed balance) vs col E total (full balance). If F == E, SKU is 100% in ERP. | Requires reading col F + col E from last worker run. |
| **Last Sync** | Worker status object (already has `lastRunAt`, `lastResult`, `isRunning`). | Extend status to include `rowsProcessed`, `rowsSkipped`, `errors`, `durationMs`. |
| **SKU Discrepancies** | Compare `Sku.currentBalance` against sheet Balance (Final) col E per SKU. | Server function that reads cached sheet balances and compares to DB. |
| **Order Reconciliation** | ERP orders with `orderNumber` on outward transactions vs ERP orders without. Marketplace dispatches = outward txns where `orderNumber` matches non-numeric pattern. | Query `InventoryTransaction WHERE reason = 'order_allocation' OR source = 'sheet'` joined with `Order`. |
| **Recent Activity** | Worker run log. | New: worker appends to a circular buffer (last 50 runs) in memory, exposed via `getStatus()`. |

### Implementation Plan

| Component | Description |
|-----------|-------------|
| **Server function: `getSheetMonitorData`** | Returns all dashboard data in one call. Reads from worker status cache + DB queries. No live sheet API calls (too slow for a page load). |
| **Worker status extension** | Add to `getStatus()`: `sheetRowCounts` (per tab), `sheetBalanceTotal`, `ingestedCounts` (per tab), `recentRuns` (last 50), `rowsProcessed`, `rowsSkipped`, `durationMs`. |
| **Route** | New page under `/settings/sheets` (admin only) or standalone `/sheets-monitor`. |
| **Frontend** | Cards layout with shadcn/ui. Progress bars, stats cards, data table for discrepancies. Auto-refresh every 60s via TanStack Query. |

### When to Build

This page should be built **after the worker revision** (tasks 1-4 in Remaining Work) and **before go-live** (tasks 6-8). Having the monitor up first means we can watch the initial ingestion happen in real time and catch issues immediately.

---

## Phase 3: Webhook Consolidation (FUTURE / LOW PRIORITY)

Currently two GCF webhooks write Shopify order data to Sheets:
1. **Order-level** → ShopifyAllOrderData tab (tracking, payment, etc.)
2. **Line-level** → Orders from COH tab (SKU, qty, customer, etc.)

The ERP already receives Shopify webhooks and stores orders. Optionally, the ERP could take over writing to Sheets too — becoming the single ingestion point. This would:
- Eliminate duplicate order issues from GCF
- Let ERP track whether Sheet data is complete/current
- Reduce moving parts

**Not blocking anything** — GCF works. This is an optimization for later.

---

## Phase 4: Barcode Mastersheet & Fabric Ledger (PLANNED)

The **Barcode Mastersheet** (`1xlK4gO2Gxu8-8-WS4jFnR0uxYO35fEBPZiSbJobGVy8`) is the master reference for all SKU/product data across the Google Sheets ecosystem. Making the ERP the source of truth for this data prevents operations/warehouse teams from accidentally corrupting critical product metadata.

### Current State (Explored 2026-02-07)

**Barcode Mastersheet Structure:**

| Tab | Rows | Purpose |
|-----|------|---------|
| **Sheet1** (main) | 6,508 | SKU master data: Barcode, Product, Color, Size, Style Code, Fabric Code, etc. |
| New Barcodes | 0 | Placeholder for new SKUs (empty) |
| Copy of Sheet1 / Copy of Sheet1 1 | ~4,500 each | Historical backups |
| Shopify Product Export | 3,420 | Raw Shopify export data |
| Product Weights | 848 | SKU shipping dimensions (Weight, Length, Breadth, Height, HSN Code) |
| Fabric Report | broken | Has #REF! errors — attempted fabric balance formulas |
| Sheet17 | 654 | Analytics: Sampling, Sales, Inventory, Fabric Stock |

**Main Tab (Sheet1) Column Analysis:**

| Column | Header | Coverage | Unique Values | Notes |
|--------|--------|----------|---------------|-------|
| A | Barcode | 93.7% | 5,540 | SKU/barcode identifier |
| B | Product Title | 74.1% | 180 | Product name (e.g., "Modal Crew") |
| C | Color | 74.1% | 105 | Color name |
| D | Size | 74.0% | 9 | S, M, L, XL, XS, 2XL, 3XL, 4XL, Regular |
| E | name | 74.0% | 4,798 | Full SKU name (e.g., "Women's Modal Crew - S - White") |
| **F** | **Style Code** | 68.8% | **127** | Product variation grouping (e.g., WTS003, COHW030TP) |
| **G** | **Fabric Code** | 62.5% | **97** | Links to fabric (e.g., Modal-IL-White, Pima-SJ-Black) |
| H | Product Status | 0.5% | 1 | Only "Inactive" marked |
| K | Gender | 74.0% | 3 | Women's, Men's, Accessories |
| M | MRP | 40.5% | 28 | Prices (₹1,799, etc.) |
| N-P | Fabric Cost, UOM, Consumption | 0% | - | Empty columns |
| T | Fabric Type | 0% | - | Empty column |

> **Key columns for ERP integration:** Barcode (A), Style Code (F), Fabric Code (G)

### Fabric Code Pattern Analysis

97 unique fabric codes following pattern: `{Material}-{FabricType/ID}-{Colour}`

| Prefix | Count | Pattern | Examples |
|--------|-------|---------|----------|
| COT | 19 | `COT-{construction}-{colour}` | COT-SEERSUCKER-BLUE, COT-SHRT-FNESTR-DRKGREY |
| Linen | 15 | `Linen-01-{colour}` | Linen-01-White, Linen-01-Indigo |
| Pima | 11 | `Pima-{SJ\|FT}-{colour}` | Pima-SJ-Black, Pima-FT-MilGreen |
| BrushedTerry | 5 | `BrushedTerry-01-{colour}` | BrushedTerry-01-Black |
| Satin | 5 | `Satin-{variant}-{colour}` | Satin-01-Blue, Satin-FloralPrint-AW23 |
| CMRib/CMRIb | 8 | `CMRib-01-{colour}` | CMRib-01-Green, CMRIb-01-Black |
| Modal | 3 | `Modal-IL-{colour}` | Modal-IL-White, Modal-IL-Grey |
| Tencel | 4 | `Tencel-01-{colour}` | Tencel-01-Black |
| Vintage | 5 | `Vintage-IL-{colour}` | Vintage-IL-White |

**Abbreviation Key:**
- `SJ` = Single Jersey
- `FT` = French Terry
- `IL` = Interlock (assumed)
- `SHRT` = Shirting
- `FNESTR` = Fine Stripe

### ERP FabricColour Mapping

The ERP has 103 FabricColours but **no `code` field**. Current identification is via `(fabricId, colourName)` composite unique key.

**Mapping Strategy:**

1. **Add `code` field to FabricColour** (nullable String, unique)
2. **Map existing 97 sheet codes** to corresponding FabricColours
3. **Flag unmapped codes** for manual review (don't auto-create)
4. **ERP generates codes** for new FabricColours using consistent pattern

**Sample Mappings:**

| Sheet Code | ERP FabricColour |
|------------|------------------|
| `Pima-SJ-Black` | Pima Cotton → Supima Single Jersey \| Carbon Black |
| `Pima-FT-MilGreen` | Pima Cotton → Supima French Terry \| Military Green |
| `Linen-01-White` | Linen → Linen 60 Lea \| White |
| `CMRib-01-Black` | Cotton → Rib \| Carbon Black |
| `Seersucker-Blue` | Cotton → Seersucker \| Blue |
| `Modal-IL-White` | **NOT IN ERP** — needs creation |
| `Tencel-01-Black` | **NOT IN ERP** — needs creation |

### Fabric Ledger Tab

New tab in Barcode Mastersheet that ERP updates with fabric balance data. Other sheets (Orders Mastersheet, etc.) can VLOOKUP/IMPORTRANGE from this tab.

**Tab Name:** `Fabric Balances` (or `ERP Fabric Ledger`)

**Columns:**

| Column | Header | Source | Description |
|--------|--------|--------|-------------|
| A | Fabric Code | ERP | Unique fabric code (e.g., Pima-SJ-Black) |
| B | Fabric Name | ERP | Full name (e.g., "Pima Cotton - Supima Single Jersey - Carbon Black") |
| C | Material | ERP | Material name (e.g., "Pima Cotton") |
| D | Current Balance | ERP | `FabricColour.currentBalance` |
| E | Unit | ERP | meters or kg |
| F | Cost per Unit | ERP | ₹ per unit |
| G | Supplier | ERP | Primary supplier name |
| H | Lead Time (days) | ERP | Default lead time |
| I | Pending Orders Qty | ERP | Fabric allocated to unfulfilled orders (computed from BOM × open orders) |
| J | Available Balance | Formula | `=D-I` (balance minus pending) |
| K | 30-Day Consumption | ERP | Average usage over last 30 days |
| L | Reorder Point | Formula | `=K*H/30` (consumption × lead time) |
| M | Last Updated | ERP | Timestamp of last push |

**Usage in Orders Mastersheet:**

```
=VLOOKUP(G2, IMPORTRANGE("barcode-sheet-id", "Fabric Balances!A:J"), 10, FALSE)
```

This gives the **Available Balance** for the fabric code in column G of any order line.

### Schema Changes

**Add `code` field to FabricColour:**

```prisma
model FabricColour {
  // ... existing fields ...

  code            String?   @unique  // Fabric code for sheet sync (e.g., "Pima-SJ-Black")
}
```

**Migration:**
```sql
ALTER TABLE "FabricColour" ADD COLUMN "code" TEXT;
CREATE UNIQUE INDEX "FabricColour_code_key" ON "FabricColour"("code");
```

### Fabric Ledger Push Worker

New worker that pushes fabric balance data from ERP to the Fabric Balances tab.

**Architecture:**

```typescript
// server/src/services/fabricLedgerPushWorker.ts

interface FabricLedgerRow {
  code: string;
  name: string;
  material: string;
  currentBalance: number;
  unit: string;
  costPerUnit: number | null;
  supplierName: string | null;
  leadTimeDays: number | null;
  pendingOrdersQty: number;  // Computed from BOM
  consumption30d: number;    // From FabricColourTransaction history
  lastUpdated: string;       // ISO timestamp
}

// Phases:
// 1. Query all FabricColours with code field populated
// 2. Compute pending orders qty (join OrderLine → SkuBomLine → FabricColour)
// 3. Compute 30-day consumption (aggregate FabricColourTransaction)
// 4. Write to Fabric Balances tab in Barcode Mastersheet
```

**Push Frequency:** Every 15 minutes (configurable via `FABRIC_LEDGER_PUSH_INTERVAL_MS`)

**Feature Flag:** `ENABLE_FABRIC_LEDGER_PUSH` (default: false)

### Fabric Code Mapping Script

Script to populate the `code` field on existing FabricColours:

```bash
npx tsx server/scripts/map-fabric-codes.ts --dry-run   # Preview mappings
npx tsx server/scripts/map-fabric-codes.ts --apply     # Apply mappings
npx tsx server/scripts/map-fabric-codes.ts --report    # Show unmapped codes
```

**Mapping Logic:**

1. Read all 97 fabric codes from Barcode Mastersheet
2. For each code, parse pattern: `{Material}-{FabricType}-{Colour}`
3. Look up FabricColour by matching Material name + Fabric name + Colour name
4. If found: set `FabricColour.code = sheetCode`
5. If not found: log for manual review

### Barcode → SKU Sync (Future)

Currently, new SKUs are sometimes added to the Barcode Mastersheet before they exist in the ERP. A future enhancement could:

1. **Detect new barcodes** in sheet that don't exist in ERP
2. **Flag for review** or auto-import as new SKUs
3. **Validate fabric code** exists before creating SKU

This enables the team to continue their current workflow of adding SKUs to the sheet while ensuring ERP stays in sync.

### Remaining Work (Phase 4)

| # | Task | Status | Notes |
|---|------|--------|-------|
| P4-1 | **Prisma migration: add `code` to FabricColour** | Not started | Nullable unique String field |
| P4-2 | **Build fabric code mapping script** | Not started | `map-fabric-codes.ts` with --dry-run/--apply/--report |
| P4-3 | **Populate `code` field** | Not started | Run mapping script, manually review unmapped |
| P4-4 | **Create Fabric Balances tab** | Not started | Add new tab to Barcode Mastersheet with header row |
| P4-5 | **Build fabric ledger push worker** | Not started | Query ERP, compute pending/consumption, write to sheet |
| P4-6 | **Add pending orders calculation** | Not started | Join OrderLine → SkuBomLine to sum fabric requirements |
| P4-7 | **Add 30-day consumption calculation** | Not started | Aggregate FabricColourTransaction for last 30 days |
| P4-8 | **Test VLOOKUP from Orders Mastersheet** | Not started | Verify other sheets can read Fabric Balances |
| P4-9 | **Add to monitoring page** | Not started | Show fabric push status, last run, any errors |
| P4-10 | **Create missing FabricColours** | Not started | Modal, Tencel, Vintage fabrics from manual review |

### Design Decisions (Phase 4)

14. **`code` field on FabricColour** — human-readable unique identifier for sheet sync. Follows existing sheet pattern `{Material}-{Type}-{Colour}`.
15. **Fabric Ledger as reference tab** — ERP pushes to a single tab in Barcode Mastersheet. Other sheets VLOOKUP/IMPORTRANGE from it. Centralized, cacheable.
16. **Pending orders = fabric demand** — computed from open orders × BOM fabric requirements. Shows fabric committed to orders not yet dispatched.
17. **Flag, don't auto-create** — unmapped fabric codes are logged for manual review rather than auto-creating potentially duplicate FabricColours.
18. **Available Balance = Current - Pending** — simple formula in sheet. ERP provides the inputs, sheet does the math.

---

## Phase 5: Piece-Level Tracking & Returns Integration (PLANNED)

The **Return & Exchange Pending Pieces** tab in Office Ledger tracks individual physical pieces with unique barcodes. This enables piece-level tracking through the return → QC → inward workflow. The ERP should adopt this capability.

### Current Sheet System (Explored 2026-02-07)

**Tab: "Return & Exchange Pending Pieces"** — 14,241 pieces tracked

| Column | Header | Coverage | Purpose |
|--------|--------|----------|---------|
| A | uniqueBarcode | 99.9% | **Unique ID per physical piece** |
| B | Product Barcode | 99.8% | SKU (links to product) |
| C | productName | 0% | Broken (#REF!) |
| D | Qty | 100% | Always 1 (piece-level) |
| E | Source | 98.7% | Return (43.8%), Exchange (30.8%), RTO (23.6%) |
| F | Order ID | 93.8% | Shopify order number |
| G | Return ID | 5.4% | Return Prime / marketplace ID |
| H | Customer Name | 96.6% | Customer name |
| I | Date Received | 99.8% | When piece arrived |
| K | Note | 49.4% | Additional notes |
| L | Inward Count | 99.9% | 0=pending, 1=inwarded (formula has issues) |
| M | timestamp | 52.5% | Entry timestamp |

**Source Distribution:**
- Return: 6,241 (43.8%)
- Exchange: 4,392 (30.8%)
- RTO: 3,370 (23.6%)
- Other: 236 (1.6%)

**Order Channel (from Order ID patterns):**
- Shopify (5-digit): 78.7%
- Shopify (6-digit): 3.4%
- Amazon: 0.2%
- Other/Empty: 17.8%

### Unique Barcode Format

**Pattern:** `DDMMYY` (print date) + `NNNN` (sequence within batch)

| Example | Breakdown | Meaning |
|---------|-----------|---------|
| `2801250510` | `280125` + `0510` | Jan 28, 2025 batch, sequence 510 |
| `1207241000` | `120724` + `1000` | Jul 12, 2024 batch, sequence 1000 |
| `1112202616` | `111220` + `2616` | Dec 11, 2020 batch, sequence 2616 |

**How it works:**
1. Pre-print batch of 500-1000 barcode labels with sequential numbers
2. Date in barcode = when batch was **printed** (not when piece arrives)
3. Physical label attached to each piece when it arrives at warehouse
4. Barcode scanned to log piece in "Return & Exchange Pending Pieces" tab

**Note:** Old batches may still be in use — a 2020 barcode can be applied to a 2026 return.

### Linkage: Returns → Inward (Final)

When a piece is QC'd and added to inventory:
1. Entry created in **Inward (Final)** with source = "repacking"
2. Unique barcode placed in **column G** ("Unique Barcode")
3. Links the inward transaction back to the original return record

**Current linkage stats:**
- 3,172 Inward (Final) rows have a unique barcode in col G
- 3,150 of those match a barcode from Returns tab (99.3%)
- Almost all are source = "repacking"

### ERP Returns System (Current)

The ERP has a rich returns system but **no piece-level tracking**:

| Feature | ERP Support | Sheet Support |
|---------|-------------|---------------|
| Return status workflow | ✅ (requested→pickup→received→complete) | ❌ (just 0/1) |
| Batch grouping | ✅ (returnBatchNumber) | ❌ |
| QC condition | ✅ (5 conditions) | ❌ |
| Refund calculation | ✅ (gross, clawback, deductions, net) | ❌ |
| Return Prime integration | ✅ | ✅ (Return ID field) |
| **Piece-level barcode** | ❌ | ✅ |
| **Individual piece tracking** | ❌ | ✅ |

**Key gap:** ERP tracks at SKU + batch level, not individual piece level.

### Proposed Schema: ReturnedPiece Model

Add piece-level tracking to the ERP:

```prisma
model ReturnedPiece {
  id              String   @id @default(uuid())

  // Unique barcode (the physical label)
  pieceBarcode    String   @unique  // e.g., "2801250510"

  // Link to SKU
  skuId           String
  sku             Sku      @relation(fields: [skuId], references: [id])

  // Source tracking
  source          ReturnSource  // RETURN, EXCHANGE, RTO, REPACKING, OTHER

  // Order linkage
  orderId         String?       // Shopify order ID
  orderLineId     String?       // ERP OrderLine if matched
  orderLine       OrderLine?    @relation(fields: [orderLineId], references: [id])

  // Return Prime linkage
  returnPrimeId   String?       // Return Prime request ID

  // Customer (for analytics, not critical)
  customerName    String?

  // Lifecycle
  receivedAt      DateTime      // When piece arrived at warehouse
  receivedById    String?       // Who logged it
  receivedBy      User?         @relation("PieceReceivedBy", fields: [receivedById], references: [id])

  // QC / Inward status
  status          PieceStatus   @default(PENDING)  // PENDING, APPROVED, REJECTED, WRITTEN_OFF

  inwardedAt      DateTime?     // When added to inventory
  inwardedById    String?       // Who approved it
  inwardedBy      User?         @relation("PieceInwardedBy", fields: [inwardedById], references: [id])

  // QC details
  condition       String?       // good, damaged, defective, wrong_item, used
  conditionNotes  String?

  // Link to inventory transaction (when approved)
  inventoryTransactionId  String?  @unique
  inventoryTransaction    InventoryTransaction? @relation(fields: [inventoryTransactionId], references: [id])

  // Metadata
  notes           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([skuId])
  @@index([orderId])
  @@index([status])
  @@index([receivedAt])
}

enum ReturnSource {
  RETURN
  EXCHANGE
  RTO
  REPACKING
  OTHER
}

enum PieceStatus {
  PENDING      // Received, awaiting QC
  APPROVED     // QC passed, added to inventory
  REJECTED     // QC failed, not added to inventory
  WRITTEN_OFF  // Written off (damaged, etc.)
}
```

### Barcode Generation

ERP can generate barcodes in same format for continuity:

```typescript
// server/src/utils/pieceBarcode.ts

/**
 * Generate a batch of piece barcodes.
 * Format: DDMMYY + NNNN (4-digit sequence)
 *
 * @param count - Number of barcodes to generate (max 9999)
 * @param startSequence - Starting sequence number (default: find next available)
 */
export async function generatePieceBarcodes(
  count: number,
  startSequence?: number
): Promise<string[]> {
  const today = new Date();
  const dd = today.getDate().toString().padStart(2, '0');
  const mm = (today.getMonth() + 1).toString().padStart(2, '0');
  const yy = today.getFullYear().toString().slice(2);
  const prefix = `${dd}${mm}${yy}`;  // e.g., "070226" for Feb 7, 2026

  // Find highest existing sequence for today's prefix
  const existing = await prisma.returnedPiece.findMany({
    where: { pieceBarcode: { startsWith: prefix } },
    select: { pieceBarcode: true },
    orderBy: { pieceBarcode: 'desc' },
    take: 1,
  });

  const lastSeq = existing[0]
    ? parseInt(existing[0].pieceBarcode.slice(6), 10)
    : 0;
  const start = startSequence ?? (lastSeq + 1);

  const barcodes: string[] = [];
  for (let i = 0; i < count; i++) {
    const seq = (start + i).toString().padStart(4, '0');
    barcodes.push(`${prefix}${seq}`);
  }

  return barcodes;
}
```

### Workflow: Piece Receiving

**Current Sheet workflow:**
1. Piece arrives at warehouse
2. Team attaches pre-printed barcode label
3. Scans barcode → logs in "Return & Exchange Pending Pieces"
4. Later: QC passes → logs in "Inward (Final)" with barcode in col G

**Proposed ERP workflow:**
1. Piece arrives at warehouse
2. Team scans/enters barcode → creates `ReturnedPiece` record
3. Links to OrderLine if order number provided
4. QC inspector reviews → sets `status` and `condition`
5. If approved: creates `InventoryTransaction`, links to piece, updates SKU balance
6. If rejected: sets `status=REJECTED` or `WRITTEN_OFF`

### Data Migration

Import existing 14,241 pieces from sheet into ERP:

```bash
npx tsx server/scripts/import-returned-pieces.ts --dry-run   # Preview
npx tsx server/scripts/import-returned-pieces.ts --apply     # Import
```

**Field mapping:**

| Sheet Column | ERP Field |
|--------------|-----------|
| A (uniqueBarcode) | pieceBarcode |
| B (Product Barcode) | skuId (lookup by SKU code) |
| E (Source) | source (normalize: return→RETURN, exchange→EXCHANGE, rto→RTO) |
| F (Order ID) | orderId |
| G (Return ID) | returnPrimeId |
| H (Customer Name) | customerName |
| I (Date Received) | receivedAt |
| K (Note) | notes |
| L (Inward Count) | status (0→PENDING, 1→APPROVED) |

### Integration with Existing Returns

Link `ReturnedPiece` to existing ERP returns:

1. **Match by Order ID:** If orderId matches an ERP Order, link pieces to corresponding OrderLines
2. **Match by Return Prime ID:** If returnPrimeId matches ReturnPrimeRequest, link pieces
3. **Populate QC fields:** When piece is approved, copy condition to OrderLine.returnCondition

### Remaining Work (Phase 5)

| # | Task | Status | Notes |
|---|------|--------|-------|
| P5-1 | **Prisma migration: ReturnedPiece model** | Not started | New model with enums |
| P5-2 | **Add pieceBarcode generation utility** | Not started | Same format as sheet (DDMMYY + seq) |
| P5-3 | **Build import script for existing pieces** | Not started | `import-returned-pieces.ts` |
| P5-4 | **Add piece receiving UI** | Not started | Scan barcode → create ReturnedPiece |
| P5-5 | **Integrate with repacking queue** | Not started | Link ReturnedPiece to RepackingQueueItem |
| P5-6 | **Add inventory transaction linkage** | Not started | Create txn on approval, link to piece |
| P5-7 | **Add to monitoring page** | Not started | Show piece stats, pending count |
| P5-8 | **Verify linkage accuracy** | Not started | Compare sheet Inward Count with ERP status |

### Design Decisions (Phase 5)

19. **Piece-level tracking** — each physical unit gets a unique barcode. Enables tracking through return → QC → inventory lifecycle.
20. **Same barcode format** — ERP generates DDMMYY + sequence to maintain continuity with existing printed labels.
21. **Link to OrderLine** — pieces connect to orders for analytics. Can track "which piece from which order went where."
22. **Status enum vs Inward Count** — richer status (PENDING/APPROVED/REJECTED/WRITTEN_OFF) instead of just 0/1.
23. **Preserve source** — store original source (RETURN/EXCHANGE/RTO) on piece, don't lose it when added to inventory.
24. **Inventory transaction linkage** — when piece is approved, create InventoryTransaction and link back to piece for audit trail.

---

## Spreadsheet IDs

| Sheet | ID | Purpose |
|-------|-----|---------|
| Orders Mastersheet | `1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo` | Active orders, fulfillment, inventory allocation |
| Office Ledger | `1ZZgzu4xPXhP9ba3-liXHxj5tY0HihoEnVC9-wLijD5E` | Inward/Outward transactions, Balance (Final) |
| **Barcode Mastersheet** | `1xlK4gO2Gxu8-8-WS4jFnR0uxYO35fEBPZiSbJobGVy8` | SKU master data, Style/Fabric codes, Fabric Balances tab |

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `create-live-tabs.ts` | **Phase 3**: Create "Inward (Live)" and "Outward (Live)" tabs in COH Orders Mastersheet |
| `switch-balance-formula.ts` | **Phase 3**: Write ERP balance to Balance (Final) col F, switch col E formula to IMPORTRANGE-based |
| `switch-inventory-formula.ts` | **Phase 3**: Add col R to Inventory tab, write ERP balance, switch col C formula. `--dry-run` supported |
| `check-inventory-formulas.ts` | Diagnostic: read current Inventory + Office Inventory formulas |
| `setup-balance-formula.ts` | Update/restore col E formulas. `--dry-run` / `--apply` / `--restore` |
| `test-past-balance.ts` | Compute & preview col F values from sheet data. `--write` to apply |
| `check-sheet-totals.ts` | Diagnostic: row counts and qty totals per tab |
| `check-balance-final.ts` | Diagnostic: read Balance (Final) and verify col C/D/E consistency |
| `explore-mastersheet-structure.ts` | Diagnostic: dump all tab names, headers, formulas, row counts |
| `explore-inventory-formulas.ts` | Diagnostic: deep dive into Inventory + Orders tab formulas |
| `explore-data-patterns.ts` | Diagnostic: full column-level analysis of all tabs (source values, coverage %) |
| `verify-outward-totals.ts` | Diagnostic: verify Mastersheet Outward totals match OL Orders Outward aggregate |
| `backup-sheets.ts` | Full snapshot of all sheet tabs to timestamped JSON. Run before any modifications |
| `restore-sheets.ts` | Restore sheet tabs from backup. `--backup <timestamp>` `--tab <name>` or `--all` `--dry-run` |
| `explore-barcode-sheet.ts` | Diagnostic: explore Barcode Mastersheet structure, tabs, columns, sample data |
| `analyze-fabric-codes.ts` | Diagnostic: analyze fabric code patterns from Barcode Mastersheet col G |
| `list-erp-fabrics.ts` | Diagnostic: list all FabricColours in ERP with Material → Fabric → Colour hierarchy |
| `map-fabric-codes.ts` | Map sheet fabric codes to ERP FabricColours. `--dry-run` / `--apply` / `--report` |
| `explore-returns-tab.ts` | Diagnostic: explore Return & Exchange Pending Pieces structure |
| `analyze-returns-workflow.ts` | Diagnostic: analyze source distribution, inward status, linkages |
| `analyze-unique-barcodes.ts` | Diagnostic: analyze piece barcode format (DDMMYY + sequence) |
| `import-returned-pieces.ts` | Import existing pieces from sheet to ERP. `--dry-run` / `--apply` |
| `backfill-sheet-fields.ts` | **Ledgers backfill**: Re-reads Google Sheets, updates `source`, `performedBy`, `tailorNumber`, `repackingBarcode` (inward) and `destination` (outward) on existing DB records. Raw SQL batch updates. `--write` to apply |
| `backfill-outward-order-numbers.ts` | **Evidence-based fulfillment**: Backfill `orderNumber` on 37,345 historical ms-outward InventoryTransactions |
| `analyze-outward-order-matching.ts` | Diagnostic: analyze outward txn order number patterns and match rates |
| `link-historical-outward-to-orders.ts` | Link historical outward txns to OrderLines (set lineStatus=shipped). `--write` to apply |
| `migrate-outward-live-layout.ts` | **Phase 4**: Migrate Outward (Live) layout to match Orders from COH. Updates headers, remaps existing rows, updates Inventory + Balance formulas. `--dry-run` supported |

## Key Design Decisions

1. **Combined-view formula** — `Sheet Balance = F (ERP) + SUMIF(local sheet data)`. This single formula is the bridge that makes everything work: both systems can operate simultaneously, ingestion is always safe, and there's never a transition gap.
2. **Sheets for ops, ERP for engine** — play to each system's strengths. Team keeps their familiar Sheets workflow. ERP handles computation, history, and analytics.
3. **ERP pushes balance, Sheets handles allocation** — clean separation. ERP doesn't need to know about open orders. Sheets' SUMIFS handle allocation natively.
4. **No migration cutover needed** — the formula guarantees correctness whether data lives in Sheet, ERP, or both. Team migrates at their own pace.
5. **Content-based referenceIds** — row indices shift on deletion; SKU+qty+date+source is stable for dedup.
6. **Feature-flagged** — everything can be disabled instantly without code changes.
7. **6 optional fields** — `source`, `destination`, `tailorNumber`, `performedBy`, `repackingBarcode`, `orderNumber` on InventoryTransaction. All nullable, zero-impact migration. Preserves rich metadata from sheets that doesn't fit existing fields.
8. **Ingestion = reconciliation** — running the offload worker doesn't change balances, it just shifts where data lives (from SUMIF-counted to F-counted). Safe to run anytime.
9. **Mastersheet Outward for order dispatch** — Ingest from Mastersheet "Outward" (39K individual rows with order numbers), NOT Office Ledger "Orders Outward" (3K aggregate IMPORTRANGE). Individual rows enable order-level reconciliation.
10. **`orderNumber` enables reconciliation** — linking dispatch records to Shopify/marketplace orders lets us find gaps in both directions (orders without dispatches, dispatches without orders).
11. **Non-destructive by default** — every change is additive first (new columns, new DB rows), switchable second (formula swap with `--restore`), destructive never (row deletion disabled, requires explicit opt-in after weeks of verification). Full sheet backup before any modification.
12. **Side-by-side verification** — new formulas are tested in a temporary column (col G) and compared against the original (col E) before switching. The team never sees wrong balances.
13. **Deprecate, don't delete** — redundant ERP features are feature-flagged off, not removed. Code stays for reference and fallback. Gradual phase-out over months.
14. **Evidence-based fulfillment** — outward InventoryTransactions from sheets ARE the shipping evidence. When an outward entry has an order number, the corresponding OrderLine is automatically set to `shipped`. No explicit Ship & Release or Line Status Sync needed — the presence of outward evidence IS the proof.
15. **Disable conflicting manual sync steps** — sheetSyncService Steps 1 (Ship & Release) and 4 (Sync Line Statuses) create duplicate outward transactions and bypass evidence-based flow. Disabled with no-op results, preserving step indices for UI compatibility.
16. **Raw SQL batch updates for backfill** — Individual Prisma updates (95K round trips to remote DB) take hours. Raw SQL `UPDATE ... FROM (VALUES ...)` batches 500 rows per statement — 95K records in ~1 minute.
17. **`repackingBarcode` field naming** — Column G in Inward sheets contains unique barcodes mostly for Repacking source. Named `repackingBarcode` (not generic `barcode`) to clearly convey purpose and avoid confusion with SKU barcode (col A).
18. **Ledgers page: server-side everything** — 134K+ records can't be client-filtered. Server function handles search (OR across 7 fields), pagination, stats aggregation, and filter option enumeration. Route loader prefetches for SSR.
19. **Outward (Live) layout matches Orders from COH** — eliminates complex column remapping (G→A, I→B, B→F, etc.). Team can copy-paste a row directly for emergency outward. Worker ingestion reads G:G (SKU) and I:I (Qty). Formulas use same refs.

---

## Remaining Work (as of 2026-02-08)

### Phase 3, Step 12: Deploy & Monitor

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | **Enable on staging** | Not started | `ENABLE_SHEET_OFFLOAD=true`, `ENABLE_SHEET_DELETION=true` |
| 2 | **Test with sample data** | Not started | Add test rows to Inward (Live) and Outward (Live), verify ingestion |
| 3 | **Enable on production** | Not started | Same env vars, monitor first few cycles |
| 4 | **Redirect team** | Not started | Tell ops team to use "Inward (Live)" and "Outward (Live)" tabs |
| 5 | **Archive old tabs** | Not started | Rename old inward/outward tabs with "(Archive)" suffix or hide |

### Completed Phases

| Phase | Status | Summary |
|-------|--------|---------|
| Phase 1: Build | DONE | Worker, config, backup/restore, monitoring, admin UI |
| Phase 2: Historical Ingestion | DONE | 134K+ txns ingested, 4,257 SKUs verified, 73 missing SKUs imported |
| Phase 3, Steps 8-11 | DONE | Live tabs created, formulas switched (both Inventory + Balance Final), worker rewritten for dual-target, admin endpoints |
| Evidence-Based Fulfillment | DONE | orderNumber backfilled on 37,345 historical txns, auto-linking in worker (Phase B2), 237 historical OrderLines corrected, manual sync Steps 1 & 4 disabled |
| Ledgers Redesign & Sheet Field Backfill | DONE | Ledgers page rewritten (table layout, 3 tabs, server-side search/pagination), backfilled source/performedBy/tailorNumber/repackingBarcode/destination on 95K records from Google Sheets |
| Outward (Live) Layout Alignment | DONE | Layout matches Orders from COH (A-AD + AE=Outward Date), 1:1 copy, formulas updated (G:G/I:I), migration run |

### Future Phases

| # | Task | Status |
|---|------|--------|
| — | ERP clean-up: deprecate fulfillment UI, update dashboard metrics | Not started |
| P4 | **Barcode Mastersheet & Fabric Ledger** | Not started (see Phase 4 section) |
| P5 | **Piece-Level Tracking & Returns** | Not started (see Phase 5 section) |
| — | Add order reconciliation to monitoring page | Not started |
| — | Improve ERP inward UI for team adoption | Not started |
| — | ERP outward on order dispatch | Not started |

---

## ERP Clean-Up Plan

With Sheets handling open order management and allocation, significant parts of the ERP become redundant. This section catalogs what stays, what goes, and what needs review.

### Why Analytics Are Safe

The ERP receives **all Shopify orders via webhooks** — this doesn't change in the hybrid model. Every order that comes through Shopify gets written to `Order` + `OrderLine` tables by the webhook processor. Revenue, customer, product, and costing analytics all query these tables by `orderDate` and amounts — they don't depend on fulfillment status.

```
Shopify → Webhook → ShopifyOrderCache → Order/OrderLine tables → Analytics
                                                                   ↑
                                              This pipeline is UNCHANGED
```

The only analytics that depend on fulfillment status are **pipeline counts** (pending / allocated / picked / packed) on the dashboard. These become meaningless when fulfillment moves to Sheets. But they can be replaced with inventory-focused metrics instead.

### Feature-by-Feature Audit

#### Pages

| Page | Route | Current Purpose | Hybrid Status | Action |
|------|-------|----------------|---------------|--------|
| **Orders** | `/orders` | 4-view fulfillment hub (Open/Shipped/RTO/All) | **REDUNDANT** — Sheets handles fulfillment | Simplify to read-only historical view |
| **Orders Simple** | `/orders-simple` | Lightweight mobile order view | **REDUNDANT** | Remove |
| **Order Search** | `/order-search` | Global search across all orders | **KEEP** | No change — needed for customer service, lookups |
| **Tracking** | `/tracking` | iThink tracking dashboard | **KEEP** | No change — needed for delivery monitoring |
| **Inventory** | `/inventory` | Stock management | **KEEP** | Core of hybrid system |
| **Inventory Inward** | `/inventory-inward` | Fast inward workflow | **KEEP** | Becomes primary inward UI as team migrates from Sheets |
| **Products** | `/products` | Catalog + BOM | **KEEP** | Unaffected |
| **Customers** | `/customers` | Customer management + analytics | **KEEP** | Unaffected — queries Order tables filled by webhooks |
| **Returns** | `/returns` | Return processing | **KEEP** | Returns/RTO receiving has inventory impact |
| **Production** | `/production` | Production planning | **KEEP** | Unaffected |
| **Ledgers** | `/ledgers` | Transaction history | **KEEP** | Unaffected |
| **Costing** | `/costing` | P&L, unit economics | **KEEP** | Queries Order tables filled by webhooks |
| **Analytics** | `/analytics` | Sales by 10 dimensions | **KEEP** | Queries Order tables filled by webhooks |
| **Settings** | `/settings` | System settings, background jobs | **KEEP** | Add Sheets monitor tab |

#### Order Mutations (~30 server functions)

| Category | Functions | Hybrid Status | Action |
|----------|----------|---------------|--------|
| **Line status transitions** | `setLineStatus`, `markLineDelivered`, `markLineRto`, `receiveLineRto`, `cancelLine`, `uncancelLine` | **REDUNDANT** — Sheets manages fulfillment flow | Deprecate (keep code, remove from UI) |
| **Shipping** | `shipLines`, `adminShipOrder`, `unshipOrder`, `markShippedLine`, `unmarkShippedLine` | **REDUNDANT** — Sheets tracks dispatch | Deprecate |
| **Allocation** | `allocateOrder` | **REDUNDANT** — Sheets handles allocation via SUMIFS | Deprecate |
| **Release/archive** | `releaseToShipped`, `releaseToCancelled` | **REVIEW** — may simplify to auto-archive | Simplify |
| **Order CRUD** | `createOrder`, `updateOrder`, `deleteOrder`, `addLine`, `updateLine` | **KEEP** — still needed for corrections, exchanges | No change |
| **Payment** | `markPaid` | **KEEP** — payment tracking independent of fulfillment | No change |
| **Customization** | `customizeLine`, `removeLineCustomization` | **KEEP** — custom SKU creation is data-dependent | No change |
| **Delivery/RTO** | `markDelivered`, `markRto`, `receiveRto` | **KEEP** — RTO receiving triggers inventory re-credit | Simplify (remove from fulfillment flow, keep as standalone) |
| **Notes/tracking edits** | `updateLineNotes`, `updateLineTracking` | **KEEP** — correction capability | No change |

#### Allocation Logic

| Component | Current | Hybrid Status | Action |
|-----------|---------|---------------|--------|
| `allocateOrder` mutation | Creates `outward` InventoryTransaction with `reason: 'order_allocation'` | **REDUNDANT** — Sheets SUMIFS handle allocation | Deprecate |
| Balance check before allocation | `availableBalance >= qty` | **REDUNDANT** — Sheets shows available balance natively | Deprecate |
| Deallocation on cancel | Deletes outward transaction, restores balance | **REDUNDANT** — Sheets removes from orders tab | Deprecate |
| `STATUSES_WITH_ALLOCATED_INVENTORY` | Tracks which statuses have active outward txns | **REDUNDANT** | Deprecate |

#### Background Workers & Sync

| Worker | Current Purpose | Hybrid Status | Action |
|--------|----------------|---------------|--------|
| **Shopify webhooks** (orders, products, customers) | Ingest Shopify data to ERP | **KEEP** | No change — ERP is the archive |
| **Scheduled Sync** (hourly) | Catch missed webhooks | **KEEP** | No change |
| **Cache Processor** (30s) | Drain ShopifyOrderCache backlog | **KEEP** | No change |
| **Tracking Sync** (4h) | Fetch iThink tracking updates | **KEEP** | No change — tracking data stays in ERP |
| **Sheet Offload Worker** (3 jobs) | Ingest sheet data to ERP | **KEEP** | This IS the hybrid bridge (`ingest_inward`, `ingest_outward`, `move_shipped_to_outward`) |
| **Return Prime Sync** | Retry failed RP syncs | **KEEP** | No change |
| **Shopify Inventory Webhook** | Cache Shopify inventory levels | **REVIEW** | May become redundant if ERP balance is source of truth |

#### SSE Events

| Event | Current Trigger | Hybrid Status | Action |
|-------|----------------|---------------|--------|
| `order_created` | Webhook processes order | **KEEP** | Still needed for any ERP order views |
| `line_status` | Fulfillment mutations | **REDUNDANT** | Remove triggers from deprecated mutations |
| `order_shipped`, `lines_shipped` | Ship mutations | **REDUNDANT** | Remove |
| `order_delivered`, `line_delivered` | Delivery mutations | **REVIEW** | May keep for tracking sync triggers |
| `inventory_updated` | Inventory mutations | **KEEP** | Core of hybrid system |
| `production_batch_*` | Production mutations | **KEEP** | Unaffected |

### Analytics Impact Summary

| Analytics Feature | Data Source | Depends on Fulfillment Status? | Impact |
|-------------------|-----------|-------------------------------|--------|
| **Revenue** (today/7d/30d) | `Order.totalAmount` + `orderDate` | No | **SAFE** — populated by Shopify webhook |
| **Top Products** | `OrderLine.qty` + `unitPrice` | No (excludes cancelled only) | **SAFE** |
| **Top Customers** | `Order.customerId` + amounts | No | **SAFE** |
| **Top Fabrics/Materials** | `OrderLine` → SKU → BOM → Fabric | No | **SAFE** |
| **Customer Tiers/LTV** | `Order.totalAmount` history | No | **SAFE** |
| **Payment Split** (COD/Prepaid) | `Order.paymentMethod` | No | **SAFE** |
| **Sales by Dimension** (10 views) | `OrderLine` + Product hierarchy | No | **SAFE** |
| **Costing / P&L** | `OrderLine` + `SkuCosting` | No | **SAFE** |
| **Dashboard Pipeline** | `OrderLine.lineStatus` counts | **YES** | **BREAKS** — replace with inventory metrics |
| **Open Order Count** | `Order.status` / `isArchived` | **YES** | **BREAKS** — replace or remove |

### Dashboard Pipeline Replacement

The current dashboard shows:
```
Pipeline:  [Pending: 45]  [Allocated: 23]  [Ready: 12]  [Releasable: 8]
```

These counts become meaningless when fulfillment is in Sheets. Replace with inventory-focused metrics:

```
Inventory: [Total SKUs: 6,510]  [In Stock: 4,200]  [Low Stock: 380]  [Out of Stock: 1,930]
Sheets:    [Uningested Rows: 234]  [Last Sync: 15 min ago]  [Balance Match: ✅]
```

### Clean-Up Approach: Deprecate, Don't Delete

**Strategy:** Feature-flag redundant features rather than deleting code. This allows:
1. Gradual transition — team can fall back if needed
2. Reference — code documents business logic that may be useful
3. No risk — broken imports, missing routes, etc.

```typescript
// Approach: Add feature flag to orders page
const ENABLE_FULFILLMENT_UI = process.env.ENABLE_FULFILLMENT_UI !== 'false'; // default ON initially

// In routes: conditionally render fulfillment actions
// In mutations: check flag before allowing fulfillment operations
```

**Timeline:**
1. **Phase 0 (now):** Build hybrid system. Leave all existing features ON.
2. **Phase 1 (balance push working):** Turn off allocation mutations. Dashboard pipeline → inventory metrics.
3. **Phase 2 (team using Sheets for fulfillment):** Hide fulfillment UI. Simplify orders page to read-only.
4. **Phase 3 (stable):** Remove deprecated code entirely.

---

## Implementation Progress

### Phase 1: Historical Offload Build — COMPLETED (2026-02-07)

| Component | Status | Files |
|-----------|--------|-------|
| Prisma migration (6 fields) | Done | `prisma/schema.prisma`, `prisma/migrations/20260207_add_sheet_metadata_fields/` |
| Config: Mastersheet Outward + mappings | Done | `server/src/config/sync/sheets.ts`, `server/src/config/sync/index.ts` |
| Worker: Phase A metadata | Done | `server/src/services/sheetOffloadWorker.ts` |
| Worker: Phase B Mastersheet Outward | Done | `server/src/services/sheetOffloadWorker.ts` |
| Backup/Restore scripts | Done | `server/scripts/backup-sheets.ts`, `server/scripts/restore-sheets.ts` |
| Formula verification script | Done | `server/scripts/setup-balance-formula.ts` |
| Monitoring (OffloadMonitor) | Done | `client/src/components/settings/tabs/SheetSyncTab.tsx` |
| Admin stats (recentRuns) | Done | `server/src/routes/admin.ts` |

### Phase 2: Historical Ingestion — COMPLETED (2026-02-07)

- **134K+ transactions** ingested (83K inward + 51K outward + 484 adjustments)
- **4,257 SKUs** verified: 0 mismatches against Balance (Final)
- **73 missing SKUs** imported from Barcode Mastersheet
- Backup at `backups/sheets-2026-02-07-133013/`

### Phase 3: ERP-Based Balance System — COMPLETED (2026-02-07, Steps 8-11)

| Component | Status | Files |
|-----------|--------|-------|
| Create live tabs (Inward/Outward) | Done | `server/scripts/create-live-tabs.ts` — tabs in COH Orders Mastersheet |
| Write ERP balance to Balance (Final) col F | Done | `server/scripts/switch-balance-formula.ts` — 6,098 match, 0 mismatch |
| Switch Balance (Final) col E formula | Done | IMPORTRANGE-based formula referencing live tabs |
| Add Inventory col R (ERP balance) | Done | `server/scripts/switch-inventory-formula.ts` — grid expanded 17→18 cols |
| Switch Inventory col C formula | Done | `=R+SUMIF(Inward Live)-SUMIF(Outward Live)` — 6,098 match, 0 mismatch |
| Rewrite sheetOffloadWorker | Done | `server/src/services/sheetOffloadWorker.ts` — 2 buffer tabs, dual-target writes |
| Config: LIVE_TABS, INVENTORY_TAB, live cols | Done | `server/src/config/sync/sheets.ts`, `server/src/config/sync/index.ts` |
| Admin status + trigger endpoints | Done | `server/src/routes/admin.ts` — GET status, POST trigger |
| SheetSyncTab: buffer counts UI | Done | `client/src/components/settings/tabs/SheetSyncTab.tsx` |
| TypeScript check | Pass | Both client and server |

**Key architecture changes:**
- Live tabs in **COH Orders Mastersheet** (not Office Ledger) — same sheet as Inventory for fast SUMIF
- Worker writes to **both** Inventory col R (Mastersheet) AND Balance (Final) col F (Office Ledger)
- Inventory tab no longer depends on Office Inventory / Office Ledger
- Worker interval changed from 60 min to 30 min
- Removed `OFFLOAD_AGE_DAYS` — buffer tabs are always fresh

**Next**: Step 12 — Deploy & Monitor (enable `ENABLE_SHEET_OFFLOAD=true` on staging, test with sample data)

### Evidence-Based Fulfillment — COMPLETED (2026-02-08)

| Component | Status | Files |
|-----------|--------|-------|
| Backfill `orderNumber` on 37,345 historical ms-outward txns | Done | `server/scripts/backfill-outward-order-numbers.ts` |
| Auto-link outward to OrderLines (Phase B2 in worker) | Done | `server/src/services/sheetOffloadWorker.ts` (`linkOutwardToOrders()`) |
| Historical OrderLine linking (237 lines corrected) | Done | `server/scripts/link-historical-outward-to-orders.ts` |
| Disable Steps 1 & 4 in manual CSV sync | Done | `server/src/services/sheetSyncService.ts` |
| TypeScript check | Pass | Both client and server |

**Key changes:**
- **Phase B2 added to worker:** After ingesting outward, `linkOutwardToOrders()` matches outward txns to OrderLines by orderNumber + skuId, sets lineStatus='shipped' with courier/AWB data
- **LINKABLE_STATUSES:** `['pending', 'allocated', 'picked', 'packed']` — only these get auto-shipped. Already-shipped/cancelled lines are skipped
- **Array-based SKU lookup with FIFO consumption:** Handles duplicate SKUs in same order correctly
- **Manual sync disabled:** sheetSyncService Steps 1 (Ship & Release) and 4 (Sync Line Statuses) were creating duplicate outward transactions and bypassing evidence-based flow
- **Historical data:** 88,600 shipped lines (99.87%), 117 in pipeline (110 pending, 3 allocated, 4 packed), 0 lines with outward evidence but pre-ship status

### Ledgers Redesign & Sheet Field Backfill — COMPLETED (2026-02-08)

| Component | Status | Files |
|-----------|--------|-------|
| `LedgersSearchParams` schema (tab, search, reason, location, origin, page, limit) | Done | `shared/src/schemas/searchParams.ts` |
| `getLedgerTransactions` server function (search, pagination, stats, filters) | Done | `client/src/server/functions/inventory.ts` |
| Route loader with SSR prefetch | Done | `client/src/routes/_authenticated/ledgers.tsx` |
| Ledgers page rewrite (3 tabs, table layout, filter bar, stats, pagination) | Done | `client/src/pages/Ledgers.tsx` |
| Add `repackingBarcode` field to InventoryTransaction | Done | `prisma/schema.prisma` |
| Backfill sheet fields (source, performedBy, tailorNumber, repackingBarcode, destination) | Done | `server/scripts/backfill-sheet-fields.ts` |
| TypeScript check | Pass | Both client and server |

**Key changes:**
- **Ledgers page**: Table layout with 3 tabs (inward/outward/materials), server-side search across 7 fields, reason/location/origin filters, stats row, pagination
- **Inward columns**: Date, SKU, Product, Color, Size, Qty, Reason, Source, Performed By, Tailor #, Barcode, Origin (Sheet/App badge)
- **Outward columns**: Date, SKU, Product, Color, Size, Qty, Reason, Destination, Order #, Origin
- **Backfill**: Raw SQL `UPDATE ... FROM (VALUES ...)` — 95K records in ~1 minute (vs hours with individual Prisma updates)
- **Field coverage**: source=83,090 | performedBy=59,314 | tailorNumber=8,953 | repackingBarcode=9,922 | destination=11,326

### Outward (Live) Layout Alignment — COMPLETED (2026-02-08)

| Component | Status | Files |
|-----------|--------|-------|
| New `OUTWARD_LIVE_COLS` config (matches Orders from COH) | Done | `server/src/config/sync/sheets.ts` |
| Update `ingestOutwardLive()` (range A:AE, date priority AE→A) | Done | `server/src/services/sheetOffloadWorker.ts` |
| Simplify `moveShippedToOutward()` (1:1 copy + AE) | Done | `server/src/services/sheetOffloadWorker.ts` |
| Update Apps Script (1:1 copy, remove split write) | Done | `server/scripts/apps-script-outward.js` |
| Update formula scripts (Outward cols A→G, B→I) | Done | `switch-inventory-formula.ts`, `switch-balance-formula.ts` |
| Update sheet protection (remove col C protection for Outward) | Done | `server/scripts/push-sheet-protection.ts` |
| Migration script (headers + formulas) | Done | `server/scripts/migrate-outward-live-layout.ts` |
| Update `LIVE_BALANCE_FORMULA_TEMPLATE` | Done | `server/src/config/sync/sheets.ts` |
| TypeScript check | Pass | Both client and server |

**Key changes:**
- **Outward (Live) now matches Orders from COH layout** (A-AD) + Outward Date at AE — team can copy-paste rows directly for emergency outward
- **No more column remapping** — `moveShippedToOutward()` copies entire row as-is, just appends today's date at AE
- **Formula refs updated** — Inventory col C and Balance (Final) col E SUMIFs now reference `$G:$G` (SKU) and `$I:$I` (Qty) instead of `$A:$A` / `$B:$B`
- **Col C protection removed** from Outward (Live) — no more ARRAYFORMULA, product name comes from pasted data in col H
- **Migration run**: 0 existing rows (buffer was empty), 6,507 Inventory formulas + 6,508 Balance formulas updated
