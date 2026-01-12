# Shopify Domain

> Sync, webhooks, cache management, and COD payment sync via Shopify Admin API (2024-10).

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/shopify.js` |
| Key Files | `services/shopify.js` (ShopifyClient), `services/shopifyOrderProcessor.js` |
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
| `discountCodes`, `tags`, `customerNotes` | Shopify | ShopifyOrderCache.rawData |
| `totalPrice`, `subtotalPrice` | Shopify | ShopifyOrderCache (generated columns) |
| `paymentMethod`, `awbNumber`, `courier`, `status` | ERP | Order |
| `shippedAt`, `deliveredAt` | Both | Order & Cache |

**Access pattern**: `Order` with `include: { shopifyCache: true }`

## Sync Modes

| Mode | Use Case | Query |
|------|----------|-------|
| `deep` | Initial setup, recovery | All orders, paginated |
| `quick` | Daily catch-up | `created_at_min` = latest DB date |
| `update` | Hourly refresh | `updated_at_min` = 2 hours ago |

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
| `GET/PUT /config` | Shopify credentials (token masked) |
| `POST /sync/jobs/start` | Start sync job (`syncMode: deep|quick|update`) |
| `POST /sync/backfill` | Data correction (`fields: [paymentMethod, cacheFields, orderFields]`) |
| `POST /webhooks/shopify/orders` | Unified order webhook |

## Database Tables

- `ShopifyOrderCache` - Raw JSON + generated columns
- `ShopifyProductCache` - Product catalog
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
