# Shipping Domain

> Unified shipping operations via ShipOrderService. All shipping must go through this service.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/orders/fulfillment.js` |
| Key Files | `server/src/services/shipOrderService.js` |
| Related | Orders (status), Inventory (outward), Tracking (AWB) |

## Architecture

**Single service**: All shipping operations through `ShipOrderService`.

```
Fulfillment Routes ──→ ShipOrderService ──→ Inventory (outward)
                                        └──→ Order/Line status update
```

**Why unified**: Prevents inventory leaks from bypassing proper deduction logic.

## Service API

```javascript
// Ship specific lines
shipOrderLines(tx, {
  orderLineIds,
  awbNumber,
  courier,
  userId,
  skipStatusValidation?,  // For migration
  skipInventory?          // For migration
})

// Ship entire order (convenience wrapper)
shipOrder(tx, { orderId, ...options })

// Pre-check without transaction
validateShipment(prisma, orderLineIds, options)
```

## Endpoints

| Path | Purpose | Notes |
|------|---------|-------|
| `POST /fulfillment/:id/ship` | Ship entire order | All lines must be packed |
| `POST /fulfillment/:id/ship-lines` | Ship specific lines | Partial shipment |
| `POST /fulfillment/process-marked-shipped` | Batch commit | Lines with status=marked_shipped |
| `POST /fulfillment/:id/migration-ship` | Onboarding (admin) | skipInventory=true |

## Business Rules

1. **Lines must be packed**: Standard ship requires all lines in `packed` status
2. **Allocated lines only**: Inventory deducted only for lines with `allocatedAt` set
3. **Migration exception**: Use `migration-ship` for onboarding orders (skips inventory)
4. **No bulk status update**: Cannot set `lineStatus='shipped'` via bulk-update

## Inventory Deduction Logic

```javascript
// Only deduct for allocated lines
if (line.allocatedAt) {
  createOutwardTransaction({ reason: 'sale', qty: line.quantity });
}
// Unallocated lines (migration) skip inventory
```

## Cross-Domain

- **← Orders**: Ship action on packed orders
- **→ Inventory**: Creates outward transactions (sale reason)
- **→ Tracking**: AWB number assigned for tracking

## Gotchas

1. **Service required**: All shipping MUST go through ShipOrderService
2. **Unallocated skip**: Lines without `allocatedAt` don't affect inventory
3. **Removed systems**: Quick-ship, auto-ship, bulk-update to shipped (all bypassed proper handling)
4. **Migration-ship**: Admin only, use for onboarding historical orders
5. **Validate first**: Use `validateShipment()` for pre-checks without committing
