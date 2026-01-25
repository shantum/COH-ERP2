# Returns System - Line-Level Implementation Plan

## Overview

✅ **IMPLEMENTATION COMPLETE** (2026-01-25)

Migrated returns from separate `ReturnRequest` entity to **line-level fields on OrderLine**, following the existing RTO pattern. This simplifies the data model and makes returns a natural property of order fulfillment.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Return entity | Fields on `OrderLine` (not separate table) |
| Pattern to follow | Existing RTO fields (`rtoInitiatedAt`, `rtoCondition`, etc.) |
| Exchange handling | Staff-initiated via button (not auto-created) |
| Inventory restock | Always via repacking queue → then inward transaction |
| Image storage | Deferred to Phase 2 |

---

## Implementation Status

### Phase 1: Database Schema ✅ COMPLETE
- [x] Add 30+ return fields to OrderLine model
- [x] Add `isReturnable` and `nonReturnableReason` to Product
- [x] Add User relations for return tracking
- [x] Add `exchangeSourceLines` relation to Order
- [x] Add indexes for return queries

### Phase 2: Configuration ✅ COMPLETE
- [x] Create `/server/src/config/thresholds/returns.ts`
- [x] Export from index.ts

### Phase 3: Zod Schemas ✅ COMPLETE
- [x] Add line-level return schemas to `/shared/src/schemas/returns.ts`
- [x] Input schemas for all mutations
- [x] Query result schemas

### Phase 4: Server Functions ✅ COMPLETE
- [x] Query functions: `getOrderForReturn`, `getActiveLineReturns`, `getLineReturnActionQueue`, `calculateLineReturnRefund`
- [x] Mutation functions: `initiateLineReturn`, `scheduleReturnPickup`, `markReturnInTransit`, `receiveLineReturn`, `processLineReturnRefund`, `sendReturnRefundLink`, `completeLineReturnRefund`, `completeLineReturn`, `cancelLineReturn`, `closeLineReturnManually`, `createExchangeOrder`

### Phase 5: Frontend - Returns Page Refactor ✅ COMPLETE
- [x] Audit existing Returns.tsx page
- [x] Update to use new line-level queries/mutations
- [x] Fix delete return request cache invalidation bug
- [x] Fix receive mutation cache invalidation
- [x] Simplify tabs: 5 tabs → 3 tabs (Action Queue, All Returns, Analytics)
- [x] Reduced file from 2,000+ lines to ~1,200 lines
- [x] Initiate Return modal with order search and line eligibility
- [x] Action Queue with context-aware action buttons
- [x] All Returns table with search and filter

### Phase 6: Inventory Integration ✅ COMPLETE (via existing repacking queue)
- [x] `receiveLineReturn` creates RepackingQueueItem
- [x] Uses existing QC workflow

### Phase 7: Database Migration ✅ COMPLETE
- [x] Run `db:push` to apply schema changes (2026-01-25)
- [x] Legacy `ReturnRequest` model still exists for backward compatibility
- [ ] Optional: Migrate existing ReturnRequest data (skipped - no existing data)

---

## Complete Return Flow

```
Customer requests return
        │
        ▼
┌───────────────┐
│   requested   │  Staff initiates return on OrderLine
└───────┬───────┘  Sets: returnQty, reason, resolution (refund/exchange)
        │
        ├──────────────────────────────────────────┐
        │                                          │
        ▼                                          ▼
┌───────────────────┐                    ┌─────────────────────┐
│ pickup_scheduled  │                    │ (staff can create   │
└───────┬───────────┘                    │  exchange order at  │
        │                                │  any point)         │
        ▼                                └─────────────────────┘
┌───────────────┐
│  in_transit   │  Courier picks up from customer
└───────┬───────┘
        │
        ▼
┌───────────────┐
│   received    │  Warehouse receives, assesses condition
└───────┬───────┘  → Creates RepackingQueueItem
        │
        ▼
┌───────────────────────────────────────┐
│         REPACKING QUEUE               │
│  (existing QC workflow)               │
│                                       │
│  ┌─────────┐         ┌──────────┐    │
│  │  Ready  │         │ Write-off│    │
│  └────┬────┘         └────┬─────┘    │
│       │                   │          │
│       ▼                   ▼          │
│  Inward Txn          WriteOffLog     │
│  (back to stock)     (loss tracked)  │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────┐
│   complete    │  Resolution finalized:
└───────────────┘  - Refund: payment link sent/completed
                   - Exchange: exchange order created & shipped
```

---

## Key Files

### Backend (Complete)
| File | Status | Description |
|------|--------|-------------|
| `/prisma/schema.prisma` | ✅ | Return fields on OrderLine, isReturnable on Product |
| `/server/src/config/thresholds/returns.ts` | ✅ | Return config (window, reasons, conditions) |
| `/server/src/config/thresholds/index.ts` | ✅ | Exports returns config |
| `/shared/src/schemas/returns.ts` | ✅ | Zod schemas for line-level returns |
| `/client/src/server/functions/returns.ts` | ✅ | Query functions (existing + new line-level) |
| `/client/src/server/functions/returnsMutations.ts` | ✅ | Mutation functions (existing + new line-level) |

### Frontend (Complete)
| File | Status | Description |
|------|--------|-------------|
| `/client/src/pages/Returns.tsx` | ✅ | Main returns hub - refactored to line-level |

---

## New Server Functions

### Queries
- `getOrderForReturn(orderNumber)` - Order with line eligibility for initiating returns
- `getActiveLineReturns()` - All active line-level returns
- `getLineReturnActionQueue()` - Prioritized action queue
- `calculateLineReturnRefund(orderLineId)` - Refund breakdown

### Mutations
- `initiateLineReturn` - Start return on order line
- `scheduleReturnPickup` - Schedule pickup
- `markReturnInTransit` - Mark in transit
- `receiveLineReturn` - Receive at warehouse (creates QC queue)
- `processLineReturnRefund` - Calculate and save refund
- `sendReturnRefundLink` - Send payment link
- `completeLineReturnRefund` - Mark refund complete
- `completeLineReturn` - Complete return
- `cancelLineReturn` - Cancel return
- `closeLineReturnManually` - Close for edge cases
- `createExchangeOrder` - Create exchange order

---

## Deferred to Phase 2

- [ ] Photo upload for return QC
- [ ] Customer self-service portal
- [ ] Automated notifications (SMS/email)
- [ ] Payment link integration (Razorpay)
- [ ] Courier API for pickup scheduling
- [ ] Return analytics dashboard enhancements

---

## What Was Implemented

### Frontend Changes (Returns.tsx)
- **Imports**: Switched from legacy `ReturnRequest` to line-level types from `@coh/shared/schemas/returns`
- **Queries**:
  - `getActiveLineReturns()` for all active returns
  - `getLineReturnActionQueue()` for action queue
  - `getOrderForReturn()` for initiate modal
- **Mutations**: All use `{ data: ... }` wrapper syntax
  - `initiateLineReturn`, `scheduleReturnPickup`, `receiveLineReturn`
  - `processLineReturnRefund`, `completeLineReturn`, `cancelLineReturn`
  - `createExchangeOrder`
- **Cache Keys**:
  - `['returns', 'active']` - active returns list
  - `['returns', 'action-queue']` - action queue
  - `['repacking-queue']` - QC queue

### Bug Fixes
1. **Delete mutation**: Added missing invalidation for `['returns', 'pending']` and `['actionQueue']`
2. **Receive mutation**: Added missing invalidation for `['returns', 'pending']` and `['actionQueue']`

---

## Remaining Enhancements (Optional)

- [ ] Refund modal with amount entry (currently uses placeholder)
- [ ] Exchange SKU picker component (currently uses prompt)
- [ ] Analytics tab implementation
- [ ] Photo upload for return QC
- [ ] Payment link integration (Razorpay)
- [ ] Courier API for pickup scheduling

---

**Last Updated:** 2026-01-25
**Status:** ✅ IMPLEMENTATION COMPLETE
**Commits:**
- `4388c57` - Add line-level returns system to OrderLine model
- Frontend refactor - Migrate Returns.tsx to line-level system
