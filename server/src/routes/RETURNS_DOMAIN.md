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

## Status Transition Rules (State Machine)

Valid status transitions are enforced by `isValidStatusTransition()`:

| From Status | Allowed To Status |
|-------------|------------------|
| `requested` | `reverse_initiated`, `in_transit`, `cancelled` |
| `reverse_initiated` | `in_transit`, `received`, `cancelled` |
| `in_transit` | `received`, `cancelled` |
| `received` | `processing`, `resolved`, `cancelled`, `reverse_initiated` (undo) |
| `processing` | `resolved`, `cancelled` |
| `resolved` | (terminal - no transitions) |
| `cancelled` | (terminal - no transitions) |

## Race Condition Protection

The following operations use optimistic locking to prevent concurrent modification:

1. **Receive Item** (`POST /:id/receive-item`):
   - Re-checks `itemCondition` inside transaction
   - Checks for existing repacking queue item

2. **Process Repacking** (`POST /repacking/process`):
   - Re-checks item status inside transaction
   - Checks for existing inventory transactions

## Validation Rules

1. **Duplicate tickets**: Cannot create ticket with same SKU from same order if active ticket exists
2. **Reason category lock**: Cannot change `reasonCategory` after any item is received
3. **Refund validation**: `refundAmount` cannot exceed sum of line values
4. **Close validation**: Cannot resolve ticket until all lines have `itemCondition` set
5. **Delete protection**: Cannot delete if any repacking items are processed (`ready` or `write_off`)

## Common Gotchas

1. **Return vs Exchange logic**: Resolution type determines workflow
2. **Value difference**: `valueDifference` field tracks exchange up/down amounts
3. **Barcode scanning**: Uses `skuCode` field (not separate barcode) in pending lookups
4. **Status vs Resolution**: `status` is workflow state, `resolution` is outcome type
5. **Repacking is separate**: Item in repacking queue != return completed
6. **Undo-receive cleanup**: Deletes inventory transactions and write-off logs when undoing
7. **Input sanitization**: SKU lookup sanitizes input to prevent special character issues

## Related Frontend

- `pages/Returns.tsx` (113KB) — Main returns management (very large!)
- `pages/ReturnInward.tsx` (74KB) — Receiving and QC interface
