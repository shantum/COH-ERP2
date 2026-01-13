# Customers Domain

> Customer management, tier calculation, LTV tracking, and RTO risk assessment.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/customers.ts` |
| Key Files | `utils/tierUtils.ts` (calculateTier, calculateLTV, getCustomerStatsMap, updateCustomerTier) |
| Related | Orders (LTV source), Shopify (customer sync), Reports (top-customers) |

## Tier System

**Thresholds** (configurable via `SystemSetting.tier_thresholds`):

| Tier | Default LTV |
|------|-------------|
| Platinum | >= 50,000 |
| Gold | >= 25,000 |
| Silver | >= 10,000 |
| Bronze | < 10,000 |

## LTV Formula

```javascript
LTV = SUM(order.totalAmount) WHERE:
  - status != 'cancelled'
  - trackingStatus NOT IN ['rto_initiated', 'rto_in_transit', 'rto_delivered']
  - totalAmount > 0 (excludes zero-value exchanges)
```

**Tier updates triggered by**: Order delivery, RTO initiation, batch update via `updateAllCustomerTiers()`

## RTO Risk Scoring

**COD-only**: Prepaid RTOs are refunded (no loss). COD RTOs = unrecoverable cost.

```javascript
rtoCount = orders.filter(o =>
  o.trackingStatus?.startsWith('rto') &&
  o.paymentMethod === 'COD'
).length
```

## Stats Enrichment Pattern

```javascript
// For displaying customer stats on order grids
import { getCustomerStatsMap } from 'utils/tierUtils.ts';
import { enrichOrdersWithCustomerStats } from 'utils/queryPatterns.ts';

// Option 1: Enrich orders
const enriched = await enrichOrdersWithCustomerStats(prisma, orders);
// Adds: customerLtv, customerOrderCount, customerRtoCount, customerTier

// Option 2: Direct stats map
const statsMap = await getCustomerStatsMap(prisma, customerIds);
const stats = statsMap[customerId]; // { ltv, orderCount, rtoCount }
```

## Key Endpoints

**Customer routes** (`/api/customers`):

| Path | Purpose |
|------|---------|
| `GET /` | List with metrics (filter: tier, search; multi-word AND search) |
| `GET /:id` | Full profile with affinity analysis (product/color/fabric) |
| `GET /:id/addresses` | Past addresses for autofill (ERP + Shopify) |
| `POST /` | Create customer |
| `PUT /:id` | Update customer |

**Analytics routes** (`/api/customers/analytics`):

| Path | Purpose |
|------|---------|
| `GET /overview` | KPIs: repeat rate, AOV, avg frequency, avg LTV |
| `GET /high-value` | Top customers by LTV (limit param) |
| `GET /frequent-returners` | Customers with >20% return rate (min 2 orders) |
| `GET /at-risk` | Silver+ tier with 90+ days no order |

**Reports routes** (`/api/reports`):

| Path | Purpose |
|------|---------|
| `GET /top-customers` | Dashboard card with city, top products |

## Cross-Domain

- **Orders**: LTV calculated from order totals
- **Shopify**: Customer data synced (email, defaultAddress)
- **Orders grid**: RTO count displayed for risk assessment

## Gotchas

1. **Dynamic preferred**: Use `getCustomerStatsMap()` over denormalized `customer.rtoCount`
2. **RTO excludes prepaid**: Only COD RTOs count toward risk
3. **LTV excludes zero-value**: Exchanges and giveaways don't inflate value
4. **Unshipped orders count**: Query uses `OR[trackingStatus=null OR NOT IN rto_*]`
5. **Tier auto-update**: Triggered on delivery and RTO via `updateCustomerTier()`
6. **Phone fallback**: Uses `customer.phone || mostRecentOrder.customerPhone`
7. **Batch tier updates**: Use `updateAllCustomerTiers()` with 5000-customer chunks to avoid bind variable limits
8. **Search multi-word**: All words must match across name/email/phone (AND logic)
