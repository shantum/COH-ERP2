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

Single page (`/orders`) with 4 tabs:
- **Open** - Active orders in fulfillment pipeline
- **Shipped** - Orders in transit/delivered (includes RTO and COD Pending as toggle filters)
- **Archived** - Completed historical orders
- **Cancelled** - Cancelled orders

**Key files:**
- `client/src/pages/Orders.tsx` - Main orchestrator with 4 tabs + shipped filters
- `client/src/components/orders/OrdersGrid.tsx` - Unified grid with `currentView` prop
- `client/src/hooks/useUnifiedOrdersData.ts` - Data hook with background prefetch

**Line status flow:** `pending → allocated → picked → packed → shipped`

**Unified status endpoint:** All line transitions use `POST /lines/:lineId/status`:
- Frontend calls `ordersApi.setLineStatus(lineId, status)`
- Backend validates transitions via `VALID_TRANSITIONS` matrix
- Allocate creates OUTWARD transaction, unallocate deletes it

**Three independent dimensions:**
| Field | Controls | Values |
|-------|----------|--------|
| `lineStatus` | Fulfillment stage | pending, allocated, picked, packed, shipped, cancelled |
| `closedAt` | View visibility | null = open, timestamp = shipped |
| `isArchived` | Archive state | false = active, true = archived |

**View query logic:**
- Open: `closedAt IS NULL` on any line
- Shipped: All non-cancelled lines have `closedAt` (RTO/COD filtered client-side)
- Archived: `isArchived = true`
- Cancelled: `lineStatus = 'cancelled'`

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
