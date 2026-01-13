# Frontend Patterns

> Common patterns, hooks, and utilities for React frontend.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Framework | React 19, TypeScript, TanStack Query |
| Grid | AG-Grid with custom theme |
| API Clients | tRPC (type-safe, preferred) + Axios (legacy) |
| Key Files | `services/trpc.ts`, `hooks/useGridState.ts`, `services/api.ts` |
| Shared Components | `components/common/` (ProductSearch, CustomerSearch, modals) |
| Constants | `constants/` (queryKeys, sizes) |

## tRPC Client (Preferred)

Type-safe API client with full inference from server routers.

**Files**:
- `services/trpc.ts` - Client with auth integration (httpBatchLink, superjson transformer)
- `providers/TRPCProvider.tsx` - React provider (shares QueryClient with TanStack Query)
- `services/index.ts` - Central export for both clients

**Usage**:
```typescript
import { trpc } from '@/services/trpc';

// Queries
const { data } = trpc.orders.list.useQuery({ view: 'open', limit: 500 });
// Optimized inventory - fetches only SKUs in open orders
const { data: inventory } = trpc.inventory.getBalances.useQuery({ skuIds: openOrderSkuIds });

// Mutations with cache invalidation
const utils = trpc.useUtils();
const createMutation = trpc.orders.create.useMutation({
  onSuccess: () => utils.orders.list.invalidate({ view: 'open', limit: 500 })
});
```

**tRPC Migration Status**:

| Domain | tRPC | Axios | Notes |
|--------|------|-------|-------|
| Orders list (6 views) | Yes | - | `trpc.orders.list.useQuery()` |
| Orders create | Yes | - | `trpc.orders.create.useMutation()` |
| Orders allocate | Yes | - | `trpc.orders.allocate.useMutation()` |
| Orders ship (lines) | Yes | - | `trpc.orders.ship.useMutation()` |
| Inventory balance | Yes | - | `trpc.inventory.getBalances({ skuIds })` |
| Products list | Yes | - | For SKU dropdown |
| Customers list/get | Yes | - | `trpc.customers.list/get` |
| Order summaries | - | Yes | Pending tRPC procedures |
| Pick/Pack/Unallocate | - | Yes | Use `ordersApi` methods |
| Supporting (fabrics, production) | - | Yes | Different API domains |

## Dual Cache Invalidation

Both Axios (TanStack Query) and tRPC caches coexist. Mutations must invalidate both.

```typescript
// In useOrdersMutations.ts
const invalidateTab = (tab: string, debounce = false) => {
  // 1. Invalidate Axios query keys
  keysToInvalidate.forEach(key => queryClient.invalidateQueries({ queryKey: [key] }));

  // 2. Invalidate tRPC cache
  trpcUtils.orders.list.invalidate({ view: tab, limit: 500 });
};
```

**Key**: Always invalidate BOTH caches after mutations that affect data fetched by either client.

## Page-to-Domain Mapping

| Page | Route | Backend Domain |
|------|-------|----------------|
| `Orders.tsx` | `/orders` | Orders (Open, Cancelled tabs) |
| `Shipments.tsx` | `/shipments` | Orders (Shipped, RTO, COD Pending, Archived tabs) |
| `OrderSearch.tsx` | `/order-search` | Orders (GlobalOrderSearch full page) |
| `Inventory.tsx` | `/inventory` | Inventory (SKU lookup, stock filters) |
| `InventoryInward.tsx` | `/inventory-inward` | Inventory (scan-first: Production, Adjustments) |
| `ReturnsRto.tsx` | `/returns-rto` | Inventory (scan-first: Returns, RTO, Repacking) |
| `Returns.tsx` | `/returns` | Returns |
| `Production.tsx` | `/production` | Production |
| `Catalog.tsx` | `/catalog` | Catalog |
| `Fabrics.tsx` | `/fabrics` | Fabrics |
| `Customers.tsx` | `/customers` | Customers |
| `InwardHub.tsx` | `/inward-hub` | **@deprecated** - redirects to `/inventory-inward` |

**URL Backward Compatibility**: Old tab URLs like `/orders?tab=shipped` redirect to `/shipments?tab=shipped`

## Performance Patterns

**Sequential background loading** (`useOrdersData.ts`):
```typescript
// Active tab loads immediately via tRPC
// Remaining tabs load sequentially: Open -> Shipped -> RTO -> COD Pending -> Cancelled -> Archived
// Each tab enabled when previous completes: enabled: activeTab === 'rto' || shippedOrdersQuery.isSuccess
// Inventory balance only fetches SKUs in open orders (openOrderSkuIds) - reduces ~3MB to ~50-100KB
```

**O(1) map caching** (`orderHelpers.ts`):
```typescript
const invMap = getInventoryMap(inventoryBalance);
const stock = invMap.get(line.skuId) ?? 0;  // O(1) vs O(n) find()
```

**Optimistic updates** - see dedicated section below.

## Optimistic Updates

Patterns for responsive UI without full refetches.

### Selective Object Updates (Preserve Grid State)

```typescript
// BAD: Replaces entire array, loses checkbox/selection state
queryClient.setQueryData(['orders', 'open'], (old) => ({
  ...old,
  orders: old.orders.map(o => o.id === orderId ? {...o, status: 'allocated'} : o)
}));

// GOOD: Only updates specific object reference, preserves grid state
queryClient.setQueryData(['orders', 'open'], (old) => {
  const orderIndex = old.orders.findIndex(o => o.id === orderId);
  if (orderIndex === -1) return old;
  const newOrders = [...old.orders];
  newOrders[orderIndex] = { ...newOrders[orderIndex], status: 'allocated' };
  return { ...old, orders: newOrders };
});
```

### Filtered Inventory Invalidation

Don't refetch all balances - only invalidate affected SKUs:

```typescript
// BAD: Refetches entire inventory
trpcUtils.inventory.getAllBalances.invalidate();

// GOOD: Extract affected SKUs, refetch only those
const affectedSkuIds = order.lines.map(l => l.skuId);
const updatedBalances = await trpc.inventory.getBalances.query({ skuIds: affectedSkuIds });
queryClient.setQueryData(['inventory', 'balances'], (old) => {
  // Merge only the changed balances
  return { ...old, ...updatedBalances };
});
```

### Skip Stale Updates Pattern

Prevent optimistic cache from being overwritten by slow responses:

```typescript
onMutate: () => ({ skipped: false }),
onSuccess: (_, __, ctx) => {
  if (ctx?.skipped) return;  // Skip if newer data arrived
  invalidateTab('open');
}
```

### Field Name Consistency

Always check tRPC router types for correct field names:

| Domain | Correct | Wrong |
|--------|---------|-------|
| Inventory | `totalReserved` | `reservedBalance` |
| Orders | `trackingStatus` | `status` (different meaning) |

## Shared Components

Located in `components/common/`:

| Component | Purpose | Previously |
|-----------|---------|------------|
| `ProductSearch.tsx` | SKU/product autocomplete with inventory | Was duplicated in 3 files |
| `CustomerSearch.tsx` | Customer autocomplete with tier display | Was duplicated in 3 files |
| `ConfirmModal.tsx` | Confirmation dialog | - |
| `FormModal.tsx` | Generic form modal | - |
| `InfoModal.tsx` | Information display modal | - |

**Order Modals**: Use `UnifiedOrderModal` with `mode='view'|'edit'|'ship'`. Deprecated modals removed: EditOrderModal, ShipOrderModal, OrderViewModal, OrderDetailModal, NotesModal.

## Constants

Located in `constants/`:

| File | Exports | Notes |
|------|---------|-------|
| `queryKeys.ts` | `queryKeys`, `invalidateTab` | Centralized cache keys |
| `sizes.ts` | `SIZE_ORDER`, `sortBySizeOrder()` | Was duplicated in 8 files |

## Custom Hooks

| Hook | Purpose |
|------|---------|
| `useOrdersData` | Open + Cancelled tabs for Orders page (tRPC) |
| `useOrdersMutations` | Pre-shipment mutations: allocate, pick, pack, ship, cancel (mixed tRPC/Axios) |
| `useShipmentsData` | Shipped, RTO, COD Pending, Archived tabs for Shipments page (tRPC) |
| `useShipmentsMutations` | Post-shipment mutations: archive, unarchive, markDelivered, markRto, receiveRto, unship |
| `useGridState` | AG-Grid column state with localStorage + server sync |
| `usePermissions` | Permission checking |

**Hook Split Pattern**: When a page is split (Orders -> Orders + Shipments), split the hooks too:
- Data hooks fetch tab-specific data with sequential background loading
- Mutation hooks contain only mutations relevant to that page's tabs
- Both use dual cache invalidation (Axios + tRPC)

## AG-Grid Utilities

| File | Purpose |
|------|---------|
| `agGridHelpers.ts` | Theme, formatters (date, currency, relative time) |
| `useGridState.ts` | Column visibility, order, widths, server sync |
| `common/grid/` | Reusable: StatusBadge, TrackingStatusBadge, ColumnVisibilityDropdown |

### AG-Grid cellRenderer Pattern

**CRITICAL**: `cellRenderer` must return JSX elements, not HTML strings.

```typescript
// BAD: HTML string gets escaped and displayed as text
cellRenderer: (params) => {
  return '<span class="text-red-600">Error</span>';  // Shows literal string!
}

// GOOD: Return JSX element
cellRenderer: (params) => {
  return <span className="text-red-600">Error</span>;
}
```

**Why**: AG-Grid treats string returns as text content and escapes HTML. Only JSX/React elements render as markup.

**Pattern used in**: `Inventory.tsx` Status column (lines 218-226), `Catalog.tsx`, `Orders.tsx`

## useGridState API

```typescript
const {
  visibleColumns,
  columnOrder,
  columnWidths,
  pageSize,
  handleToggleColumn,
  handleResetAll,
  handleColumnMoved,
  handleColumnResized,
  handlePageSizeChange,
  isManager,
  hasUnsavedChanges,
  isSavingPrefs,
  savePreferencesToServer
} = useGridState({ gridId: 'gridId', allColumnIds, defaultPageSize: 100, defaultHiddenColumns: [] });
```

**Helper functions** (exported from `useGridState.ts`):
- `getColumnOrderFromApi(api)` - Extract column order from AG-Grid API
- `applyColumnVisibility(columnDefs, visibleColumns)` - Apply visibility to column defs
- `orderColumns(columnDefs, columnOrder)` - Reorder columns based on saved order
- `applyColumnWidths(columnDefs, columnWidths)` - Apply saved widths to column defs

## Query Keys

Centralized in `constants/queryKeys.ts`:
```typescript
import { queryKeys, invalidateTab } from './constants/queryKeys';

// Axios queries
queryClient.invalidateQueries(queryKeys.orders.open);

// tRPC queries (different pattern)
trpcUtils.orders.list.invalidate({ view: 'open', limit: 500 });
```

## Catalog Component Pattern

Large page split into extracted utilities and components:

```
pages/Catalog.tsx (944 lines, down from 2376)
├── utils/catalogAggregations.ts  # aggregateByVariation, aggregateByProduct
├── utils/catalogColumns.ts       # AG-Grid column definitions
└── components/catalog/
    ├── CatalogFilters.tsx        # Filter controls
    ├── EditModal.tsx             # Edit dialog
    └── FabricEditPopover.tsx     # Fabric assignment
```

Use this pattern when a page exceeds ~1500 lines.

## Collapsible Sidebar

Located in `components/Layout.tsx`. Features:
- Toggle button at bottom of sidebar (desktop only)
- `localStorage.getItem('sidebar-collapsed')` persists preference
- Hover expansion: collapsed sidebar expands on mouse enter
- Icons remain visible when collapsed with tooltips

## Gotchas

1. **Dual cache**: Mutations must invalidate both Axios and tRPC caches
2. **tRPC input matching**: Invalidation input must match query input exactly (`{ view: 'open', limit: 500 }`)
3. **Tab counts delayed**: Populate progressively as loading completes
4. **Map caching required**: Use `getInventoryMap()`/`getFabricMap()` for loops
5. **Optimistic context pattern**: Use `skipped` for conditional invalidation
6. **Selective cache updates**: Use index-based updates, not `.map()` - preserves AG-Grid checkbox state
7. **Inventory field names**: Use `totalReserved` not `reservedBalance` (check tRPC types)
8. **AG-Grid shared**: Use `agGridHelpers.ts` - don't recreate formatters
9. **Column sync**: Managers can sync preferences for all users via server
10. **Pinned columns**: Set `pinned: 'right'` to keep Actions visible after resize
11. **tRPC errors**: Different shape than Axios - use `err.message` not `err.response?.data?.error`
12. **SIZE_ORDER**: Import from `constants/sizes.ts`, not local definition
13. **UnifiedOrderModal**: Use for all order operations (view/edit/ship), not legacy modals
14. **Page split mutations**: When splitting pages, ensure all mutation references are updated (e.g., remove `archiveOrder` from Orders.tsx after moving to useShipmentsMutations)
15. **URL-based tab state**: Use `useSearchParams` for tab state - cleaner than local state, enables deep linking and refresh
16. **GlobalOrderSearch routing**: Includes page navigation logic to route between Orders and Shipments pages based on order status
17. **AG-Grid cellRenderer JSX**: Return JSX elements, not HTML strings - strings get escaped and display as text
