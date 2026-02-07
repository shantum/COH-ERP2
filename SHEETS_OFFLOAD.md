# Google Sheets ↔ ERP Hybrid System

## Vision

Google Sheets remains the team's daily working surface for **order management** — it's fast, familiar, and flexible. The ERP handles the **heavy lifting**: inventory engine, historical data, analytics, and Shopify integration. The two systems stay in sync through targeted data flows.

```
┌─────────────────────────────────────────┐     ┌─────────────────────────────┐
│           Google Sheets (Ops UI)         │     │        ERP (Engine)          │
│                                         │     │                             │
│  Orders from COH  ← GCF webhooks ←───────── Shopify                       │
│    (open orders, fulfillment,           │     │                             │
│     packing, dispatch)                  │     │  All orders (archive)       │
│                                         │     │  All inventory transactions │
│  Inventory tab                          │     │  SKU/product catalog        │
│    Col C: Balance  ◄── ERP writes ──────────  Computed balance per SKU     │
│    Col D: Allocated (SUMIFS on orders)  │     │                             │
│    Col E: Available = C - D             │     │                             │
│                                         │     │                             │
│  Inward/Outward tabs                    │     │                             │
│    Recent entries  ──── ERP ingests ────────→ InventoryTransactions        │
│    Old entries     ──── offloaded ──────────→ InventoryTransactions        │
│                                         │     │                             │
│  Balance (Final)                        │     │                             │
│    =F (ERP past bal) + recent SUMIFs    │     │                             │
└─────────────────────────────────────────┘     └─────────────────────────────┘
```

### Who Owns What

| Domain | Owner | Other system's role |
|--------|-------|-------------------|
| **Open orders / fulfillment** | Sheets | ERP stores archive, provides analytics |
| **Inventory balance** | ERP (computes) | Sheets displays via pushed value |
| **Allocation** | Sheets (formulas) | ERP doesn't track allocation |
| **Inward (production received)** | Transitioning → ERP | Currently Sheets, migrating to ERP UI |
| **Outward (dispatch)** | Transitioning → ERP | Currently Sheets (manual copy), migrating |
| **Historical data** | ERP | Sheets keeps only recent/active data |
| **Shopify orders** | ERP (via webhooks) | GCF writes line items to Sheets for ops |

---

## Current Sheet Architecture (Explored 2026-02-07)

### Two Spreadsheets

**1. Orders Mastersheet** (`1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo`)

| Tab | Rows | Purpose |
|-----|------|---------|
| **Orders from COH** | ~219 | Active open orders. Line-level: order#, customer, SKU, qty, status, assigned, picked, packed, shipped. GCF webhook writes new orders here. |
| **Inventory** | 6,510 | Per-SKU balance + allocation. Pulls from Office Inventory, subtracts assigned orders. |
| **Office Inventory** | 6,510 | Mirror of Balance (Final) from ledger. Cols: Barcode, Name, Inward, Outward, Balance. |
| **Outward** | 39,424 | Dispatched order lines (copied from Orders from COH after packing). |
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

### Key Formulas (current)

**Balance (Final) Col E** — 5 SUMIFs scanning ~135K rows:
```
=SUMIF('Inward (Final)'!$A:$A,$A3,'Inward (Final)'!$B:$B)
+SUMIF('Inward (Archive)'!$A:$A,$A3,'Inward (Archive)'!$B:$B)
-SUMIF(Outward!$A:$A,$A3,Outward!$B:$B)
-SUMIF('Orders Outward'!$A:$A,$A3,'Orders Outward'!$B:$B)
-SUMIF('Orders Outward 12728-41874'!$N:$N,$A3,'Orders Outward 12728-41874'!$O:$O)
```

**Inventory Tab Col C** (Balance) — looks up Office Inventory:
```
=SUMIF('Office Inventory'!A:E, A4, 'Office Inventory'!E:E)
```

**Inventory Tab Col D** (Allocated) — counts assigned order qty:
```
=SUMIFS('Orders from COH'!I:I, 'Orders from COH'!G:G, A4, 'Orders from COH'!N:N, TRUE)
```
Where col I = Qty, col G = SKU, col N = Assigned flag (TRUE/FALSE).

**Inventory Tab Col E** (Available):
```
=C4-D4
```

**Orders from COH Col M** (Qty Balance) — VLOOKUP to Inventory tab showing available stock per SKU.

### Data Flow: Order Lifecycle

```
1. Shopify order placed
2. GCF webhook #1 → writes order-level data to "ShopifyAllOrderData"
3. GCF webhook #2 → writes line items to "Orders from COH" (SKU, qty, customer, etc.)
4. Inventory tab auto-updates: SUMIFS counts allocated qty (col N = Assigned flag)
5. Team works in "Orders from COH": assigns, picks, packs
6. On dispatch: team copies row to Mastersheet "Outward" tab, deletes from orders tab
   (Outward Summary aggregates by SKU → IMPORTRANGE to OL "Orders Outward")
7. Balance (Final) recalculates (outward SUMIF increases)
8. Inventory tab available balance decreases
```

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
| Offload worker (4 phases) | `server/src/services/sheetOffloadWorker.ts` | ⚠️ Needs revision (outward source + new fields) |
| Logger (`sheetsLogger`) | `server/src/utils/logger.ts` | ✅ Done |
| Config re-exports | `server/src/config/sync/index.ts` | ✅ Done |
| Server integration (start/stop/shutdown) | `server/src/index.js` | ✅ Done |
| Admin dashboard (background jobs) | `server/src/routes/admin.ts` | ✅ Done |
| Formula update script | `server/scripts/setup-balance-formula.ts` | ✅ Done |
| Past balance preview/write | `server/scripts/test-past-balance.ts` | ✅ Done |
| Diagnostic scripts | `server/scripts/check-*.ts` | ✅ Done |

### Worker Phases

1. **Phase A — Ingest Inward:** Read Inward (Final) old rows + all Inward (Archive), create InventoryTransactions
2. **Phase B — Ingest Outward:** Read old Outward + Mastersheet Outward (individual order lines), create InventoryTransactions
3. **Phase C — Update Past Balance:** Query ingested transactions per SKU, write net balance to col F
4. **Phase D — Invalidate Caches:** Clear inventory balance cache, broadcast SSE update

> **REVISION NEEDED:** The current worker ingests from Office Ledger "Orders Outward" (aggregate). It must be **revised** to ingest from **Mastersheet "Outward"** (individual order lines with order numbers). It also needs to capture new metadata fields (see Schema Changes below).

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
- Original sheet data is preserved in the transaction fields (`source`, `destination`, `tailorNumber`, `performedBy`, `orderNumber`)
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

The existing `InventoryTransaction` model needs **5 new optional fields** to capture metadata from sheet data that doesn't fit into the current schema:

```prisma
model InventoryTransaction {
  // ... existing fields ...

  // New optional fields for sheet-imported data
  source          String?   // Original source text from sheet (e.g. "sampling", "warehouse")
  destination     String?   // Outward destination (e.g. "for order", "sourcing", "office")
  tailorNumber    String?   // Tailor identifier (23% of Final inward rows have this)
  performedBy     String?   // "Done By" column from inward sheets
  orderNumber     String?   // Shopify order# or marketplace order ID (from Mastersheet Outward)
}
```

**Why these fields?**

| Field | Source | Why not existing fields? |
|-------|--------|------------------------|
| `source` | Inward col E | Too granular for `reason` (e.g. "sampling" vs "warehouse" both map to a reason but are different sources) |
| `destination` | Outward col E | No existing field for outward destination |
| `tailorNumber` | Inward (Final) col H | Links to tailor entity for production tracking |
| `performedBy` | Inward col F | Different from `createdById` (system user) — this is the actual person who did the inward |
| `orderNumber` | Mastersheet Outward col B | Enables linking dispatch records to Shopify orders for reconciliation |

**Migration:** Simple `ALTER TABLE ADD COLUMN` — all nullable, no data backfill needed. Run before enabling the offload worker.

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

Similar path. The outward workflow is more complex because it's tied to order dispatch:
- Currently: team copies rows from "Orders from COH" → Mastersheet "Outward" tab (which aggregates via "Outward Summary" → IMPORTRANGE to OL "Orders Outward")
- Future: ERP records outward when order is marked shipped
- The dispatch action could eventually be triggered from either system

### Reconciliation / Matching

At any point, to verify both systems agree:

```bash
# 1. Run the offload worker (ingests sheet → ERP)
# Admin dashboard → Background Jobs → Sheet Offload → Trigger

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

## Spreadsheet IDs

| Sheet | ID |
|-------|-----|
| Orders Mastersheet | `1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo` |
| Office Ledger | `1ZZgzu4xPXhP9ba3-liXHxj5tY0HihoEnVC9-wLijD5E` |

## Scripts Reference

| Script | Purpose |
|--------|---------|
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

## Key Design Decisions

1. **Combined-view formula** — `Sheet Balance = F (ERP) + SUMIF(local sheet data)`. This single formula is the bridge that makes everything work: both systems can operate simultaneously, ingestion is always safe, and there's never a transition gap.
2. **Sheets for ops, ERP for engine** — play to each system's strengths. Team keeps their familiar Sheets workflow. ERP handles computation, history, and analytics.
3. **ERP pushes balance, Sheets handles allocation** — clean separation. ERP doesn't need to know about open orders. Sheets' SUMIFS handle allocation natively.
4. **No migration cutover needed** — the formula guarantees correctness whether data lives in Sheet, ERP, or both. Team migrates at their own pace.
5. **Content-based referenceIds** — row indices shift on deletion; SKU+qty+date+source is stable for dedup.
6. **Feature-flagged** — everything can be disabled instantly without code changes.
7. **5 new optional fields** — `source`, `destination`, `tailorNumber`, `performedBy`, `orderNumber` on InventoryTransaction. All nullable, zero-impact migration. Preserves rich metadata from sheets that doesn't fit existing fields.
8. **Ingestion = reconciliation** — running the offload worker doesn't change balances, it just shifts where data lives (from SUMIF-counted to F-counted). Safe to run anytime.
9. **Mastersheet Outward for order dispatch** — Ingest from Mastersheet "Outward" (39K individual rows with order numbers), NOT Office Ledger "Orders Outward" (3K aggregate IMPORTRANGE). Individual rows enable order-level reconciliation.
10. **`orderNumber` enables reconciliation** — linking dispatch records to Shopify/marketplace orders lets us find gaps in both directions (orders without dispatches, dispatches without orders).
11. **Non-destructive by default** — every change is additive first (new columns, new DB rows), switchable second (formula swap with `--restore`), destructive never (row deletion disabled, requires explicit opt-in after weeks of verification). Full sheet backup before any modification.
12. **Side-by-side verification** — new formulas are tested in a temporary column (col G) and compared against the original (col E) before switching. The team never sees wrong balances.
13. **Deprecate, don't delete** — redundant ERP features are feature-flagged off, not removed. Code stays for reference and fallback. Gradual phase-out over months.

---

## Remaining Work (as of 2026-02-07)

### Before Go-Live (Phase 0)

**Build:**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | **Prisma migration: 5 new fields** | Not started | `source`, `destination`, `tailorNumber`, `performedBy`, `orderNumber` on InventoryTransaction |
| 2 | **Revise offload worker: outward source** | Not started | Switch Phase B from OL "Orders Outward" (aggregate) → Mastersheet "Outward" (individual order lines) |
| 3 | **Revise offload worker: capture new fields** | Not started | Populate `source`, `destination`, `tailorNumber`, `performedBy`, `orderNumber` during ingestion |
| 4 | **Expand source mapping** | Not started | Add missing sources: warehouse→transfer, op stock→transfer, alteration→production, rto→rto_received, reject→damage |
| 5 | **Extend worker status** | Not started | Add `sheetRowCounts`, `ingestedCounts`, `recentRuns`, `durationMs` to `getStatus()` |
| 6 | **Build backup & restore scripts** | Not started | `backup-sheets.ts` (full snapshot to JSON) + `restore-sheets.ts` (write back from backup) |
| 7 | **Add side-by-side formula verification** | Not started | Extend `setup-balance-formula.ts` with `--test` flag that writes to col G for comparison |
| 8 | **Build monitoring page** | Not started | `/settings/sheets` — server function + frontend (see Monitoring Page section) |
| 9 | **Run verify-outward-totals.ts** | Not started | Confirm Mastersheet Outward totals match OL Orders Outward aggregate |

**Go-live (safety-first sequence):**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 10 | **Take full backup** | Not started | `backup-sheets.ts` → verify manifest |
| 11 | **Write col F values** | Not started | `test-past-balance.ts --write` → verify col E unchanged |
| 12 | **Side-by-side formula test** | Not started | Write new formula to col G, compare E vs G for all 6,510 SKUs |
| 13 | **Switch col E formula** | Not started | `setup-balance-formula.ts --apply` → verify values unchanged → delete col G |
| 14 | **Enable worker (ingest only)** | Not started | `ENABLE_SHEET_OFFLOAD=true`, `ENABLE_SHEET_DELETION=false` — watch via monitoring page |
| 15 | **Verify for 1-2 weeks** | Not started | Monitor balance crosscheck, spot-check SKUs, run reconciliation |

### Phase 1 (Balance Push)

| # | Task | Status |
|---|------|--------|
| 11 | Build balance push worker (ERP → col F) | Not started |
| 12 | Decide push frequency (periodic vs on-change) | Not decided |

### Phase 2 (Migration)

| # | Task | Status |
|---|------|--------|
| 13 | Add order reconciliation to monitoring page | Not started |
| 14 | Improve ERP inward UI for team adoption | Not started |
| 15 | ERP outward on order dispatch | Not started |
| 16 | ERP clean-up: deprecate redundant features | Not started |

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
| **Sheet Offload Worker** | Ingest sheet data to ERP | **KEEP** | This IS the hybrid bridge |
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

### Phase 1: Build — COMPLETED (2026-02-07)

| Component | Status | Files |
|-----------|--------|-------|
| Prisma migration (5 fields) | Done | `prisma/schema.prisma`, `prisma/migrations/20260207_add_sheet_metadata_fields/` |
| Config: Mastersheet Outward + mappings | Done | `server/src/config/sync/sheets.ts`, `server/src/config/sync/index.ts` |
| Worker: Phase A metadata | Done | `server/src/services/sheetOffloadWorker.ts` (ParsedInwardRow + txnData) |
| Worker: Phase B Mastersheet Outward | Done | `server/src/services/sheetOffloadWorker.ts` (new Mastersheet block) |
| Worker: dynamic outward reason | Done | `server/src/services/sheetOffloadWorker.ts` (mapDestinationToReason) |
| Worker: status extension | Done | `server/src/services/sheetOffloadWorker.ts` (recentRuns, sheetRowCounts, ingestedCounts) |
| Backup script | Done | `server/scripts/backup-sheets.ts` |
| Restore script | Done | `server/scripts/restore-sheets.ts` |
| Formula verification script | Done | `server/scripts/setup-balance-formula.ts` |
| Monitoring (OffloadMonitor) | Done | `client/src/components/settings/tabs/SheetSyncTab.tsx` |
| Admin trigger enum | Done | `client/src/server/functions/admin.ts` |
| Admin stats (recentRuns) | Done | `server/src/routes/admin.ts` |
| TypeScript check | Pass | Both client and server |

**Next**: Phase 2 — Go-Live (run migration, take backup, test offload worker)
