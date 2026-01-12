# Customers Domain

> Customer management, tier calculation, LTV tracking, and RTO risk assessment.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/customers.ts`, `reports.ts` |
| Key Files | `tierUtils.ts` (getCustomerStatsMap, calculateTier) |
| Related | Orders (LTV source), Shopify (customer sync) |

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

**Tier updates triggered by**: Order delivery, RTO initiation, manual batch update

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
import { getCustomerStatsMap, enrichOrdersWithCustomerStats } from 'tierUtils.ts';

// Option 1: Enrich orders
const enriched = await enrichOrdersWithCustomerStats(prisma, orders);
// Adds: customerLtv, customerOrderCount, customerRtoCount, customerTier

// Option 2: Direct stats map
const statsMap = await getCustomerStatsMap(prisma, customerIds);
const stats = statsMap[customerId]; // { ltv, orderCount, rtoCount }
```

## Key Endpoints

| Path | Purpose |
|------|---------|
| `GET /customers` | List with metrics (tier params: platinum, gold, silver, bronze) |
| `GET /customers/:id` | Full profile with affinity analysis |
| `GET /customers/:id/addresses` | Past addresses for autofill |
| `GET /reports/top-customers` | Dashboard card with top products |

## Cross-Domain

- **← Orders**: LTV calculated from order totals
- **← Shopify**: Customer data synced
- **→ Orders**: RTO count displayed in grid for risk assessment

## Gotchas

1. **Dynamic preferred**: Use `getCustomerStatsMap()` over denormalized `customer.rtoCount`
2. **RTO excludes prepaid**: Only COD RTOs count toward risk
3. **LTV excludes zero-value**: Exchanges and giveaways don't inflate value
4. **Unshipped orders count**: Query uses `OR[trackingStatus=null OR NOT IN rto_*]`
5. **Tier auto-update**: Triggered on delivery and RTO, not order creation
6. **Phone fallback**: Uses `customer.phone || mostRecentOrder.customerPhone`
