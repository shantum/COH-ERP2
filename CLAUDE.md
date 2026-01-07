# CLAUDE.md

Primary instructions for Claude Code. For detailed reference, see `ARCHITECTURE.md`.

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
| Backend | Express.js (JS ES modules), Prisma ORM, PostgreSQL |
| Frontend | React 19, TypeScript, TanStack Query, Tailwind, AG-Grid |
| Auth | JWT (7-day), bcryptjs |
| Integrations | Shopify (webhooks + sync), iThink Logistics |

## Critical Files

**Before making changes, read the relevant domain README:**

| Domain | README Location |
|--------|-----------------|
| Orders | `server/src/routes/ORDERS_DOMAIN.md` |
| Returns | `server/src/routes/RETURNS_DOMAIN.md` |
| Shopify | `server/src/routes/SHOPIFY_DOMAIN.md` |
| Inventory | `server/src/routes/INVENTORY_DOMAIN.md` |
| Production | `server/src/routes/PRODUCTION_DOMAIN.md` |
| Tracking | `server/src/routes/TRACKING_DOMAIN.md` |
| Frontend | `client/src/FRONTEND_DOMAINS.md` |

**Key source files:**
- `server/src/routes/orders/` - Modular order routes (index, listOrders, fulfillment, mutations)
- `server/src/utils/queryPatterns.js` - Shared Prisma patterns, ORDER_LIST_SELECT
- `server/src/utils/validation.js` - Zod schemas (ShipOrderSchema, CreateOrderSchema)
- `client/src/types/index.ts` - TypeScript type definitions
- `client/src/services/api.ts` - Centralized API client

## Core Concepts

### Order Fulfillment
```
pending → allocated → picked → packed → shipped
```
- **Allocate**: Creates `reserved` inventory transaction
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

## API Routes

Base URL: `/api`

| Route | Purpose |
|-------|---------|
| `/auth` | Login, register, users |
| `/products` | Product/Variation/SKU CRUD |
| `/inventory` | Stock balance, transactions |
| `/orders` | Order management, fulfillment |
| `/remittance` | COD payment tracking |
| `/returns` | Return request workflow |
| `/repacking` | QC and restocking queue |
| `/production` | Batch scheduling |
| `/tracking` | iThink shipment tracking |
| `/shopify` | Sync endpoints |
| `/webhooks` | Shopify webhooks |

## Shopify Integration

- Credentials in `SystemSetting` table (configure via Settings UI)
- **Unified webhook**: `POST /api/webhooks/shopify/orders` (handles all order events)
- Cache-first pattern: `ShopifyOrderCache` stores raw JSON
- COD sync uses Transaction API (`markOrderAsPaid`)

## Common Gotchas

1. **Cache-first**: Shopify orders via `ShopifyOrderCache`, not direct API
2. **Production completion**: Creates inventory inward AND fabric outward
3. **Fabric consumption**: SKU value → Product value → default 1.5
4. **Credentials in DB**: Shopify and iThink creds in `SystemSetting`, not env vars
5. **Auto-archive**: Orders >90 days old archived on server startup
6. **Shipped tab filters**: Excludes RTO and unpaid COD (separate tabs)
7. **Zod validation**: Order endpoints use `validate()` middleware
8. **Router order matters**: In `orders/index.js`, specific routes before parameterized
9. **RTO per-line processing**: Use `/inventory/rto-inward-line` for per-line condition marking
10. **RTO condition logic**: Only `good`/`unopened` create inventory; `damaged`/`wrong_product` write-off

## Environment Variables

`.env` requires:
- `DATABASE_URL` - PostgreSQL connection
- `JWT_SECRET` - JWT signing key

## Safe Auto-Run Commands

- `npm run dev`
- `npm test`
- `curl` to localhost:3001

## Shell Tips

```bash
# JSON payloads with curl
curl -d '{"key":"value"}'           # Use single quotes
curl -d "{\"key\":\"value\"}"       # Or escape double quotes
TOKEN=$(curl ... | jq -r '.token')  # Store before piping
```
