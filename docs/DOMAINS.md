# Domain Reference

> All backend and frontend domains consolidated. **Last updated: January 9, 2026** (Exchange order tracking WIP)

---

## Orders Domain

Order management and fulfillment workflow.

### File Structure
```
orders/
├── index.js        ← Router combiner
├── listOrders.js   ← GET /?view= (unified), legacy /open, /shipped, etc.
├── fulfillment.js  ← POST: /lines/:id/allocate|pick|pack, /:id/ship|unship
└── mutations.js    ← POST/PUT/DELETE: create, update, cancel, archive
```

**Related:** `orderViews.js` (view configs), `queryPatterns.js`, `validation.js`, `tierUtils.js`

### Unified Order Views API

**Single endpoint**: `GET /orders?view=<name>` replaces 5 separate endpoints.

| View | Filter | Sort | Enrichments |
|------|--------|------|-------------|
| `open` | status='open', not archived | orderDate ASC | fulfillmentStage, lineStatusCounts |
| `shipped` | shipped/delivered, excludes RTO & COD pending | shippedAt DESC | daysInTransit, trackingStatus |
| `rto` | trackingStatus in rto_* | rtoInitiatedAt DESC | daysInRto, rtoStatus |
| `cod_pending` | COD + delivered + not remitted | deliveredAt DESC | daysSinceDelivery |
| `archived` | isArchived=true | archivedAt DESC | - |

**Query params**: `view`, `limit`, `offset`, `days`, `search`

**Search** works across: orderNumber, customerName, awbNumber, email, phone

**Architecture** (`server/src/utils/orderViews.js`):
- `ORDER_VIEWS`: Config objects with where, orderBy, enrichment arrays
- `buildViewWhereClause()`: Handles exclusions, date filters, search
- `enrichOrdersForView()`: Applies view-specific enrichments
- `ORDER_UNIFIED_SELECT`: Comprehensive SELECT pattern for all views

**Legacy endpoints** (`/orders/open`, `/orders/shipped`, etc.) still work for backward compatibility.

### Order Line Status Machine
```
pending → allocated → picked → packed → [ship order] → shipped
           ↓
    (creates reserved inventory)
```

**Undo actions:** unallocate (deletes reserved), unpick, unpack, unship (reverses sale + recreates reserved)

**Quick Ship:** `POST /:id/quick-ship` - Allocates all pending lines and ships in one action (requires all lines have stock)

### Validation Schemas (Zod)
| Schema | Endpoint | Validates |
|--------|----------|-----------|
| `ShipOrderSchema` | `POST /:id/ship` | AWB, courier required |
| `CreateOrderSchema` | `POST /` | Customer, lines, payment |
| `UpdateOrderSchema` | `PUT /:id` | Customer, notes |

### Frontend
- `Orders.tsx` (40KB) - 5 tabs: Open, Shipped, RTO, COD Pending, Archived
- `OrdersGrid.tsx` (56KB), `ShippedOrdersGrid.tsx` (38KB), `RtoOrdersGrid.tsx`, `CodPendingGrid.tsx`, `ArchivedOrdersGrid.tsx`

---

## Inventory Domain

SKU inventory with ledger-based transactions.

### Transaction Types
| Type | Description | Reasons |
|------|-------------|---------|
| `inward` | Stock additions | production, return_receipt, adjustment |
| `outward` | Stock removals | sale, damage, adjustment |
| `reserved` | Soft holds | order_allocation |

### Balance Formula
```javascript
Balance = SUM(inward) - SUM(outward)
Available = Balance - SUM(reserved)
```

### Key Endpoints
| Path | Purpose |
|------|---------|
| `GET /balance` | All SKU balances |
| `POST /inward`, `/outward` | Create transactions |
| `POST /quick-inward` | Production inward with barcode |
| `GET /pending-sources` | All inward source counts |
| `GET /pending-queue/:source` | Queue by source (rto, production, returns, repacking) |
| `POST /rto-inward-line` | Per-line RTO with condition |

### RTO Inward Conditions
| Condition | Action |
|-----------|--------|
| `good`, `unopened` | Creates inward transaction |
| `damaged`, `wrong_product` | Creates WriteOffLog |

### Frontend
- `Inventory.tsx` (42KB), `Ledgers.tsx` (23KB), `InwardHub.tsx`

---

## Returns Domain

Return request workflow, repacking queue, write-offs.

### Status Flow
```
requested → reverse_initiated → in_transit → received → processing → completed
                                    ↓
                              [to repacking queue]
```

### Resolution Types
| Resolution | Description |
|------------|-------------|
| `refund` | Full refund, no replacement |
| `exchange_same` | Same item replacement |
| `exchange_up` | Higher value (customer pays diff) |
| `exchange_down` | Lower value (refund diff) |

### Repacking Queue
```
[from returns] → pending → inspecting → repacking → ready | write_off
                                                      ↓         ↓
                                              [add to stock]  [WriteOffLog]
```

### Key Endpoints
| Path | Purpose |
|------|---------|
| `GET /pending` | Awaiting receipt |
| `GET /action-queue` | Dashboard with action counts |
| `POST /:id/receive-item` | Receive and QC item |
| `POST /:id/ship-replacement` | Ship exchange |
| `POST /repacking/process` | Accept or write-off |

### Frontend
- `Returns.tsx` (113KB), `ReturnInward.tsx` (74KB)

---

## Shopify Domain

Sync, webhooks, background jobs, COD payment sync.

### Architecture
```
Shopify Store
     ↓
┌─────────────┐     ┌──────────────┐
│  Webhooks   │────→│  Cache       │────→ Database
│  (realtime) │     │  (first)     │
└─────────────┘     └──────────────┘
                           ↑
┌─────────────┐     ┌──────────────┐
│  Bulk Sync  │────→│  SyncWorker  │────→ COD Payment → Shopify
│  (manual)   │     │  (background)│      Transaction API
└─────────────┘     └──────────────┘
```

### Sync Modes
| Mode | Use Case | Behavior |
|------|----------|----------|
| `DEEP` | Initial setup | Full import, aggressive memory |
| `QUICK` | Daily catch-up | Missing orders only |
| `UPDATE` | Hourly refresh | Recently changed orders |

### Key Endpoints
| Path | Purpose |
|------|---------|
| `GET/PUT /config` | Shopify credentials |
| `GET/PUT /settings/auto-ship` | Auto-ship toggle |
| `POST /sync/full-dump` | Background order sync |
| `POST /webhooks/shopify/orders` | Unified webhook (recommended) |

### Auto-Ship Setting
Controls whether open orders automatically ship when Shopify marks them fulfilled.

| Setting | Behavior |
|---------|----------|
| `auto_ship_fulfilled: true` (default) | Open orders auto-ship on Shopify fulfillment |
| `auto_ship_fulfilled: false` | Strict ERP mode - Shopify fulfillment ignored |

**UI**: Settings → Shopify tab → "Auto-Ship Fulfilled Orders" toggle

**Backend**: `shopifyOrderProcessor.js` checks setting during sync

### COD Payment Sync
```javascript
shopifyClient.markOrderAsPaid(shopifyOrderId, amount, utr, paidAt)
// Creates capture transaction in Shopify
```

### Database Tables
`ShopifyOrderCache`, `ShopifyProductCache`, `SyncJob`, `WebhookLog`, `FailedWebhookQueue`, `SystemSetting`

---

## Production Domain

Batch scheduling and completion.

### Batch Status Flow
```
planned → in_progress → completed
                ↓
    [creates inventory inward]
    [creates fabric outward]
```

### Key Endpoints
| Path | Purpose |
|------|---------|
| `GET /batches` | List production batches |
| `POST /batches/:id/complete` | Complete with qty |
| `POST /batches/:id/uncomplete` | Reverse completion |
| `GET /locked-dates` | Get locked dates |
| `GET /capacity` | Daily capacity |
| `GET /requirements` | SKUs needing production |

### Fabric Consumption
```javascript
getEffectiveFabricConsumption(sku)
// Fallback: sku.fabricConsumption → product.fabricConsumption → 1.5
```

### Frontend
- `Production.tsx` (50KB), `ProductionInward.tsx` (46KB)

---

## Tracking Domain

Shipment tracking via iThink Logistics.

### Status Mapping
| iThink Code | Internal Status |
|-------------|-----------------|
| `DL` | `delivered` |
| `IT`, `OT` | `in_transit` |
| `PP` | `manifested` |
| RTO initiated/transit | `rto_in_transit` |
| RTO delivered | `rto_delivered` |

### Background Sync
Runs every 4 hours. Now re-evaluates `delivered` orders to catch RTO misclassification.

### Order Tracking Fields
`awbNumber`, `trackingStatus`, `lastScanLocation`, `lastScanAt`, `isRto`, `rtoInitiatedAt`, `rtoReceivedAt`

### Key Endpoints
| Path | Purpose |
|------|---------|
| `GET /awb/:awb` | Track single AWB |
| `POST /batch` | Track multiple AWBs (max 10) |
| `POST /sync/run` | Trigger manual sync |

---

## Fabrics Domain

Fabric inventory management with ledger-based transactions.

### Key Endpoints
| Path | Purpose |
|------|---------|
| `GET /flat` | All fabrics with computed balances (for AG-Grid) |
| `GET /filters` | Unique fabric types for filter dropdowns |
| `GET /` | Nested fabric list (legacy) |
| `POST /` | Create fabric |
| `POST /:id/transactions` | Add inward/outward transaction |
| `GET /reconciliation/history` | Stock reconciliation history |
| `POST /reconciliation/start` | Begin physical stock count |

### Balance Formula
```javascript
Balance = SUM(inward) - SUM(outward)
```

### Frontend
- `Fabrics.tsx` - Flat AG-Grid table with filters

---

## Frontend Patterns

### Page-to-Domain Mapping
| Page | Backend | Size |
|------|---------|------|
| `Orders.tsx` | Orders | 40KB |
| `Returns.tsx` | Returns | 114KB |
| `ReturnInward.tsx` | Returns | 74KB |
| `InwardHub.tsx` | Inventory | - |
| `Inventory.tsx` | Inventory | 42KB |
| `Production.tsx` | Production | 50KB |
| `Products.tsx` | Products | 49KB |
| `Fabrics.tsx` | Fabrics | 37KB |

### Performance Patterns

**Sequential Background Loading** (`useOrdersData.ts`):
- Active tab loads immediately
- Remaining tabs load sequentially: Open -> Shipped -> RTO -> COD Pending -> Archived
- Tab switching instant due to pre-loading

**O(1) Map Caching** (`orderHelpers.ts`):
```typescript
const invMap = getInventoryMap(inventoryBalance);
const stock = invMap.get(line.skuId) ?? 0;  // O(1) vs O(n) find()
```

**Server-side Aggregation** (`tierUtils.js`):
- Customer stats use Prisma `groupBy` with `_sum`/`_count`

**Optimistic Updates** (`useOrdersMutations.ts`):
```typescript
// Context pattern to prevent stale cache overwrites
onMutate: () => ({ skipped: false }),
onSuccess: (_, __, ctx) => {
  if (ctx?.skipped) return; // Skip if newer data arrived
  queryClient.invalidateQueries(['orders']);
}
```

### Custom Hooks
| Hook | Purpose |
|------|---------|
| `useOrdersData` | All 5 tabs data fetching with sequential loading |
| `useOrdersMutations` | All order action mutations with optimistic updates |
| `useGridState` | AG-Grid column visibility/order with localStorage |
| `useAuth` | Auth context |

### AG-Grid Shared Utilities

**Location**: `utils/agGridHelpers.ts`, `hooks/useGridState.ts`, `components/common/grid/`

| File | Purpose |
|------|---------|
| `agGridHelpers.ts` | Theme config, formatters (date, currency, relative time), tracking URLs |
| `useGridState.ts` | Column visibility, order, page size with localStorage persistence |
| `common/grid/` | Reusable components: StatusBadge, TrackingStatusBadge, ColumnVisibilityDropdown |

**Usage**: Fabrics and Catalog pages use shared utilities. Order grids kept inline (complexity didn't justify abstraction).

### Component Organization
```
components/
├── orders/          # 15 order components
├── settings/tabs/   # 6 settings tabs
├── common/grid/     # AG-Grid shared components
├── Layout.tsx, Modal.tsx, ErrorBoundary.tsx
```

---

## Common Gotchas (All Domains)

### Orders
1. **Unified views**: Use `GET /orders?view=` - legacy endpoints still work but unified is preferred
2. Router mount order matters - specific routes before parameterized
3. Zod validation via `validate()` middleware
4. Shipped view excludes RTO and unpaid COD (they have separate views)
5. Search works on any view - one implementation via `buildViewWhereClause()`

### Inventory
6. Reserved not deducted from balance, only from available
7. RTO condition determines action (good/unopened = inward, others = write-off)
8. Use `calculateAllInventoryBalances()` for batch, not N+1

### Returns
9. Status vs Resolution - status is workflow, resolution is outcome
10. Repacking is separate from return completion

### Shopify
11. Cache-first - check `ShopifyOrderCache`, not API
12. Credentials in `SystemSetting` table, not env vars
13. COD payment sync uses Transaction API, not Order update
14. **Auto-ship setting**: Check `auto_ship_fulfilled` - default true auto-ships on Shopify fulfill

### Production
15. Completion creates BOTH inventory inward AND fabric outward
16. Fabric consumption fallback: SKU -> Product -> 1.5

### Tracking
17. Batch limit: max 10 AWBs per iThink request
18. Re-evaluates delivered orders for RTO misclassification

### Fabrics
19. Use `/flat` endpoint for AG-Grid, not nested `/` endpoint
20. Balance is computed server-side via transaction aggregation

### Frontend
21. Tab counts delayed - populate progressively as loading completes
22. Map caching - use `getInventoryMap()`/`getFabricMap()` for loops
23. Optimistic updates use context with `skipped` for conditional invalidation
24. AG-Grid shared utilities in `utils/agGridHelpers.ts` - don't recreate
