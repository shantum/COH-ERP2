# Production Domain

> Batch scheduling and completion with inventory/fabric transactions.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/production.ts` |
| Key Files | `utils/queryPatterns.ts` (getEffectiveFabricConsumption), `utils/productionUtils.js` |
| Related | Inventory (inward), Fabrics (outward) |

## Batch Status Flow

```
planned → in_progress → completed
                ↓
    [creates inventory inward]
    [creates fabric outward]
```

**Auto-status**: Status auto-updates based on `qtyCompleted` vs `qtyPlanned`.

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
| `GET /batches` | List batches (filter: status, tailorId, startDate, endDate, customOnly) |
| `POST /batches` | Create batch (validates locked dates, past dates) |
| `POST /batches/:id/start` | Set status to in_progress |
| `POST /batches/:id/complete` | Complete with qty (creates inventory + fabric txns) |
| `POST /batches/:id/uncomplete` | Reverse completion (deletes txns) |
| `GET /requirements` | Order-wise production needs (pending lines without inventory) |
| `GET /pending-by-sku/:skuId` | Pending batches for a SKU |
| `GET /locked-dates` | Get locked production dates |
| `POST /lock-date` | Lock a date (prevents new batches) |
| `POST /unlock-date` | Unlock a date |
| `GET /capacity` | Daily tailor capacity dashboard |

## Cross-Domain

- **Inventory**: Completion creates inward (reason: `production` or `production_custom`)
- **Fabrics**: Completion creates outward (reason: `production`)
- **Custom SKUs**: Auto-allocate to linked order line on completion

## Gotchas

1. **Dual transaction**: Completion creates BOTH inventory inward AND fabric outward
2. **Fabric validation**: Validates fabric balance inside transaction before creating outward
3. **Consumption fallback**: SKU → Product → 1.5 meters default
4. **Custom SKU auto-allocate**: Custom batches auto-allocate on completion; standard batches require manual allocation
5. **Atomic batch codes**: Format `YYYYMMDD-XXX`, race-condition safe via unique constraint + retry
6. **Locked dates**: Stored in `SystemSetting` (key: `production_locked_dates`), prevents new batches
7. **Cannot delete completed**: Batches with inventory/fabric transactions must be uncompleted first
8. **Uncomplete blocks if progressed**: Custom SKU uncomplete blocked if order line is picked/packed/shipped
