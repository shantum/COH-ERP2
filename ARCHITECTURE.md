# COH-ERP Architecture

> **Living Reference** — Last updated: January 7, 2026
> For quick start and commands, see `CLAUDE.md`

Detailed architecture reference for COH-ERP, a manufacturing ERP with Shopify integration.

---

## Project Structure

```
COH-ERP2/
├── client/src/
│   ├── pages/             # 15 pages (largest: Returns.tsx 113KB, Products.tsx 49KB)
│   ├── components/        # Layout, Modal, ErrorBoundary + orders/, settings/ subdirs
│   ├── hooks/             # useAuth + custom hooks
│   ├── services/api.ts    # Centralized API client (470+ lines)
│   └── types/index.ts     # TypeScript interfaces (642 lines)
│
├── server/src/
│   ├── routes/            # 17 route files (largest: returns.js 73KB, orders/ modular 78KB)
│   ├── services/          # 8 services (shopify sync, tracking, background jobs)
│   ├── middleware/        # Auth middleware
│   └── utils/             # queryPatterns.js, tierUtils.js, validation.js, encryption.js
│
└── server/prisma/
    └── schema.prisma      # 920+ lines, 35+ models
```

---

## Data Model

### Core Hierarchy
```
Product → Variation → SKU
           ↓
        Fabric → FabricTransaction (ledger)
           
SKU → InventoryTransaction (ledger)
SKU → OrderLine ← Order ← Customer
SKU → ProductionBatch

ReturnRequest → ReturnRequestLine
     ↓
RepackingQueueItem → WriteOffLog
```

### Key Models (from schema.prisma)

| Model | Key Fields |
|-------|------------|
| `Product` | name, styleCode, category, shopifyProductId |
| `Variation` | productId, colorName, fabricId, imageUrl |
| `Sku` | skuCode (also barcode), size, mrp, shopifyVariantId |
| `Order` | orderNumber, shopifyOrderId, status, isArchived, COD remittance fields |
| `OrderLine` | skuId, qty, lineStatus, productionBatchId |
| `InventoryTransaction` | txnType (inward/outward), qty, reason |
| `ReturnRequest` | requestNumber, status, resolution, valueDifference |
| `ProductionBatch` | batchDate, skuId, qtyPlanned, qtyCompleted, status |

---

## Critical Flows

### Order Line Status
```
pending → allocated → picked → packed → shipped
```

- **allocated**: Creates `reserved` transaction
- **shipped**: Deletes `reserved`, creates `outward` transaction

### Inventory Transactions
Three types: `inward`, `outward`, `reserved`

```javascript
// From queryPatterns.js
Balance = SUM(inward) - SUM(outward)
Available = Balance - SUM(reserved)
```

**Reasons by type:**
- `inward`: production, return_receipt, adjustment
- `outward`: sale, damage, adjustment
- `reserved`: order_allocation

### Return Status
```
pending_pickup → in_transit → received → processing → completed
```

**Resolution types:** refund, exchange_same, exchange_up, exchange_down

When item received → goes to `RepackingQueueItem` → either restocked or `WriteOffLog`

### COD Remittance Flow (New)
```
Upload CSV → Match order → Update payment fields → Sync to Shopify
                                                      ↓
                                  synced | failed | manual_review
```

---

## API Routes (17 files)

| Route | File Size | Key Endpoints |
|-------|-----------|---------------|
| `/api/orders` | 78KB | `/open`, `/shipped`, `/rto`, `/cod-pending`, `/archived`, `/lines/:id/allocate|pick|pack`, `/:id/ship` |
| `/api/remittance` | 33KB | `/upload`, `/pending`, `/summary`, `/failed`, `/retry-sync`, `/approve-manual` |
| `/api/returns` | 73KB | `/pending`, `/action-queue`, `/:id/receive-item`, `/:id/ship-replacement` |
| `/api/fabrics` | 27KB | `/reconciliation/*`, `/:id/transactions` |
| `/api/shopify` | 44KB | `/sync/full-dump`, `/sync/jobs/*`, `/config` |
| `/api/tracking` | 16KB | `/awb/:awb`, `/batch`, `/orders`, `/config` |
| `/api/inventory` | 21KB | `/balance`, `/inward`, `/outward`, `/quick-inward` |
| `/api/production` | 20KB | `/batches`, `/capacity`, `/requirements` |
| `/api/repacking` | 23KB | `/queue`, `/process`, `/write-offs` |
| `/api/webhooks` | 24KB | `/shopify/orders`, `/shopify/customers/*` |
| `/api/admin` | 22KB | `/users`, `/stats`, `/inspect/*`, `/tier-thresholds` |

---

## Frontend Pages (15 pages)

| Page | Size | Purpose |
|------|------|---------|
| `Returns.tsx` | 113KB | Full return workflow with action queue |
| `ReturnInward.tsx` | 74KB | Receiving returns, QC inspection |
| `Production.tsx` | 50KB | Production planning and batches |
| `ProductionInward.tsx` | 46KB | Recording production completion |
| `Products.tsx` | 49KB | Product/Variation/SKU management |
| `Inventory.tsx` | 42KB | Stock levels and transactions |
| `Fabrics.tsx` | 37KB | Fabric management |
| `Orders.tsx` | 40KB | Order fulfillment workflow (5 tabs) |
| `FabricReconciliation.tsx` | 24KB | Physical stock count |
| `Ledgers.tsx` | 23KB | Transaction history |
| `Customers.tsx` | 18KB | Customer database |
| `Settings.tsx` | 4KB | System settings tabs container |

### Order Components (15 components in `components/orders/`)

| Component | Purpose |
|-----------|---------|
| `OrdersGrid.tsx` (56KB) | Main AG-Grid for open orders with fulfillment actions |
| `ShippedOrdersGrid.tsx` (38KB) | Grid for shipped/delivered orders with tracking |
| `ArchivedOrdersGrid.tsx` (26KB) | Paginated grid for archived orders |
| `TrackingModal.tsx` (23KB) | Real-time shipment tracking (iThink Logistics) |
| `OrderViewModal.tsx` (21KB) | Full order details modal |
| `RtoOrdersGrid.tsx` (15KB) | RTO orders grid [NEW] |
| `CodPendingGrid.tsx` (12KB) | COD pending orders grid [NEW] |
| `SummaryPanel.tsx` (6KB) | Dashboard stats panel |

### Settings Tabs (in `components/settings/tabs/`)

| Component | Purpose |
|-----------|---------|
| `RemittanceTab.tsx` (27KB) | COD remittance CSV upload and Shopify sync |

---

## Shopify Integration

### Sync Pattern
1. **Webhooks** (real-time): `orders/create`, `orders/updated`
2. **Full Dump** (bulk): Background job via `SyncWorker`
3. **Cache Layer**: `ShopifyOrderCache` stores raw JSON

### Key Tables
- `ShopifyOrderCache` — Raw order JSON, extracted fields (discountCodes, trackingNumber)
- `ShopifyProductCache` — Product sync tracking
- `SyncJob` — Background job progress (pending/running/completed/failed)

### Unified Webhook Endpoint (recommended)
```
POST /api/webhooks/shopify/orders
```
Handles create, update, cancel, fulfill events.

### COD Payment Sync (New)
```javascript
shopifyClient.markOrderAsPaid(shopifyOrderId, amount, utr, paidAt)
```
Creates a capture transaction in Shopify to mark COD orders as paid.

---

## Tracking Integration (iThink Logistics)

Real-time shipment tracking via iThink Logistics API.

| Service | Purpose |
|---------|---------|
| `ithinkLogistics.js` | API client for tracking (253 lines) |
| `trackingSync.js` | Background sync for tracking updates (393 lines) |
| `tracking.js` (route) | `/api/tracking/*` endpoints |

**Key features:**
- Track single or batch AWBs (max 10)
- Full scan history timeline
- RTO detection and status mapping (improved)
- Re-evaluates delivered orders to catch RTO misclassification
- Credentials stored in `SystemSetting` table

---

## COD Remittance System (New)

Handles COD payment tracking and Shopify sync.

| File | Purpose |
|------|---------|
| `remittance.js` | CSV upload, payment status updates |
| `shopify.js` (service) | `markOrderAsPaid()` for Shopify sync |
| `RemittanceTab.tsx` | Frontend UI for remittance upload |

**Order COD Fields (schema.prisma):**
- `codRemittedAt`, `codRemittanceUtr`, `codRemittedAmount`
- `codShopifySyncStatus`, `codShopifySyncError`, `codShopifySyncedAt`

---

## Key Files

| File | Why It Matters |
|------|----------------|
| `server/src/routes/orders/` | Modular order routes: `index.js` (router), `listOrders.js` (GET endpoints), `fulfillment.js` (ship/allocate), `mutations.js` (CRUD/archive) |
| `server/src/utils/queryPatterns.js` | ORDER_LIST_SELECT constants, enrichOrdersWithCustomerStats(), inventory helpers |
| `server/src/utils/validation.js` | Zod schemas (ShipOrderSchema, CreateOrderSchema, etc.) with validate() middleware factory |
| `server/src/services/shopifyOrderProcessor.js` | Cache-first order processing |
| `server/src/services/ithinkLogistics.js` | Shipment tracking API client |
| `server/src/services/trackingSync.js` | Background tracking sync with RTO detection |
| `server/src/services/syncWorker.js` | Background sync job runner (23KB) |
| `server/src/routes/remittance.js` | COD remittance processing |
| `client/src/services/api.ts` | All API calls, auth interceptors |
| `client/src/types/index.ts` | TypeScript interfaces (source of truth for types) |

---

## Common Gotchas

1. **Cache-first orders**: Always check `ShopifyOrderCache` first
2. **Production completion**: Creates inventory `inward` AND fabric `outward`
3. **Fabric consumption fallback**: `getEffectiveFabricConsumption()` → SKU → Product → 1.5
4. **Reserved inventory**: Allocated orders hold stock via `reserved` transactions
5. **Shopify creds**: Stored in `SystemSetting` table, not env vars
6. **iThink creds**: Also in `SystemSetting` (`ithink_access_token`, `ithink_secret_key`)
7. **Auto-archive**: Orders auto-archive after 90 days (runs on startup)
8. **Scheduled sync**: Hourly Shopify sync via `scheduledSync.js`
9. **COD payment sync**: Uses Shopify Transaction API, not Order update
10. **RTO detection**: Tracking sync re-evaluates delivered orders for RTO status
11. **Zod validation**: Order endpoints use `validate()` middleware with schemas from validation.js
12. **Orders route modular**: Split into 3 sub-routers (listOrders.js, fulfillment.js, mutations.js)

---

## Development Commands

```bash
# Server (port 3001)
cd server && npm run dev

# Client (port 5173)  
cd client && npm run dev

# Database
npm run db:generate    # After schema changes
npm run db:push        # Push to database
npm run db:studio      # Prisma GUI

# Tests
npm test               # Jest tests
```

---

## Changelog

### January 7, 2026
**Orders Modular Refactor** (Evening):
- Split 2000-line `orders.js` into `orders/index.js`, `listOrders.js`, `fulfillment.js`, `mutations.js`
- Centralized Zod validation in `utils/validation.js`
- Added ORDER_LIST_SELECT constants to `utils/queryPatterns.js`

**Orders Page 5-Tab System** (Afternoon):
- Added RTO tab (`/orders/rto`, `RtoOrdersGrid.tsx`)
- Added COD Pending tab (`/orders/cod-pending`, `CodPendingGrid.tsx`)
- Shipped tab now excludes RTO and unpaid COD

**COD Remittance System** (Morning):
- New `/api/remittance/*` endpoints for COD payment tracking
- Shopify `markOrderAsPaid()` for Transaction API sync
- New Order fields: `codRemittedAt`, `codRemittanceUtr`, `codShopifySyncStatus`
- Improved RTO detection in tracking sync

### January 6, 2026
- iThink Logistics tracking integration (`/api/tracking/*`)
- New components: TrackingModal, ShippedOrdersGrid, ArchivedOrdersGrid
- Archive-by-date and pagination for archived orders
- Shopify fulfillment status now informational only

### January 5, 2026
- Test suites: `orders-inventory.test.js`, `integration.test.js`
- Shopify cache-first sync pattern
- Repacking queue and write-off logs

### Earlier (December 2025)
- Initial production deployment
- Shopify webhooks and bulk sync
- Undo fulfillment actions (unpick, unpack)
