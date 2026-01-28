# CLAUDE.md

## Core Principles

1. **Simplicity above all.** Remove bloat. Reduce > Perfect > Repeat.
2. **First principles.** Reason from fundamentals, solve efficiently.
3. **Living memory.** Update this file with learnings/mistakes as you work.
4. **Document as you go.** Comment undocumented code when you encounter it.
5. **Use agents liberally.** Spawn sub-agents for parallel/complex work.
6. **Commit early, commit often.** Small, frequent commits. **Run `cd client && npx tsc -p tsconfig.app.json --noEmit && cd ../server && npx tsc --noEmit` before committing.**
11. **STRICT: Branch discipline.** Always work on and push to `develop`. NEVER push to `main` unless the user explicitly confirms. Commits go to `develop`; merging to `main` requires user approval.
7. **Separate config from code.** Magic numbers, thresholds, mappings > `/config/`.
8. **Clean architecture.** Dependencies point inward. Business logic independent of frameworks/UI/DB.
9. **Build for the long term.** Maintainability over cleverness.
10. **Type-safe by default.** Strict TypeScript, Zod validation. No `any`, no shortcuts.

## Quick Start

```bash
# Using pnpm (recommended - workspace mode)
cd server && pnpm dev       # Port 3001
cd client && pnpm dev       # Port 5173
pnpm db:generate && pnpm db:push  # From root

# Using npm (works for individual packages)
cd server && npm run dev
cd client && npm run dev
```

**Note:** Root uses pnpm workspace (`pnpm-workspace.yaml`). Railway builds use npm (`nixpacks.toml`).

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
| 16 | Page sizes: All views use 250 per page (`useUnifiedOrdersData.ts` PAGE_SIZE constant) |
| 37 | Query keys: `['domain', 'action', 'server-fn', params]`. Old tRPC format causes cache misses |
| 39 | Use `inventoryQueryKeys.balance` from `constants/queryKeys.ts` for inventory queries |
| 55 | **Allocated inventory helper**: `hasAllocatedInventory()` = `['allocated','picked','packed']`. Use for both server cleanup and client optimistic updates. Shipped lines have no OUTWARD transaction (inventory already deducted at allocation). |

### Inventory (CRITICAL)
| # | Rule |
|---|------|
| 38 | Balance: use `txnType` column, NEVER `qty > 0`. OUTWARD stores POSITIVE qty with `txnType='outward'` |
| 44 | **Materialized Balance**: `Sku.currentBalance` and `FabricColour.currentBalance` are maintained by DB triggers. Read directly for O(1) lookups. |
| 45 | Triggers: `update_sku_balance()` for SKU, `update_fabric_colour_balance()` for fabric. Auto-update on INSERT/DELETE/UPDATE to transaction tables. |
| 46 | `currentBalance` is PROTECTED: Guard triggers block direct UPDATEs. Only create transactions (InventoryTransaction / FabricColourTransaction). |
| 47 | **Legacy Fabric system**: `Fabric` + `FabricTransaction` are deprecated. Use `FabricColour` + `FabricColourTransaction` for all new features. |
| 49 | CHECK constraints enforce: `qty > 0` (OrderLine, InventoryTransaction), `txnType IN ('inward', 'outward')` |

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
| 34 | Client-side code CANNOT import `@server/`. SSR/Server Functions use externalization. For DB: `@coh/shared/services/db` |
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
| 13 | Tracking: TEXT patterns override codes; `cancel_status="Approved"` = cancelled |
| 14 | Shopify: syncs tracking ONLY; ERP is source of truth for `shipped` |
| 15 | Tracking sync excludes terminal statuses (`delivered`, `rto_delivered`, `cancelled`, `reverse_delivered`) |
| 50 | Tracking codes: "UD" is unreliable (used for many states). Text patterns are authoritative via `resolveTrackingStatus()` |
| 51 | RTO detection: `cancel_status="Approved"` takes priority (110), then text patterns, then status codes |

### Infrastructure
| # | Rule |
|---|------|
| 7 | Prisma dates return Date objects: use `toDateString()` from `utils/dateHelpers.ts` |
| 8 | Dev URLs: use `localhost` for API calls |
| 48 | **Postgres.app requires password**: DATABASE_URL must include password. Local dev uses `coh_dev_local` as password. |
| 19 | Fabric hierarchy: DB enforces Material>Fabric>Colour. Variations link via `fabricColourId` |
| 20 | Inheritance: colours inherit cost/lead/minOrder from fabric if not set |
| 23 | Express routes: auth, admin, webhooks, SSE, pulse, returns, tracking, shopify, internal. Everything else = Server Functions |
| 25 | Prisma schema at `/prisma/schema.prisma` (root). Run db commands from root |
| 52 | `INTERNAL_API_SECRET` env var required for Server Function -> Express SSE broadcasts in production |
| 53 | Two SSE endpoints: `/api/events` (full replay) and `/api/pulse` (lightweight, no replay) |
| 54 | Background workers disabled via `DISABLE_BACKGROUND_WORKERS=true` for testing |

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
- Search params use `.catch(defaultValue)` for graceful fallback on invalid input
- File-based routing in `client/src/routes/`. Let generator handle route tree
- Auth: protected routes under `_authenticated` layout, use `beforeLoad` not `useEffect`
- Redirects: old URLs need redirect file in `_redirects/` folder
- Use `Route.useLoaderData()` for SSR initial data, `Route.useSearch()` for URL params (SSR-safe)

## Orders Architecture

### Data Model
- Single page `/orders` with segmented tabs: **Open, Shipped, RTO, All**
- Each row = one order line (server-flattened), `isFirstLine` marks header
- Cancelled orders visible in All view after release

### Tracking (Line-Level Only)

**OrderLine is ONLY source of truth.** Order.status only updated for terminal states (delivered/returned/cancelled).

| Field | Notes |
|-------|-------|
| awbNumber, courier | Each line can have different AWB |
| shippedAt, deliveredAt | Line-level timestamps |
| trackingStatus | Values: `in_transit`, `out_for_delivery`, `delivered`, `rto_initiated`, `rto_in_transit`, `rto_delivered`, `cancelled`, etc. |
| rtoInitiatedAt, rtoReceivedAt, rtoCondition | RTO lifecycle |
| lastScanAt, lastScanLocation, lastScanStatus | Last tracking scan details |
| courierStatusCode, deliveryAttempts | Raw courier data |
| expectedDeliveryDate | EDD from iThink |

**TrackingStatus Values** (16 total): `manifested`, `not_picked`, `picked_up`, `in_transit`, `reached_destination`, `out_for_delivery`, `delivery_delayed`, `undelivered`, `delivered`, `cancelled`, `rto_initiated`, `rto_in_transit`, `rto_delivered`, `reverse_pickup`, `reverse_in_transit`, `reverse_delivered`

**Terminal statuses**: `delivered`, `rto_delivered`, `cancelled`, `reverse_delivered`

### State Machine

Pure logic: `@coh/shared/domain/orders/stateMachine.ts` (LineStatus type, transitions, validation, inventory helpers)
DB-dependent: `server/src/utils/orderStateMachine.ts` (re-exports shared + `executeTransition` with Prisma)

**Forward Progression:** `pending > allocated > picked > packed > shipped > delivered (via tracking)`

**Backward Corrections (each status can go back one step):**
- `allocated > pending` (unallocate, releases inventory)
- `picked > allocated` (unpick)
- `packed > picked` (unpack)
- `shipped > packed` (unship, clears AWB)

**Cancellation:** Any non-shipped status can cancel. `cancelled > pending` for uncancel.

**Inventory Effects:**
- `pending > allocated`: Creates OUTWARD transaction (allocates)
- `allocated/picked/packed > cancelled`: Deletes OUTWARD (releases)
- Shipped lines cannot be cancelled (use RTO flow)

### Views & Release

Source: `server/src/utils/orderViews.ts`

| View | Condition |
|------|-----------|
| Open | `isArchived=false` AND (has non-shipped/cancelled lines OR fully shipped but `releasedToShipped=false` OR fully cancelled but `releasedToCancelled=false`) |
| Shipped | `isArchived=false`, `releasedToShipped=true`, all non-cancelled lines shipped, excludes RTO orders |
| RTO | Has at least one line with `trackingStatus` in `[rto_initiated, rto_in_transit, rto_delivered]` |
| All | All orders regardless of status |

## Return Lifecycle

OrderLine is source of truth for returns (extensive `return*` fields).

| Field Group | Key Fields |
|-------------|------------|
| Batch | `returnBatchNumber` - groups lines returned together (e.g., "64168/1") |
| Status | `returnStatus`: requested > pickup_scheduled > in_transit > received > complete |
| Logistics | `returnAwbNumber`, `returnCourier`, `returnPickupType` |
| QC | `returnCondition` (good/damaged/defective/wrong_item/used), `returnConditionNotes` |
| Refund | `returnGrossAmount`, `returnDiscountClawback`, `returnDeductions`, `returnNetAmount` (Decimal) |
| Resolution | `returnResolution`: refund, exchange, rejected |
| Exchange | `returnExchangeOrderId` - FK to exchange Order |

## BOM System (Bill of Materials)

3-level inheritance: Product > Variation > SKU. Null values inherit from parent.

| Level | Model | Purpose |
|-------|-------|---------|
| Product | ProductBomTemplate | Structure + defaults (trims, services) |
| Variation | VariationBomLine | Color-specific (fabric colours, overrides) |
| SKU | SkuBomLine | Size-specific (quantity overrides) |

**Component Types**: `FABRIC`, `TRIM`, `SERVICE`
**Roles**: `main`, `accent`, `lining`, `button`, `print` (defined in ComponentRole)
**Catalogs**: `TrimItem` (buttons, zippers), `ServiceItem` (printing, embroidery), `Vendor`

## Caching

| Cache | TTL | Location |
|-------|-----|----------|
| `inventoryBalanceCache` | 5 min | `@coh/shared/services/inventory/balanceCache.ts` |
| `fabricColourBalanceCache` | 5 min | `@coh/shared/services/inventory/balanceCache.ts` |
| `customerStatsCache` | 2 min | `server/services/customerStatsCache.ts` |

**Note**: Both balance caches read from materialized `currentBalance` columns maintained by DB triggers. The cache reduces DB round trips but is no longer critical for performance.

```typescript
import { inventoryBalanceCache, fabricColourBalanceCache } from '@coh/shared/services/inventory';

// SKU balances
const balances = await inventoryBalanceCache.get(prisma, skuIds);
inventoryBalanceCache.invalidate(affectedSkuIds);

// Fabric colour balances
const fabricBalances = await fabricColourBalanceCache.get(prisma, fabricColourIds);
fabricColourBalanceCache.invalidate(affectedFabricColourIds);
```

**Inventory Balance**: `SUM(inward) - SUM(outward)` using `txnType` column. Balance can be negative.

**SSE**: Server `routes/sse.ts` (100-event replay) + `routes/pulse.ts` (lightweight) | Client `hooks/useOrderSSE.ts`. Auto-reconnect.

## Shopify Integration

### Order Processing
Source: `server/src/services/shopifyOrderProcessor.ts`
- `processShopifyOrderToERP()` - Webhooks (DB lookup)
- `processOrderWithContext()` - Batch (Map O(1) lookup)

**ERP as Source of Truth:**
- Shopify fulfillment syncs AWB/courier to OrderLines but does NOT auto-ship
- ERP workflow (allocate > pick > pack > ship) is required for lineStatus changes
- Shopify tracking data captured for reference only

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
3. Status codes (fallback, "UD" ignored - unreliable)

**Optimization**: Terminal statuses (`delivered`, `rto_delivered`) excluded from sync.

## Background Workers

Managed by `expressApp.js` via `startBackgroundWorkers()`:

| Worker | Interval | Purpose |
|--------|----------|---------|
| `scheduledSync` | Configurable | Shopify order sync (24hr lookback) |
| `trackingSync` | 30 min | iThink tracking updates |
| `cacheProcessor` | Continuous | Cache operation processing |
| `cacheDumpWorker` | Continuous | Cache dump to disk |
| `pulseBroadcaster` | Continuous | SSE pulse signal broadcasting |
| Cache cleanup | Daily 2 AM | Stale cache entry cleanup |

**Environment Variables:**
- `DISABLE_BACKGROUND_WORKERS=true` - Disables all background workers
- `INTERNAL_API_SECRET` - Secret for internal API calls (Server Functions -> Express)

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `JWT_SECRET` | Yes | - | Auth signing key |
| `PORT` | No | 3001 | Server port |
| `NODE_ENV` | No | development | Environment |
| `JWT_EXPIRY` | No | 7d | Token expiration |
| `ENABLE_ADMIN_SHIP` | No | true | Admin ship feature |
| `DISABLE_BACKGROUND_WORKERS` | No | false | Disable sync workers |
| `INTERNAL_API_SECRET` | No | - | Server-to-server auth |
| `SHOPIFY_ACCESS_TOKEN` | No | - | Shopify Admin API |
| `SHOPIFY_SHOP_DOMAIN` | No | - | e.g., store.myshopify.com |
| `SHOPIFY_WEBHOOK_SECRET` | No | - | HMAC verification |
| `ITHINK_ACCESS_TOKEN` | No | - | iThink API |
| `ITHINK_SECRET_KEY` | No | - | iThink secret |
| `ITHINK_DEFAULT_LOGISTICS` | No | delhivery | Default courier |

See `server/src/config/env.js` for full Zod schema with validation.

## Key Files

### Client
```
routes/_authenticated/orders.tsx, products.tsx
components/orders/OrdersTable/OrdersTable.tsx, OrdersTable/columns/, OrdersTable/cells/
components/products/ProductsTree.tsx, SkuFlatView.tsx, cells/, detail/, unified-edit/
components/materials/MaterialsTreeTable.tsx, cells/
hooks/useOrdersMutations.ts, useUnifiedOrdersData.ts, useAuth.ts, useOrderSSE.ts
hooks/orders/ (8 modular mutation hooks + optimistic/)
constants/queryKeys.ts, sizes.ts
```

### Server Functions
```
client/src/server/functions/
  # Queries
  orders.ts, customers.ts, inventory.ts, products.ts
  materials.ts, fabrics.ts, fabricColours.ts, tracking.ts
  production.ts, returns.ts, admin.ts, shopify.ts
  catalog.ts, reports.ts, auth.ts, repacking.ts

  # Mutations
  orderMutations.ts, customerMutations.ts, inventoryMutations.ts
  productsMutations.ts, materialsMutations.ts, fabricMutations.ts
  fabricColourMutations.ts, bomMutations.ts, productionMutations.ts
  reconciliationMutations.ts, returnsMutations.ts
  authMutations.ts, paymentMutations.ts
```

### Server (Express)
```
server/src/
  production.js          # Unified SSR+API entry (Railway)
  expressApp.js          # Express factory + background worker coordination
  lib/prisma.js          # Prisma client singleton
  config/
    env.js               # Zod environment validation (loaded first)
    mappings/trackingStatus.ts, paymentGateway.ts
    sync/ithink.ts, shopify.ts
    thresholds/customerTiers.ts, orderTiming.ts, inventory.ts
  routes/
    auth.ts, admin.ts    # Auth and admin management
    webhooks.ts, sse.ts  # Webhooks and SSE
    pulse.ts, internal.ts # Lightweight SSE and internal APIs
    shopify/, returns.ts, tracking.ts
    remittance.js, pincodes.js, inventory-reconciliation.js
  services/
    trackingSync.ts, scheduledSync.ts  # Background sync
    shopifyOrderProcessor.ts, autoArchive.ts
    customerStatsCache.ts, pulseBroadcaster.ts
    deferredExecutor.ts, shipOrderService.ts
    ithinkLogistics.ts   # iThink API client
  utils/
    orderStateMachine.ts   # Re-exports shared + DB-dependent executeTransition
    orderViews.ts, orderEnrichment/
    errors.ts, logger.ts, dateHelpers.ts
    shutdownCoordinator.ts, circuitBreaker.ts
    tierUtils.ts
  middleware/
    auth.ts, permissions.ts, errorHandler.ts, asyncHandler.ts
```

### Shared Package (@coh/shared)

> **CRITICAL**: `services/` uses DYNAMIC imports only. Static imports break client bundling.

```
shared/src/
  schemas/              # Zod schemas + inferred types (CLIENT-SAFE)
    common.ts             # Base schemas (uuid, pagination, status enums)
    searchParams.ts       # URL search param schemas for TanStack Router
    orders.ts, customers.ts, inventory.ts, returns.ts, products.ts
    materials.ts, production.ts, reconciliation.ts, payments.ts
  services/             # SERVER-ONLY - dynamic imports only
    db/kysely.ts, prisma.ts
    db/queries/inventory.ts, customers.ts  # High-perf Kysely queries
    inventory/balanceCache.ts  # SKU + FabricColour balance caches
    orders/shipService.ts      # Unified shipping service
  domain/               # CLIENT-SAFE - Pure business logic
    constants.ts          # GST rates (5% below 2500, 18% above)
    customers/tiers.ts    # Customer tier calculation (platinum=50k, gold=25k, silver=10k)
    inventory/balance.ts  # Pure balance calculation functions
    orders/pricing.ts     # Order total calculation
    orders/lineMutations.ts # Type definitions for line mutations
    orders/stateMachine.ts  # LineStatus, transitions, validation, inventory helpers
    returns/              # Return eligibility, policy, options
  validators/           # CLIENT-SAFE - Validation utilities
    index.ts              # Password, AWB, format validators, sanitization
  errors/               # CLIENT-SAFE - Error utilities
    returns.ts            # ReturnError class, error codes, result helpers
  types/                # CLIENT-SAFE - TypeScript interfaces
```

### Database Triggers

| Trigger | Table | Effect |
|---------|-------|--------|
| `trg_inventory_balance_*` | InventoryTransaction | Maintains `Sku.currentBalance` |
| `trg_fabric_colour_balance_*` | FabricColourTransaction | Maintains `FabricColour.currentBalance` |
| `trg_guard_sku_balance` | Sku | Blocks direct currentBalance updates |
| `trg_guard_fabric_colour_balance` | FabricColour | Blocks direct currentBalance updates |
| `trg_check_variation_bom_fabric_hierarchy` | VariationBomLine | Enforces BOM-Variation fabric consistency |
| `trg_check_variation_fabric_hierarchy` | Variation | Prevents breaking BOM links on fabric change |

### Root
```
prisma/schema.prisma, migrations/  # Run db commands from root
nixpacks.toml                      # Railway build config
pnpm-workspace.yaml                # Workspace definition
```

## Products & Materials

**Products page** (`/products`) has 9 tabs:

| Tab | Purpose |
|-----|---------|
| Products | Catalog view with tree/flat toggle |
| Materials | Material > Fabric > FabricColour hierarchy |
| Trims | Trim items catalog |
| Services | Service items catalog |
| BOM Editor | Two-panel master-detail BOM setup |
| Consumption | Spreadsheet grid view for consumption |
| Import | CSV import with column mapping |
| Fabric Mapping | Assign fabrics to variations |
| Style Codes | Inline edit style codes |

### Hierarchies
- **Products**: Product > Variation > SKU (tree or flat view)
- **Materials**: Material > Fabric > FabricColour (DB-enforced FK constraints)

### Variation-Fabric Linking
- `Variation.fabricId` - Legacy link to `Fabric` (required, still in use)
- `Variation.fabricColourId` - NEW link to specific `FabricColour` (optional, for new features)

### FabricColour System
- Stock tracked at colour level via `FabricColourTransaction`
- `Variation.fabricColourId` links variations to specific colours
- Inherited fields (null = use parent Fabric value):
  - `costPerUnit`, `leadTimeDays`, `minOrderQty`, `supplierId`
- `FabricColour.currentBalance` is materialized by DB trigger

## Express Routes (Full List)

| Route | File | Purpose |
|-------|------|---------|
| `/api/auth` | `routes/auth.ts` | Login, logout, token refresh |
| `/api/admin` | `routes/admin.ts` | User/role management, system settings, logs, background jobs |
| `/api/webhooks` | `routes/webhooks.ts` | Shopify webhook handlers |
| `/api/events` | `routes/sse.ts` | SSE stream with 100-event replay |
| `/api/pulse` | `routes/pulse.ts` | Lightweight SSE (no replay) |
| `/api/internal` | `routes/internal.ts` | Server-to-server SSE broadcast |
| `/api/shopify` | `routes/shopify/index.ts` | Shopify integration endpoints |
| `/api/returns` | `routes/returns.ts` | Reverse pickup scheduling |
| `/api/tracking` | `routes/tracking.ts` | Admin tracking debug endpoints |
| `/api/remittance` | `routes/remittance.js` | COD remittance |
| `/api/pincodes` | `routes/pincodes.js` | Pincode serviceability |
| `/api/inventory` | `routes/inventory-reconciliation.js` | Inventory reconciliation |
| `/api/health` | inline | Health checks |

## Client Hooks Architecture

### Order Mutations (Modular Pattern)
`useOrdersMutations.ts` is a facade composing 8 focused sub-hooks in `hooks/orders/`:

| Hook | Purpose |
|------|---------|
| `useOrderWorkflowMutations` | allocate/pick/pack workflow |
| `useOrderShipMutations` | ship operations |
| `useOrderCrudMutations` | create/update/delete orders |
| `useOrderStatusMutations` | cancel/uncancel |
| `useOrderDeliveryMutations` | delivery tracking |
| `useOrderLineMutations` | line operations + customization |
| `useOrderReleaseMutations` | release workflows |
| `useProductionBatchMutations` | production batches |

### Optimistic Updates
Located in `hooks/orders/optimistic/`:
- `types.ts` - Type definitions
- `inventoryHelpers.ts` - Re-exports from `@coh/shared/domain/orders/stateMachine` (no local implementation)
- `cacheTargeting.ts` - Query key builders, row access
- `statusUpdateHelpers.ts` - Optimistic transformations

### Other Key Hooks
| Hook | Purpose |
|------|---------|
| `useAuth.ts` | Authentication context |
| `useUnifiedOrdersData.ts` | Order data with SSE integration |
| `useOrderSSE.ts` | Real-time SSE subscription |
| `useSearchOrders.ts` | Cross-view order search |
| `useUrlModal.ts` | URL-driven modal state |
| `useDebounce.ts` | Input debouncing |
| `useGridState.ts` | AG-Grid state persistence |
| `usePermissions.ts` | Role-based access control |
| `production/useProductionData.ts` | Production queries/mutations |

## Shared Domain Layer

Pure functions for business logic, shared between server and client.

| Domain | Functions | Notes |
|--------|-----------|-------|
| `customers/tiers` | `calculateTierFromLtv`, `compareTiers`, `getAmountToNextTier` | LTV thresholds: platinum=50k, gold=25k, silver=10k |
| `inventory/balance` | `calculateBalance`, `hasEnoughStock`, `getShortfall` | Pure balance calculations, no DB |
| `orders/pricing` | `calculateOrderTotal`, `getProductMrpForShipping` | Exchange orders always calculate from lines |
| `orders/lineMutations` | Type definitions for line-level mutations | MutationResult, MarkLineDeliveredInput, etc. |
| `orders/stateMachine` | `isValidTransition`, `getTransitionDefinition`, `hasAllocatedInventory`, `calculateInventoryDelta` | Pure state machine logic, no DB deps |
| `constants` | `getGstRate`, `GST_THRESHOLD` | GST: 5% below INR 2500, 18% above |

### Returns Domain (`shared/src/domain/returns/`)

| Export | Purpose |
|--------|---------|
| `RETURN_POLICY` | Window: 14 days, warning at 2 days remaining |
| `RETURN_REASONS`, `RETURN_CONDITIONS`, etc. | Labeled option maps for UI |
| `checkEligibility()` | Validates return eligibility with reasons |
| `toOptions()`, `getLabel()` | Helpers for dropdown options |

### Validators (`shared/src/validators/`)

| Function | Purpose |
|----------|---------|
| `validatePassword()` | 8+ chars, upper, lower, number, special |
| `validateAwbFormat()` | Courier-specific AWB patterns, generic fallback |
| `isValidEmail()`, `isValidPhone()` | Format validation (Indian phone format) |
| `sanitizeSearchInput()` | SQL wildcard escaping |

### Errors (`shared/src/errors/`)

```typescript
// Returns domain errors
import { ReturnError, RETURN_ERROR_CODES, returnSuccess, returnError } from '@coh/shared';

// Throw with structured error
throw new ReturnError(RETURN_ERROR_CODES.NOT_DELIVERED, { context: { lineId } });

// Return result pattern
return returnError(RETURN_ERROR_CODES.WINDOW_EXPIRED);
return returnSuccess(data, 'Return processed');
```

## Configuration

`/server/src/config/`:

| File | Purpose |
|------|---------|
| `env.js` | Zod environment validation (loaded first) |
| `index.ts` | Central config re-exports |
| `types.ts` | Config type definitions |
| `mappings/trackingStatus.ts` | iThink status code to internal status mapping |
| `mappings/paymentGateway.ts` | Shopify gateway to COD/Prepaid mapping |
| `sync/ithink.ts` | iThink API settings, batch sizes, circuit breaker |
| `sync/shopify.ts` | Shopify sync settings |
| `thresholds/customerTiers.ts` | LTV breakpoints for customer tiers |
| `thresholds/orderTiming.ts` | Order timing thresholds |
| `thresholds/inventory.ts` | Inventory alert thresholds |

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

### CI/CD
- No GitHub Actions configured
- Deployment: Railway auto-deploy from `develop` (staging) and `main` (production)
- Pre-commit: Manual TypeScript check required (see Principle #6)

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
| `/` | Dashboard (index) |
| `/orders` | Order fulfillment (AG-Grid, 4 views: Open, Shipped, RTO, All) |
| `/order-search` | Cross-tab order search |
| `/orders-mobile` | Mobile order management |
| `/products` | Catalog + BOM (9 tabs) |
| `/inventory` | Stock management (AG-Grid) |
| `/inventory-mobile` | Mobile stock + Shopify sync |
| `/inventory-inward` | Inventory inward processing |
| `/inventory-count` | Physical inventory counts |
| `/customers` | Customer management |
| `/analytics` | Business metrics |
| `/returns` | Customer returns processing |
| `/returns-rto` | RTO returns processing |
| `/ledgers` | FabricColour transaction history (filter by hierarchy/date) |
| `/fabric-reconciliation` | Physical fabric stock count reconciliation |
| `/fabric-receipt` | Fabric receipt processing |
| `/production` | Production planning |
| `/settings` | System settings |
| `/users` | User management |

---
**Updated:** 2026-01-27 (comprehensive audit by 7 parallel agents)
