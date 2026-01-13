# Fabrics Domain

> Fabric inventory with ledger-based transactions, cost inheritance, and reorder analysis.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/fabrics/` (modular) |
| Key Files | `queryPatterns.ts` (calculateFabricBalance, getEffectiveFabricConsumption) |
| Related | Production (outward), Products (fabricTypeId) |

## Route Structure

```
routes/fabrics/
├── index.ts          # Router composition
├── types.ts          # Shared types, helpers
├── colors.ts         # Fabric color operations
├── fabricTypes.ts    # Fabric type CRUD
├── transactions.ts   # Fabric transactions, balance
└── reconciliation.ts # Reconciliation workflow
```

## Data Model

```
FabricType (e.g., "Linen 60 Lea")
├── defaultCostPerUnit    ← inherited by Fabric if null
├── defaultLeadTimeDays   ← inherited by Fabric if null
└── fabrics[]
    └── Fabric (e.g., "Mustard Linen")
        ├── costPerUnit   ← null = inherit from type
        └── transactions[]
```

## Balance Formula

```javascript
Balance = SUM(inward) - SUM(outward)
// Note: No "reserved" concept for fabrics (unlike SKU inventory)
```

## Cost Cascade

```javascript
effectiveCost = Fabric.costPerUnit ?? FabricType.defaultCostPerUnit ?? 0
// Null at Fabric level = inherit from FabricType
```

## Transaction Types

| txnType | reason | When Created |
|---------|--------|--------------|
| `inward` | `supplier_receipt` | FabricOrder received |
| `inward` | `reconciliation_*` | Physical count +variance |
| `outward` | `production` | ProductionBatch completed |
| `outward` | `reconciliation_*` | Physical count -variance |

## Stock Status Calculation

```javascript
avgDailyConsumption = SUM(outward last 28d) / 28
reorderPoint = avgDailyConsumption * (leadTimeDays + 7)

if (balance <= reorderPoint) status = 'ORDER NOW'
else if (balance <= avgDaily * (leadTime + 14)) status = 'ORDER SOON'
else status = 'OK'
```

## Views

| View | Aggregation |
|------|-------------|
| `color` (default) | Per-fabric: balance, consumption, status |
| `type` | Aggregated: colorCount, totalStock, productCount |

## Key Endpoints

| Path | Purpose |
|------|---------|
| `GET /flat?view=color|type` | AG-Grid data with filters |
| `POST /:id/transactions` | Create inward/outward |
| `POST /reconciliation/start` | Start physical count |
| `POST /reconciliation/:id/submit` | Finalize with adjustments |

## Cross-Domain

- **← Production**: Batch completion creates outward
- **→ Products**: `Product.fabricTypeId` links to FabricType
- **→ Variations**: `Variation.fabricId` links to specific Fabric

## Gotchas

1. **Default type protected**: Cannot rename or add colors to Default FabricType
2. **Soft delete**: Deleting fabric reassigns Variations to Default, may delete empty type
3. **No reserved concept**: Unlike SKU inventory, fabrics don't have reserved quantities
4. **Production check**: Batch completion validates fabric balance before outward
5. **Cost inheritance**: Null at Fabric level means inherit from FabricType
6. **Reconciliation immutable**: Cannot edit after status='submitted'
7. **Type view excludes Default**: Aggregation excludes Default fabric type
