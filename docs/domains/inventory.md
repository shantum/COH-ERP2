# Inventory Domain

> SKU inventory ledger with transaction-based balance calculation.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/inventory/` (modular) |
| Page | `pages/InwardHub.tsx` (67 lines, mode orchestrator only) |
| Components | `components/inward/*.tsx` (10 modular components) |
| Related | Orders (reserved/sales), Production (inward), Returns (RTO inward) |

## Route Structure

```
routes/inventory/
├── index.ts        # Router composition
├── types.ts        # Shared types, helpers
├── balance.ts      # Balance queries, stock alerts
├── pending.ts      # Inward hub, pending queues, RTO processing
└── transactions.ts # Inward/outward operations
```

## InwardHub Architecture

Refactored from 2000+ line monolith to modular components. Each mode is self-contained with own scan handling, queue management, transaction creation, and UI state.

**Layout**: `ModeSelector` → `InwardModeHeader` + `[Mode]Inward` + `PendingQueuePanel` + `RecentInwardsTable`

**Shared pattern across all modes**: Scanner input → lookup → queue → process

| Component | Purpose |
|-----------|---------|
| `ModeSelector.tsx` | Mode selection UI (production, rto, returns, repacking, adjustments) |
| `InwardModeHeader.tsx` | Header with mode info and context |
| `PendingQueuePanel.tsx` | Pending items queue for current mode |
| `RecentInwardsTable.tsx` | Recent transactions table filtered by mode |
| `ProductionInward.tsx` | Production batch completion workflow |
| `RtoInward.tsx` | RTO processing with condition handling (good/damaged) |
| `ReturnsInward.tsx` | Customer returns processing |
| `RepackingInward.tsx` | Repacking workflow from QC queue |
| `AdjustmentsInward.tsx` | Manual stock adjustments (any SKU) |

## Inward Hub Modes

| Mode | Source | Validation | Action |
|------|--------|------------|--------|
| Production | `production` | Must match pending batch | Creates inward |
| Returns | `returns` | Must match return ticket | Sends to QC queue |
| RTO | `rto` | Must match RTO order line | Inward (good) or write-off |
| Repacking | `repacking` | Must match QC queue item | Inward (ready) or write-off |
| Adjustments | `adjustments` | Any valid SKU | Manual stock adjustment |

## Balance Formula

```javascript
Balance = SUM(inward) - SUM(outward)
Available = Balance - SUM(reserved)
```

## Transaction Types

| Type | When Created | Reason Values |
|------|--------------|---------------|
| `inward` | Production complete, RTO good, return receipt | production, return_receipt, adjustment |
| `outward` | Order shipped | sale, damage, adjustment |
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
