# Shopify Domain

Shopify integration: sync, webhooks, background jobs, and COD payment sync.

## Key Files

| File | Size | Purpose |
|------|------|---------|
| `shopify.js` (route) | 44KB | Sync endpoints, config, previews |
| `webhooks.js` | 24KB | Webhook receivers |
| `../services/shopify.js` | 24KB | Shopify API client (with payment methods) |
| `../services/syncWorker.js` | 23KB | Background sync job runner |
| `../services/shopifyOrderProcessor.js` | 16KB | Order cache and processing |
| `../services/productSyncService.js` | 16KB | Product/SKU sync logic |
| `../services/customerSyncService.js` | 7KB | Customer sync logic |
| `../services/scheduledSync.js` | 6KB | Hourly sync scheduler |

## Architecture Overview

```
Shopify Store
     ↓
┌─────────────┐     ┌──────────────┐
│  Webhooks   │────→│  Cache       │────→ Database
│  (realtime) │     │  (first)     │
└─────────────┘     └──────────────┘
                           ↑
┌─────────────┐     ┌──────────────┐
│  Bulk Sync  │────→│  SyncWorker  │
│  (manual)   │     │  (background)│
└─────────────┘     └──────────────┘
                           ↓
                   ┌──────────────┐
                   │ COD Payment  │────→ Shopify
                   │ (remittance) │      Transaction API
                   └──────────────┘
```

## Sync Modes (SyncWorker)

| Mode | Use Case | Behavior |
|------|----------|----------|
| `DEEP` | Initial setup, recovery | Full import, aggressive memory management |
| `QUICK` | Daily catch-up | Missing orders only, skip existing |
| `UPDATE` | Hourly refresh | Recently changed orders via `updated_at_min` |

## Key Endpoints (shopify.js)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/config` | Get current Shopify config |
| PUT | `/config` | Update shop domain and token |
| POST | `/test-connection` | Verify API access |
| POST | `/sync/products` | Sync all products |
| POST | `/sync/customers` | Sync customers |
| POST | `/sync/full-dump` | Start background order sync job |
| GET | `/sync/jobs` | List sync jobs |
| GET | `/sync/jobs/:id` | Get job status |
| POST | `/preview/*` | Preview data without importing |

## Webhook Endpoints (webhooks.js)

**Recommended - Unified endpoint:**
```
POST /api/webhooks/shopify/orders
```
Handles: create, update, cancel, fulfill (use with `orders/updated` topic)

**Legacy endpoints (still supported):**
- `/shopify/orders/create`
- `/shopify/orders/updated`
- `/shopify/orders/cancelled`
- `/shopify/orders/fulfilled`
- `/shopify/products/create|update|delete`
- `/shopify/customers/create|update`

## Cache-First Pattern

Orders use `ShopifyOrderCache` table:
1. Webhook receives raw JSON → cache it
2. Process cache → create/update Order + OrderLines
3. Order queries read from cache for discount codes, tags, etc.

**Key function:** `cacheAndProcessOrder(prisma, shopifyOrder)` in `shopifyOrderProcessor.js`

## Key Services

### shopify.js (API Client)
```javascript
shopifyClient.getProducts()
shopifyClient.getOrders({ created_at_min, limit })
shopifyClient.getCustomers()
shopifyClient.isConfigured()
shopifyClient.loadFromDatabase()

// NEW: Payment/Transaction Methods
shopifyClient.markOrderAsPaid(shopifyOrderId, amount, utr, paidAt)
shopifyClient.getOrderTransactions(shopifyOrderId)
```

### markOrderAsPaid (COD Remittance)

New method for syncing COD payments to Shopify:

```javascript
// Creates a capture transaction to mark order as paid
const result = await shopifyClient.markOrderAsPaid(
    shopifyOrderId,   // Shopify order ID
    amount,           // Payment amount
    utr,              // Bank UTR reference (used as authorization)
    paidAt            // Payment date
);

// Returns: { success: true, transaction: {...} }
// or: { success: false, error: "..." }
```

This creates a Shopify transaction:
- `kind: 'capture'` (payment received)
- `gateway: 'Cash on Delivery'`
- `source: 'external'`

### syncWorker.js
```javascript
syncWorker.startJob(jobType, { days, syncMode })
syncWorker.resumeJob(jobId)
syncWorker.cancelJob(jobId)
syncWorker.getJobStatus(jobId)
```

## Database Tables

| Table | Purpose |
|-------|---------|
| `ShopifyOrderCache` | Raw order JSON, extracted fields |
| `ShopifyProductCache` | Product sync tracking |
| `SyncJob` | Background job progress |
| `WebhookLog` | Webhook receipt audit |
| `FailedWebhookQueue` | Dead-letter queue for retries |
| `SystemSetting` | Credentials storage |

## Configuration

Credentials stored in `SystemSetting` table:
- `shopify_shop_domain`
- `shopify_access_token`
- `shopify_webhook_secret` (for HMAC verification)

## Scheduled Sync

`scheduledSync.js` runs hourly:
- Uses `UPDATE` mode (stale orders only)
- Syncs orders updated in last 120 minutes
- Auto-starts on server boot

## Dependencies

- **Orders**: Creates Order + OrderLines from Shopify
- **Customers**: Creates/updates Customer records
- **Products**: Creates Product → Variation → SKU hierarchy
- **Inventory**: Updates `shopifyInventoryCache`
- **Remittance**: Uses `markOrderAsPaid` to sync COD payments

## Common Gotchas

1. **Cache-first**: Always check cache, don't hit API for single orders
2. **Credentials in DB**: Not in env vars — use Settings UI
3. **Webhook deduplication**: Uses `X-Shopify-Webhook-Id` header
4. **HMAC verification optional**: Works without secret for testing
5. **Fulfillment status informational**: Doesn't block ERP workflow
6. **Rate limiting**: Sync jobs use batching and delays
7. **SKU matching**: Matches on `shopifyVariantId` or `skuCode`
8. **COD payment sync**: Uses Transaction API, not Order update

## Related Frontend

- Settings page for Shopify configuration
- Sync status displayed in admin area
- RemittanceTab uses Shopify sync for COD payments
