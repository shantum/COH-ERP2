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
- `orderViews.ts` - View configs (~1150 lines)

### Data Model
- Each row = one order line (server-flattened)
- `isFirstLine` marks header row for grouping
- Line status: `pending → allocated → picked → packed → shipped`

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
  utils/orderHelpers.ts               # flattenOrders, enrichRowsWithInventory
  tests/orders-production.spec.ts     # E2E tests

server/src/
  utils/orderViews.ts                 # VIEW_CONFIGS with where/orderBy/enrichments
  utils/queryPatterns.ts              # ORDER_UNIFIED_SELECT, accessors
  utils/dateHelpers.ts                # Safe Date-to-string conversions
  services/inventoryBalanceCache.ts   # Inventory cache singleton
  services/customerStatsCache.ts      # Customer stats cache singleton
  trpc/routers/orders.ts              # tRPC procedures
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

