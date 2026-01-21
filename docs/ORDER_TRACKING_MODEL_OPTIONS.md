# Order Tracking Data Model Options

**Date**: 2026-01-21
**Status**: Evaluating

## Context

We need to decide the best data model for tracking shipments. Two main options:

1. **Option A**: OrderLine-centric (current direction, simplified)
2. **Option B**: Fulfillment model (Shopify-like)

---

## Option A: OrderLine-Centric Model

### Schema
```
Order
  └─ OrderLine (one per item ordered)
       ├─ awbNumber
       ├─ courier
       ├─ trackingStatus
       ├─ shippedAt, deliveredAt
       ├─ lastScanAt, lastScanLocation, etc.
       └─ rtoInitiatedAt, rtoReceivedAt
```

### Pros
- **Simpler schema** - No new tables, just clean up existing fields
- **Direct mapping** - Each line item has its tracking, easy to understand
- **Already partially implemented** - Current codebase uses this pattern
- **Flexible** - Each line can have different AWB (multi-AWB orders work naturally)

### Cons
- **Data duplication** - If 3 items ship together (same AWB), tracking data is duplicated 3x
- **Sync complexity** - When tracking updates, must update ALL lines with that AWB
- **Inconsistency risk** - Lines with same AWB could drift out of sync
- **Storage inefficiency** - ~80% of orders are single-AWB, so duplication is common

### Example: 3-item order shipped together
```
OrderLine 1: awbNumber="AWB123", courier="Delhivery", status="in_transit"
OrderLine 2: awbNumber="AWB123", courier="Delhivery", status="in_transit"  // duplicate
OrderLine 3: awbNumber="AWB123", courier="Delhivery", status="in_transit"  // duplicate
```

---

## Option B: Fulfillment Model (Shopify-like)

### Schema
```
Order
  └─ Fulfillment (one per shipment/AWB)
       ├─ awbNumber
       ├─ courier
       ├─ trackingStatus
       ├─ shippedAt, deliveredAt
       ├─ lastScanAt, lastScanLocation, etc.
       └─ FulfillmentLine (links to OrderLines)
            ├─ orderLineId
            └─ qty (how many of that line are in this fulfillment)

OrderLine (no tracking fields - just the item)
  ├─ skuId, qty, unitPrice
  └─ lineStatus (derived from fulfillments)
```

### Pros
- **No duplication** - One AWB = one Fulfillment record
- **Shopify aligned** - Mirrors Shopify's proven model, easier webhook mapping
- **Cleaner updates** - Update one Fulfillment, all linked lines are updated
- **Partial fulfillment native** - Can ship 2 of 3 items in first fulfillment, 1 later
- **Better for analytics** - Query shipments directly, not aggregated from lines

### Cons
- **More complex schema** - 2 new tables (Fulfillment, FulfillmentLine)
- **Migration effort** - More code changes, need to migrate existing data
- **Query complexity** - To get line status, must join through Fulfillment
- **Learning curve** - Team needs to understand new model

### Example: 3-item order shipped together
```
Fulfillment 1: awbNumber="AWB123", courier="Delhivery", status="in_transit"
  └─ FulfillmentLine: orderLineId=1, qty=1
  └─ FulfillmentLine: orderLineId=2, qty=1
  └─ FulfillmentLine: orderLineId=3, qty=1
```

### Example: 3-item order, partial shipment (2 now, 1 later)
```
Fulfillment 1: awbNumber="AWB123", status="delivered"
  └─ FulfillmentLine: orderLineId=1, qty=1
  └─ FulfillmentLine: orderLineId=2, qty=1

Fulfillment 2: awbNumber="AWB456", status="in_transit"
  └─ FulfillmentLine: orderLineId=3, qty=1
```

---

## Comparison Matrix

| Aspect | Option A (OrderLine) | Option B (Fulfillment) |
|--------|---------------------|------------------------|
| Schema complexity | Low (cleanup only) | Medium (2 new tables) |
| Data duplication | Yes (~80% of orders) | None |
| Migration effort | Low | Medium-High |
| Shopify alignment | Partial | Full |
| Multi-AWB support | Natural | Natural |
| Partial fulfillment | Awkward (qty tracking) | Native |
| Query simplicity | Simple (direct) | Medium (joins) |
| Update consistency | Risk of drift | Guaranteed |
| iThink sync | Update N lines | Update 1 fulfillment |
| Future flexibility | Limited | High |

---

## Shopify's Actual Model (Reference)

From Shopify's API:

```json
{
  "order": {
    "id": 12345,
    "line_items": [
      { "id": 1, "sku": "SKU-A", "quantity": 2 },
      { "id": 2, "sku": "SKU-B", "quantity": 1 }
    ],
    "fulfillments": [
      {
        "id": 100,
        "status": "success",
        "tracking_number": "AWB123",
        "tracking_company": "Delhivery",
        "tracking_url": "https://...",
        "shipment_status": "in_transit",
        "created_at": "2024-01-15T10:00:00Z",
        "line_items": [
          { "id": 1, "quantity": 2 },
          { "id": 2, "quantity": 1 }
        ]
      }
    ]
  }
}
```

Key observations:
- `fulfillments` is an array (multiple shipments possible)
- Each fulfillment has ONE tracking_number
- `line_items` inside fulfillment shows what was fulfilled
- `quantity` allows partial fulfillment (fulfill 1 of 2)

---

## Proposed Fulfillment Schema (if Option B chosen)

```prisma
model Fulfillment {
  id                   String             @id @default(uuid())
  orderId              String

  // Shipping info
  awbNumber            String
  courier              String
  shippedAt            DateTime

  // Tracking data (from iThink)
  trackingStatus       String?
  lastTrackingUpdate   DateTime?
  deliveredAt          DateTime?
  lastScanAt           DateTime?
  lastScanLocation     String?
  lastScanStatus       String?
  courierStatusCode    String?
  deliveryAttempts     Int?
  expectedDeliveryDate DateTime?

  // RTO
  rtoInitiatedAt       DateTime?
  rtoReceivedAt        DateTime?
  rtoCondition         String?
  rtoNotes             String?

  // Metadata
  createdAt            DateTime           @default(now())
  createdById          String?

  // Relations
  order                Order              @relation(fields: [orderId], references: [id])
  fulfillmentLines     FulfillmentLine[]

  @@unique([awbNumber])
  @@index([orderId])
  @@index([trackingStatus])
  @@index([awbNumber])
}

model FulfillmentLine {
  id             String      @id @default(uuid())
  fulfillmentId  String
  orderLineId    String
  qty            Int         // How many of this line are in this fulfillment

  fulfillment    Fulfillment @relation(fields: [fulfillmentId], references: [id])
  orderLine      OrderLine   @relation(fields: [orderLineId], references: [id])

  @@unique([fulfillmentId, orderLineId])
  @@index([orderLineId])
}
```

And **remove** from OrderLine:
- awbNumber, courier, shippedAt, deliveredAt
- trackingStatus, lastTrackingUpdate
- rtoInitiatedAt, rtoReceivedAt
- All iThink fields

---

## Migration Path (Option B)

### Phase 1: Add New Tables
1. Add `Fulfillment` and `FulfillmentLine` tables
2. Keep OrderLine tracking fields temporarily

### Phase 2: Data Migration
```sql
-- Create Fulfillments from distinct AWBs
INSERT INTO "Fulfillment" (id, orderId, awbNumber, courier, ...)
SELECT DISTINCT ON (awbNumber)
  gen_random_uuid(),
  orderId,
  awbNumber,
  courier,
  ...
FROM "OrderLine"
WHERE awbNumber IS NOT NULL;

-- Create FulfillmentLines
INSERT INTO "FulfillmentLine" (id, fulfillmentId, orderLineId, qty)
SELECT
  gen_random_uuid(),
  f.id,
  ol.id,
  ol.qty
FROM "OrderLine" ol
JOIN "Fulfillment" f ON ol.awbNumber = f.awbNumber;
```

### Phase 3: Code Updates
1. Ship mutations create Fulfillment + FulfillmentLines
2. Tracking sync updates Fulfillment only
3. Queries join through Fulfillment for status

### Phase 4: Cleanup
1. Remove tracking fields from OrderLine
2. Update all clients to use new model

---

## Recommendation

**For simplicity**: Option A (OrderLine-centric)
- Faster to implement
- Less migration risk
- Good enough for 5-20% multi-AWB rate

**For long-term maintainability**: Option B (Fulfillment model)
- Aligns with Shopify (industry standard)
- Cleaner data model
- Better for future features (partial fulfillment, split shipments)

**My recommendation**: If you're willing to invest in the migration, **Option B** is the better long-term choice. The Fulfillment model is battle-tested by Shopify and handles edge cases more elegantly.

---

## Decision

**Chosen approach**: Option A (OrderLine-centric)

**Rationale**:
1. **Simplicity is top priority** - User explicitly prioritizes simpler schema
2. **95%+ orders ship together** - Minimal AWB duplication in practice
3. **Willing to write complex queries** - Can use `SELECT DISTINCT awbNumber` for shipment reports
4. **Faster to implement** - Less migration risk, fewer code changes
5. **Partial fulfillment** - Can be handled with multiple AWBs on different lines

**Accepted tradeoffs**:
- Some data duplication when items ship together (acceptable given 95%+ same-box rate)
- AWB-level queries require aggregation (acceptable given query flexibility preference)

**Date decided**: 2026-01-21
