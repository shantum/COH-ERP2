# Shopify Domain

> Sync, webhooks, cache management, and COD payment sync via Shopify Admin API (2024-10).

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/shopify.ts`, `server/src/routes/webhooks.ts` |
| Key Files | `services/shopify.ts` (ShopifyClient), `services/shopifyOrderProcessor.ts` |
| Related | Orders (synced data), Remittance (COD payment sync) |

## Architecture

**Cache-first pattern**: All Shopify orders cached before ERP processing.

```
Shopify Store ──┬──→ Webhooks (realtime) ──┐
                │                           │
                └──→ Bulk Sync (scheduled) ─┼──→ ShopifyOrderCache → Order (ERP)

COD Remittance ──→ Transaction API ──→ Shopify (mark paid)
```

**Principles**:
1. Always cache first - raw JSON in `ShopifyOrderCache.rawData`
2. ERP is source of truth for shipping - Shopify fulfillment is informational
3. Process asynchronously - background jobs with memory management

## Field Ownership

| Field | Owner | Location |
|-------|-------|----------|
| `discountCodes`, `tags`, `customerNotes` | Shopify | ShopifyOrderCache (extracted) |
| `totalPrice`, `subtotalPrice`, `totalTax`, `totalDiscounts` | Shopify | ShopifyOrderCache (generated) |
| `customerEmail`, `customerPhone`, `shippingAddress` | Shopify | ShopifyOrderCache (generated) |
| `paymentMethod`, `awbNumber`, `courier`, `status`, `trackingStatus` | ERP | Order |
| `shippedAt`, `deliveredAt` | Both | Order & Cache |

**Generated columns**: PostgreSQL `GENERATED ALWAYS AS ... STORED` - auto-computed from rawData, no backfills needed.

**Access pattern**: `Order` with `include: { shopifyCache: true }`

## Sync Modes

| Mode | Use Case | Filter | Options |
|------|----------|--------|---------|
| `deep` | Initial setup, recovery | All orders, paginated | `days?: number` |
| `quick` | Daily catch-up | Missing orders after latest DB order date | - |
| `update` | Hourly refresh | `updated_at_min` = staleAfterMins ago | `staleAfterMins: number` (required) |

## Payment Method Detection

Priority-based detection from gateway data:

```javascript
1. Gateway: 'shopflo', 'razorpay' → Prepaid
2. Gateway: 'cod', 'cash', 'manual' → COD
3. Preserve existing COD (if already set)
4. Financial status: 'pending' → COD
5. Fallback → Prepaid
```

**Note**: ERP `paymentMethod` is editable - users can override.

## COD Payment Sync (Remittance)

```javascript
await shopifyClient.markOrderAsPaid(shopifyOrderId, amount, utr, paidAt);
// Creates Transaction API capture - financial_status auto-updates to 'paid'
```

## Key Endpoints

| Path | Purpose |
|------|---------|
| `GET/PUT /api/shopify/config` | Shopify credentials (token encrypted) |
| `POST /api/shopify/sync/jobs/start` | Start sync job (`syncMode: deep|quick|update`) |
| `POST /api/shopify/sync/backfill` | Data correction (`fields: [all, paymentMethod, cacheFields, orderFields]`) |
| `POST /api/webhooks/shopify/orders` | Unified order webhook (handles create/update/cancel/fulfill via X-Shopify-Topic) |
| `POST /api/webhooks/shopify/products/*` | Product webhooks (create/update/delete) |
| `POST /api/webhooks/shopify/customers/*` | Customer webhooks (create/update) |

## Database Tables

- `ShopifyOrderCache` - Raw JSON + 40+ generated columns (amounts, customer, shipping, timestamps)
- `ShopifyProductCache` - Product catalog
- `ShopifyInventoryCache` - Inventory levels per SKU
- `SyncJob` - Job tracking
- `WebhookLog`, `FailedWebhookQueue` - Webhook audit

## Cross-Domain

- **→ Orders**: Synced orders create/update ERP Orders
- **→ Remittance**: COD sync uses Transaction API
- **← Customers**: Customer data synced from Shopify

## Gotchas

1. **Cache-first mandatory**: Never process without caching first
2. **ERP owns shipping**: Shopify fulfillment doesn't change ERP status
3. **Order locking**: Use `FOR UPDATE` to prevent webhook/sync race conditions
4. **Rate limits**: 40 calls/second bucket; buffer at 35
5. **Payment editable**: ERP field overrides Shopify detection when manually set
6. **Generated columns**: Don't update directly - auto-computed from `rawData`
7. **Credentials in DB**: `SystemSetting` table, not env vars
8. **Backfill idempotent**: Safe to run multiple times
