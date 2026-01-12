# Orders Domain

> Order lifecycle, fulfillment workflow, unified views API, and line-level shipping.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/orders/` (modular: listOrders, fulfillment, mutations) |
| Key Files | `orderViews.js`, `queryPatterns.js`, `validation.js`, `shipOrderService.js` |
| Related | Inventory (reserved/sales), Shopify (cache), Customers (LTV), Shipping |

## File Structure

```
orders/
├── index.js        ← Router combiner
├── listOrders.js   ← GET /?view= (unified), legacy /open, /shipped
├── fulfillment.js  ← POST: /lines/:id/allocate|pick|pack, /:id/ship
└── mutations.js    ← POST/PUT/DELETE: create, update, cancel, archive
```

## Unified Views API

**Single endpoint**: `GET /orders?view=<name>` replaces 5 separate endpoints.

| View | Filter | Sort | Default Limit |
|------|--------|------|---------------|
| `open` | status='open', not archived | orderDate ASC (FIFO) | 10000 |
| `shipped` | shipped/delivered, excludes RTO & COD pending | shippedAt DESC | 100 |
| `rto` | trackingStatus in rto_* | rtoInitiatedAt DESC | 200 |
| `cod_pending` | COD + delivered + not remitted | deliveredAt DESC | 200 |
| `archived` | isArchived=true | archivedAt DESC | 100 |

**Query params**: `view`, `limit`, `offset`, `days`, `search`

**Search** works across: orderNumber, customerName, awbNumber, email, phone

**Architecture** (`orderViews.js`):
- `ORDER_VIEWS`: Config objects with where, orderBy, enrichment arrays
- `buildViewWhereClause()`: Handles exclusions, date filters, search
- `enrichOrdersForView()`: Applies view-specific enrichments

## Line Status Machine

```
pending → allocated → picked → packed → [ship] → shipped
            ↓
    (creates reserved)
```

**Inventory deduction**: Only lines with `allocatedAt` set get inventory deducted on ship. Unallocated orders (migration imports) skip inventory automatically.

**Undo actions**: unallocate (deletes reserved), unpick, unpack, unship (reverses sale + recreates reserved)

## Business Rules

1. **FIFO processing**: Open orders sorted by orderDate ASC for fair fulfillment
2. **Shipped view exclusions**: Excludes RTO and unpaid COD (separate views)
3. **Line-level shipping**: Each OrderLine can have own `shippingAddress` (JSON, nullable) - fallback to Order.shippingAddress
4. **Exchange orders**: Prefix `EXC-`, `isExchange=true`, allows zero/negative totalAmount
5. **Analytics excludes archives**: But includes archived if totalAmount > 0

## Validation Schemas (Zod)

| Schema | Validates |
|--------|-----------|
| `ShipOrderSchema` | AWB, courier required |
| `CreateOrderSchema` | Customer, lines, payment |
| `UpdateOrderSchema` | Customer, notes |

## Cross-Domain

- **→ Inventory**: Allocation creates reserved; shipping creates outward (sale)
- **→ Customers**: Delivery triggers tier recalculation
- **← Shopify**: Orders synced via ShopifyOrderCache
- **→ Shipping**: All ship operations via ShipOrderService

## Gotchas

1. **Unified views preferred**: Legacy endpoints (`/open`, `/shipped`) still work but use `?view=` instead
2. **Router order matters**: In `orders/index.js`, specific routes must come before parameterized (`:id`)
3. **Zod validation**: Order endpoints use `validate()` middleware
4. **Search is view-aware**: Same implementation via `buildViewWhereClause()`
5. **Auto-archive**: Orders >90 days old archived on server startup
