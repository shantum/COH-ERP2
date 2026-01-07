# Orders Domain

Order management and fulfillment workflow.

## Key Files

**Modular Route Structure** (refactored from single 2000-line file):

| File | Size | Purpose |
|------|------|---------|
| `orders/index.js` | 0.5KB | Router combiner - mounts sub-routers |
| `orders/listOrders.js` | 24KB | GET endpoints (list, view orders) |
| `orders/fulfillment.js` | 15KB | Line status updates, ship/unship, RTO actions |
| `orders/mutations.js` | 24KB | CRUD, cancel, archive operations |

**Related Files:**

| File | Size | Purpose |
|------|------|---------|
| `remittance.js` | 33KB | COD remittance processing |
| `../utils/queryPatterns.js` | 18KB | Shared select patterns, helpers |
| `../utils/validation.js` | 8KB | Zod validation schemas |
| `../utils/tierUtils.js` | 3KB | Customer tier calculations |

## Modular Structure

The orders route is split into 3 sub-routers:

```
orders/
├── index.js        ← Main router (mounts sub-routers)
├── listOrders.js   ← GET endpoints: /open, /shipped, /rto, /cod-pending, /archived
├── fulfillment.js  ← POST: /lines/:id/allocate|pick|pack, /:id/ship|unship
└── mutations.js    ← POST/PUT/DELETE: create, update, cancel, archive
```

**Router mounting order matters** - more specific routes first.

## Key Endpoints

### List Orders (`listOrders.js`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/open` | Open orders with fulfillment status |
| GET | `/shipped` | Shipped orders (excludes RTO and unpaid COD) |
| GET | `/shipped/summary` | Shipped orders summary stats |
| GET | `/rto` | RTO orders (Return to Origin) |
| GET | `/cod-pending` | COD orders delivered but awaiting payment |
| GET | `/archived` | Paginated archived orders |
| GET | `/archived/analytics` | Archived orders revenue and stats |
| GET | `/:id` | Single order by ID |

### Fulfillment (`fulfillment.js`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/lines/:id/allocate` | Allocate inventory (creates `reserved` txn) |
| POST | `/lines/:id/unallocate` | Release reserved inventory |
| POST | `/lines/:id/pick` | Mark line as picked |
| POST | `/lines/:id/unpick` | Revert to allocated |
| POST | `/lines/:id/pack` | Mark line as packed |
| POST | `/lines/:id/unpack` | Revert to picked |
| POST | `/lines/bulk-update` | Bulk update line statuses |
| POST | `/:id/ship` | Ship order (validated with Zod) |
| POST | `/:id/unship` | Revert to open |
| POST | `/:id/deliver` | Mark as delivered |
| POST | `/:id/mark-rto` | Initiate RTO |
| POST | `/:id/receive-rto` | Mark RTO received |

### Mutations (`mutations.js`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/` | Create order (validated with Zod) |
| PUT | `/:id` | Update order (validated with Zod) |
| DELETE | `/:id` | Delete order (manual orders only) |
| POST | `/:id/cancel` | Cancel order |
| POST | `/:id/uncancel` | Restore cancelled order |
| POST | `/:id/archive` | Archive single order |
| POST | `/:id/unarchive` | Unarchive order |
| POST | `/archive-by-date` | Bulk archive before date |
| POST | `/archive-delivered-prepaid` | Archive delivered prepaid & paid COD |
| POST | `/:orderId/lines` | Add line to order |
| PUT | `/lines/:lineId` | Update order line |
| DELETE | `/lines/:lineId` | Delete order line |
| POST | `/lines/:lineId/cancel` | Cancel order line |
| POST | `/lines/:lineId/uncancel` | Restore cancelled line |

## Order Tabs (Frontend)

The Orders page has 5 tabs:

| Tab | Endpoint | Description |
|-----|----------|-------------|
| Open | `/open` | Orders being fulfilled |
| Shipped | `/shipped` | Successfully shipped (excludes RTO/COD pending) |
| RTO | `/rto` | Return to Origin orders |
| COD Pending | `/cod-pending` | Delivered COD awaiting payment |
| Archived | `/archived` | Historical orders |

## Order Line Status Machine

```
pending → allocated → picked → packed → [ship order] → shipped
           ↓
    (creates reserved inventory)
```

**Undo actions available:** 
- `unallocate` → deletes reserved transaction
- `unpick` → reverts to allocated  
- `unpack` → reverts to picked
- `unship` → reverses sale transaction, recreates reserved

## Validation Schemas (Zod)

Located in `../utils/validation.js`:

| Schema | Used By | Validates |
|--------|---------|-----------|
| `ShipOrderSchema` | `/:id/ship` | AWB number, courier (required) |
| `CreateOrderSchema` | `POST /` | Customer, lines, payment method |
| `UpdateOrderSchema` | `PUT /:id` | Customer details, notes |
| `AddOrderLineSchema` | `POST /:orderId/lines` | SKU ID, quantity |

## Shared Query Patterns

Located in `../utils/queryPatterns.js`:

| Pattern | Purpose |
|---------|---------|
| `ORDER_LIST_SELECT` | Base select for all order lists |
| `ORDER_LIST_SELECT_OPEN` | Extended select for open orders |
| `ORDER_LIST_SELECT_SHIPPED` | Extended select for shipped orders |
| `ORDER_LIST_SELECT_RTO` | Extended select for RTO orders |
| `ORDER_LIST_SELECT_COD_PENDING` | Extended select for COD pending |
| `ORDER_LINES_INCLUDE` | Standard order lines include pattern |
| `enrichOrdersWithCustomerStats()` | Add customer LTV/tier to orders |
| `calculateDaysSince()` | Date utility for days calculation |
| `determineTrackingStatus()` | Calculate tracking status display |

## COD Remittance (remittance.js)

Feature for tracking COD payment collection:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/remittance/upload` | Upload CSV with COD payment data |
| GET | `/remittance/pending` | COD orders delivered but not paid |
| GET | `/remittance/summary` | Stats for pending/paid COD orders |
| GET | `/remittance/failed` | Orders that failed Shopify sync |
| POST | `/remittance/retry-sync` | Retry failed Shopify syncs |
| POST | `/remittance/approve-manual` | Approve manual review orders |

## Key Functions

- `autoArchiveOldOrders(prisma)` — Runs on startup, archives orders shipped >90 days ago (in `mutations.js`)
- `enrichOrdersWithCustomerStats()` — Adds customer LTV/tier to order lists (in `queryPatterns.js`)

## Dependencies

- **Inventory**: Reserved/outward transactions via `queryPatterns.js`
- **Customers**: Tier calculations via `tierUtils.js`
- **Shopify**: Cache data for discount codes and tags; COD payment sync
- **Production**: Links to `ProductionBatch` for out-of-stock items
- **Tracking**: Provides `trackingStatus` for RTO detection

## Common Gotchas

1. **Router mount order matters**: In `index.js`, specific routes before parameterized
2. **Zod validation**: Ship/create/update use `validate()` middleware
3. **Shared selects**: Use patterns from `queryPatterns.js` for consistency
4. **Cache-first pattern**: Shopify data comes from `shopifyCache` relation
5. **Shipped tab filtering**: Excludes RTO and unpaid COD (they have own tabs)
6. **5 tabs now**: Open, Shipped, RTO, COD Pending, Archived

## Related Frontend

- `pages/Orders.tsx` (40KB) — Main orders page with 5 tabs
- `components/orders/OrdersGrid.tsx` (56KB) — AG-Grid for open orders
- `components/orders/ShippedOrdersGrid.tsx` (38KB) — Shipped orders grid
- `components/orders/RtoOrdersGrid.tsx` (15KB) — RTO orders grid
- `components/orders/CodPendingGrid.tsx` (12KB) — COD pending orders grid
- `components/orders/ArchivedOrdersGrid.tsx` (26KB) — Archived orders with analytics
- `components/settings/tabs/RemittanceTab.tsx` (28KB) — COD remittance upload UI
