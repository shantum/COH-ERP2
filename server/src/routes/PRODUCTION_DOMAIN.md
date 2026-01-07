# Production Domain

Production batch scheduling and completion.

## Key Files

| File | Size | Purpose |
|------|------|---------|
| `production.js` | 20KB | Batch management (511 lines) |
| `../utils/queryPatterns.js` | 14KB | Fabric consumption helpers |

## Batch Status Flow

```
planned → in_progress → completed
                ↓
    [creates inventory inward]
    [creates fabric outward]
```

## Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/batches` | List production batches |
| POST | `/batches` | Create new batch |
| POST | `/batches/:id/start` | Start production |
| PUT | `/batches/:id` | Update batch details |
| DELETE | `/batches/:id` | Delete planned batch |
| POST | `/batches/:id/complete` | Complete with qty |
| POST | `/batches/:id/uncomplete` | Reverse completion |
| GET | `/locked-dates` | Get locked production dates |
| POST | `/locked-dates` | Lock a date |
| DELETE | `/locked-dates/:date` | Unlock a date |
| GET | `/capacity` | Daily capacity calculations |
| GET | `/requirements` | SKUs needing production |
| GET | `/tailors` | List tailors |

## Batch Completion

On `POST /batches/:id/complete`:

1. Update batch with `qtyCompleted`, `status: 'completed'`
2. Create inventory `inward` transaction (reason: `production`)
3. Create fabric `outward` transaction (fabric consumption)

Both operations run in a Prisma transaction.

## Uncomplete Batch

On `POST /batches/:id/uncomplete`:

1. Delete inventory `inward` transaction for this batch
2. Delete fabric `outward` transaction for this batch
3. Reset batch to `in_progress`, clear `qtyCompleted`

## Fabric Consumption

Fabric is consumed when batch completes:

```javascript
// Get consumption rate
getEffectiveFabricConsumption(sku)
// Returns: sku.fabricConsumption || product.fabricConsumption || 1.5

// Calculate total fabric
totalFabric = qtyCompleted * consumptionRate
```

## Batch Code Generation

Auto-generated format: `YYYYMMDD-XXX`

```javascript
generateBatchCode(prisma, targetDate)
// Returns: "20260107-001", "20260107-002", etc.
```

## Date Locking

Production dates can be locked to prevent new batches:

- `GET /locked-dates` — Returns locked date list
- `POST /locked-dates` — Lock a date (prevents batch creation)
- `DELETE /locked-dates/:date` — Unlock

## Order Line Integration

Batches can link to order lines for out-of-stock items:

```javascript
// When creating batch with sourceOrderLineId
await prisma.orderLine.update({
    where: { id: sourceOrderLineId },
    data: { productionBatchId: batch.id }
})
```

## Capacity Planning

`GET /capacity` returns:
- Daily batch counts by date
- SKU distribution
- Tailor workload

`GET /requirements` returns SKUs where:
- `availableBalance < targetStockQty`
- No pending/in_progress batch exists

## Data Model

```
ProductionBatch
  - id, batchCode, batchDate
  - skuId, qtyPlanned, qtyCompleted
  - tailorId, status, priority
  - sourceOrderLineId (optional link)
  - notes, completedAt
  
Tailor
  - id, name, isActive
```

## Dependencies

- **Inventory**: Creates `inward` transaction on complete
- **Fabrics**: Creates `outward` transaction on complete
- **Orders**: Can link to order lines for scheduling
- **SKUs**: Each batch is for a specific SKU

## Common Gotchas

1. **Dual transactions**: Completion creates BOTH inventory inward AND fabric outward
2. **Fabric consumption fallback**: SKU → Product → 1.5 (hardcoded default)
3. **Locked dates**: Check before creating batches
4. **Uncomplete deletes transactions**: No soft delete
5. **Batch code sequential**: Per-date numbering (001, 002, etc.)
6. **Order line link**: Optional, for tracking production source

## Related Frontend

- `pages/Production.tsx` (50KB) — Production planning
- `pages/ProductionInward.tsx` (46KB) — Recording completions
