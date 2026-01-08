# CLAUDE.md

Primary instructions for Claude Code. See `ARCHITECTURE.md` for system overview, `docs/DOMAINS.md` for domain details.

## Quick Start

```bash
# Server (port 3001)
cd server && npm run dev

# Client (port 5173)
cd client && npm run dev

# Database
npm run db:generate   # After schema changes
npm run db:push       # Push to database
npm run db:studio     # Prisma GUI

# Tests
cd server && npm test
```

**Login**: `admin@coh.com` / `XOFiya@34`

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Express.js (ES modules), Prisma ORM, PostgreSQL |
| Frontend | React 19, TypeScript, TanStack Query, Tailwind, AG-Grid |
| Auth | JWT (7-day), bcryptjs |
| Integrations | Shopify (webhooks + sync), iThink Logistics |

## Core Concepts

### Order Fulfillment
```
pending -> allocated -> picked -> packed -> shipped
```
- **Allocate**: Creates `reserved` inventory
- **Ship**: Deletes `reserved`, creates `outward`

### Inventory Ledger
```
Balance = SUM(inward) - SUM(outward)
Available = Balance - SUM(reserved)
```

### Orders Page (5 Tabs)
| Tab | Endpoint | Notes |
|-----|----------|-------|
| Open | `/orders/open` | Active fulfillment |
| Shipped | `/orders/shipped` | Excludes RTO and unpaid COD |
| RTO | `/orders/rto` | Return to Origin |
| COD Pending | `/orders/cod-pending` | Delivered, awaiting payment |
| Archived | `/orders/archived` | Historical |

## Key Files

| Purpose | Location |
|---------|----------|
| Routes | `server/src/routes/` - orders/, returns.js, shopify.js, etc. |
| Prisma patterns | `server/src/utils/queryPatterns.js` |
| Zod schemas | `server/src/utils/validation.js` |
| API client | `client/src/services/api.ts` |
| Types | `client/src/types/index.ts` |

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
13. **API debugging**: Store `TOKEN` in env var, use `curl -s`, prefer exact jq matches over `contains()`

## Environment Variables

`.env` requires: `DATABASE_URL`, `JWT_SECRET`

## Session Cleanup (Proactive)

**Auto-run cleanup after:**
- 3+ features implemented
- 5+ files modified
- 3+ bug fixes
- Major refactors
- Before ending long sessions

**Cleanup agent** (`.claude/agents/session-cleanup.md`):
1. Review recent git history
2. Quick code cleanup (unused imports, console.logs)
3. Capture learnings -> gotchas/docs
4. Trigger documentation-optimizer if needed

## Safe Auto-Run Commands

`npm run dev`, `npm test`, `curl` to localhost:3001

## Shell Tips

```bash
# API debugging - store token once, reuse
export TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@coh.com","password":"XOFiya@34"}' | jq -r '.token')

# Reuse in subsequent calls (use -s for silent)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/orders/shipped | jq .

# JSON payloads - use single quotes
curl -s -d '{"key":"value"}' ...

# jq - prefer exact matches over contains() to avoid null errors
jq '.orders[] | select(.orderNumber == "64040")'   # exact match
jq '.orders[] | select(.orderNumber? // "" | contains("640"))'  # safe contains
```
