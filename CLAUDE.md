# CLAUDE.md

## Core Principles

1. **Simplicity above all.** Remove bloat. Reduce → Perfect → Repeat.
2. **First principles.** Reason from fundamentals, solve efficiently.
3. **Living memory.** Update this file with learnings/mistakes as you work.
4. **Document as you go.** Comment undocumented code when you encounter it.
5. **Use agents liberally.** Spawn sub-agents for parallel/complex work.
6. **Commit early, commit often.** Always commit your changes. Small, frequent commits. **ALWAYS run `cd client && npx tsc -p tsconfig.app.json --noEmit && cd ../server && npx tsc --noEmit` before committing to catch TypeScript errors.**
7. **Separate config from code.** Magic numbers, thresholds, mappings → `/config/`. Code should read config, not contain it.
8. **Clean architecture.** Dependencies point inward. Business logic independent of frameworks/UI/DB.
9. **Build for the long term.** Write code your future self will thank you for. Maintainability over cleverness.
10. **Type-safe by default.** Strict TypeScript, proper Server Function typing, Zod validation. No `any`, no shortcuts.

## Architecture: TanStack Start + Server Functions

> **Migration Complete**: tRPC fully removed. Server Functions are the primary data layer.
>
> See [TANSTACK_START_MIGRATION_PLAN.md](./TANSTACK_START_MIGRATION_PLAN.md) for migration history.

### Current Architecture

| Component | Technology | Status |
|-----------|------------|--------|
| Frontend Router | TanStack Router | ✅ Complete |
| Layouts | TanStack `__root.tsx` | ✅ Complete |
| Data Fetching | Server Functions + TanStack Query | ✅ Complete |
| Mutations | Server Functions | ✅ Complete |
| Backend | Express (minimal) + Server Functions | ✅ Complete |
| Real-time | SSE → TanStack Query invalidation | ✅ Complete |

**Data Flow Pattern**:
```typescript
// Route loader prefetches data
loader: async ({ search }) => getOrders({ data: search })

// Component uses TanStack Query with loader data
const { data } = useQuery({
  queryKey: ['orders', search],
  queryFn: () => getOrders({ data: search }),
  initialData: Route.useLoaderData(),
});
```

### Type Safety Philosophy

> **⚠️ NON-NEGOTIABLE: Zod is the source of truth. Always.**
> - Define schemas in Zod
> - Infer types with `z.infer<>`
> - Validate search params, Server Function inputs
> - **NEVER write `interface` or `type` separately from the Zod schema**

### Server Function Type Safety Standards

**Error Handling** - Use `catch (error: unknown)` with type guards:
```typescript
// CORRECT - explicit unknown type with instanceof narrowing
} catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: { code: 'EXTERNAL_ERROR', message } };
}

// WRONG - unsafe cast assumes all errors are Error instances
} catch (error) {
    const err = error as Error;  // DON'T - crashes on non-Error throws
    return { success: false, error: err.message };
}
```

**Prisma Client Typing** - Use `InstanceType<typeof PrismaClient>`:
```typescript
// Type alias for helper functions (at top of file)
type PrismaInstance = InstanceType<typeof PrismaClient>;

// For transaction clients (omit unavailable methods)
type PrismaTransaction = Omit<
    PrismaInstance,
    '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

async function getPrisma() {
    const { PrismaClient } = await import('@prisma/client');
    const globalForPrisma = globalThis as unknown as {
        prisma: InstanceType<typeof PrismaClient> | undefined;
    };
    // ... singleton pattern
}
```

**Handler Return Types** - Always explicit for complex queries:
```typescript
// Typed WHERE clause builders
function buildWhereClause(view: string, ...): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = { isArchived: false };
    // ...
    return where;
}

// Export response types for consumers
export interface OrdersResponse {
    rows: FlattenedOrderRow[];
    pagination: { total: number; page: number; /* ... */ };
}
```

**Express Route Validation** - Zod schemas for request bodies:
```typescript
// Define schemas (replaces interface definitions)
const LoginBodySchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
});

// Validate in handler
const parseResult = LoginBodySchema.safeParse(req.body);
if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.issues[0]?.message });
    return;
}
const { email, password } = parseResult.data;
```

### TanStack Router Migration Rules

#### Search Params & Type Safety
- **No `any` or `Record<string, unknown>`** for search params. Every route with search state MUST have a Zod schema in `shared/src/schemas/searchParams.ts`
- Use `z.coerce` for numbers and booleans to ensure robust URL state typing
- Use `Route.useSearch()` instead of `window.location` or old `useSearchParams`. If you're manually parsing URL strings, update the route's `validateSearch` config instead

#### File-Based Routing
- **Strictly file-based routing** following TanStack Start pattern. Do NOT manually define route trees in a single large file—let the generator handle it from `client/src/routes/` directory structure
- Register router for global type safety in `__root.tsx` or `router.tsx`:
  ```typescript
  declare module '@tanstack/react-router' {
    interface Register { router: typeof router }
  }
  ```
  This enables full jump-to-definition support for all routes

#### Auth & beforeLoad Guards
- All protected routes MUST be children of the `_authenticated` layout
- Use `beforeLoad` hook for auth checks—do NOT use `useEffect` inside components for redirects. The router must block unauthorized access BEFORE component render
- Handle `auth.isLoading` gracefully in `beforeLoad`—do NOT redirect to `/login` while auth status is still loading

#### Backwards Compatibility
- **Non-negotiable**: Every old URL (`/catalog`, `/shipments`, etc.) must have a redirect file in `_redirects/` folder using TanStack `redirect()`. No 404s for existing bookmarks
- Use `activeProps` on all `Link` components for sidebar styling—do NOT manually calculate active state via pathname string matching

#### Code Quality
- Avoid circular dependencies between `routerContext.ts` and `useAuth.tsx`. Move shared types to a dedicated types file
- After creating/modifying routes, run `npx tsc --noEmit` in client directory. No broken link references or route tree errors accepted

## Quick Start

```bash
cd server && npm run dev    # Port 3001
cd client && npm run dev    # Port 5173
npm run db:generate && npm run db:push  # Run from root (Prisma is at /prisma/)
```

Login: `admin@coh.com` / `XOFiya@34`

## Stack

- **Backend**: Express (auth, webhooks, file uploads) + TanStack Start Server Functions + Prisma + PostgreSQL
- **Frontend**: React 19 + TanStack Router + TanStack Query v5 + AG-Grid + Tailwind + shadcn/ui
- **Data Flow**: Route Loaders → Server Functions → TanStack Query cache → SSE invalidation
- **Validation**: Zod at all boundaries (search params, Server Function inputs)
- **Real-time**: SSE with TanStack Query invalidation
- **Production**: Unified SSR server (TanStack Start + Express on single port)

### UI Components
- **Use shadcn/ui components wherever possible** - buttons, dialogs, dropdowns, inputs, etc.
- Location: `client/src/components/ui/` - check existing components before creating new ones
- Add new shadcn components via: `npx shadcn@latest add <component-name>`
- **Dialog stacking**: Use `DialogStack` from `ui/dialog-stack.tsx` for nested modals (auto z-index management)

## Gotchas (Read First!)

1. **Server Functions**: All data fetching and mutations use Server Functions in `client/src/server/functions/`. No tRPC.
2. **Cache invalidation**: mutations MUST invalidate TanStack Query + server caches. Use `queryClient.invalidateQueries()`
3. **AG-Grid cellRenderer**: return JSX, not strings; use centralized formatting from `ordersGrid/formatting/`
4. **Shopify data**: lives in `shopifyCache.*`, NEVER use `rawData`
5. **Line fields**: use pre-computed O(1) fields (`lineShippedAt`, `daysInTransit`), not `orderLines.find()` O(n)
6. **View filters**: shipped/cancelled orders stay in Open until Release clicked
7. **Prisma dates**: returns Date objects—use `toDateString()` from `utils/dateHelpers.ts`
8. **Dev URLs**: use `localhost` for API calls in dev; see #27 for production
9. **Zod params**: never `prop: undefined`, use spread `...(val ? {prop: val} : {})`
10. **Deferred tasks**: mutations return immediately; side effects (cache, SSE) run async via `deferredExecutor`
11. **Line-level tracking**: delivery/RTO mutations are line-level; orders can have mixed states (partial delivery, multi-AWB)
12. **Admin ship**: use `adminShip` mutation; requires admin role + `ENABLE_ADMIN_SHIP=true`
13. **Tracking status mapping**: TEXT patterns override status codes; `cancel_status="Approved"` always means cancelled; "UD" code is unreliable
14. **Shopify fulfillment**: syncs tracking data ONLY; ERP is source of truth for `shipped` status—never auto-ship from webhooks
15. **Tracking sync**: excludes terminal statuses (`delivered`, `rto_delivered`) to avoid wasting API calls on unchangeable data
16. **Page sizes**: Open=500 (active mgmt), Shipped/Cancelled=100 (historical views)
17. **TypeScript checks BEFORE committing**: ALWAYS run `cd client && npx tsc -p tsconfig.app.json --noEmit && cd ../server && npx tsc --noEmit` before every commit. NON-NEGOTIABLE.
18. **TanStack Table trees**: use `getSubRows` for hierarchy, never mutate `children` directly; expansion state separate from data
19. **Fabric hierarchy**: Database enforces Material→Fabric→Colour consistency; colours MUST have fabricId, fabrics MUST have materialId
20. **Inheritance pattern**: Fabric colours inherit cost/lead/minOrder from parent fabric if not explicitly set (priority: colour → fabric → null)
21. **Cell components**: Modularize into `/cells/` directory with barrel export from `index.ts`; reusable across tables
22. **URL state sync**: Master-detail views sync selection to URL params (`?tab=bom&id=123&type=product`); parse on mount, update on selection
23. **Express routes**: Only for auth (cookies), webhooks, SSE, and file uploads. Everything else uses Server Functions.
24. **SSR hydration**: Guard `window`/`document` access with `typeof window !== 'undefined'`. For UI depending on runtime state (router status, etc.), use TanStack's `ClientOnly` component—server-rendered HTML may persist otherwise.
25. **Prisma location**: Schema is at `/prisma/schema.prisma` (root), not in server/. Run db commands from root.
26. **Server Function cookies**: Use `getCookie` and `getRequestHeader` from `@tanstack/react-start/server`, NOT from `vinxi/http`. Vinxi utilities fail with "Cannot read properties of undefined (reading 'config')" when Server Functions are called from client.
27. **Server Function API calls**: In production, call Express API via `http://127.0.0.1:${process.env.PORT}` (same-server call), NOT `localhost:3001` which doesn't exist on Railway.
28. **Server Function large payloads**: Use `method: 'POST'` for Server Functions that receive arrays or large data. GET requests encode data in headers, causing HTTP 431 "Request Header Fields Too Large".
29. **JWT roleId can be null**: Auth middleware Zod schema must use `roleId: z.string().nullable().optional()` since users without roles have `roleId: null` in their token.
30. **Error typing**: Always use `catch (error: unknown)` with `instanceof Error` guard. Never `catch (error)` with `error as Error` cast—non-Error objects can be thrown.
31. **Prisma typing**: Use `InstanceType<typeof PrismaClient>` for client type. Don't use `any` for global prisma singleton. For transactions use `Omit<...>` to exclude unavailable methods.
32. **WHERE clause typing**: Type Prisma WHERE builders as `Prisma.OrderWhereInput` (or relevant model). Avoids `any` in query construction.
33. **Express body validation**: Use Zod schemas with `safeParse()` for request bodies. Don't use `req.body as SomeInterface`—validates at runtime, not just compile time.

## Orders Architecture

### Data Model
- Single page `/orders` with dropdown selector
- Views: Open, Shipped, Cancelled (3 views)
- Shipped has filter chips: All, RTO, COD Pending (server-side filtering via `shippedFilter`)
- Each row = one order line (server-flattened), `isFirstLine` marks header for grouping
- Note: Archived view hidden from UI but auto-archive runs silently

### Tracking Data Architecture (IMPORTANT)

**OrderLine is the ONLY source of truth for tracking data.** Order-level tracking fields have been removed.

| Field | Location | Notes |
|-------|----------|-------|
| awbNumber, courier | OrderLine | Each line can have different AWB (multi-AWB orders) |
| shippedAt, deliveredAt | OrderLine | Line-level timestamps |
| trackingStatus | OrderLine | `in_transit`, `delivered`, `rto_in_transit`, `rto_delivered` |
| rtoInitiatedAt, rtoReceivedAt | OrderLine | RTO lifecycle timestamps |
| lastScanAt, lastScanLocation | OrderLine | iThink tracking data |
| expectedDeliveryDate | OrderLine | EDD from courier |

**Key patterns:**
- View filtering uses `EXISTS (SELECT 1 FROM OrderLine WHERE ...)` for "any line matches"
- AWB search queries `OrderLine.awbNumber`, not Order
- Tracking sync updates ALL OrderLines with same AWB
- Terminal status (delivered, rto_delivered) derived from OrderLine statuses
- **Hold functionality removed** - no isOnHold, holdReason, etc.

### Line Status State Machine

Source: `server/src/utils/orderStateMachine.ts` (use `executeTransition` in transaction)

```
pending → allocated → picked → packed → shipped
   ↓         ↓          ↓        ↓
cancelled cancelled  cancelled cancelled → pending (uncancel)

Reverse: shipped → packed → picked → allocated → pending (via un* mutations)
```

**Inventory:** `pending→allocated` creates OUTWARD; cancellation/unallocation deletes it

### Views & Release Workflow

| View | Condition | Notes |
|------|-----------|-------|
| Open | Active orders OR shipped/cancelled but not released | Default view |
| Shipped | All lines shipped AND `releasedToShipped=true` | Has filter chips: All/RTO/COD Pending |
| Cancelled | All lines cancelled AND `releasedToCancelled=true` | Line-level view |

**Shipped Filters** (via `shippedFilter` param):
- `all`: All shipped orders (default)
- `rto`: RTO in transit or delivered
- `cod_pending`: Delivered COD awaiting remittance

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

### Real-Time (SSE)
- Server: `routes/sse.ts` | Client: `hooks/useOrderSSE.ts`
- Auto-reconnect with 100-event replay buffer; prefer `invalidate()` over `setData()`

## Data Fetching & Mutations

### Server Functions Pattern
```typescript
// Route loader prefetches via Server Function
loader: async ({ search }) => getOrders({ data: search })

// Component with TanStack Query
const loaderData = Route.useLoaderData();
const { data } = useQuery({
  queryKey: ['orders', search],
  queryFn: () => getOrders({ data: search }),
  initialData: loaderData,
});

// Mutations
const mutation = useMutation({
  mutationFn: (input) => shipOrder({ data: input }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
});
```

### Server Functions Production Gotchas

**Cookie/Header Access** - Use TanStack Start utilities, NOT vinxi:
```typescript
// CORRECT - works for SSR and client-initiated Server Functions
import { getCookie, getRequestHeader } from '@tanstack/react-start/server';
const token = getCookie('auth_token');

// WRONG - fails with "Cannot read properties of undefined (reading 'config')"
import { getCookie } from 'vinxi/http';  // DON'T USE
```

**Large Payloads** - Use POST method to avoid header size limits:
```typescript
// CORRECT - data goes in request body
export const getInventoryBalances = createServerFn({ method: 'POST' })
  .handler(async ({ data }) => { /* receives array of 100+ SKU IDs */ });

// WRONG - causes HTTP 431 "Request Header Fields Too Large"
export const getInventoryBalances = createServerFn({ method: 'GET' })
  .handler(async ({ data }) => { /* array encoded in headers, too big */ });
```

**Internal API Calls** - Use correct URL for environment:
```typescript
// In Server Functions that call Express API
const port = process.env.PORT || '3001';
const apiUrl = process.env.NODE_ENV === 'production'
  ? `http://127.0.0.1:${port}`   // Same server on Railway
  : 'http://localhost:3001';     // Separate dev server
```

**SSR Hydration Mismatch** - Use ClientOnly for runtime-dependent UI:
```typescript
// CORRECT - server renders fallback, client renders actual state
import { ClientOnly } from '@tanstack/react-router';

function LoadingBar() {
  return (
    <ClientOnly fallback={null}>
      <LoadingBarContent />  {/* Uses router state that differs SSR vs client */}
    </ClientOnly>
  );
}

// WRONG - server renders bar (pending), client hydrates with same HTML even though idle
function LoadingBar() {
  const isLoading = useRouterState({ select: (s) => s.status === 'pending' });
  if (!isLoading) return null;
  return <div>Loading...</div>;  // Server HTML persists after hydration!
}
```

### Real-time: SSE → TanStack Query
1. SSE pushes signal-only pings: `{ type: 'ORDER_SHIPPED' }`
2. Client calls `queryClient.invalidateQueries({ queryKey: ['orders'] })`
3. TanStack Query refetches → UI updates

## Shopify Order Processor

Source of truth: `server/src/services/shopifyOrderProcessor.ts`

**Entry points:**
- `processShopifyOrderToERP()` - Webhooks (DB-based SKU lookup)
- `processOrderWithContext()` - Batch (Map-based O(1) lookup)

**Status precedence:** ERP is source of truth for `shipped`/`delivered`. Shopify captures tracking but does NOT auto-ship.

## Tracking & iThink Integration

### Status Mapping Priority (CRITICAL)

Source: `server/src/config/mappings/trackingStatus.ts`

**Resolution order** (check `cancel_status` FIRST, then apply resolver):
1. **Cancel status field**: `cancel_status="Approved"` → `cancelled` (priority 110, checked before text/code)
2. **Text patterns**: Match status text (e.g., "Reached At Destination") → MOST RELIABLE
3. **Status codes**: Match code (e.g., "DL") → FALLBACK for reliable codes only
4. **Unreliable codes**: "UD" is IGNORED in code matching—only text patterns apply

**Why text-first?** Couriers reuse codes like "UD" for many states:
- "UD" + "Reached At Destination" → `reached_destination` (text wins)
- "UD" + "Cancelled" → `cancelled` (text wins)
- "UD" + "In Transit" → `in_transit` (text wins)
- "UD" with no text match → `in_transit` (fallback)

### Tracking Sync Optimization

- **Terminal statuses excluded**: `delivered`, `rto_delivered` never re-queried (saves 93% API calls)
- **Page sizes**: Syncs process data in batches; use smaller pages for historical views
- **Debug endpoint**: `/api/tracking/raw/:awbNumber` returns raw iThink response (no auth, debug only)

### Key Gotchas
- Always check `cancel_status` field before mapping status code/text
- Never trust "UD" code alone—require text pattern match
- Text patterns use `includes()` matching, codes use exact match
- Exclude patterns (`excludePatterns`) prevent false positives (e.g., "rto delivered" won't match "delivered")

## Key Files

### Client - Orders
```
pages/Orders.tsx                         # Page orchestrator
components/orders/OrdersGrid.tsx         # AG-Grid component
components/orders/ordersGrid/columns/    # 6 modular column files
components/orders/ordersGrid/formatting/ # Centralized AG-Grid styles (colors, statuses, thresholds)
hooks/useOrdersMutations.ts              # Facade composing all mutation hooks
hooks/useUnifiedOrdersData.ts            # Main data hook
hooks/orders/                            # Focused mutation hooks
utils/orderHelpers.ts                    # flattenOrders, enrichRowsWithInventory
```

### Client - Products & Materials
```
pages/Products.tsx                       # Main page with 5 tabs (products/materials/trims/services/bom)
components/products/
  ProductsViewSwitcher.tsx               # Toggle: Hierarchy tree ↔ SKU flat table
  ProductsTree.tsx                       # TanStack Table tree (Product→Variation→SKU)
  SkuFlatView.tsx                        # Flat SKU table with column reordering + pagination
  DetailPanel.tsx                        # Master-detail right panel
  cells/                                 # Modular cell components
  detail/                                # Detail panel tabs (Info, BOM, Costs, SKUs)
  unified-edit/                          # Unified product/variation/SKU edit modal
    UnifiedProductEditModal.tsx          # Main modal orchestrator
    levels/                              # Level-specific forms
    tabs/                                # Tab components
    shared/                              # Shared form fields
  types.ts                               # ProductTreeNode, ProductNodeType, tab types
components/materials/
  MaterialsTreeView.tsx                  # Page wrapper with view mode toggle
  MaterialsTreeTable.tsx                 # TanStack Table tree (Material→Fabric→Colour)
  LinkProductsModal.tsx                  # Link fabrics/colours to products
  cells/                                 # Cell components (ColoursCell, ConnectedProductsCell, etc.)
  types.ts                               # MaterialNode, MaterialNodeType, inheritance types
```

### Server Functions (Primary Data Layer)
```
client/src/server/functions/
  orders.ts, orderMutations.ts        # Orders queries and mutations
  customers.ts, customerMutations.ts  # Customers queries and mutations
  inventory.ts, inventoryMutations.ts # Inventory queries and mutations
  products.ts, productsMutations.ts   # Products queries and mutations
  materials.ts, materialsMutations.ts # Materials queries and mutations
  fabrics.ts, fabricMutations.ts      # Fabrics queries and mutations
  returns.ts, returnsMutations.ts     # Returns queries and mutations
  tracking.ts                         # Tracking queries
  admin.ts, shopify.ts, catalog.ts    # Admin, Shopify, Catalog functions
  bomMutations.ts                     # BOM mutations
  production.ts, productionMutations.ts # Production queries and mutations
  reports.ts, repacking.ts            # Reports and repacking
```

### Server (Express - Minimal Routes)
```
server/src/
  production.js                       # Unified SSR+API server (Railway entry point)
  expressApp.js                       # Express app factory (used by dev & prod)
  index.js                            # Dev server entry point

routes/
  auth.ts                             # Auth (JWT, HttpOnly cookies)
  webhooks.ts                         # Shopify webhooks
  shopify/                            # Shopify admin sync (6 files)
  sse.ts                              # SSE streaming
  pulse.ts                            # Health checks
  admin.ts                            # Admin operations
  remittance.ts                       # File uploads (remittance)
  import-export.ts                    # File uploads/downloads
  inventory-reconciliation.ts         # File uploads (reconciliation)
  pincodes.js                         # File uploads (pincodes)

config/                               # Centralized configuration system
config/mappings/trackingStatus.ts     # iThink status mapping (text-first, cancel_status priority)

services/
  autoArchive.ts                      # Auto-archive service (extracted for server startup)
  inventoryBalanceCache.ts            # Inventory cache
  customerStatsCache.ts               # Customer stats cache
  adminShipService.ts                 # Admin force ship (isolated, feature-flagged)
  trackingSync.ts                     # Background tracking sync (excludes terminal statuses)
  shopifyOrderProcessor.ts            # Shopify webhook processor (tracking sync only)

utils/
  orderStateMachine.ts                # Line status state machine
  orderViews.ts                       # VIEW_CONFIGS (flattening, enrichment)
  orderEnrichment/                    # Enrichment pipeline (9 files)
  patterns/                           # Query patterns (inventory, transactions, etc.)
```

### Root (Monorepo)
```
prisma/
  schema.prisma                       # Database schema (shared by client + server)
  migrations/                         # Prisma migrations
  seed.js                             # Database seeding
package.json                          # Root package with Prisma deps
nixpacks.toml                         # Railway build config
```

## Products & Materials Architecture

### Data Model
**Products page** (`/products`) has 5 main tabs:
1. **Products**: Dual-view (Hierarchy tree / SKU flat table) with column reordering + pagination
2. **Materials**: 3-tier tree (Material → Fabric → Colour)
3. **Trims**: Flat catalog
4. **Services**: Flat catalog
5. **BOM**: Master-detail with URL state sync

### 3-Tier Hierarchies (TanStack Table)

**Products**: `Product → Variation → SKU`
- Tree: `ProductsTree` | Flat: `SkuFlatView` | View switcher: `ProductsViewSwitcher`
- Types: `client/src/components/products/types.ts`
- Cells: `client/src/components/products/cells/` (ExpanderCell, NameCell, TypeBadgeCell, etc.)

**Materials**: `Material → Fabric → Colour`
- Component: `MaterialsTreeTable` | View: `MaterialsTreeView`
- Two view modes: `fabric` (fabrics at top) / `material` (full hierarchy)
- Types: `client/src/components/materials/types.ts`
- Cells: `client/src/components/materials/cells/` (ColoursCell, ConnectedProductsCell, etc.)
- **Hierarchy rules**: DB-enforced FK constraints (colours→fabrics→materials)

### TanStack Table Pattern

```typescript
// Define getSubRows for hierarchy
const table = useReactTable({
  data,
  columns,
  getSubRows: (row) => row.children, // Auto expansion
  getCoreRowModel: getCoreRowModel(),
  getExpandedRowModel: getExpandedRowModel(),
  state: { expanded }, // Separate from data
});

// Cell components as separate files
export function ExpanderCell({ row }: CellContext<NodeType>) {
  return row.getCanExpand() ? (
    <button onClick={row.getToggleExpandedHandler()}>
      {row.getIsExpanded() ? <ChevronDown /> : <ChevronRight />}
    </button>
  ) : null;
}
```

### Inheritance Pattern (Materials)

Colours inherit `costPerUnit`, `leadTimeDays`, `minOrderQty` from parent fabric:

```typescript
// Server computes effective values
effectiveCostPerUnit: colour.costPerUnit ?? fabric.costPerUnit,
costInherited: colour.costPerUnit === null,
```

UI shows inheritance indicator (↑) when using fabric value.

### Master-Detail with URL Sync

Pattern used in Products BOM tab:

```typescript
// Parse URL on mount
const selectedId = searchParams.get('id');
const selectedType = searchParams.get('type');

// Sync selection to URL
const handleSelect = (node) => {
  setSearchParams({ tab: 'bom', id: node.id, type: node.type });
};
```

Enables deep linking to specific product/variation/SKU details.

## Configuration

Centralized config system in `/server/src/config/`:
- **Mappings**: `/mappings/` - Payment gateways, tracking status codes
- **Thresholds**: `/thresholds/` - Customer tiers, order timing, inventory
- **Sync**: `/sync/` - Shopify & iThink integration settings

## Dev & Deploy

### Monorepo Structure

Prisma lives at root (`/prisma/`) - "Shared Brain" pattern:
- Both `client` (Server Functions) and `server` (Express) share the same Prisma client
- Run `npm run db:generate` from root to generate client for both packages
- Migrations: `npm run db:migrate` from root

### Production Architecture

Production uses a unified server (`server/src/production.js`):
- Single HTTP server on PORT (default 3000)
- `/api/*` routes → Express (auth, webhooks, SSE, file uploads)
- All other routes → TanStack Start SSR

```
Request → production.js
           ├── /api/* → Express (expressApp.js)
           └── /* → TanStack Start SSR (client/dist/server/server.js)
```

Key files:
- `server/src/production.js` - Unified entry point
- `server/src/expressApp.js` - Express app factory (shared between dev & prod)

### Scripts & Environment

- **Scripts**: `server/src/scripts/` — run with `npx ts-node src/scripts/scriptName.ts`
- **Env vars**:
  - `DATABASE_URL`, `JWT_SECRET` (required)
  - `ENABLE_ADMIN_SHIP` (default: true) - Enable admin force ship feature

### Railway CLI (REQUIRED for Deployment)

> **⚠️ ALWAYS use Railway CLI for deployment tasks.** This is our primary deployment platform.

**Installation**: `npm install -g @railway/cli`

**Essential Commands**:
```bash
railway login                    # Authenticate (one-time)
railway link                     # Link to project (one-time per repo)
railway status                   # Check current project/service status
railway logs                     # View runtime logs (deployed app)
railway variables                # List environment variables
railway variables --set "KEY=value"  # Set environment variable
railway up                       # Deploy current code (manual trigger)
railway up --detach              # Deploy and return immediately (shows build URL)
railway redeploy --yes           # Redeploy latest successful build
railway open                     # Open Railway dashboard in browser
```

**Debugging Builds**:
```bash
# Force fresh build (clears Docker layer cache)
railway variables --set "NO_CACHE=1"
railway redeploy --yes

# After successful build, remove to re-enable caching
railway variables --unset "NO_CACHE"
```

**Key Files**:
- `railway.json` - Railway-specific config (builder, deploy settings)
- `nixpacks.toml` - Build phases (setup, install, build, start) - Node.js 22
- `.dockerignore` - Exclude files from build context (node_modules, dist)
- `prisma/schema.prisma` - Database schema (at root, not in server/)

**Build Order** (nixpacks.toml):
1. Install root deps + generate Prisma client
2. Build shared types
3. Build server
4. Build client (SSR)

**Common Issues**:
- Build cache stale? Set `NO_CACHE=1` for one build
- Module not found? Check `.dockerignore` excludes `node_modules`
- TypeScript errors? Ensure `shared` builds before `client`
- Prisma not found? Ensure running from root where `/prisma/` lives

## When to Use Agents

- **Exploring codebase** → `Explore` agent
- **Multi-file searches** → `general-purpose` agent
- **Complex implementations** → `elite-engineer` or `fullstack-erp-engineer`
- **Logic verification** → `logic-auditor`
- **Documentation** → `doc-optimizer` or `codebase-steward`
- **Planning** → `Plan` agent

## Application Structure

### Pages Overview
| Page | Purpose | View Type |
|------|---------|-----------|
| `/orders` | Order fulfillment pipeline | AG-Grid (Open/Shipped/Cancelled views) |
| `/products` | Product catalog + BOM | TanStack Table trees + flat tables (5 tabs) |
| `/materials` | Materials catalog (legacy standalone) | Tree view |
| `/inventory` | Stock management | AG-Grid |
| `/customers` | Customer management | AG-Grid |
| `/analytics` | Business metrics | Charts + tables |
| `/returns` | Customer returns | AG-Grid |
| `/returns-rto` | RTO processing | AG-Grid |

**Note**: `/products` consolidates Products, Materials, Trims, Services, and BOM. Legacy `/materials` page exists but use `/products?tab=materials` for new work.

---
**Updated till commit:** `90b3f6b` (2026-01-22) - Type safety improvements: error handling with `catch (error: unknown)`, Prisma typing, handler return types, Express Zod validation
