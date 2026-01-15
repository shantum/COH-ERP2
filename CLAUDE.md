# CLAUDE.md

## Core Principles

**Keep it clean and simple.** Remove bloat as you find it. Simpler is always better.

**Code is documentation.** Comment well so agents understand context easily.

## Quick Start

```bash
cd server && npm run dev    # Port 3001
cd client && npm run dev    # Port 5173
npm run db:generate && npm run db:push
```

**Login**: `admin@coh.com` / `XOFiya@34`

## Tech Stack

**Backend**: Express + tRPC + Prisma + PostgreSQL
**Frontend**: React 19 + TanStack Query + AG-Grid + Tailwind
**Integrations**: Shopify (orders), iThink Logistics (tracking)

## Orders System

Single page (`/orders`) with 4 tabs: Open, Shipped, Archived, Cancelled

**Key files:**
- `client/src/pages/Orders.tsx` - Main orchestrator
- `client/src/components/orders/OrdersGrid.tsx` - Unified grid
- `server/src/utils/orderViews.ts` - View configs + `ORDER_UNIFIED_SELECT`

**Line status flow:** `pending → allocated → picked → packed → shipped`

**Data architecture:**
- Each grid row = one order line (multiple rows per order)
- `isFirstLine` flag distinguishes order header row from continuation rows
- Tracking columns show data per-line with order-level fallback

**View logic:**
- Open: Lines not shipped/cancelled, OR shipped but `releasedToShipped=false`
- Shipped: All lines shipped AND `releasedToShipped=true`
- Archived: `isArchived = true`

## OrdersGrid Column Patterns

```typescript
// Line-level data with order fallback
valueGetter: (params) => {
    const line = params.data?.order?.orderLines?.find(l => l.id === params.data?.lineId);
    return line?.fieldName || params.data?.order?.fieldName || null;
}
```

**Data sources:**
- `shopifyCache.*` - Use specific fields (discountCodes, paymentMethod, customerNotes, trackingNumber). NEVER use rawData.
- `order.trackingStatus` - From iThink sync, NOT Shopify
- Line-level: shippedAt, deliveredAt, trackingStatus, awbNumber, courier

## Inventory

- **Balance**: `SUM(inward) - SUM(outward)`
- **Allocate**: Creates OUTWARD transaction immediately

## Before Committing

```bash
cd client && npm run build
cd server && npx tsc --noEmit
```

## Critical Gotchas

1. **Router order**: Specific routes before parameterized (`:id`)
2. **AsyncHandler**: Wrap async routes with `asyncHandler()`
3. **Cache invalidation**: Mutations invalidate both TanStack Query and tRPC
4. **AG-Grid cellRenderer**: Return JSX, not HTML strings
5. **shopifyCache.rawData**: Excluded from queries for performance - derive data from specific fields

## Environment

`.env` requires: `DATABASE_URL`, `JWT_SECRET`
