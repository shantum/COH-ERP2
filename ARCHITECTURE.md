# COH-ERP Architecture

> System overview for COH-ERP manufacturing ERP. **Last updated: January 9, 2026**
> For commands see `CLAUDE.md`, for domain details see `docs/DOMAINS.md`

---

## Project Structure

```
COH-ERP2/
├── client/src/
│   ├── pages/             # 15 pages
│   ├── components/        # Layout, Modal + orders/, settings/, common/grid/
│   ├── hooks/             # useAuth, useOrdersData, useGridState
│   ├── utils/             # agGridHelpers.ts (shared AG-Grid config)
│   ├── services/api.ts    # Centralized API client
│   └── types/index.ts     # TypeScript interfaces
│
├── server/src/
│   ├── routes/            # 17 route files (orders/ is modular)
│   ├── services/          # 8 services (shopify, tracking, sync)
│   ├── middleware/        # Auth
│   └── utils/             # queryPatterns, tierUtils, validation, encryption
│
└── server/prisma/schema.prisma  # 35+ models
```

---

## Data Model

### Core Hierarchy
```
Product -> Variation -> SKU
              ↓
           Fabric -> FabricTransaction (ledger)

SKU -> InventoryTransaction (ledger)
SKU -> OrderLine <- Order <- Customer
SKU -> ProductionBatch

ReturnRequest -> ReturnRequestLine -> RepackingQueueItem -> WriteOffLog
```

### Key Models

| Model | Key Fields |
|-------|------------|
| `Product` | name, styleCode, category, shopifyProductId |
| `Variation` | productId, colorName, fabricId, imageUrl |
| `Sku` | skuCode, size, mrp, isCustomSku, parentSkuId |
| `Order` | orderNumber, status, isArchived, isExchange (new), originalOrderId (new) |
| `OrderLine` | skuId, qty, lineStatus, isCustomized, isNonReturnable |
| `InventoryTransaction` | txnType (inward/outward/reserved), qty, reason |
| `ReturnRequest` | requestNumber, status, resolution, valueDifference, exchangeOrderId |
| `ProductionBatch` | batchDate, skuId, qtyPlanned, qtyCompleted, status |

---

## Critical Flows

### Order Line Status
```
pending -> allocated -> picked -> packed -> shipped
```
- **allocated**: Creates `reserved` transaction
- **shipped**: Deletes `reserved`, creates `outward`

### Inventory Transactions
```javascript
Balance = SUM(inward) - SUM(outward)
Available = Balance - SUM(reserved)
```

**Reasons:** inward (production, return_receipt), outward (sale, damage), reserved (order_allocation)

### Return Status
```
pending_pickup -> in_transit -> received -> processing -> completed
```
**Resolutions:** refund, exchange_same, exchange_up, exchange_down

### COD Remittance
```
Upload CSV -> Match order -> Update payment -> Sync to Shopify (Transaction API)
```

---

## API Routes

| Route | Purpose |
|-------|---------|
| `/api/auth` | Login, register |
| `/api/orders?view=` | **Unified order views** (open, shipped, rto, cod_pending, archived) |
| `/api/inventory` | Stock balance, transactions, RTO inward |
| `/api/returns` | Return workflow |
| `/api/repacking` | QC and restocking |
| `/api/production` | Batch scheduling |
| `/api/remittance` | COD payment tracking |
| `/api/shopify` | Sync endpoints, auto-ship setting |
| `/api/webhooks` | Shopify webhooks |
| `/api/tracking` | iThink shipment tracking |

### Unified Order Views
Single endpoint `GET /orders?view=<name>` with config-driven architecture:
- View definitions in `server/src/utils/orderViews.js`
- WHERE clause builder handles exclusions and search
- Enrichment functions applied per-view (customerStats, daysInTransit, etc.)
- Legacy endpoints (`/orders/open`, `/orders/shipped`) still work for backward compatibility

---

## Shopify Integration

- **Cache-first**: `ShopifyOrderCache` stores raw JSON
- **Unified webhook**: `POST /api/webhooks/shopify/orders`
- **Credentials**: `SystemSetting` table (not env vars)
- **COD sync**: `markOrderAsPaid()` via Transaction API

---

## Tracking Integration (iThink)

- Track single/batch AWBs (max 10)
- Background sync every 4 hours
- Re-evaluates `delivered` to catch RTO
- Credentials in `SystemSetting`

---

## Key Files

| File | Purpose |
|------|---------|
| `server/src/routes/orders/` | Modular: index, listOrders, fulfillment, mutations |
| `server/src/utils/orderViews.js` | **View configs, WHERE builder, enrichment functions** |
| `server/src/utils/queryPatterns.js` | ORDER_LIST_SELECT, inventory helpers |
| `server/src/utils/validation.js` | Zod schemas with validate() middleware |
| `server/src/services/shopifyOrderProcessor.js` | Cache-first order processing, auto-ship logic |
| `server/src/services/ithinkLogistics.js` | Tracking API client |
| `client/src/services/api.ts` | All API calls |
| `client/src/types/index.ts` | TypeScript interfaces |

---

## Changelog

### January 9, 2026 (WIP)
- **Exchange Order Tracking**: Schema changes for `isExchange`, `originalOrderId` (⚠️ migration pending)
- Order creation supports exchange orders with EXC- prefix

### January 8, 2026
- **Unified Order Views**: Single endpoint `GET /orders?view=` replaces 5 endpoints
- **Auto-ship fulfilled orders**: Toggle in Settings > Shopify to auto-ship when Shopify fulfills
- New `orderViews.js`: View configs, WHERE builder, enrichment functions
- Fabrics page: Rewrote from nested cards to flat AG-Grid table
- New AG-Grid shared utilities: `utils/agGridHelpers.ts`, `hooks/useGridState.ts`, `components/common/grid/`
- New fabric endpoints: `/fabrics/flat`, `/fabrics/filters`
- Documentation optimization: consolidated 7 domain READMEs into `docs/DOMAINS.md`

### January 7, 2026
- Orders modular refactor (split 2000-line orders.js)
- 5-tab system: Open, Shipped, RTO, COD Pending, Archived
- COD remittance with Shopify Transaction API sync
- RTO per-line processing with condition marking

### January 6, 2026
- iThink Logistics tracking integration
- Archive-by-date and pagination for archived orders

### Earlier
- Shopify cache-first sync pattern
- Repacking queue and write-off logs
