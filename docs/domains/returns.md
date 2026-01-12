# Returns & RTO Domain

> Two distinct workflows: customer-initiated returns (exchange/refund) vs carrier-initiated RTOs (failed delivery).

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `returns.ts` (tickets), `inventory.ts` (RTO inward), `repacking.ts` (QC) |
| Key Files | `queryPatterns.ts`, `tierUtils.ts`, `orderViews.ts` |
| Related | Inventory (inward/write-off), Orders (RTO view), Customers (RTO risk) |

## RTO vs Return Distinction

| Aspect | RTO | Return |
|--------|-----|--------|
| Trigger | Carrier (failed delivery) | Customer (refund/exchange) |
| Status field | `Order.trackingStatus` (rto_*) | `ReturnRequest.status` |
| Processing | `/inventory/rto-inward-line` | `/returns/:id/receive-item` → repacking |
| LTV impact | Excludes from LTV | Doesn't affect LTV |

## Return Ticket Status Flow

```
requested → reverse_initiated → in_transit → received → resolved
                                                ↓
                                    [items to repacking queue]
```

**Valid transitions**:
- `requested` → reverse_initiated, in_transit, cancelled
- `in_transit` → received, cancelled
- `received` → resolved, cancelled

## RTO Processing Flow

```
Order.trackingStatus: in_transit → rto_initiated → rto_in_transit → rto_delivered
                                                                          ↓
                                                              /rto-inward-line
                                                                    ↓
                                              ┌─────────────────────┼─────────────────────┐
                                              ↓                     ↓                     ↓
                                        good/unopened          damaged            wrong_product
                                              ↓                     ↓                     ↓
                                        Inventory +1         WriteOffLog            WriteOffLog
```

## Repacking Queue Flow

```
[from returns receive] → pending → inspecting → repacking → ready | write_off
                                                               ↓         ↓
                                                         Inventory    WriteOffLog
                                                         inward
```

## Business Rules

1. **Customized items blocked**: `isNonReturnable=true` on OrderLine blocks return
2. **Reason locking**: `reasonCategory` locked after first item received
3. **Exchange early-ship**: Replacement can ship when reverse is `in_transit` (not received)
4. **RTO count COD-only**: Only COD orders with RTO status count toward customer risk
5. **Idempotency**: Both RTO inward and repacking have duplicate checks (retry-safe)

## Resolution Types

| Resolution | Customer Outcome |
|------------|------------------|
| `refund` | Money back |
| `exchange_same` | Same value item |
| `exchange_up` | Higher value, customer pays difference |
| `exchange_down` | Lower value, refund difference |

## Item Conditions

| Condition | Inventory Action |
|-----------|------------------|
| `good`, `unopened` | Creates inward (+stock) |
| `used` | Goes to repacking queue |
| `damaged`, `wrong_product` | Write-off only |

## Key Endpoints

**Returns** (`/api/returns`):
- `POST /` - Create ticket (validates customization, duplicates)
- `POST /:id/receive-item` - Receive with condition → repacking queue
- `PUT /:id/mark-reverse-in-transit` - Enable early-ship
- `PUT /:id/ship-replacement` - Ship exchange (requires reverse in-transit)

**RTO** (`/api/inventory`):
- `GET /pending-queue/rto` - RTO lines awaiting processing
- `POST /rto-inward-line` - Process single line with condition

**Repacking** (`/api/repacking`):
- `GET /queue` - Pending QC items
- `POST /process` - Accept (`ready`) or write-off

## Cross-Domain

- **→ Inventory**: RTO inward creates transaction or write-off
- **→ Customers**: COD RTO count affects risk scoring
- **← Tracking**: Status changes (rto_*) trigger RTO visibility in queue

## Gotchas

1. **RTO vs Return**: Different routes, different models, different workflows
2. **Per-line RTO**: Use `/rto-inward-line` - each line can have different condition
3. **Condition determines action**: `good`/`unopened` = stock, others = write-off
4. **Early-ship**: Exchange can ship when reverse `in_transit`, NOT when `received`
5. **Auto-resolve**: Exchange auto-resolves when BOTH `reverseReceived` AND `forwardDelivered`
6. **Terminal status**: All RTO lines processed → `Order.terminalStatus='rto_received'`
7. **Optimistic locking**: Repacking re-checks status inside transaction (concurrent-safe)
8. **Write-off sources**: `return` (repacking), `rto` (RTO inward), `production`, `inventory_audit`
