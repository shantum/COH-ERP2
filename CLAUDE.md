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

## Core Flows

- **Order**: `pending → allocated → picked → packed → shipped → delivered`
- **Inventory**: `Available = Balance - Reserved` where `Balance = SUM(inward) - SUM(outward)`
- **Cost cascade**: SKU → Variation → Product → Global (null = fallback)

## Critical Gotchas

1. **Credentials in DB**: Shopify/iThink creds in `SystemSetting` table, not env vars
2. **Router order**: Specific routes before parameterized (`:id`)
3. **AsyncHandler**: Wrap async routes with `asyncHandler()`
4. **Dual cache invalidation**: Mutations must invalidate both TanStack Query and tRPC caches
5. **Inventory cache**: Direct `prisma.inventoryTransaction.create()` requires `inventoryBalanceCache.invalidate([skuId])`
6. **AG-Grid cellRenderer**: Return JSX elements, not HTML strings

## Domain Docs

See `docs/domains/` for deep dives on orders, inventory, shipping, returns, shopify, etc.

## Environment

`.env` requires: `DATABASE_URL`, `JWT_SECRET`

## Shell Tips

```bash
export TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@coh.com","password":"XOFiya@34"}' | jq -r '.token')

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/orders | jq .
```
