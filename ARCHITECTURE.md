# COH-ERP Architecture

> **Living Reference** — Last updated: January 7, 2026

A lightweight ERP for Creatures of Habit's manufacturing operations, inventory, orders, and Shopify integration.

This file is an up to date project summary containing the most important details to keep in mind while working on the project. Check the changelog section to track updates and changes. It is a living reference file for the whole project.

---

## Quick Reference

| Component | Technology |
|-----------|------------|
| Backend | Express.js, Prisma ORM, PostgreSQL |
| Frontend | React 19, TypeScript, TanStack Query, Tailwind CSS |
| Auth | JWT (7-day expiry), bcryptjs |
| Integration | Shopify (webhooks + bulk sync), iThink Logistics (tracking) |

**Default credentials:** `admin@coh.com` / `XOFiya@34`

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
│   ├── routes/            # 17 route files (largest: returns.js 73KB, orders.js 71KB)
│   ├── services/          # 8 services (shopify sync, tracking, background jobs)
│   ├── middleware/        # Auth middleware
│   └── utils/             # queryPatterns.js, tierUtils.js, encryption.js
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
| `/api/orders` | 71KB | `/open`, `/shipped`, `/archived`, `/lines/:id/allocate|pick|pack`, `/:id/ship`, `/archive-by-date` |
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
| `Orders.tsx` | 38KB | Order fulfillment workflow |
| `FabricReconciliation.tsx` | 24KB | Physical stock count |
| `Ledgers.tsx` | 23KB | Transaction history |
| `Customers.tsx` | 18KB | Customer database |
| `Settings.tsx` | 14KB | System settings with tabs |

### Order Components (13 components in `components/orders/`)

| Component | Purpose |
|-----------|---------|
| `OrdersGrid.tsx` (56KB) | Main AG-Grid for open orders with fulfillment actions |
| `ShippedOrdersGrid.tsx` (38KB) | Grid for shipped/delivered orders with tracking |
| `ArchivedOrdersGrid.tsx` (26KB) | Paginated grid for archived orders |
| `TrackingModal.tsx` (23KB) | Real-time shipment tracking (iThink Logistics) |
| `OrderViewModal.tsx` (21KB) | Full order details modal |
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
| `server/src/utils/queryPatterns.js` | Transaction constants, balance calculations, inventory helpers |
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
- Added COD Remittance system (`/api/remittance/*`)
- New `remittance.js` route for CSV upload and payment tracking
- Shopify `markOrderAsPaid()` method for COD payment sync
- New Order schema fields: `codRemittedAt`, `codRemittanceUtr`, `codRemittedAmount`, `codShopifySyncStatus`, etc.
- Frontend: RemittanceTab in Settings for CSV upload
- Improved tracking sync: re-evaluates delivered/RTO orders
- Enhanced RTO status detection using last scan status
- Archived orders now support sort by `orderDate` or `archivedAt`
- Archive Delivered button now handles both prepaid and paid COD orders

### January 6, 2026 (Late Evening)
- Enhanced order management with pagination for archived orders
- Added archive-by-date endpoint (`POST /api/orders/archive-by-date`)
- Expanded ShippedOrdersGrid with summary panels and AG-Grid improvements
- Fixed unused import error in Orders.tsx
- Shopify fulfillment status now informational only (no blocking)

### January 6, 2026 (Evening)
- Added iThink Logistics tracking integration (`/api/tracking/*`)
- New order components: TrackingModal, ShippedOrdersGrid, ArchivedOrdersGrid, SummaryPanel
- Updated default credentials
- Removed obsolete docs (APP_OVERVIEW.md, TECHNICAL_OVERVIEW.md, etc.)

### January 6, 2026 (Morning)
- Rewrote ARCHITECTURE.md as concise living reference based on actual code analysis
- Added changelog section

### January 5, 2026
- Added test suites: `orders-inventory.test.js`, `integration.test.js`
- Improved Shopify sync reliability with cache mechanisms
- Enhanced return processing with repacking queue and write-off logs

### January 3, 2026
- Frontend reorganization planning (feature-based structure proposal)

### December 31, 2025
- Undo functionality for fulfillment (unpick, unpack)
- Real-time production plan updates in order view

### December 2025
- Initial production deployment
- Shopify integration with webhooks and bulk sync
