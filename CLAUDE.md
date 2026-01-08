# CLAUDE.md

Primary instructions for Claude Code. See `docs/DOMAINS.md` for domain details, `ARCHITECTURE.md` for system overview.

## Quick Start

```bash
# Server (port 3001)       # Client (port 5173)
cd server && npm run dev   cd client && npm run dev

# Database                  # Tests
npm run db:generate        cd server && npm test
npm run db:push
```

**Login**: `admin@coh.com` / `XOFiya@34`

## Tech Stack

| Layer | Stack |
|-------|-------|
| Backend | Express.js (ES modules), Prisma ORM, PostgreSQL, Zod |
| Frontend | React 19, TypeScript, TanStack Query, AG-Grid, Tailwind |
| Integrations | Shopify (webhooks + sync), iThink Logistics, JWT auth |

## Core Flows

**Order**: `pending -> allocated -> picked -> packed -> shipped`

**Inventory**: `Balance = SUM(inward) - SUM(outward)` | `Available = Balance - SUM(reserved)`

## Orders Page (5 Tabs)

| Tab | Filters | Notes |
|-----|---------|-------|
| Open | Active fulfillment | Default tab |
| Shipped | Excludes RTO, unpaid COD | - |
| RTO | `isRto: true` | Return to Origin |
| COD Pending | Delivered, awaiting payment | - |
| Archived | >90 days old | Auto-archived on startup |

## Key Files

| Purpose | Location |
|---------|----------|
| Routes | `server/src/routes/` (orders/ is modular) |
| Shared patterns | `server/src/utils/queryPatterns.js`, `validation.js` |
| Frontend | `client/src/services/api.ts`, `types/index.ts`, `hooks/` |

## Common Gotchas

1. **Cache-first**: Shopify orders via `ShopifyOrderCache`, not direct API
2. **Production completion**: Creates inventory inward AND fabric outward
3. **Fabric consumption**: SKU value -> Product value -> default 1.5
4. **Credentials in DB**: Shopify/iThink creds in `SystemSetting`, not env vars
5. **Auto-archive**: Orders >90 days old archived on server startup
6. **Shipped tab filters**: Excludes RTO and unpaid COD (separate tabs)
7. **Zod validation**: Order endpoints use `validate()` middleware
8. **Router order matters**: In `orders/index.js`, specific routes before parameterized
9. **RTO per-line processing**: Use `/inventory/rto-inward-line` for per-line condition
10. **RTO condition logic**: Only `good`/`unopened` create inventory; others write-off
11. **Sequential loading**: Order tabs load progressively via `useOrdersData.ts`
12. **Map caching**: Use `getInventoryMap()`/`getFabricMap()` for O(1) lookups in loops
13. **Optimistic updates**: Use `context.skipped` pattern in mutations to prevent stale cache overwrites
14. **AG-Grid pinned columns**: Set `pinned: 'right'` after resize to keep Actions visible

## Environment

`.env` requires: `DATABASE_URL`, `JWT_SECRET`

**Safe commands**: `npm run dev`, `npm test`, `curl` to localhost:3001

## Session Cleanup

Run `.claude/agents/session-cleanup.md` after: 3+ features, 5+ files modified, major refactors, or before ending long sessions. Captures learnings and triggers doc optimizer.

## Shell Tips

```bash
# Store token once, reuse
export TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@coh.com","password":"XOFiya@34"}' | jq -r '.token')

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/orders/shipped | jq .

# jq - prefer exact matches over contains()
jq '.orders[] | select(.orderNumber == "64040")'   # exact match
```
