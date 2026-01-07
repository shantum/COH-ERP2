# Frontend Domains

Overview of frontend page organization and component structure.

## Page-to-Domain Mapping

| Page | Size | Backend Domain | Purpose |
|------|------|----------------|---------|
| `Orders.tsx` | 38KB | Orders | Order management tabs |
| `Returns.tsx` | 113KB | Returns | Full return workflow |
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
| `Settings.tsx` | 4KB | Admin | System settings |
| `Login.tsx` | 3KB | Auth | Authentication |

## Large Files Warning

Files over 50KB are harder to fit in Claude's context:

| File | Size | Recommendation |
|------|------|----------------|
| `Returns.tsx` | 113KB | Could split into tabs/modes |
| `OrdersGrid.tsx` | 56KB | Dense AG-Grid logic |
| `Production.tsx` | 50KB | Planning + calendar |
| `Products.tsx` | 49KB | Multi-level CRUD |

## Component Organization

```
client/src/
├── components/
│   ├── orders/          # Order-specific components (13 files)
│   │   ├── OrdersGrid.tsx        (56KB) — Main open orders grid
│   │   ├── ShippedOrdersGrid.tsx (38KB) — Shipped orders grid
│   │   ├── ArchivedOrdersGrid.tsx(26KB) — Archived orders grid
│   │   ├── TrackingModal.tsx     (23KB) — iThink tracking
│   │   ├── OrderViewModal.tsx    (21KB) — Order details
│   │   ├── CreateOrderModal.tsx  (18KB) — Manual order creation
│   │   ├── CustomerDetailModal.tsx(16KB)— Customer popup
│   │   ├── EditOrderModal.tsx    (13KB) — Edit order
│   │   ├── OrderDetailModal.tsx  (8KB)  — Simple detail view
│   │   ├── SummaryPanel.tsx      (6KB)  — Stats panel
│   │   └── ...
│   │
│   ├── settings/        # Settings page components
│   │
│   ├── Layout.tsx       (5KB) — Main layout wrapper
│   ├── Modal.tsx        (6KB) — Reusable modal
│   └── ErrorBoundary.tsx(3KB) — Error handling
│
├── pages/              # Route-level components
├── hooks/              # Custom hooks
│   ├── useAuth.tsx     — Auth context and hooks
│   └── ...
│
├── services/
│   └── api.ts          (428 lines) — Axios client
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

## API Client (`services/api.ts`)

Centralized axios instance with:
- Base URL configuration
- Auth token interceptor
- Error handling
- All API functions exported

Key exports:
```typescript
api.orders.getOpen()
api.orders.allocateLine(lineId)
api.orders.ship(orderId, data)
api.inventory.getBalance()
api.shopify.sync(type)
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
  - Amber: Production queued
  - Red: Errors/alerts

## Common Gotchas

1. **Large file sizes**: Some pages need refactoring
2. **AG-Grid license**: Using community edition
3. **Types in sync**: Update `types/index.ts` when backend changes
4. **API client is large**: 428 lines, search for specific function
5. **useQuery keys**: Follow pattern `[entity, filter]`
6. **Modal state in parent**: Modals don't manage their own visibility
