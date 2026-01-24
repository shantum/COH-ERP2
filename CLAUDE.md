# CLAUDE.md

## Core Principles

1. **Simplicity above all.** Remove bloat. Reduce > Perfect > Repeat.
2. **First principles.** Reason from fundamentals, solve efficiently.
3. **Living memory.** Update this file with learnings/mistakes as you work.
4. **Document as you go.** Comment undocumented code when you encounter it.
5. **Use agents liberally.** Spawn sub-agents for parallel/complex work.
6. **Commit early, commit often.** Small, frequent commits. **Run `cd client && npx tsc -p tsconfig.app.json --noEmit && cd ../server && npx tsc --noEmit` before committing.**
7. **Separate config from code.** Magic numbers, thresholds, mappings > `/config/`.
8. **Clean architecture.** Dependencies point inward. Business logic independent of frameworks/UI/DB.
9. **Build for the long term.** Maintainability over cleverness.
10. **Type-safe by default.** Strict TypeScript, Zod validation. No `any`, no shortcuts.

## Quick Start

```bash
cd server && npm run dev    # Port 3001
cd client && npm run dev    # Port 5173
npm run db:generate && npm run db:push  # From root (Prisma at /prisma/)
```

Login: `admin@coh.com` / `XOFiya@34`

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TanStack Router/Query v5, AG-Grid, Tailwind, shadcn/ui |
| Backend | Express (auth/webhooks/SSE/uploads) + TanStack Server Functions |
| Database | PostgreSQL + Prisma ORM + Kysely (performance queries) |
| Real-time | SSE > TanStack Query invalidation |
| Validation | Zod at all boundaries |

**Data Flow**: Route Loaders > Server Functions > TanStack Query cache > SSE invalidation

```typescript
// Standard pattern: loader prefetch + TanStack Query
loader: async ({ search }) => getOrders({ data: search })

const { data } = useQuery({
  queryKey: ['orders', search],
  queryFn: () => getOrders({ data: search }),
  initialData: Route.useLoaderData(),
});
```

## Gotchas (Read First!)

### Data & Caching
| # | Rule |
|---|------|
| 1 | Server Functions in `client/src/server/functions/`. No tRPC. |
| 2 | Mutations MUST invalidate TanStack Query + server caches |
| 4 | Shopify data: `shopifyCache.*` only, NEVER `rawData` |
| 5 | Line fields: use pre-computed O(1) (`lineShippedAt`, `daysInTransit`), not `orderLines.find()` |
| 10 | Mutations return immediately; side effects run async via `deferredExecutor` |
| 16 | Page sizes: Open=500 (active), Shipped/Cancelled=100 (historical) |
| 37 | Query keys: `['domain', 'action', 'server-fn', params]`. Old tRPC format causes cache misses |
| 39 | Use `inventoryQueryKeys.balance` from `constants/queryKeys.ts` for inventory queries |

### Inventory (CRITICAL)
| # | Rule |
|---|------|
| 38 | Balance: use `txnType` column, NEVER `qty > 0`. OUTWARD stores POSITIVE qty with `txnType='outward'` |
| 44 | **Materialized Balance**: `Sku.currentBalance` and `FabricColour.currentBalance` are maintained by DB triggers. Read directly for O(1) lookups. |
| 45 | Triggers: `update_sku_balance()` for SKU, `update_fabric_colour_balance()` for fabric. Auto-update on INSERT/DELETE/UPDATE to transaction tables. |
| 46 | `currentBalance` is PROTECTED: Guard triggers block direct UPDATEs. Only create transactions (InventoryTransaction / FabricColourTransaction). |
| 47 | **Legacy Fabric system**: `Fabric` + `FabricTransaction` are deprecated. Use `FabricColour` + `FabricColourTransaction` for all new features. |

### TypeScript & Validation
| # | Rule |
|---|------|
| 9 | Zod params: never `prop: undefined`, use spread `...(val ? {prop: val} : {})` |
| 17 | TypeScript check BEFORE committing: `cd client && npx tsc -p tsconfig.app.json --noEmit && cd ../server && npx tsc --noEmit` |
| 29 | JWT roleId can be null: use `roleId: z.string().nullable().optional()` |
| 30 | Error typing: `catch (error: unknown)` with `instanceof Error` guard |
| 31 | Prisma typing: `InstanceType<typeof PrismaClient>`, transactions use `Omit<...>` |
| 32 | WHERE clause typing: `Prisma.OrderWhereInput` (or relevant model) |
| 33 | Express body: Zod `safeParse()`, not `req.body as SomeInterface` |

### Server Functions
| # | Rule |
|---|------|
| 26 | Cookies: `getCookie` from `@tanstack/react-start/server`, NOT `vinxi/http` |
| 27 | API calls: production uses `http://127.0.0.1:${PORT}`, not `localhost:3001` |
| 28 | Large payloads: `method: 'POST'` to avoid HTTP 431 header size error |
| 34 | CANNOT import from `@server/` path alias. Use `@coh/shared/services/db` |
| 35 | Use `getKysely()` and `getPrisma()` from `@coh/shared/services/db` |
| 36 | High-perf Kysely queries: `@coh/shared/services/db/queries` |

### SSR & Hydration
| # | Rule |
|---|------|
| 24 | Use `ClientOnly` for runtime-dependent UI (router state, `new Date()`). `typeof window !== 'undefined'` is NOT sufficient |

### Shared Package (CRITICAL)
| # | Rule |
|---|------|
| 43 | `@coh/shared/services/` MUST use dynamic imports only. Static `import { sql } from 'kysely'` BREAKS client bundling. Always: `const { sql } = await import('kysely')` |

### UI & Components
| # | Rule |
|---|------|
| 3 | AG-Grid cellRenderer: return JSX, not strings |
| 18 | TanStack Table trees: `getSubRows` for hierarchy, never mutate `children` |
| 21 | Cell components: modularize into `/cells/` directory |
| 22 | Master-detail: sync selection to URL params (`?tab=bom&id=123&type=product`) |
| 40 | Cell components MUST be wrapped with `React.memo()` |
| 41 | `cancelQueries()`: use specific queryKey, not broad keys like `['orders']` |
| 42 | Prefer `createMany()`/`updateMany()` over loops |

### Orders & Tracking
| # | Rule |
|---|------|
| 6 | Shipped/cancelled orders stay in Open until Release clicked |
| 11 | Delivery/RTO mutations are line-level; orders can have mixed states |
| 12 | Admin ship: `adminShip` mutation, requires admin role + `ENABLE_ADMIN_SHIP=true` |
| 13 | Tracking: TEXT patterns override codes; `cancel_status="Approved"` = cancelled; "UD" code unreliable |
| 14 | Shopify: syncs tracking ONLY; ERP is source of truth for `shipped` |
| 15 | Tracking sync excludes terminal statuses (`delivered`, `rto_delivered`) |

### Infrastructure
| # | Rule |
|---|------|
| 7 | Prisma dates return Date objects: use `toDateString()` from `utils/dateHelpers.ts` |
| 8 | Dev URLs: use `localhost` for API calls |
| 19 | Fabric hierarchy: DB enforces Material>Fabric>Colour. Variations link via `fabricColourId` |
| 20 | Inheritance: colours inherit cost/lead/minOrder from fabric if not set |
| 23 | Express routes: only auth, webhooks, SSE, file uploads. Everything else = Server Functions |
| 25 | Prisma schema at `/prisma/schema.prisma` (root). Run db commands from root |

## Type Safety

> **Zod is source of truth.** Define schemas in Zod, infer types with `z.infer<>`. Never write separate `interface`/`type`.

```typescript
// Error handling
} catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
}

// Prisma typing
type PrismaInstance = InstanceType<typeof PrismaClient>;
type PrismaTransaction = Omit<PrismaInstance, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// WHERE clause builders
function buildWhereClause(view: string): Prisma.OrderWhereInput { ... }
```

### TanStack Router Rules
- Search params: Zod schema in `shared/src/schemas/searchParams.ts`, use `z.coerce` for numbers/booleans
- File-based routing in `client/src/routes/`. Let generator handle route tree
- Auth: protected routes under `_authenticated` layout, use `beforeLoad` not `useEffect`
- Redirects: old URLs need redirect file in `_redirects/` folder

## Orders Architecture

### Data Model
- Single page `/orders` with dropdown: Open, Shipped, Cancelled
- Each row = one order line (server-flattened), `isFirstLine` marks header
- Shipped filters: All, RTO, COD Pending (via `shippedFilter` param)

### Tracking (Line-Level Only)

**OrderLine is ONLY source of truth.** Order-level tracking removed.

| Field | Notes |
|-------|-------|
| awbNumber, courier | Each line can have different AWB |
| shippedAt, deliveredAt, trackingStatus | Line-level timestamps |
| rtoInitiatedAt, rtoReceivedAt | RTO lifecycle |
| lastScanAt, lastScanLocation, expectedDeliveryDate | iThink data |

### State Machine

Source: `server/src/utils/orderStateMachine.ts`

```
pending > allocated > picked > packed > shipped
   |          |          |        |
cancelled  cancelled  cancelled cancelled > pending (uncancel)
```

**Inventory**: `pending>allocated` creates OUTWARD; cancellation deletes it

### Views & Release

| View | Condition |
|------|-----------|
| Open | Active OR shipped/cancelled but not released |
| Shipped | All lines shipped AND `releasedToShipped=true` |
| Cancelled | All lines cancelled AND `releasedToCancelled=true` |

## Caching

| Cache | TTL | Location |
|-------|-----|----------|
| `inventoryBalanceCache` | 5 min | `@coh/shared/services/inventory` |
| `customerStatsCache` | 2 min | `server/services/customerStatsCache.ts` |

**Note**: `Sku.currentBalance` is materialized via DB trigger, so balance lookups are O(1). The cache reduces DB round trips but is no longer critical for performance.

```typescript
import { inventoryBalanceCache } from '@coh/shared/services/inventory';
const balances = await inventoryBalanceCache.get(prisma, skuIds);
inventoryBalanceCache.invalidate(affectedSkuIds);  // CRITICAL after mutations
```

**Inventory Balance**: `SUM(inward) - SUM(outward)` using `txnType` column. Balance can be negative.

**SSE**: Server `routes/sse.ts` | Client `hooks/useOrderSSE.ts`. Auto-reconnect with 100-event replay.

## Shopify Integration

### Order Processing
Source: `server/src/services/shopifyOrderProcessor.ts`
- `processShopifyOrderToERP()` - Webhooks (DB lookup)
- `processOrderWithContext()` - Batch (Map O(1) lookup)
- **ERP is source of truth** for shipped/delivered. Shopify captures tracking only.

### Inventory Sync

| Direction | Mechanism | Trigger |
|-----------|-----------|---------|
| ERP > Shopify | GraphQL Admin API | Manual via `/api/shopify/inventory/*` |
| Shopify > ERP | Webhook | Auto on stock change |

**Endpoints** (`/api/shopify/inventory/`): `/locations`, `/item/:sku`, `/set`, `/zero-out`

**Requirements**: SKU needs `shopifyInventoryItemId`, webhook registered, `SHOPIFY_WEBHOOK_SECRET` set

## Tracking (iThink)

Source: `server/src/config/mappings/trackingStatus.ts`

**Resolution order**:
1. `cancel_status="Approved"` > cancelled (priority 110)
2. Text patterns (most reliable)
3. Status codes (fallback, "UD" ignored)

**Optimization**: Terminal statuses (`delivered`, `rto_delivered`) excluded from sync.

## Key Files

### Client
```
pages/Orders.tsx, Products.tsx
components/orders/OrdersGrid.tsx, ordersGrid/columns/, ordersGrid/formatting/
components/products/ProductsTree.tsx, SkuFlatView.tsx, cells/, detail/, unified-edit/
components/materials/MaterialsTreeTable.tsx, cells/
hooks/useOrdersMutations.ts, useUnifiedOrdersData.ts, orders/
```

### Server Functions
```
client/src/server/functions/
  orders.ts, orderMutations.ts, customers.ts, customerMutations.ts
  inventory.ts, inventoryMutations.ts, products.ts, productsMutations.ts
  materials.ts, fabrics.ts, fabricColours.ts, tracking.ts
  production.ts, returns.ts, admin.ts, shopify.ts
```

### Server (Express)
```
server/src/
  production.js          # Unified SSR+API (Railway entry)
  expressApp.js          # Express factory
  routes/auth.ts, webhooks.ts, sse.ts, shopify/
  services/trackingSync.ts, shopifyOrderProcessor.ts, autoArchive.ts
  utils/orderStateMachine.ts, orderViews.ts
  config/mappings/trackingStatus.ts
```

### Shared Package (@coh/shared)

> **CRITICAL**: `services/` uses DYNAMIC imports only. Static imports break client bundling.

```
shared/src/
  schemas/           # Zod schemas + inferred types (CLIENT-SAFE)
  services/          # SERVER-ONLY - dynamic imports only
    db/kysely.ts, prisma.ts, queries/
    inventory/balanceCache.ts
    orders/shipService.ts
  domain/, validators/, types/  # CLIENT-SAFE
```

### Root
```
prisma/schema.prisma, migrations/  # Run db commands from root
nixpacks.toml                      # Railway build config
```

## Products & Materials

**Products page** (`/products`) has 5 tabs: Products, Materials, Trims, Services, BOM

### Hierarchies
- **Products**: Product > Variation > SKU (tree or flat view)
- **Materials**: Material > Fabric > Colour (DB-enforced FK constraints)

### FabricColour System
- Stock tracked at colour level via `FabricColourTransaction`
- `Variation.fabricColourId` links variations to specific colours
- Colours inherit cost/lead/minOrder from parent fabric if not set

## Configuration

`/server/src/config/`:
- `/mappings/` - Payment gateways, tracking status codes
- `/thresholds/` - Customer tiers, order timing, inventory
- `/sync/` - Shopify & iThink settings

## Deployment

### Production Architecture
```
Request > production.js
           |-- /api/* > Express
           |-- /* > TanStack Start SSR
```

### Railway CLI
```bash
railway login && railway link    # One-time setup
railway up --detach              # Deploy
railway logs                     # View logs
railway variables --set "KEY=val"  # Set env var
```

**Build Order** (nixpacks.toml): root deps + Prisma > shared > server > client

**Debug**: Set `NO_CACHE=1` for fresh build, then unset.

### Staging (REQUIRED)
- `develop` > Staging (auto-deploy)
- `main` > Production (via PR)
- Same login credentials both environments

```bash
railway link -e staging -s COH-ERP2 -p COH-ERP2
railway up --detach
```

## UI Components

- Use shadcn/ui from `client/src/components/ui/`
- Add new: `npx shadcn@latest add <component-name>`
- Nested modals: `DialogStack` from `ui/dialog-stack.tsx`

## When to Use Agents

| Task | Agent |
|------|-------|
| Exploring codebase | `Explore` |
| Multi-file searches | `general-purpose` |
| Complex implementations | `elite-engineer`, `fullstack-erp-engineer` |
| Logic verification | `logic-auditor` |
| Documentation | `doc-optimizer`, `codebase-steward` |
| Planning | `Plan` |

## Pages Overview

| Page | Purpose |
|------|---------|
| `/orders` | Order fulfillment (AG-Grid, 3 views) |
| `/products` | Catalog + BOM (5 tabs) |
| `/inventory` | Stock management |
| `/inventory-mobile` | Mobile stock + Shopify sync |
| `/customers` | Customer management |
| `/analytics` | Business metrics |
| `/returns`, `/returns-rto` | Returns processing |
| `/ledgers` | Fabric colour ledgers |
| `/fabric-reconciliation` | Fabric count reconciliation |
| `/production` | Production planning |

---
**Updated:** `64bce27` (2026-01-23)
