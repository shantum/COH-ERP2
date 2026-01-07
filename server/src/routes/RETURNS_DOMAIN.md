# Returns Domain

Return request workflow, repacking queue, and write-offs.

## Key Files

| File | Size | Purpose |
|------|------|---------|
| `returns.js` | 73KB | Return request management (1962 lines) |
| `repacking.js` | 23KB | QC queue and write-off processing |
| `../utils/tierUtils.js` | 3KB | Customer tier for prioritization |

## Return Request Status Flow

```
requested → reverse_initiated → in_transit → received → processing → completed
                                    ↓
                              [to repacking queue]
```

## Resolution Types

| Resolution | Description |
|------------|-------------|
| `refund` | Full refund, no replacement |
| `exchange_same` | Same item replacement |
| `exchange_up` | Higher value replacement (customer pays difference) |
| `exchange_down` | Lower value replacement (refund difference) |

## Key Endpoints (returns.js)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | All return requests |
| GET | `/pending` | Awaiting receipt |
| GET | `/pending/by-sku` | Find tickets by SKU code/barcode |
| GET | `/action-queue` | Dashboard with action counts |
| POST | `/:id/receive-item` | Receive and QC item |
| POST | `/:id/ship-replacement` | Ship exchange replacement |
| PUT | `/:id/resolution` | Set resolution type |
| PUT | `/:id/refund` | Record refund processed |
| PUT | `/:id/payment` | Record customer payment (exchange_up) |

## Action Queue Buckets

The `/action-queue` endpoint returns counts for:
- `pendingPickup` — Reverse not yet initiated
- `inTransit` — Waiting for item to arrive
- `received` — Item received, needs QC
- `exchangesReadyToShip` — Replacement ready
- `refundsPending` — Exchange_down needs refund
- `paymentsPending` — Exchange_up needs payment

## Repacking Queue (repacking.js)

Items go to repacking after return receipt:

```
[from returns] → pending → inspecting → repacking → ready | write_off
                                                      ↓         ↓
                                              [add to stock]  [WriteOffLog]
```

| Endpoint | Purpose |
|----------|---------|
| GET `/queue` | Pending repacking items |
| GET `/queue/stats` | Status counts |
| POST `/process` | Accept (restock) or write-off item |
| GET `/write-offs` | Write-off history |

## Inventory Integration

- **On accept (restock)**: Creates `inward` transaction with reason `return_receipt`
- **On write-off**: Creates `WriteOffLog` with reason and value

## Key Data Models

```
ReturnRequest
  → ReturnRequestLine (items being returned)
  → ReturnShipping (forward/reverse shipment tracking)
  → ReturnStatusHistory (audit trail)
  
RepackingQueueItem
  → WriteOffLog (if item written off)
```

## Dependencies

- **Orders**: Original order reference
- **Inventory**: Restock transactions
- **Customers**: Tier for prioritization
- **SKUs**: For barcode/code lookup

## Common Gotchas

1. **Return vs Exchange logic**: Resolution type determines workflow
2. **Value difference**: `valueDifference` field tracks exchange up/down amounts
3. **Barcode scanning**: Uses `skuCode` field (not separate barcode) in pending lookups
4. **Status vs Resolution**: `status` is workflow state, `resolution` is outcome type
5. **Repacking is separate**: Item in repacking queue ≠ return completed

## Related Frontend

- `pages/Returns.tsx` (113KB) — Main returns management (very large!)
- `pages/ReturnInward.tsx` (74KB) — Receiving and QC interface
