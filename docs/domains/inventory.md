# Inventory Domain

> SKU inventory ledger with transaction-based balance calculation.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/inventory/` (modular) |
| Pages | `Inventory.tsx` (SKU lookup), `InventoryInward.tsx` (scan-first), `ReturnsRto.tsx` (scan-first) |
| Components | `components/inward/*.tsx` (9 modular components) |
| Related | Orders (reserved/sales), Production (inward), Returns (RTO inward) |

## Frontend Pages

| Page | Route | Purpose |
|------|-------|---------|
| **Inventory** | `/inventory` | Fast SKU lookup with stock filters (In Stock, Low Stock, Out of Stock) |
| **Inventory Inward** | `/inventory-inward` | Scan-first workflow for Production and Adjustments |
| **Returns & RTO** | `/returns-rto` | Scan-first workflow for Returns, RTO, Repacking |
| ~~InwardHub~~ | ~~`/inward-hub`~~ | **@deprecated** - redirects to `/inventory-inward` |

### Inventory Page Details

**Purpose**: Fast SKU lookup optimized for finding stock levels quickly. Simpler than Catalog page.

**Data Sources**:
- `trpc.inventory.getAllBalances` - Fetches all SKU balances (limit: 10000)
- `/reports/top-products` - REST endpoint for demand analytics

**Features**:
1. **Stats Cards**: Total Pcs, SKUs, In Stock, Low Stock, Out of Stock counts
2. **Client-side Search**: AG-Grid quick filter with 200ms debounce
3. **Stock Filters**: Buttons for All | In Stock | Low Stock | Out of Stock
4. **Analytics Section** (collapsible, minimized by default):
   - **Most Stocked Products**: Client-side aggregation by productId with color breakdown
   - **Highest Demand**: Top 5 products by units sold (14/30/60/90 day periods)

**Key Patterns**:
- **Map-based aggregation**: Builds `Map<productId, ProductStock>` for O(1) lookups during aggregation
- **Dynamic grid height**: `calc(100vh - 580px)` when expanded, `calc(100vh - 340px)` when collapsed
- **Mixed data sources**: tRPC for inventory balances + REST for demand data
- **Auto-focus**: Search input focused on page load via `useRef` + `useEffect`

**Performance**:
- Client-side filtering (no server round-trip)
- Pagination: 100 rows/page default (50/100/200/500 options)
- Cache: `staleTime: 60000` for demand data

## Route Structure

```
routes/inventory/
├── index.ts         # Router composition
├── types.ts         # Type definitions (RtoCondition, PendingSource, etc.)
├── balance.ts       # Balance queries, stock alerts
├── pending.ts       # Inward hub, pending queues, RTO processing
└── transactions.ts  # Inward/outward operations
```

## Scan-First Workflow (New)

Replaces the old mode-selection workflow. Optimized for warehouse speed.

**Flow**:
1. Scan SKU barcode -> instant inward as "received" (unallocated)
2. Item appears in Recent Inwards table
3. User assigns source later (Production/RTO/Return/Adjustment) via allocation modal

**API Endpoints** (in `routes/inventory/pending.ts`):
| Endpoint | Purpose |
|----------|---------|
| `POST /instant-inward` | Creates immediate inward transaction, no forms |
| `GET /transaction-matches/:id` | Returns allocation options for a transaction |
| `POST /allocate-transaction` | Links transaction to production job, RTO order, or marks as adjustment |

**Why Scan-First?**
- No mode selection = fewer clicks
- Immediate feedback = warehouse workers know scan registered
- Allocation can happen in batch later by admin
- Handles edge cases (wrong mode selected) gracefully

## Legacy InwardHub Architecture

> **@deprecated**: Old mode-selection workflow. Kept in `InwardHub.tsx` for reference.

Each mode was self-contained with own scan handling, queue management, transaction creation, and UI state.

**Layout**: `ModeSelector` → `InwardModeHeader` + `[Mode]Inward` + `PendingQueuePanel` + `RecentInwardsTable`

| Component | Purpose |
|-----------|---------|
| `ModeSelector.tsx` | Mode selection UI (production, rto, returns, repacking, adjustments) |
| `InwardModeHeader.tsx` | Header with mode info and context |
| `PendingQueuePanel.tsx` | Pending items queue for current mode |
| `RecentInwardsTable.tsx` | Recent transactions table filtered by mode |
| `ProductionInward.tsx` | Production batch completion workflow |
| `RtoInward.tsx` | RTO processing with condition handling (good/unopened/damaged/wrong_product) |
| `ReturnsInward.tsx` | Customer returns processing |
| `RepackingInward.tsx` | Repacking workflow from QC queue |
| `AdjustmentsInward.tsx` | Manual stock adjustments (any SKU) |

**Exports**: `components/inward/index.ts` re-exports all components + `InwardMode` type.

## Inward Source Types

| Source | When Used | Validation |
|--------|-----------|------------|
| `production` | Production batch completion | Links to production job |
| `rto` | RTO order received back | Links to RTO order line |
| `return` | Customer return received | Links to return ticket |
| `repacking` | Item repacked after QC | Links to QC queue item |
| `adjustment` | Manual stock correction | No external link required |
| `received` | Scan-first unallocated | Pending allocation |

## Balance Formula

```javascript
Balance = SUM(inward) - SUM(outward)
Available = Balance - SUM(reserved)
```

## Transaction Types

Defined in `utils/queryPatterns.ts` as `TXN_TYPE` and `TXN_REASON`.

| Type | When Created | Reason Values |
|------|--------------|---------------|
| `inward` | Production complete, RTO good, return receipt | production, return_receipt, rto_received, adjustment |
| `outward` | Order shipped, damage, write-off | sale, damage, adjustment, transfer, write_off |
| `reserved` | Order allocated | order_allocation |

## RTO Inward Conditions

| Condition | Action |
|-----------|--------|
| `good`, `unopened` | Creates inward transaction (+stock) |
| `damaged`, `wrong_product` | Creates WriteOffLog (no stock) |

## Key Endpoints

| Path | Purpose |
|------|---------|
| `GET /balance` | All SKU balances (use for dashboard) |
| `POST /inward`, `/outward` | Create transactions |
| `POST /rto-inward-line` | Per-line RTO with condition |
| `GET /pending-queue/:source` | Queue by source (production, returns, rto, repacking) |
| `GET /recent-inwards?source=` | Filtered by mode (production, returns, rto, repacking, adjustments) |
| `POST /scan-lookup` | SKU lookup with pending matches for all sources |

## Cross-Domain

- **← Orders**: Allocation creates reserved; shipping creates outward
- **← Production**: Batch completion creates inward
- **← Returns**: RTO inward (good/unopened) or write-off (damaged)

## Gotchas

1. **Reserved not in balance**: Reserved only affects available, not total balance
2. **Per-line RTO**: Use `/rto-inward-line` with condition per line, not per order
3. **Batch calculations**: Use `calculateAllInventoryBalances()` for lists, not N+1 queries
4. **Map caching**: Use `getInventoryMap()` for O(1) lookups in loops
5. **Unallocated skip**: Lines without `allocatedAt` don't create inventory txn on ship
6. **Mode validation**: Each inward mode only accepts scans matching its source queue
7. **Source filter mapping**: `returns` → `return_receipt`, `rto` → `rto_received`, `repacking` → `repack_complete`
8. **Cache invalidation required**: `inventoryBalanceCache` (5-min staleness) must be manually invalidated after direct `prisma.inventoryTransaction.create()` calls. Use `inventoryBalanceCache.invalidate([skuId])`. The `queryPatterns.ts` helpers (`createReservedTransaction`, `createSaleTransaction`, `releaseReservedInventory`) already handle this - only direct Prisma calls need manual invalidation.
9. **Scan-first vs mode-selection**: `/inventory-inward` and `/returns-rto` use scan-first (faster); old `InwardHub` used mode-selection (deprecated)
10. **Instant inward unallocated**: `POST /instant-inward` creates transactions with source='received' - must be allocated later
11. **Inventory page filters**: Client-side filtering via AG-Grid quick filter + stock status buttons (all/in_stock/low_stock/out_of_stock)
12. **Analytics aggregation**: Use Map for O(1) product lookups during color breakdown aggregation (pattern in `Inventory.tsx` lines 111-149)
13. **Collapsible sections**: Dynamic grid height based on expanded state prevents layout shift
