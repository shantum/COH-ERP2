# Orders Domain

Order management and fulfillment workflow.

## Key Files

| File | Size | Purpose |
|------|------|---------|
| `orders.js` | 71KB | Main route file (~2100 lines) |
| `remittance.js` | 33KB | COD remittance processing (971 lines) |
| `../utils/queryPatterns.js` | 14KB | Inventory helpers, transaction constants |
| `../utils/tierUtils.js` | 3KB | Customer tier calculations |

## Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/open` | Open orders with fulfillment status |
| GET | `/shipped` | Shipped orders (last 30 days default) |
| GET | `/archived` | Paginated archived orders (sort by `orderDate` or `archivedAt`) |
| PUT | `/lines/:id/allocate` | Allocate inventory (creates `reserved` txn) |
| PUT | `/lines/:id/pick` | Mark line as picked |
| PUT | `/lines/:id/pack` | Mark line as packed |
| POST | `/:id/ship` | Ship order (releases reserved, creates outward txn) |
| POST | `/archive-by-date` | Bulk archive orders before date |
| POST | `/archive-delivered-prepaid` | Archive delivered prepaid & paid COD orders |

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

## COD Remittance (remittance.js)

New feature for tracking COD payment collection:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/remittance/upload` | Upload CSV with COD payment data |
| GET | `/remittance/pending` | COD orders delivered but not paid |
| GET | `/remittance/summary` | Stats for pending/paid COD orders |
| GET | `/remittance/failed` | Orders that failed Shopify sync |
| POST | `/remittance/retry-sync` | Retry failed Shopify syncs |
| POST | `/remittance/approve-manual` | Approve manual review orders |

### COD Remittance Flow

```
Upload CSV → Match order by orderNumber → Update order with payment details
                                              ↓
                                   [Shopify sync if configured]
                                              ↓
                           synced | failed | manual_review
```

**CSV Columns Expected:**
- `Order No.` (required)
- `Price` / `COD Amount`
- `Remittance Date`
- `Remittance UTR`

**Amount Mismatch**: If CSV amount differs >5% from order total, flagged for `manual_review`

### COD Order Fields (schema.prisma)

```
Order
  - codRemittedAt        // When COD was received
  - codRemittanceUtr     // Bank UTR reference
  - codRemittedAmount    // Actual amount received
  - codShopifySyncStatus // pending, synced, failed, manual_review
  - codShopifySyncError  // Error message if sync failed
  - codShopifySyncedAt   // When synced to Shopify
```

## Key Functions (in orders.js)

- `autoArchiveOldOrders(prisma)` — Runs on startup, archives orders shipped >90 days ago
- Fulfillment stage calculation logic in `/open` endpoint
- Archived orders query now supports sort by `orderDate` or `archivedAt`

## Inventory Integration

Uses helpers from `queryPatterns.js`:
- `createReservedTransaction()` — On allocate
- `releaseReservedInventory()` — On unallocate or ship
- `createSaleTransaction()` — On ship
- `deleteSaleTransactions()` — On unship

## Data Enrichment

Orders are enriched with:
- `fulfillmentStage` — Calculated from line statuses
- `customerLtv`, `customerTier` — From tier calculations
- `shopifyCache` — Discount codes, notes, tags

## Dependencies

- **Inventory**: Reserved/outward transactions
- **Customers**: Tier calculations via `tierUtils.js`
- **Shopify**: Cache data for discount codes and tags; COD payment sync
- **Production**: Links to `ProductionBatch` for out-of-stock items

## Common Gotchas

1. **Cache-first pattern**: Shopify data comes from `shopifyCache` relation, not direct API
2. **Fulfillment stage logic**: Calculated dynamically from line statuses, not stored
3. **Auto-archive**: Runs on server startup, not scheduled
4. **Archived orders are paginated**: Unlike open/shipped which load all
5. **Ship requires lines allocated**: Can skip pick/pack, but must be at least allocated
6. **Archive Delivered**: Now archives both prepaid AND paid COD orders
7. **COD Shopify sync**: Uses `shopifyClient.markOrderAsPaid()` to create capture transaction

## Related Frontend

- `pages/Orders.tsx` (38KB) — Main orders page with 3 tabs
- `components/orders/OrdersGrid.tsx` (56KB) — AG-Grid for open orders
- `components/orders/ShippedOrdersGrid.tsx` (38KB) — Shipped orders grid
- `components/orders/ArchivedOrdersGrid.tsx` (26KB) — Archived orders with sort options
- `components/settings/tabs/RemittanceTab.tsx` (27KB) — COD remittance upload UI
