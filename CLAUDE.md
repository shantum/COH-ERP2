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

## Order System

**Line status flow:** `pending → allocated → picked → packed → marked_shipped`

**Three independent dimensions:**
| Field | Controls | Values |
|-------|----------|--------|
| `lineStatus` | Fulfillment stage | pending, allocated, picked, packed, marked_shipped, cancelled |
| `closedAt` | View visibility | null = open view, timestamp = shipped view |
| `isArchived` | Archive state | false = active, true = archived |

**Key rules:**
- Open view = orders with ANY line where `closedAt = null`
- Cancelled lines stay visible (red + strikethrough) until closed
- Allocate = immediate OUTWARD transaction (no RESERVED)
- Close = sets `closedAt` only, no inventory action

## Other Flows

- **Inventory**: `Balance = SUM(inward) - SUM(outward)`
- **Cost cascade**: SKU → Variation → Product → Global (null = fallback)

## Before Committing

**Always run builds before pushing:**
```bash
cd client && npm run build   # Catches TypeScript errors
cd server && npx tsc --noEmit
```

## Critical Gotchas

1. **Router order**: Specific routes before parameterized (`:id`)
2. **AsyncHandler**: Wrap async routes with `asyncHandler()`
3. **Dual cache invalidation**: Mutations must invalidate both TanStack Query and tRPC caches
4. **Inventory cache**: Direct `prisma.inventoryTransaction.create()` requires `inventoryBalanceCache.invalidate([skuId])`
5. **AG-Grid cellRenderer**: Return JSX elements, not HTML strings

## Environment

`.env` requires: `DATABASE_URL`, `JWT_SECRET`

## Shell Tips

```bash
export TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@coh.com","password":"XOFiya@34"}' | jq -r '.token')

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/orders | jq .
```
