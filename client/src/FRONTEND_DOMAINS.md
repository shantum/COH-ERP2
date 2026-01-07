# Frontend Domains

Overview of frontend page organization and component structure.

## Page-to-Domain Mapping

| Page | Size | Backend Domain | Purpose |
|------|------|----------------|---------|
| `Orders.tsx` | 40KB | Orders | Order management tabs (5 tabs) |
| `Returns.tsx` | 114KB | Returns | Full return workflow |
| `ReturnInward.tsx` | 74KB | Returns | Receiving and QC |
| `Inventory.tsx` | 42KB | Inventory | Stock levels |
| `Ledgers.tsx` | 23KB | Inventory | Transaction history |
| `Production.tsx` | 50KB | Production | Batch planning |
| `ProductionInward.tsx` | 46KB | Production | Record completions |
| `Products.tsx` | 49KB | Products | Product/SKU management |
| `Fabrics.tsx` | 37KB | Fabrics | Fabric inventory |
| `FabricReconciliation.tsx` | 24KB | Fabrics | Physical stock count |
| `Customers.tsx` | 18KB | Customers | Customer database |
| `Dashboard.tsx` | 7KB | Reports | Overview stats |
| `Picklist.tsx` | 7KB | Orders | Pick list generation |
| `Settings.tsx` | 4KB | Admin | Settings tabs container |
| `Login.tsx` | 3KB | Auth | Authentication |

## Orders Page Tabs

The Orders page has 5 tabs with dedicated grids:

| Tab | Component | Endpoint | Purpose |
|-----|-----------|----------|---------|
| Open | `OrdersGrid.tsx` | `/orders/open` | Orders being fulfilled |
| Shipped | `ShippedOrdersGrid.tsx` | `/orders/shipped` | Successfully shipped (excludes RTO/COD pending) |
| RTO | `RtoOrdersGrid.tsx` | `/orders/rto` | Return to Origin orders |
| COD Pending | `CodPendingGrid.tsx` | `/orders/cod-pending` | Delivered COD awaiting payment |
| Archived | `ArchivedOrdersGrid.tsx` | `/orders/archived` | Historical orders |

## Large Files Warning

Files over 50KB are harder to fit in Claude's context:

| File | Size | Recommendation |
|------|------|----------------|
| `Returns.tsx` | 114KB | Could split into tabs/modes |
| `ShopifyTab.tsx` | 80KB | Sync controls + webhook view |
| `OrdersGrid.tsx` | 56KB | Dense AG-Grid logic |
| `Production.tsx` | 50KB | Planning + calendar |
| `Products.tsx` | 49KB | Multi-level CRUD |

## Component Organization

```
client/src/
├── components/
│   ├── orders/          # Order-specific components (15 files)
│   │   ├── OrdersGrid.tsx        (56KB) — Main open orders grid
│   │   ├── ShippedOrdersGrid.tsx (38KB) — Shipped orders grid
│   │   ├── ArchivedOrdersGrid.tsx(26KB) — Archived orders with analytics
│   │   ├── TrackingModal.tsx     (23KB) — iThink tracking with scan history
│   │   ├── OrderViewModal.tsx    (21KB) — Order details
│   │   ├── CreateOrderModal.tsx  (18KB) — Manual order creation
│   │   ├── CustomerDetailModal.tsx(16KB)— Customer popup
│   │   ├── RtoOrdersGrid.tsx     (15KB) — RTO orders grid [NEW]
│   │   ├── EditOrderModal.tsx    (13KB) — Edit order
│   │   ├── CodPendingGrid.tsx    (12KB) — COD pending grid [NEW]
│   │   ├── OrderDetailModal.tsx  (8KB)  — Simple detail view
│   │   ├── SummaryPanel.tsx      (6KB)  — Stats panel
│   │   ├── ShipOrderModal.tsx    (4KB)  — Ship order form
│   │   ├── NotesModal.tsx        (3KB)  — Order notes
│   │   └── index.ts              — Exports
│   │
│   ├── settings/        # Settings page components
│   │   └── tabs/        # 6 tab components
│   │       ├── ShopifyTab.tsx     (80KB) — Shopify sync controls
│   │       ├── GeneralTab.tsx     (35KB) — Users, tiers, tracking config
│   │       ├── RemittanceTab.tsx  (28KB) — COD payment tracking
│   │       ├── InspectorTab.tsx   (11KB) — Database viewer
│   │       ├── DatabaseTab.tsx    (10KB) — DB management
│   │       ├── ImportExportTab.tsx(8KB)  — CSV import/export
│   │       └── index.ts           — Exports
│   │
│   ├── Layout.tsx       (5KB) — Main layout wrapper
│   ├── JsonViewer.tsx   (6KB) — JSON display component
│   ├── Modal.tsx        (6KB) — Reusable modal
│   └── ErrorBoundary.tsx(3KB) — Error handling
│
├── pages/              # Route-level components (15 files)
│
├── hooks/              # Custom hooks (3 files)
│   ├── useAuth.tsx          (2KB)  — Auth context and hooks
│   ├── useOrdersMutations.ts(9KB)  — Order action mutations
│   └── useOrdersData.ts     (6KB)  — Order data fetching (5 tabs)
│
├── services/
│   └── api.ts          (480+ lines) — Axios client with all API functions
│
└── types/
    └── index.ts        (642 lines) — All TypeScript types
```

## Key Patterns

### Data Fetching
Uses **TanStack Query** for server state:
```typescript
const { data, isLoading } = useQuery({
    queryKey: ['orders', 'open'],
    queryFn: () => api.get('/orders/open')
})
```

### AG-Grid Usage
Order grids use AG-Grid with:
- Column definitions with custom cell renderers
- Row selection for bulk actions
- Conditional row styling (colors by status)
- Server-side pagination (archived only)

### Modals
Pattern for modals:
```typescript
// Parent manages modal state
const [isOpen, setIsOpen] = useState(false)
const [selected, setSelected] = useState(null)

<OrderViewModal 
    isOpen={isOpen} 
    order={selected}
    onClose={() => setIsOpen(false)}
/>
```

### Custom Hooks
**useOrdersData** - Centralized data fetching for all 5 tabs:
```typescript
const {
    openOrders, shippedOrders, rtoOrders, codPendingOrders, archivedOrders,
    rtoTotalCount, codPendingTotalCount, codPendingTotalAmount,
    shippedSummary, isLoading
} = useOrdersData({ activeTab, shippedDays, archivedDays, archivedSortBy })
```

**useOrdersMutations** - All order action mutations:
```typescript
const mutations = useOrdersMutations()
// mutations.allocate.mutate(lineId)
// mutations.ship.mutate(orderId)
// mutations.markDelivered.mutate(orderId)
```

## API Client (`services/api.ts`)

Centralized axios instance with:
- Base URL configuration
- Auth token interceptor
- Error handling
- All API functions exported

Key exports:
```typescript
ordersApi.getOpen()
ordersApi.getShipped()
ordersApi.getRto()                // NEW
ordersApi.getCodPending()         // NEW
ordersApi.allocateLine(lineId)
ordersApi.ship(orderId, data)
ordersApi.getArchivedAnalytics()
inventoryApi.getBalance()
shopifyApi.sync(type)
trackingApi.getAwbTracking(awb)
remittanceApi.upload(file)
// ... 100+ functions
```

## Types (`types/index.ts`)

Source of truth for TypeScript interfaces:
```typescript
interface Order { ... }
interface OrderLine { ... }
interface ReturnRequest { ... }
interface Sku { ... }
interface InventoryTransaction { ... }
// ... 50+ interfaces
```

## State Management

- **Server state**: TanStack Query (caching, refetching)
- **Auth state**: React Context (`useAuth`)
- **Local UI state**: useState/useReducer
- **No Redux** — keep it simple

## Styling

- **Tailwind CSS** for utility classes
- Color scheme:
  - Green: Packed/allocated
  - Emerald: Picked
  - Blue: Ready to pack
  - Amber: Production queued / COD pending / RTO
  - Red: Errors/alerts

## Settings Page Tabs

| Tab | Component | Purpose |
|-----|-----------|---------|
| General | `GeneralTab.tsx` | Users, tier thresholds, iThink config |
| Shopify | `ShopifyTab.tsx` | Sync controls, webhook activity |
| CSV Import/Export | `ImportExportTab.tsx` | Bulk data upload/download |
| COD Remittance | `RemittanceTab.tsx` | COD payment CSV upload, Shopify sync |
| Database | `DatabaseTab.tsx` | Clear tables, DB management |
| Data Inspector | `InspectorTab.tsx` | View raw database records |

## Recent Changes (January 7, 2026)

- **RtoOrdersGrid** added for dedicated RTO order management
- **CodPendingGrid** added for COD orders awaiting payment
- **Orders page now has 5 tabs**: Open, Shipped, RTO, COD Pending, Archived
- **useOrdersData** updated to fetch RTO and COD pending data
- **Shipped orders** now exclude RTO and unpaid COD (they have dedicated tabs)
- **RemittanceTab** for COD payment tracking
- **ArchivedOrdersGrid** has analytics endpoint with revenue stats

## Common Gotchas

1. **Large file sizes**: Some pages need refactoring
2. **AG-Grid license**: Using community edition (no row grouping)
3. **Types in sync**: Update `types/index.ts` when backend changes
4. **API client is large**: 480+ lines, search for specific function
5. **useQuery keys**: Follow pattern `[entity, filter]`
6. **Modal state in parent**: Modals don't manage their own visibility
7. **Settings is tabbed**: Main page is just container, logic in tab components
8. **Order hooks**: Use `useOrdersData` and `useOrdersMutations` for orders page
9. **5 order tabs**: Each tab has dedicated grid and endpoint
