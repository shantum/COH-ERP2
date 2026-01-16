# CLAUDE.md

## Core Principles

1. **Simplicity above all.** Remove bloat. Reduce → Perfect → Repeat.
2. **First principles.** Reason from fundamentals, solve efficiently.
3. **Living memory.** Update this file with learnings/mistakes as you work.
4. **Document as you go.** Comment undocumented code when you encounter it.
5. **Use agents liberally.** Spawn sub-agents for parallel/complex work.

## Quick Start

```bash
cd server && npm run dev    # Port 3001
cd client && npm run dev    # Port 5173
npm run db:generate && npm run db:push
```

Login: `admin@coh.com` / `XOFiya@34`

## Stack

- **Backend**: Express + tRPC + Prisma + PostgreSQL
- **Frontend**: React 19 + TanStack Query + AG-Grid + Tailwind
- **Integrations**: Shopify (orders), iThink Logistics (tracking)
- **Testing**: Playwright (E2E)

## Orders Architecture

### Overview
Single page `/orders` with dropdown selector. Views: Open, Shipped, RTO, COD Pending, Archived, Cancelled.

**Key files**:
- `Orders.tsx` - Page orchestrator (~755 lines)
- `OrdersGrid.tsx` - Grid component (~538 lines)
- `ordersGrid/columns/` - 6 modular column files
- `orderViews.ts` - View configs (~940 lines)
- `orderEnrichment/` - Enrichment pipeline (9 modular files)

### Data Model
- Each row = one order line (server-flattened)
- `isFirstLine` marks header row for grouping
- Line status: `pending → allocated → picked → packed → shipped`

### Line Status State Machine

Single source of truth: `server/src/utils/orderStateMachine.ts`

```
Status Flow:
pending → allocated → picked → packed → shipped
   ↓         ↓          ↓        ↓
cancelled cancelled  cancelled cancelled
   ↓
pending (uncancel)
```

**Key functions:**
```typescript
import {
    isValidTransition,      // Check if transition is valid
    executeTransition,      // Execute with all side effects
    hasAllocatedInventory,  // Check if status has reserved inventory
    buildTransitionError,   // Build error message
} from '../utils/orderStateMachine.js';

// Always use executeTransition inside a transaction
const result = await prisma.$transaction(async (tx) => {
    return executeTransition(tx, currentStatus, newStatus, {
        lineId, skuId, qty, userId, shipData
    });
});
```

**Inventory effects (handled automatically by `executeTransition`):**
| Transition | Effect |
|------------|--------|
| pending → allocated | Create OUTWARD transaction |
| allocated → pending (unallocate) | Delete OUTWARD transaction |
| allocated/picked/packed → cancelled | Delete OUTWARD transaction |

### Views & Release Workflow
| View | Condition |
|------|-----------|
| Open | Active orders OR shipped/cancelled but not released |
| Shipped | All lines shipped AND `releasedToShipped=true` |
| Cancelled | All lines cancelled AND `releasedToCancelled=true` |
| RTO | RTO in transit or delivered |
| COD Pending | COD awaiting remittance |
| Archived | `isArchived=true` |

**Release buttons** appear in Open view when orders are fully shipped/cancelled.

### Column Architecture
Columns in `ordersGrid/columns/`:
- `orderInfoColumns.tsx` - orderDate, orderNumber, customerName
- `paymentColumns.tsx` - discountCode, paymentMethod, customerLtv
- `lineItemColumns.tsx` - skuCode, productName, qty, skuStock
- `fulfillmentColumns.tsx` - allocate, pick, pack, ship, cancelLine
- `trackingColumns.tsx` - shopifyStatus, awb, courier, trackingStatus
- `postShipColumns.tsx` - shippedAt, deliveredAt, daysInTransit, rtoStatus

### Data Access Patterns
```typescript
// Line-level fields are PRE-COMPUTED (O(1)) - use directly
p.data?.lineShippedAt
p.data?.lineDeliveredAt
p.data?.daysInTransit

// Order-level fields via nested object
p.data?.order?.orderNumber
p.data?.shopifyCache?.discountCodes
```

**Data sources**:
- `shopifyCache.*` - Shopify fields (NEVER use rawData)
- `order.trackingStatus` - iThink logistics (not Shopify)
- Pre-computed: `lineShippedAt`, `lineDeliveredAt`, `lineTrackingStatus`, `daysInTransit`, `rtoStatus`

## Caching Architecture

### Server-Side Caches
Two singleton in-memory caches for performance:

| Cache | TTL | Location | Invalidation |
|-------|-----|----------|--------------|
| `inventoryBalanceCache` | 5 min | `services/inventoryBalanceCache.ts` | After inventory transactions |
| `customerStatsCache` | 2 min | `services/customerStatsCache.ts` | After order create/cancel/RTO |

**Pattern**:
```typescript
import { inventoryBalanceCache } from './inventoryBalanceCache';
import { customerStatsCache } from './customerStatsCache';

// Get (batch fetch, auto-caches)
const balances = await inventoryBalanceCache.get(prisma, skuIds);
const stats = await customerStatsCache.get(prisma, customerIds);

// Invalidate after mutations (CRITICAL)
inventoryBalanceCache.invalidate(affectedSkuIds);
customerStatsCache.invalidate(affectedCustomerIds);

// Clear all (bulk operations)
inventoryBalanceCache.invalidateAll();
```

### Client-Side Enrichment
```typescript
// Inventory enrichment uses cached Maps (O(1) lookup)
enrichRowsWithInventory(rows, inventoryBalance, fabricBalance)
```

## Inventory

- **Balance**: `SUM(inward) - SUM(outward)`
- **Allocate**: Creates OUTWARD immediately (no RESERVED type)
- Balance can be negative (data integrity) - use `allowNegative` option

## Testing

### E2E Tests (Playwright)
```bash
cd client && npx playwright test
```

Config: `client/playwright.config.ts`
Tests: `client/tests/orders-production.spec.ts`

Environment variables:
- `TEST_URL` - Base URL (default: http://localhost:5173)
- `RECORD_HAR=true` - Record network HAR files

### Build Verification
```bash
cd client && npm run build && cd ../server && npx tsc --noEmit
```

## tRPC Orders Router

The orders tRPC router (`server/src/trpc/routers/orders.ts`) provides type-safe procedures:

| Procedure | Type | Purpose |
|-----------|------|---------|
| `list` | Query | View-based order listing with server-side flattening |
| `get` | Query | Single order by ID |
| `create` | Mutation | Create new order |
| `allocate` | Mutation | Batch allocate lines (reserve inventory) |
| `ship` | Mutation | Ship lines with AWB/courier |
| `markPaid` | Mutation | Mark order payment as paid |
| `setLineStatus` | Mutation | Unified line status transitions |
| `cancelOrder` | Mutation | Cancel order with inventory release |
| `uncancelOrder` | Mutation | Restore cancelled order |
| `markDelivered` | Mutation | Mark shipped order as delivered |
| `markRto` | Mutation | Initiate RTO for shipped order |
| `receiveRto` | Mutation | Receive RTO, restore inventory |

**Client usage** - Mutations split into focused hooks (`hooks/orders/`):
```typescript
// Facade hook (backward compatible) - composes all sub-hooks
const mutations = useOrdersMutations();
mutations.pickLine.mutate(lineId);

// Or import focused hooks directly for better tree-shaking
import { useOrderWorkflowMutations } from './hooks/orders';
const { allocate, pickLine, packLine } = useOrderWorkflowMutations();
```

### Client Mutation Hooks (`hooks/orders/`)
| Hook | Mutations |
|------|-----------|
| `useOrderWorkflowMutations` | allocate, unallocate, pickLine, unpickLine, packLine, unpackLine |
| `useOrderShipMutations` | ship, shipLines, forceShip, unship, markShippedLine, unmarkShippedLine, updateLineTracking |
| `useOrderCrudMutations` | createOrder, updateOrder, deleteOrder, updateOrderNotes, updateLineNotes, updateShipByDate |
| `useOrderStatusMutations` | cancelOrder, uncancelOrder, cancelLine, uncancelLine |
| `useOrderDeliveryMutations` | markDelivered, markRto, receiveRto |
| `useOrderLineMutations` | updateLine, addLine, customizeLine, removeCustomization |
| `useOrderReleaseMutations` | releaseToShipped, releaseToCancelled, migrateShopifyFulfilled |
| `useProductionBatchMutations` | createBatch, updateBatch, deleteBatch |
| `useOrderInvalidation` | invalidateOpenOrders, invalidateShippedOrders, invalidateAll, etc. |

## Gotchas

1. Router: specific routes before parameterized (`:id`)
2. Wrap async routes with `asyncHandler()`
3. Mutations must invalidate TanStack Query + tRPC + server caches
4. AG-Grid cellRenderer: return JSX, not strings
5. `shopifyCache.rawData` excluded from queries—use specific fields
6. Shopify fields live in `shopifyCache`, NOT on Order
7. Use pre-computed line fields (O(1)) instead of `orderLines.find()` (O(n))
8. View filters: shipped/cancelled orders stay in Open until Release clicked
9. **ALWAYS invalidate caches after mutations** - stale reads cause bugs
10. **Prisma returns Date objects**, not strings—use `toDateString()` from `utils/dateHelpers.ts`
11. **Use `127.0.0.1` not `localhost`** in dev—IPv6 resolution causes silent failures
12. **tRPC query params**: Never use `prop: undefined`, use spread `...(val ? {prop: val} : {})`
13. **SSE cache updates**: Prefer `invalidate()` over `setData()` for resilient key matching

## Key Files

```
client/src/
  pages/Orders.tsx                    # Main page orchestrator
  components/orders/
    OrdersGrid.tsx                    # Grid component
    ordersGrid/columns/index.tsx      # Column builder
    ordersGrid/types.ts               # ColumnBuilderContext
  hooks/
    useOrdersMutations.ts             # Facade composing all mutation hooks
    orders/                           # Focused mutation hooks (decomposed)
      index.ts                        # Barrel export
      orderMutationUtils.ts           # Shared invalidation helpers
      useOrderWorkflowMutations.ts    # allocate/pick/pack workflow
      useOrderShipMutations.ts        # ship operations
      useOrderCrudMutations.ts        # create/update/delete
      useOrderStatusMutations.ts      # cancel/uncancel
      useOrderDeliveryMutations.ts    # delivery tracking
      useOrderLineMutations.ts        # line ops + customization
      useOrderReleaseMutations.ts     # release workflows
      useProductionBatchMutations.ts  # production batches
  utils/orderHelpers.ts               # flattenOrders, enrichRowsWithInventory
  tests/orders-production.spec.ts     # E2E tests

server/src/
  routes/orders/
    mutations/                        # Order mutations (decomposed)
      index.ts                        # Barrel export + router combiner
      crud.ts                         # create, update, delete
      lifecycle.ts                    # cancel, uncancel, hold, release
      archive.ts                      # archive, unarchive, autoArchive, release workflow
      lineOps.ts                      # line-level operations
      customization.ts                # custom SKU workflow
    queries/                          # Order queries (decomposed)
      index.ts                        # Barrel export + router combiner
      views.ts                        # GET /, GET /:id
      search.ts                       # GET /search-all
      summaries.ts                    # RTO, shipped, archived summaries
      analytics.ts                    # /analytics, /dashboard-stats
  utils/
    orderStateMachine.ts              # Line status state machine (single source of truth)
    orderViews.ts                     # VIEW_CONFIGS with where/orderBy/flattening
    orderEnrichment/                  # Order enrichment pipeline (modular)
      index.ts                        # Pipeline orchestrator + exports
      types.ts                        # EnrichmentType, EnrichedOrder
      fulfillmentStage.ts             # calculateFulfillmentStage()
      lineStatusCounts.ts             # calculateLineStatusCounts()
      customerStats.ts                # enrichOrdersWithCustomerStats()
      trackingStatus.ts               # determineTrackingStatus(), calculateDaysSince()
      shopifyTracking.ts              # extractShopifyTrackingFields()
      addressResolution.ts            # enrichOrderLinesWithAddresses()
      rtoStatus.ts                    # calculateRtoStatus()
    queryPatterns.ts                  # Re-export barrel for patterns/
    patterns/                         # Query patterns (decomposed)
      index.ts                        # Barrel export
      types.ts                        # Types + constants (TXN_TYPE, TXN_REASON)
      orderSelects.ts                 # ORDER_LIST_SELECT, ORDER_LINES_INCLUDE
      orderHelpers.ts                 # Re-exports from orderEnrichment, Shopify accessors
      inventory.ts                    # calculateInventoryBalance, fabric balance
      transactions.ts                 # allocation, sale, RTO transactions
      customization.ts                # createCustomSku, removeCustomization
    dateHelpers.ts                    # Safe Date-to-string conversions
  services/
    inventoryBalanceCache.ts          # Inventory cache singleton
    customerStatsCache.ts             # Customer stats cache singleton
  trpc/routers/orders.ts              # tRPC procedures (12 total)
    # Queries: list, get
    # Mutations: create, allocate, ship, markPaid, setLineStatus,
    #            cancelOrder, uncancelOrder, markDelivered, markRto, receiveRto
  scripts/                            # One-time migration scripts
```

## Scripts (One-Time Operations)

Located at `server/src/scripts/`:
- `backfillLineItemsJson.ts` - Extract line items from rawData
- `backfillCustomerTags.ts` - Bulk tag customers
- `cancelTaggedOrders.ts` - Cancel orders by tag
- `fixShippedAtDates.ts` - Correct shippedAt dates
- `markOldPrepaidShipped.ts` - Mark old prepaid as shipped
- `releaseExchangeOrders.ts` - Release exchange orders

Run with: `npx ts-node src/scripts/scriptName.ts`

## Environment

`.env`: `DATABASE_URL`, `JWT_SECRET`

**Deployment**: Railway. Use `railway` CLI to connect/manage.

## When to Use Agents

**Use sub-agents for:**
- Exploring codebase → `Explore` agent
- Multi-file searches → `general-purpose` agent
- Complex implementations → `elite-engineer` or `fullstack-erp-engineer`
- Logic verification → `logic-auditor`
- Documentation updates → `doc-optimizer` or `codebase-steward`
- Planning complex features → `Plan` agent

