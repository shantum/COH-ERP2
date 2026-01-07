# Inventory Domain

SKU inventory management with ledger-based transactions.

## Key Files

| File | Size | Purpose |
|------|------|---------|
| `inventory.js` | 21KB | Inventory endpoints (613 lines) |
| `../utils/queryPatterns.js` | 14KB | Balance calculations, transaction helpers |

## Transaction Types

| Type | Description | Examples |
|------|-------------|----------|
| `inward` | Stock additions | production, return_receipt, adjustment |
| `outward` | Stock removals | sale, damage, adjustment |
| `reserved` | Soft holds | order_allocation |

## Balance Formula

```javascript
Balance = SUM(inward) - SUM(outward)
Available = Balance - SUM(reserved)
```

**Key function:** `calculateInventoryBalance(prisma, skuId)`

## Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/balance` | All SKU balances with pagination |
| GET | `/balance/:skuId` | Single SKU balance |
| GET | `/transactions` | Transaction history with filters |
| POST | `/inward` | Create inward transaction |
| POST | `/outward` | Create outward transaction |
| POST | `/quick-inward` | Simplified inward (production) |
| GET | `/inward-history` | Production inward history |
| GET | `/alerts` | Low stock alerts |

## Transaction Reasons

| Type | Allowed Reasons |
|------|-----------------|
| `inward` | `production`, `return_receipt`, `adjustment` |
| `outward` | `sale`, `damage`, `adjustment` |
| `reserved` | `order_allocation` |

## Key Functions (queryPatterns.js)

### Balance Calculations
```javascript
calculateInventoryBalance(prisma, skuId)
calculateAllInventoryBalances(prisma, skuIds)  // Batch - avoids N+1
```

### Transaction Helpers
```javascript
createReservedTransaction(prisma, { skuId, qty, orderLineId, userId })
releaseReservedInventory(prisma, orderLineId)
releaseReservedInventoryBatch(prisma, orderLineIds)  // Batch
createSaleTransaction(prisma, { skuId, qty, orderLineId, userId })
deleteSaleTransactions(prisma, orderLineId)
```

## Quick Inward Flow

`POST /quick-inward` with barcode or SKU code:

1. Find SKU by code/barcode
2. Create `inward` transaction (reason: `production`)
3. Match to pending `ProductionBatch` if exists
4. Return new balance and matched batch info

## Outward Validation

`POST /outward` checks balance before creating:
```javascript
if (balance.currentBalance < qty) {
    return error('Insufficient balance')
}
```

## Data Model

```
InventoryTransaction
  - id, skuId, txnType, qty, reason
  - referenceId (links to order/batch)
  - userId, warehouseLocation, notes
  - createdAt
```

## Dependencies

- **Orders**: Creates `reserved` on allocate, `outward` on ship
- **Production**: Creates `inward` on batch completion
- **Returns**: Creates `inward` on restock from repacking
- **SKUs**: All transactions link to SKU

## Integration Points

### From Orders Domain
```javascript
// On allocate
createReservedTransaction(prisma, { skuId, qty, orderLineId })

// On ship
releaseReservedInventory(prisma, orderLineId)
createSaleTransaction(prisma, { skuId, qty, orderLineId })
```

### From Production Domain
```javascript
// On batch complete
prisma.inventoryTransaction.create({
    txnType: 'inward',
    reason: 'production',
    referenceId: batchId
})
```

## Stock Alerts

`GET /alerts` returns SKUs where:
```javascript
availableBalance < sku.targetStockQty
```

## Common Gotchas

1. **Reserved is not deducted from balance**: Only from `available`
2. **Quick inward guesses SKU**: Matches by `skuCode` or `barcode`
3. **Production batch matching**: Auto-links inward to pending batches
4. **Batch calculations**: Use `calculateAllInventoryBalances()` to avoid N+1
5. **Reference ID**: Use to link transaction to source (order, batch, return)

## Related Frontend

- `pages/Inventory.tsx` (42KB) — Main inventory view
- `pages/Ledgers.tsx` (23KB) — Transaction history
