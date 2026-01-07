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
| GET | `/pending-sources` | Overview of all pending inward sources |
| GET | `/scan-lookup?code=XXX` | SKU lookup with pending source matches |
| GET | `/pending-queue/:source` | Detailed queue for source (rto, production, returns, repacking) |
| POST | `/rto-inward-line` | Per-line RTO receipt with condition marking |

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

## Inward Hub Endpoints

### GET /pending-sources
Returns counts and sample items from all inward sources.

**Response:**
```javascript
{
    counts: {
        production: number,
        returns: number,
        rto: number,
        rtoUrgent: number,    // >14 days in RTO
        rtoWarning: number,   // 7-14 days in RTO
        repacking: number
    },
    items: {
        production: [...],    // Sample batch items
        returns: [...],       // Sample return lines
        rto: [...],          // Sample RTO lines
        repacking: [...]     // Sample repacking items
    }
}
```

### GET /scan-lookup?code=XXX
Finds SKU by code and matches to pending sources (priority: repacking > returns > RTO > production).

**Query params:** `code` (required)

**Response:**
```javascript
{
    sku: { id, skuCode, productName, colorName, size, imageUrl, ... },
    balance: { currentBalance, availableBalance, reserved },
    matches: [
        {
            source: 'repacking' | 'return' | 'rto' | 'production',
            priority: number,
            data: { /* source-specific fields */ }
        }
    ]
}
```

### GET /pending-queue/:source
Returns detailed pending items for a specific source with search and pagination.

**Path params:** `source` (rto, production, returns, repacking)
**Query params:** `search`, `limit` (default 50), `offset` (default 0)

**Response:**
```javascript
{
    source: string,
    items: [
        {
            // Normalized fields (all sources)
            id: string,
            skuId: string,
            skuCode: string,
            productName: string,
            colorName: string,
            size: string,
            qty: number,
            imageUrl: string,
            contextLabel: string,  // 'Order', 'Batch', 'Ticket'
            contextValue: string,  // Order number, batch code, etc.

            // Source-specific fields
            source: string,
            // RTO: lineId, orderId, orderNumber, customerName, trackingStatus,
            //      atWarehouse, rtoInitiatedAt, daysInRto, urgency
            // Production: batchId, batchCode, qtyPlanned, qtyCompleted, batchDate
            // Returns: lineId, requestId, requestNumber, reasonCategory, customerName
            // Repacking: queueItemId, condition, returnRequestNumber
        }
    ],
    total: number,
    pagination: { total, limit, offset, hasMore }
}
```

### POST /rto-inward-line
Processes a single RTO order line with condition marking.

**Body:**
```javascript
{
    lineId: string,           // OrderLine ID
    condition: string,        // 'good', 'damaged', 'wrong_product', 'unopened'
    notes?: string
}
```

**Behavior:**
- Marks line with `rtoCondition`, `rtoInwardedAt`, `rtoInwardedById`, `rtoNotes`
- Creates `inward` transaction (reason: `rto_received`) for `good` or `unopened`
- Creates `WriteOffLog` entry for `damaged` or `wrong_product`
- Validates order is in `rto_in_transit` or `rto_delivered` status
- Rejects if line already processed

**Response:**
```javascript
{
    orderLine: { id, rtoCondition, rtoInwardedAt, ... },
    inventoryTransaction?: { id, qty, reason, ... },
    writeOffRecord?: { id, reason, ... },
    balance: { currentBalance, availableBalance, reserved }
}
```

## Common Gotchas

1. **Reserved is not deducted from balance**: Only from `available`
2. **Quick inward validates SKU**: Checks SKU exists and is active before creating transaction
3. **Production batch matching**: Auto-links inward to pending batches (transaction-safe)
4. **Batch calculations**: Use `calculateAllInventoryBalances()` to avoid N+1
5. **Reference ID**: Use to link transaction to source (order, batch, return)
6. **RTO per-line processing**: Each line processed individually, not order-level
7. **RTO condition determines action**: Only `good`/`unopened` create inventory, others write-off
8. **Inward Hub priority**: Repacking > Returns > RTO > Production
9. **Negative balance protection**: `calculateInventoryBalance()` floors at 0 by default
10. **Transaction deletion validation**: Checks for dependencies before allowing deletion
11. **RTO idempotency**: Duplicate RTO inward requests are handled gracefully
12. **Adjustment audit trail**: Manual adjustments require reason and include user/timestamp in notes

## Data Integrity Features

### Idempotency Checks
- RTO inward uses `findExistingRtoInward()` to prevent duplicate transactions on retries
- Re-checks inside transaction to handle concurrent requests

### Validation Before Deletion
- `validateTransactionDeletion()` checks for:
  - Negative balance after deletion
  - Reserved inventory that would be affected
  - Active order allocations
  - Associated repacking queue items

### Race Condition Protection
- Quick-inward uses Prisma transaction for atomic SKU lookup + transaction creation
- RTO inward re-validates inside transaction
- Production batch matching is transaction-safe

## Related Frontend

- `pages/Inventory.tsx` (42KB) — Main inventory view
- `pages/Ledgers.tsx` (23KB) — Transaction history
- `pages/InwardHub.tsx` — Unified inward hub with queue panels
