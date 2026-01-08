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

## Environment Variables

`.env` requires: `DATABASE_URL`, `JWT_SECRET`

## Safe Auto-Run Commands

`npm run dev`, `npm test`, `curl` to localhost:3001

## Shell Tips

```bash
curl -d '{"key":"value"}'           # Use single quotes
TOKEN=$(curl ... | jq -r '.token')  # Store before piping
```
