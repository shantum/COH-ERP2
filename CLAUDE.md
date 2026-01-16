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
- **Testing**: Playwright (E2E) - `cd client && npx playwright test`

## Gotchas (Read First!)

1. **Router order**: specific routes before parameterized (`:id`)
2. **Async routes**: wrap with `asyncHandler()`
3. **Cache invalidation**: mutations MUST invalidate TanStack Query + tRPC + server caches
4. **AG-Grid cellRenderer**: return JSX, not strings
5. **Shopify data**: lives in `shopifyCache.*`, NEVER use `rawData`
6. **Line fields**: use pre-computed O(1) fields (`lineShippedAt`, `daysInTransit`), not `orderLines.find()` O(n)
7. **View filters**: shipped/cancelled orders stay in Open until Release clicked
8. **Prisma dates**: returns Date objects—use `toDateString()` from `utils/dateHelpers.ts`
9. **Dev URLs**: use `127.0.0.1` not `localhost`—IPv6 causes silent failures
10. **tRPC params**: never `prop: undefined`, use spread `...(val ? {prop: val} : {})`
11. **SSE updates**: prefer `invalidate()` over `setData()` for resilient key matching

## Orders Architecture

### Data Model
- Single page `/orders` with dropdown selector
- Views: Open, Shipped, RTO, COD Pending, Archived, Cancelled
- Each row = one order line (server-flattened), `isFirstLine` marks header for grouping

### Line Status State Machine

Source of truth: `server/src/utils/orderStateMachine.ts`

```
pending → allocated → picked → packed → shipped
   ↓         ↓          ↓        ↓
cancelled cancelled  cancelled cancelled
   ↓
pending (uncancel)
```

```typescript
// Always use executeTransition inside a transaction
await prisma.$transaction(tx =>
    executeTransition(tx, currentStatus, newStatus, { lineId, skuId, qty, userId, shipData })
);
```

**Inventory effects** (automatic):
- `pending → allocated`: Create OUTWARD transaction
- `allocated → pending`: Delete OUTWARD transaction
- `allocated/picked/packed → cancelled`: Delete OUTWARD transaction

### Views & Release Workflow

| View | Condition |
|------|-----------|
| Open | Active orders OR shipped/cancelled but not released |
| Shipped | All lines shipped AND `releasedToShipped=true` |
| Cancelled | All lines cancelled AND `releasedToCancelled=true` |
| RTO | RTO in transit or delivered |
| COD Pending | COD awaiting remittance |
| Archived | `isArchived=true` |

### Data Access Patterns
```typescript
// Line-level (PRE-COMPUTED O(1)) - use directly
p.data?.lineShippedAt, p.data?.daysInTransit, p.data?.rtoStatus

// Order-level via nested object
p.data?.order?.orderNumber, p.data?.shopifyCache?.discountCodes
```

## Caching

### Server-Side Caches
| Cache | TTL | Location |
|-------|-----|----------|
| `inventoryBalanceCache` | 5 min | `services/inventoryBalanceCache.ts` |
| `customerStatsCache` | 2 min | `services/customerStatsCache.ts` |

```typescript
// Get (batch fetch, auto-caches)
const balances = await inventoryBalanceCache.get(prisma, skuIds);

// CRITICAL: Invalidate after mutations
inventoryBalanceCache.invalidate(affectedSkuIds);
inventoryBalanceCache.invalidateAll(); // bulk ops
```

### Inventory
- **Balance**: `SUM(inward) - SUM(outward)`
- **Allocate**: Creates OUTWARD immediately (no RESERVED type)
- Balance can be negative (data integrity) - use `allowNegative` option

## tRPC & API

**Client exclusively uses tRPC** - all client code calls tRPC, not REST.

### tRPC Procedures (`server/src/trpc/routers/orders.ts`)
- **Queries**: `list`, `get`
- **Mutations**: `create`, `allocate`, `ship`, `markPaid`, `setLineStatus`, `cancelOrder`, `uncancelOrder`, `markDelivered`, `markRto`, `receiveRto`

### Client Mutation Hooks (`hooks/orders/`)
```typescript
// Facade (backward compatible)
const mutations = useOrdersMutations();
mutations.pickLine.mutate(lineId);

// Or focused hooks for tree-shaking
import { useOrderWorkflowMutations } from './hooks/orders';
```

| Hook | Purpose |
|------|---------|
| `useOrderWorkflowMutations` | allocate/pick/pack (has optimistic updates) |
| `useOrderShipMutations` | ship/unship/tracking |
| `useOrderCrudMutations` | create/update/delete/notes |
| `useOrderStatusMutations` | cancel/uncancel (has optimistic updates) |
| `useOrderDeliveryMutations` | delivered/RTO |
| `useOrderLineMutations` | line ops + customization |
| `useOrderReleaseMutations` | release workflows |

### Optimistic Updates
```typescript
const mutations = useOrdersMutations({ currentView: view, page, shippedFilter });
// onMutate → snapshot + optimistic update
// onError → rollback
// onSettled → background revalidation
```

## Shopify Order Processor

Source of truth: `server/src/services/shopifyOrderProcessor.ts`

**Entry points:**
- `processShopifyOrderToERP()` - Webhooks (DB-based SKU lookup)
- `processOrderWithContext()` - Batch (Map-based O(1) lookup)

**Status precedence:** ERP is source of truth for `shipped`/`delivered`. Shopify captures tracking but does NOT auto-ship.

## Key Files

### Client
```
pages/Orders.tsx                      # Page orchestrator
components/orders/OrdersGrid.tsx      # Grid component
components/orders/ordersGrid/columns/ # 6 modular column files
hooks/useOrdersMutations.ts           # Facade composing all mutation hooks
hooks/useUnifiedOrdersData.ts         # Main data hook
hooks/orders/                         # Focused mutation hooks
utils/orderHelpers.ts                 # flattenOrders, enrichRowsWithInventory
```

### Server
```
routes/orders/mutations/              # crud, lifecycle, archive, lineOps, customization
routes/orders/queries/                # views, search, summaries, analytics
utils/orderStateMachine.ts            # Line status state machine
utils/orderViews.ts                   # VIEW_CONFIGS
utils/orderEnrichment/                # Enrichment pipeline (9 files)
utils/patterns/                       # Query patterns (inventory, transactions, etc.)
services/inventoryBalanceCache.ts     # Inventory cache
services/customerStatsCache.ts        # Customer stats cache
trpc/routers/orders.ts                # tRPC procedures
```

## Scripts

Located at `server/src/scripts/`. Run with: `npx ts-node src/scripts/scriptName.ts`

## Environment

`.env`: `DATABASE_URL`, `JWT_SECRET`
**Deployment**: Railway (`railway` CLI)

## When to Use Agents

- **Exploring codebase** → `Explore` agent
- **Multi-file searches** → `general-purpose` agent
- **Complex implementations** → `elite-engineer` or `fullstack-erp-engineer`
- **Logic verification** → `logic-auditor`
- **Documentation** → `doc-optimizer` or `codebase-steward`
- **Planning** → `Plan` agent
