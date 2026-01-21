# Order → OrderLine Migration Plan

**Date**: 2026-01-21
**Status**: Code Complete - Ready for Prisma Migration

## Summary

Migrating from dual Order/OrderLine tracking fields to **OrderLine as single source of truth**. This simplifies the data model, eliminates sync issues, and properly supports multi-AWB orders.

## Design Decisions

| Question | Decision |
|----------|----------|
| Multi-AWB frequency | Occasional (5-20%) - must support |
| Hold functionality | **Not needed** - remove entirely |
| AWB search behavior | Show order + highlight matching line |
| RTO scope | Usually order-level (all lines same status) |
| Order tracking fields | **Remove completely** - derive from lines |
| Terminal status | **Derive from lines** - no Order-level fields |
| iThink tracking data | **Move to OrderLine** |
| View filters (RTO, COD) | **Any line matches** = order appears in view |

## Schema Changes

### Fields to ADD to OrderLine

These fields currently only exist on Order, need to move to OrderLine:

```prisma
model OrderLine {
  // ... existing fields ...

  // NEW: iThink tracking data (moved from Order)
  lastScanAt          DateTime?
  lastScanLocation    String?
  lastScanStatus      String?
  courierStatusCode   String?
  deliveryAttempts    Int?
  expectedDeliveryDate DateTime?
}
```

### Fields to REMOVE from Order

```prisma
// REMOVE all of these from Order model:

// Tracking (now on OrderLine only)
awbNumber            String?   // REMOVE
courier              String?   // REMOVE
shippedAt            DateTime? // REMOVE
deliveredAt          DateTime? // REMOVE
trackingStatus       String?   // REMOVE
lastTrackingUpdate   DateTime? // REMOVE
lastScanAt           DateTime? // REMOVE
lastScanLocation     String?   // REMOVE
lastScanStatus       String?   // REMOVE
courierStatusCode    String?   // REMOVE
deliveryAttempts     Int?      // REMOVE
expectedDeliveryDate DateTime? // REMOVE

// RTO (now on OrderLine only)
rtoInitiatedAt       DateTime? // REMOVE
rtoReceivedAt        DateTime? // REMOVE

// Terminal (derive from lines)
terminalAt           DateTime? // REMOVE
terminalStatus       String?   // REMOVE

// Hold (not needed)
isOnHold             Boolean?  // REMOVE
holdAt               DateTime? // REMOVE
holdReason           String?   // REMOVE
holdNotes            String?   // REMOVE
```

### Fields to REMOVE from OrderLine

```prisma
// REMOVE hold fields from OrderLine (not needed)
isOnHold             Boolean?  // REMOVE
holdAt               DateTime? // REMOVE
holdReason           String?   // REMOVE
holdNotes            String?   // REMOVE
```

## Query Changes

### View Filtering

**Before** (Order-level):
```sql
WHERE "Order"."trackingStatus" IN ('rto_in_transit', 'rto_delivered')
```

**After** (Any line matches):
```sql
WHERE EXISTS (
  SELECT 1 FROM "OrderLine" ol
  WHERE ol."orderId" = "Order"."id"
  AND ol."trackingStatus" IN ('rto_in_transit', 'rto_delivered')
)
```

### AWB Search

**Before** (Order-level):
```sql
WHERE "Order"."awbNumber" LIKE '%search%'
```

**After** (OrderLine):
```sql
WHERE EXISTS (
  SELECT 1 FROM "OrderLine" ol
  WHERE ol."orderId" = "Order"."id"
  AND ol."awbNumber" LIKE '%search%'
)
```

### Terminal Status Derivation

Instead of `Order.terminalStatus`, compute from lines:

```typescript
function getOrderTerminalStatus(lines: OrderLine[]): string | null {
  if (lines.every(l => l.trackingStatus === 'delivered')) return 'delivered';
  if (lines.every(l => l.trackingStatus === 'rto_delivered')) return 'rto_delivered';
  if (lines.every(l => l.lineStatus === 'cancelled')) return 'cancelled';
  return null; // Not terminal
}
```

## Code Changes Required

### Server

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add fields to OrderLine, remove from Order |
| `routes/tracking.ts` | Write to OrderLine instead of Order |
| `services/trackingSync.ts` | Update to OrderLine only |
| `db/queries/ordersListKysely.ts` | Update filters to use EXISTS on OrderLine |
| `utils/orderStatus.ts` | Remove Order-level field references |
| `utils/orderEnrichment/*` | Compute from OrderLine fields |
| `trpc/routers/orders.ts` | Remove hold mutations, update tracking writes |
| `routes/orders/mutations/lifecycle.ts` | Remove hold endpoints |
| `rules/definitions/hold.ts` | Delete file |
| `rules/definitions/rto.ts` | Use OrderLine fields |

### Client

| File | Changes |
|------|---------|
| `utils/orderHelpers.ts` | Remove Order-level field flattening |
| `hooks/orders/optimistic/*` | Update to OrderLine fields |
| `components/orders/UnifiedOrderModal/*` | Use line-level data |
| `components/orders/OrdersTable/cells/*` | Confirm using `line*` fields |
| `pages/Orders.tsx` | Remove hold-related UI |

## Migration Steps

### Phase 1: Schema Migration

1. Add new fields to OrderLine (non-breaking)
2. Run data migration to copy Order values to first OrderLine
3. Update all write paths to OrderLine
4. Update all read paths to OrderLine
5. Remove Order fields (breaking change)

### Phase 2: Code Updates

1. Update `trackingSync.ts` - write to OrderLine only
2. Update `ordersListKysely.ts` - use EXISTS for filters
3. Update `orderStatus.ts` - derive from lines
4. Remove hold mutations and UI
5. Update client components

### Phase 3: Cleanup

1. Remove deprecated Order fields from schema
2. Delete hold-related code
3. Update documentation

## Data Migration Script

```typescript
// scripts/migrateOrderTrackingToLines.ts
async function migrateOrderTrackingToLines() {
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { awbNumber: { not: null } },
        { trackingStatus: { not: null } },
      ]
    },
    include: { orderLines: true }
  });

  for (const order of orders) {
    // Find lines that need the Order-level data
    const linesToUpdate = order.orderLines.filter(
      line => !line.awbNumber && order.awbNumber
    );

    if (linesToUpdate.length > 0) {
      await prisma.orderLine.updateMany({
        where: { id: { in: linesToUpdate.map(l => l.id) } },
        data: {
          awbNumber: order.awbNumber,
          courier: order.courier,
          shippedAt: order.shippedAt,
          deliveredAt: order.deliveredAt,
          trackingStatus: order.trackingStatus,
          lastTrackingUpdate: order.lastTrackingUpdate,
          lastScanAt: order.lastScanAt,
          lastScanLocation: order.lastScanLocation,
          lastScanStatus: order.lastScanStatus,
          courierStatusCode: order.courierStatusCode,
          deliveryAttempts: order.deliveryAttempts,
          expectedDeliveryDate: order.expectedDeliveryDate,
          rtoInitiatedAt: order.rtoInitiatedAt,
          rtoReceivedAt: order.rtoReceivedAt,
        }
      });
    }
  }
}
```

## Rollback Plan

If issues arise:
1. Keep Order fields in schema (don't delete immediately)
2. Dual-write during transition
3. Can revert to Order-level reads if needed

## Success Criteria

- [ ] All tracking data on OrderLine only
- [ ] No Order-level tracking fields in schema
- [ ] View filters work with ANY line matching
- [ ] AWB search finds orders by line AWB
- [ ] Multi-AWB orders display correctly
- [ ] No hold functionality in codebase
- [ ] TypeScript compiles without errors
- [ ] All existing tests pass
