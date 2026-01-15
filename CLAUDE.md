# CLAUDE.md

## Core Principles

**Keep everything clean and simple.** Remove bloat as you find it - unused code, dead imports, redundant patterns. Simpler is always better.

**The code is the documentation.** Comment your code well so agents can understand context easily. Clear comments > external docs.

## Quick Start

```bash
cd server && npm run dev    # Port 3001
cd client && npm run dev    # Port 5173
npm run db:generate && npm run db:push
```

**Login**: `admin@coh.com` / `XOFiya@34`

## Tech Stack

**Backend**: Express + tRPC + Prisma + PostgreSQL | **Frontend**: React 19 + TanStack Query + AG-Grid + Tailwind

**API**: REST `/api/*`, tRPC `/trpc` | **Integrations**: Shopify, iThink Logistics

## Orders System

All order views are consolidated into a single page (`/orders`) with 6 tabs:
- **Open** - Active orders in fulfillment pipeline
- **Shipped** - Orders in transit or delivered
- **RTO** - Return to origin orders
- **COD Pending** - Delivered COD awaiting remittance
- **Archived** - Completed historical orders
- **Cancelled** - Cancelled orders

**Key files:**
- `client/src/pages/Orders.tsx` - Main orchestrator with 6 tabs
- `client/src/components/orders/OrdersGrid.tsx` - Unified grid with `currentView` prop
- `client/src/hooks/useUnifiedOrdersData.ts` - Data hook with background prefetch
- `server/src/routes/orders/lineStatus.ts` - Unified status endpoint for all line transitions

**Line status flow:** `pending → allocated → picked → packed → shipped`

**Unified status endpoint:** All line transitions use `POST /lines/:lineId/status`:
- Frontend calls `ordersApi.setLineStatus(lineId, status)`
- Backend validates transitions via `VALID_TRANSITIONS` matrix
- Allocate creates OUTWARD transaction, unallocate deletes it
- Pick/pack/ship are status-only updates

**Three independent dimensions:**
| Field | Controls | Values |
|-------|----------|--------|
| `lineStatus` | Fulfillment stage | pending, allocated, picked, packed, shipped, cancelled |
| `closedAt` | View visibility | null = open view, timestamp = shipped view |
| `isArchived` | Archive state | false = active, true = archived |

**View query logic:**
- Open: `closedAt IS NULL` on any line
- Shipped: All non-cancelled lines have `closedAt`, excludes RTO
- RTO: `trackingStatus IN ('rto_in_transit', 'rto_delivered')`
- COD Pending: `paymentMethod='COD' AND trackingStatus='delivered' AND codRemittedAt IS NULL`
- Archived: `isArchived = true`

## Inventory

- **Balance**: `SUM(inward) - SUM(outward)`
- **Allocate**: Creates OUTWARD transaction immediately (no RESERVED)
- **Cost cascade**: SKU → Variation → Product → Global (null = fallback)

## Before Committing

```bash
cd client && npm run build   # TypeScript + Vite build
cd server && npx tsc --noEmit
```

## Critical Gotchas

1. **Router order**: Specific routes before parameterized (`:id`)
2. **AsyncHandler**: Wrap async routes with `asyncHandler()`
3. **Dual cache invalidation**: Mutations must invalidate both TanStack Query and tRPC caches
4. **AG-Grid cellRenderer**: Return JSX elements, not HTML strings
5. **OrdersGrid currentView**: Pass `currentView` prop to show view-appropriate columns

## Environment

`.env` requires: `DATABASE_URL`, `JWT_SECRET`
