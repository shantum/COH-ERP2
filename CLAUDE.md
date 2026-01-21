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
10. **Type-safe by default.** Strict TypeScript, proper tRPC typing, Zod validation. No `any`, no shortcuts.

## 🚧 MIGRATION IN PROGRESS: TanStack Start

> **Active Migration**: Express + tRPC → TanStack Start
> 
> See [TANSTACK_START_MIGRATION_PLAN.md](./TANSTACK_START_MIGRATION_PLAN.md) for full details.

### Migration Strategy: Hybrid Start

| Component | Current | Target | Status |
|-----------|---------|--------|--------|
| Frontend Router | react-router-dom | TanStack Router | 🔄 In Progress |
| Layouts | React components | TanStack `__root.tsx` | 🔄 In Progress |
| Data Fetching | tRPC hooks | Route Loaders → TanStack Query | ⏳ Pending |
| Mutations | tRPC mutations | Server Functions | ⏳ Pending |
| Backend | Express + tRPC | TanStack Start Server | ⏳ Pending |
| Real-time | SSE | SSE → TanStack Query invalidation | ⏳ Pending |

**Key Insight**: tRPC stays running during migration. Call tRPC from TanStack Router pages:

```typescript
// app/routes/orders.tsx - tRPC works inside TanStack Router!
function OrdersPage() {
  const search = Route.useSearch();
  const { data } = trpc.orders.list.useQuery({ view: search.view });
  return <OrdersGrid orders={data?.rows} />;
}
```

### Type Safety Philosophy

> **⚠️ NON-NEGOTIABLE: Zod is the source of truth. Always.**
> - Define schemas in Zod
> - Infer types with `z.infer<>`
> - Validate search params, Server Function inputs
> - **NEVER write `interface` or `type` separately from the Zod schema**

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

#### tRPC Integration (Phase 1)
- tRPC hooks stay inside components for Phase 1
- Ensure `RouterContext` correctly passes `queryClient` and `trpc` instance—this foundation enables Phase 2 Route Loaders without refactoring context

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
npm run db:generate && npm run db:push
```

Login: `admin@coh.com` / `XOFiya@34`

## Stack

### Current (During Migration)
- **Backend**: Express + tRPC + Prisma + PostgreSQL
- **Frontend**: React 19 + TanStack Router + TanStack Query v5 + AG-Grid + Tailwind + shadcn/ui
- **Real-time**: SSE with TanStack Query invalidation

### Target (Post-Migration)
- **Full-stack**: TanStack Start + Prisma + PostgreSQL
- **Data Flow**: Route Loaders → TanStack Query cache → SSE invalidation
- **Validation**: Zod at all boundaries (search params, Server Function inputs)

### UI Components
- **Use shadcn/ui components wherever possible** - buttons, dialogs, dropdowns, inputs, etc.
- Location: `client/src/components/ui/` - check existing components before creating new ones
- Add new shadcn components via: `npx shadcn@latest add <component-name>`
- **Dialog stacking**: Use `DialogStack` from `ui/dialog-stack.tsx` for nested modals (auto z-index management)

## Gotchas (Read First!)

1. **Router order**: specific routes before parameterized (`:id`)
2. **Async routes**: wrap with `asyncHandler()`
3. **Cache invalidation**: mutations MUST invalidate TanStack Query + tRPC + server caches
4. **AG-Grid cellRenderer**: return JSX, not strings; use centralized formatting from `ordersGrid/formatting/`
5. **Shopify data**: lives in `shopifyCache.*`, NEVER use `rawData`
6. **Line fields**: use pre-computed O(1) fields (`lineShippedAt`, `daysInTransit`), not `orderLines.find()` O(n)
7. **View filters**: shipped/cancelled orders stay in Open until Release clicked
8. **Prisma dates**: returns Date objects—use `toDateString()` from `utils/dateHelpers.ts`
9. **Dev URLs**: use `localhost` for API calls
10. **tRPC params**: never `prop: undefined`, use spread `...(val ? {prop: val} : {})`
11. **Deferred tasks**: mutations return immediately; side effects (cache, SSE) run async via `deferredExecutor`
12. **Line-level tracking**: delivery/RTO mutations are line-level; orders can have mixed states (partial delivery, multi-AWB)
13. **Admin ship**: use `adminShip` mutation (not `ship` with force flag); requires admin role + `ENABLE_ADMIN_SHIP=true`
14. **Tracking status mapping**: TEXT patterns override status codes; `cancel_status="Approved"` always means cancelled; "UD" code is unreliable
15. **Shopify fulfillment**: syncs tracking data ONLY; ERP is source of truth for `shipped` status—never auto-ship from webhooks
16. **Tracking sync**: excludes terminal statuses (`delivered`, `rto_delivered`) to avoid wasting API calls on unchangeable data
17. **Page sizes**: Open=500 (active mgmt), Shipped/Cancelled=100 (historical views)
18. **TypeScript checks BEFORE committing**: ALWAYS run `cd client && npx tsc -p tsconfig.app.json --noEmit && cd ../server && npx tsc --noEmit` before every commit. This is NON-NEGOTIABLE. The client uses project references—`tsconfig.app.json` has stricter checks than the root config. Delete `.tsbuildinfo` if you suspect caching issues. Never push code with TypeScript errors.
19. **TanStack Table trees**: use `getSubRows` for hierarchy, never mutate `children` directly; expansion state separate from data
20. **Fabric hierarchy**: Database enforces Material→Fabric→Colour consistency; colours MUST have fabricId, fabrics MUST have materialId
21. **Inheritance pattern**: Fabric colours inherit cost/lead/minOrder from parent fabric if not explicitly set (priority: colour → fabric → null)
22. **Cell components**: Modularize into `/cells/` directory with barrel export from `index.ts`; reusable across tables
23. **URL state sync**: Master-detail views sync selection to URL params (`?tab=bom&id=123&type=product`); parse on mount, update on selection

## Orders Architecture

### Data Model
- Single page `/orders` with dropdown selector
- Views: Open, Shipped, Cancelled (3 views)
- Shipped has filter chips: All, RTO, COD Pending (server-side filtering via `shippedFilter`)
- Each row = one order line (server-flattened), `isFirstLine` marks header for grouping
- Note: Archived view hidden from UI but auto-archive runs silently

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

## Data Fetching & Mutations (During Migration)

### Current Pattern (tRPC - Still Active)
```typescript
import { trpc } from '@/services/trpc';
const { data } = trpc.orders.list.useQuery({ view: 'open' });
const mutation = trpc.orders.ship.useMutation();
```

### Target Pattern (TanStack Start)
```typescript
// Route loader (SSR)
loader: async ({ search }) => getOrders({ data: search })

// Component (hydrated from loader)
const { data } = useQuery({
  queryKey: ['orders', search],
  queryFn: () => getOrders({ data: search }),
  initialData: Route.useLoaderData(),
});
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

### Server
```
config/                               # Centralized configuration system
config/mappings/trackingStatus.ts     # iThink status mapping (text-first, cancel_status priority)
routes/
  orders/mutations/                   # crud, lifecycle, archive, lineOps, customization
  orders/queries/                     # views, search, summaries, analytics
  materials.ts                        # Materials hierarchy (Material→Fabric→Colour) + Trims/Services
  products.ts                         # Products hierarchy (Product→Variation→SKU)
  bom.ts                              # BOM management (product/variation level)
  tracking.ts                         # Tracking endpoints (AWB, batch, sync, debug /raw/:awb)
utils/orderStateMachine.ts            # Line status state machine
utils/orderViews.ts                   # VIEW_CONFIGS (flattening, enrichment)
utils/orderEnrichment/                # Enrichment pipeline (9 files)
utils/patterns/                       # Query patterns (inventory, transactions, etc.)
services/inventoryBalanceCache.ts     # Inventory cache
services/customerStatsCache.ts        # Customer stats cache
services/adminShipService.ts          # Admin force ship (isolated, feature-flagged)
services/trackingSync.ts              # Background tracking sync (excludes terminal statuses)
services/shopifyOrderProcessor.ts     # Shopify webhook processor (tracking sync only, no auto-ship)
trpc/routers/
  orders.ts                           # Orders tRPC procedures
  products.ts                         # Products tree query
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
- `nixpacks.toml` - Build phases (setup, install, build, start)
- `.dockerignore` - Exclude files from build context (node_modules, dist)

**Common Issues**:
- Build cache stale? Set `NO_CACHE=1` for one build
- Module not found? Check `.dockerignore` excludes `node_modules`
- TypeScript errors? Ensure `shared` builds before `client`

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
**Updated till commit:** `5e1ee92` (2026-01-21)
