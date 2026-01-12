# Production Domain

> Batch scheduling and completion with inventory/fabric transactions.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/production.ts` |
| Key Files | `queryPatterns.ts` (getEffectiveFabricConsumption) |
| Related | Inventory (inward), Fabrics (outward) |

## Batch Status Flow

```
planned → in_progress → completed
                ↓
    [creates inventory inward]
    [creates fabric outward]
```

## Fabric Consumption Cascade

```javascript
consumptionPerUnit = SKU.fabricConsumption
    ?? Product.defaultFabricConsumption
    ?? 1.5  // meters (system default)

totalFabricNeeded = consumptionPerUnit * qtyCompleted
```

## Key Endpoints

| Path | Purpose |
|------|---------|
| `GET /batches` | List production batches |
| `POST /batches/:id/complete` | Complete with qty |
| `POST /batches/:id/uncomplete` | Reverse completion |
| `GET /requirements` | SKUs needing production |

## Cross-Domain

- **→ Inventory**: Completion creates inward (reason: production)
- **→ Fabrics**: Completion creates outward (reason: production)

## Gotchas

1. **Dual transaction**: Completion creates BOTH inventory inward AND fabric outward
2. **Fabric validation**: Validates fabric balance before creating outward
3. **Consumption fallback**: SKU → Product → 1.5 meters default
