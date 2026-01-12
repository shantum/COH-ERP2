# Frontend Patterns

> Common patterns, hooks, and utilities for React frontend.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Framework | React 19, TypeScript, TanStack Query |
| Grid | AG-Grid with custom theme |
| Key Files | `hooks/useGridState.ts`, `utils/agGridHelpers.ts`, `services/api.ts` |

## Page-to-Domain Mapping

| Page | Backend Domain |
|------|----------------|
| `Orders.tsx` | Orders (5 tabs) |
| `Returns.tsx`, `ReturnInward.tsx` | Returns |
| `InwardHub.tsx` | Inventory (mode-based: Production, Returns, RTO, Repacking, Adjustments) |
| `Production.tsx` | Production |
| `Catalog.tsx` | Catalog |
| `Fabrics.tsx` | Fabrics |
| `Customers.tsx` | Customers |

## Inward Hub Components (`components/inward/`)

| Component | Purpose |
|-----------|---------|
| `ModeSelector` | 5 mode cards with pending counts |
| `InwardModeHeader` | Sticky banner with mode indicator |
| `PendingQueuePanel` | Clickable queue, click-to-scan |
| `RecentInwardsTable` | Filtered by source |
| `ProductionInward`, `ReturnsInward`, etc. | Mode-specific scan+form interfaces |

## Performance Patterns

**Sequential background loading** (`useOrdersData.ts`):
```typescript
// Active tab loads immediately
// Remaining tabs load sequentially: Open → Shipped → RTO → COD Pending → Archived
// Tab switching instant due to pre-loading
```

**O(1) map caching** (`orderHelpers.ts`):
```typescript
const invMap = getInventoryMap(inventoryBalance);
const stock = invMap.get(line.skuId) ?? 0;  // O(1) vs O(n) find()
```

**Optimistic updates** (`useOrdersMutations.ts`):
```typescript
onMutate: () => ({ skipped: false }),
onSuccess: (_, __, ctx) => {
  if (ctx?.skipped) return;  // Skip if newer data arrived
  queryClient.invalidateQueries(['orders']);
}
```

## Custom Hooks

| Hook | Purpose |
|------|---------|
| `useOrdersData` | All 5 tabs with sequential loading |
| `useOrdersMutations` | Order actions with optimistic updates |
| `useGridState` | AG-Grid column state with localStorage |
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

// Use
queryClient.invalidateQueries(queryKeys.orders.open);

// Or invalidate by tab
invalidateTab(queryClient, 'shipped');
```

## Gotchas

1. **Tab counts delayed**: Populate progressively as loading completes
2. **Map caching required**: Use `getInventoryMap()`/`getFabricMap()` for loops
3. **Optimistic context pattern**: Use `skipped` for conditional invalidation
4. **AG-Grid shared**: Use `agGridHelpers.ts` - don't recreate formatters
5. **Column sync**: Managers can sync preferences for all users via server
6. **Pinned columns**: Set `pinned: 'right'` to keep Actions visible after resize
