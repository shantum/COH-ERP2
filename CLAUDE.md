# CLAUDE.md

Primary instructions for Claude Code. See `docs/DOMAINS.md` for domain routing, `docs/domains/*.md` for deep dives.

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
| Backend | TypeScript, Express.js, tRPC, Prisma ORM, PostgreSQL, Zod |
| Frontend | React 19, TypeScript, TanStack Query, AG-Grid, Tailwind |
| Shared | `@coh/shared` package (types, Zod schemas, validators) |
| Integrations | Shopify (webhooks + sync), iThink Logistics, JWT auth |

**API**: REST at `/api/*`, tRPC at `/trpc` (auth, orders, products, inventory, customers, returns)

## Core Flows

**Order**: `pending → allocated → picked → packed → shipped → delivered`

**Inventory**: `Available = Balance - Reserved` where `Balance = SUM(inward) - SUM(outward)`

**Cost cascade**: SKU → Variation → Product → Global (null = fallback to next level)

## Key Files

| Purpose | Location |
|---------|----------|
| Routes (REST) | `server/src/routes/*.ts` (orders/ is modular) |
| tRPC routers | `server/src/trpc/routers/_app.ts` (combines 6 routers) |
| tRPC client | `client/src/services/trpc.ts`, `client/src/providers/TRPCProvider.tsx` |
| Shipping service | `server/src/services/shipOrderService.ts` |
| Order views | `server/src/utils/orderViews.ts` |
| Shared types | `shared/src/types/`, `shared/src/schemas/` |
| Error handling | `server/src/middleware/asyncHandler.ts`, `server/src/utils/errors.ts` |
| Permissions | `server/src/middleware/permissions.ts`, `client/src/hooks/usePermissions.ts` |
| Grid state | `client/src/hooks/useGridState.ts` |
| Order pricing | `client/src/utils/orderPricing.ts` |
| Frontend | `client/src/services/api.ts`, `types/index.ts` |

## App-Wide Gotchas

1. **Credentials in DB**: Shopify/iThink creds in `SystemSetting`, not env vars
2. **Zod validation**: Order endpoints use `validate()` middleware
3. **Router order matters**: Specific routes before parameterized (`:id`)
4. **AsyncHandler**: Wrap async routes with `asyncHandler()`; don't use with streaming
5. **Permission wildcards**: `products:*` matches all; checked via `hasPermission()`
6. **Query keys centralized**: Use `queryKeys` from `constants/queryKeys.ts`
7. **Map caching**: Use `getInventoryMap()`/`getFabricMap()` for O(1) lookups
8. **Optimistic updates**: Use `context.skipped` pattern to prevent stale cache
9. **AG-Grid shared**: Theme, formatters in `utils/agGridHelpers.ts`
10. **Persistent logs**: `server/logs/server.jsonl`, 24-hour retention
11. **Dual cache invalidation**: Mutations must invalidate both TanStack Query and tRPC caches (see `useOrdersMutations.ts`)
12. **tRPC views**: `trpc.orders.list` accepts `view` param matching REST unified views
13. **Inventory cache**: Direct `prisma.inventoryTransaction.create()` requires `inventoryBalanceCache.invalidate([skuId])`; `queryPatterns.ts` helpers already handle this
14. **Order pricing**: Use `orderPricing.ts` utilities - exchange orders have `totalAmount=0` but need line-calculated values for shipping

## Domain-Specific Docs

For detailed documentation on specific domains, see `docs/domains/`:

| Domain | File | Key Topics |
|--------|------|------------|
| Orders | [orders.md](docs/domains/orders.md) | Unified views, line status, fulfillment |
| Shipping | [shipping.md](docs/domains/shipping.md) | ShipOrderService (required for all shipping) |
| Inventory | [inventory.md](docs/domains/inventory.md) | Ledger, transactions, RTO conditions |
| Returns/RTO | [returns.md](docs/domains/returns.md) | Two workflows, repacking queue |
| Shopify | [shopify.md](docs/domains/shopify.md) | Sync modes, cache-first, field ownership |
| Remittance | [remittance.md](docs/domains/remittance.md) | COD reconciliation, Shopify sync |
| Fabrics | [fabrics.md](docs/domains/fabrics.md) | Cost cascade, reconciliation |
| Catalog | [catalog.md](docs/domains/catalog.md) | Costing system, GST |
| Customers | [customers.md](docs/domains/customers.md) | Tiers, LTV, RTO risk |
| Admin | [admin.md](docs/domains/admin.md) | Auth, permissions, settings |
| Frontend | [frontend.md](docs/domains/frontend.md) | Hooks, AG-Grid patterns |

## Environment

`.env` requires: `DATABASE_URL`, `JWT_SECRET`

**Safe commands**: `npm run dev`, `npm test`, `curl` to localhost:3001

## Recommended Agents

| Task Type | Agent | When to Use |
|-----------|-------|-------------|
| New features | `fullstack-erp-engineer` | Multi-layer changes (DB + API + UI) |
| Bug fixes | `error-solver` | Runtime errors, failing tests |
| Code review | `code-simplifier` | After completing a feature |
| Logic verification | `logic-auditor` | Complex business logic validation |
| Planning | `feature-planner` | Before implementing new features |
| Refactoring | `systems-simplifier` | Reduce complexity, consolidate |
| Documentation | `doc-optimizer` | Keep docs concise and current |
| Cleanup | `code-cleanup-auditor` | Find dead code, unused imports |

## Session Cleanup

Run `.claude/agents/session-cleanup.md` after: 3+ features, 5+ files modified, major refactors.

## Shell Tips

```bash
# Store token once, reuse
export TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@coh.com","password":"XOFiya@34"}' | jq -r '.token')

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/orders?view=shipped | jq .
```
