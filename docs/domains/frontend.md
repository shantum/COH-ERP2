# Frontend Patterns

> Common patterns, hooks, and utilities for React frontend.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Framework | React 19, TypeScript, TanStack Query |
| Grid | AG-Grid with custom theme |
| API Clients | tRPC (type-safe, preferred) + Axios (legacy) |
| Key Files | `services/trpc.ts`, `hooks/useGridState.ts`, `services/api.ts` |

## tRPC Client (Preferred)

Type-safe API client with full inference from server routers.

**Files**:
- `services/trpc.ts` - Client with auth integration
- `providers/TRPCProvider.tsx` - React provider (shares QueryClient with TanStack Query)
- `services/index.ts` - Central export for both clients

**Usage**:
```typescript
import { trpc } from '@/services/trpc';

// Queries
const { data } = trpc.orders.list.useQuery({ view: 'open', limit: 500 });
const { data: inventory } = trpc.inventory.getAllBalances.useQuery({ includeCustomSkus: true });

// Mutations with cache invalidation
const utils = trpc.useUtils();
const createMutation = trpc.orders.create.useMutation({
  onSuccess: () => utils.orders.list.invalidate({ view: 'open', limit: 500 })
});
```

**Migration Status** (Phase 12):

| Domain | tRPC | Axios | Notes |
|--------|------|-------|-------|
| Orders list (6 views) | Yes | - | `trpc.orders.list.useQuery()` |
| Orders create/allocate/ship | Yes | - | Key mutations migrated |
| Inventory balance | Yes | - | `trpc.inventory.getAllBalances` |
| Products list | Yes | - | For SKU dropdown |
| Customers list/get | Yes | - | `trpc.customers.list/get` |
| Order summaries | - | Yes | Pending tRPC procedures |
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

| Page | Backend Domain |
|------|----------------|
| `Orders.tsx` | Orders (6 tabs) |
| `Returns.tsx`, `ReturnInward.tsx` | Returns |
| `InwardHub.tsx` | Inventory (mode-based: Production, Returns, RTO, Repacking, Adjustments) |
| `Production.tsx` | Production |
| `Catalog.tsx` | Catalog |
| `Fabrics.tsx` | Fabrics |
| `Customers.tsx` | Customers |

## Performance Patterns

**Sequential background loading** (`useOrdersData.ts`):
```typescript
// Active tab loads immediately via tRPC
// Remaining tabs load sequentially: Open -> Shipped -> RTO -> COD Pending -> Cancelled -> Archived
// Each tab enabled when previous completes: enabled: activeTab === 'rto' || shippedOrdersQuery.isSuccess
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

## Custom Hooks

| Hook | Purpose |
|------|---------|
| `useOrdersData` | All 6 tabs with sequential loading (tRPC) |
| `useOrdersMutations` | Order actions with optimistic updates (mixed tRPC/Axios) |
| `useGridState` | AG-Grid column state with localStorage + server sync |
| `usePermissions` | Permission checking |

## AG-Grid Utilities

| File | Purpose |
|------|---------|
| `agGridHelpers.ts` | Theme, formatters (date, currency, relative time) |
| `useGridState.ts` | Column visibility, order, widths, server sync |
| `common/grid/` | Reusable: StatusBadge, TrackingStatusBadge, ColumnVisibilityDropdown |

## useGridState API

```typescript
const {
  visibleColumns,
  columnOrder,
  columnWidths,
  handleToggleColumn,
  handleResetAll,
  handleColumnMoved,
  handleColumnResized,
  isManager,
  hasUnsavedChanges,
  savePreferencesToServer
} = useGridState('gridId', defaultColumns);
```

## Query Keys

Centralized in `constants/queryKeys.ts`:
```typescript
import { queryKeys, invalidateTab } from './constants/queryKeys';

// Axios queries
queryClient.invalidateQueries(queryKeys.orders.open);

// tRPC queries (different pattern)
trpcUtils.orders.list.invalidate({ view: 'open', limit: 500 });
```

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
