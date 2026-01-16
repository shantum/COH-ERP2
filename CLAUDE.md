# CLAUDE.md

## Core Principles

1. **Simplicity above all.** Remove bloat. Reduce → Perfect → Repeat.
2. **First principles.** Reason from fundamentals, solve efficiently.
3. **Living memory.** Update this file with learnings/mistakes as you work. Top priority.
4. **Document as you go.** Comment undocumented code when you encounter it.
5. **Use agents liberally.** Spawn sub-agents for parallel/complex work. Don't do everything yourself.

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

## Orders Architecture

### Overview
Single page `/orders` with dropdown selector: Open, Shipped, RTO, COD Pending, Archived, Cancelled

**Key files**:
- `Orders.tsx` - Page orchestrator (750 lines)
- `OrdersGrid.tsx` - Grid orchestrator (538 lines)
- `ordersGrid/columns/` - 6 modular column files
- `server/src/utils/orderViews.ts` - View configs

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

**Release buttons** appear in Open view when orders are fully shipped/cancelled. User clicks to move to destination view.

### Column Architecture (Modular)
Columns split into 6 files in `ordersGrid/columns/`:
- `orderInfoColumns.tsx` - orderDate, orderNumber, customerName, etc.
- `paymentColumns.tsx` - discountCode, paymentMethod, customerLtv, etc.
- `lineItemColumns.tsx` - skuCode, productName, qty, skuStock, etc.
- `fulfillmentColumns.tsx` - allocate, pick, pack, ship, cancelLine
- `trackingColumns.tsx` - shopifyStatus, awb, courier, trackingStatus
- `postShipColumns.tsx` - shippedAt, deliveredAt, daysInTransit, rtoStatus

All columns receive `ColumnBuilderContext` with handlers and UI state.

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

### Performance Patterns
```typescript
// Inventory enrichment uses cached Maps (rebuild only if reference changes)
enrichRowsWithInventory(rows, inventoryBalance, fabricBalance)

// Maps are O(1) lookup, only rebuilt when data changes
const skuStock = inventoryMap.get(row.skuId) ?? 0
```

## Inventory

- **Balance**: `SUM(inward) - SUM(outward)`
- **Allocate**: Creates OUTWARD immediately (no RESERVED type)
- Balance can be negative (data integrity) - use `allowNegative` option

## Before Commit

```bash
cd client && npm run build && cd ../server && npx tsc --noEmit
```

## Gotchas

1. Router: specific routes before parameterized (`:id`)
2. Wrap async routes with `asyncHandler()`
3. Mutations must invalidate TanStack Query + tRPC
4. AG-Grid cellRenderer: return JSX, not strings
5. `shopifyCache.rawData` excluded from queries—use specific fields
6. Shopify fields (discountCode, customerNotes) live in `shopifyCache`, NOT on Order
7. Use pre-computed line fields (O(1)) instead of `orderLines.find()` (O(n))
8. View filters: shipped/cancelled orders stay in Open until user clicks Release

## Key Files

```
client/src/
  pages/Orders.tsx                    # Main page orchestrator
  components/orders/
    OrdersGrid.tsx                    # Grid component
    ordersGrid/columns/index.tsx      # Column builder
    ordersGrid/types.ts               # ColumnBuilderContext
  utils/orderHelpers.ts               # flattenOrders, enrichRowsWithInventory

server/src/
  utils/orderViews.ts                 # VIEW_CONFIGS with where/orderBy/enrichments
  utils/queryPatterns.ts              # ORDER_UNIFIED_SELECT, accessors
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
- Exploring codebase ("where is X handled?") → `Explore` agent
- Multi-file searches when unsure of location → `general-purpose` agent
- Complex implementations → `elite-engineer` or `fullstack-erp-engineer`
- Logic verification after changes → `logic-auditor`
- Documentation updates → `doc-optimizer` or `codebase-steward`
- Planning complex features → `Plan` agent

**Run in parallel when possible:** Launch multiple agents simultaneously for independent tasks.

**Don't use agents for:** Simple file reads, single grep, quick edits—do those directly.
