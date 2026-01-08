# Test Documentation

> **404 tests** | Framework: Jest | Run: `cd server && npm test`

## Test Files Summary

| File | Tests | Coverage |
|------|-------|----------|
| `essential.test.js` | 71 | Core utilities, encryption, tier calculation |
| `integration.test.js` | 69 | Order/fulfillment, status transitions |
| `database-webhook.test.js` | 68 | DB validation, webhook schemas, sync |
| `returns-exchange.test.js` | 103 | Return workflows, exchange, repacking |
| `orders-inventory.test.js` | 93 | Inventory transactions, allocation |

## Key Test Categories

### Utility Functions (Essential)
- `getEffectiveFabricConsumption()` - SKU -> Product -> 1.5 fallback
- `calculateInventoryBalance()` - inward - outward, available = balance - reserved
- `validatePassword()` - 8+ chars, uppercase, lowercase, number, special
- `calculateTier()/calculateLTV()` - Bronze < 10k < Silver < 25k < Gold < 50k < Platinum
- `encrypt()/decrypt()/isEncrypted()` - AES-256-GCM round trip

### Shopify Mapping
- `mapOrderStatus()` - cancelled_at -> cancelled, fulfilled -> delivered, default -> open
- `mapOrderChannel()` - web -> shopify_online, pos -> shopify_pos
- Payment detection - pending financial_status = COD, paid = Prepaid

### Order Status Transitions (Integration)
```
Valid: pending -> allocated -> picked -> packed -> shipped
Undo:  allocated -> pending, picked -> allocated, packed -> picked, shipped -> allocated
```

### Fulfillment Stage
| Line Statuses | Stage |
|---------------|-------|
| All pending | `pending` |
| All allocated | `allocated` |
| Mixed | `in_progress` |
| All packed | `ready_to_ship` |

### Inventory Transactions
| Action | Transaction |
|--------|-------------|
| Allocate | Create `reserved` |
| Ship | Delete `reserved`, Create `outward` (sale) |
| Unship | Delete `outward`, Create `reserved` |
| Return restock | Create `inward` (return_receipt) |

### Return Processing
- Status: requested -> reverse_initiated -> in_transit -> received -> processing -> completed
- Conditions: resellable = restock, damaged/defective = no restock
- Resolution: refund, exchange_same, exchange_up, exchange_down

## Not Yet Tested

**Priority High:**
- Route handlers (HTTP layer) for orders, returns, inventory, webhooks
- End-to-end fulfillment flow
- Shopify sync service functions

**Medium:**
- Frontend components (React Testing Library)
- Production batch workflow

## Running Tests

```bash
cd server && npm test           # All tests
npm test:watch                  # Watch mode
npm test:coverage              # Coverage report
```

## Adding Tests

1. Add to `server/src/__tests__/*.test.js`
2. Follow `describe('Category')` + `it('should...')` pattern
3. Focus on pure functions first (no DB)
