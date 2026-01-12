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

## Orders API (Unified Views)

**Single endpoint**: `GET /orders?view=<name>` replaces 5 separate endpoints.

| View | Filter | Sort | Default Limit |
|------|--------|------|---------------|
| `open` | status='open', not archived | orderDate ASC (FIFO) | 10000 |
| `shipped` | shipped/delivered, excludes RTO & COD pending | shippedAt DESC | 100 |
| `rto` | trackingStatus in rto_* | rtoInitiatedAt DESC | 200 |
| `cod_pending` | COD + delivered + not remitted | deliveredAt DESC | 200 |
| `archived` | isArchived=true | archivedAt DESC | 100 |

**Query params**: `view`, `limit`, `offset`, `days`, `search`

**Search** works on: orderNumber, customerName, awbNumber, email, phone

**Frontend API** (`ordersApi`): Uses `getOpen()`, `getShipped()`, etc. wrappers that call unified endpoint.

**Key files**: `server/src/utils/orderViews.js` (view configs), `server/src/routes/orders/listOrders.js`

## Shopify Data Field Ownership

Defines which system owns each field and where data lives. Critical for understanding data flow.

| Field | Owner | Location | Type | Notes |
|-------|-------|----------|------|-------|
| `discountCodes` | Shopify | ShopifyOrderCache.rawData | JSON | Read-only from Shopify, comma-separated |
| `customerNotes` | Shopify | ShopifyOrderCache.rawData | JSON | Shopify order.note field |
| `tags` | Shopify | ShopifyOrderCache.rawData | JSON | Comma-separated tags from Shopify |
| `financialStatus` | Shopify | ShopifyOrderCache.rawData | JSON | paid/pending/refunded/etc |
| `fulfillmentStatus` | Shopify | ShopifyOrderCache.rawData | JSON | unfulfilled/partial/fulfilled/null |
| `totalPrice` | Shopify | ShopifyOrderCache (generated) | Extracted | Auto-extracted from rawData.total_price |
| `subtotalPrice` | Shopify | ShopifyOrderCache (generated) | Extracted | Auto-extracted from rawData.subtotal_price |
| `totalTax` | Shopify | ShopifyOrderCache (generated) | Extracted | Auto-extracted from rawData.total_tax |
| `totalDiscounts` | Shopify | ShopifyOrderCache (generated) | Extracted | Auto-extracted from rawData.total_discounts |
| `paymentMethod` | ERP | Order | Direct | COD/Prepaid, editable in ERP |
| `awbNumber` | ERP | Order | Direct | Tracking number assigned by ERP |
| `courier` | ERP | Order | Direct | Shipping provider (iThink, etc) |
| `trackingStatus` | ERP | Order | Direct | From iThink Logistics API |
| `status` | ERP | Order | Direct | open/allocated/picked/packed/shipped/delivered |
| `shippedAt` | Both | Order & Cache | Both | ERP controls, synced to Shopify |
| `deliveredAt` | Both | Order & Cache | Both | Set by ERP, may sync from Shopify fulfillment |

**Access pattern**: Query `Order` with `include: { shopifyCache: true }` to get both ERP and Shopify fields.

**Generated columns**: Use PostgreSQL `GENERATED ALWAYS AS ... STORED` to auto-extract Shopify JSON fields. No backfills needed - computed on insert/update. Schema: `server/prisma/schema.prisma`, migration: `server/prisma/migrations/20260112_shopify_cache_generated_columns/`

**Frontend fallback**: Use nullish coalescing for graceful degradation: `shopifyCache.totalPrice ?? order.totalAmount ?? 0`

## Shipping (Unified Service)

All shipping operations go through `ShipOrderService` (`server/src/services/shipOrderService.js`).

| Endpoint | Purpose | Options |
|----------|---------|---------|
| `POST /fulfillment/:id/ship` | Ship entire order | Standard (all lines must be packed) |
| `POST /fulfillment/:id/ship-lines` | Ship specific lines | Partial shipment |
| `POST /fulfillment/process-marked-shipped` | Batch spreadsheet commit | Lines with status=marked_shipped |
| `POST /fulfillment/:id/migration-ship` | Onboarding (admin only) | skipInventory=true, skipStatusValidation=true |

**Service API**:
- `shipOrderLines(tx, { orderLineIds, awbNumber, courier, userId, skipStatusValidation?, skipInventory? })`
- `shipOrder(tx, { orderId, ...options })` - convenience wrapper
- `validateShipment(prisma, orderLineIds, options)` - pre-check without transaction

**Removed systems**: Quick-ship, auto-ship, bulk-update to shipped status (all bypass proper inventory handling).

## Key Files

| Purpose | Location |
|---------|----------|
| Routes | `server/src/routes/` (orders/ is modular) |
| Shipping service | `server/src/services/shipOrderService.js` |
| Catalog/Costing | `server/src/routes/catalog.js`, `products.js` (cost-config) |
| Shared patterns | `server/src/utils/queryPatterns.js`, `validation.js` |
| Error handling | `server/src/middleware/asyncHandler.js`, `server/src/utils/errors.js` |
| Permissions | `server/src/middleware/permissions.js`, `client/src/hooks/usePermissions.ts` |
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
15. **AG-Grid shared utilities**: Theme, formatters in `utils/agGridHelpers.ts`; state persistence in `hooks/useGridState.ts`
16. **Don't over-engineer shared utilities**: Working code with inline patterns often better than abstraction (order grids kept inline)
17. **Persistent logs**: Logs stored in `server/logs/server.jsonl`, survive restarts, 24-hour retention
18. **Costing cascades**: SKU → Variation → Product → Global (null = fallback to next level)
19. **Lining cost**: Only non-null when `hasLining=true`, otherwise always null
20. **Fabric cost**: Fabric.costPerUnit ?? FabricType.defaultCostPerUnit (cascade)
21. **AsyncHandler**: Wrap async routes with `asyncHandler()` to auto-catch errors; don't use with streaming/res.pipe()
22. **Permission token invalidation**: Changing user permissions increments `tokenVersion`, forcing re-login
23. **Permission wildcards**: `products:*` matches all product permissions; checked via `hasPermission()` utility
24. **Server-side field filtering**: Cost fields filtered at API level via `filterConfidentialFields()`, not just UI
25. **Query keys centralized**: Use `queryKeys` from `constants/queryKeys.ts`; `invalidateTab()` handles cache clearing
26. **Deprecated schema**: `User.role` removed (use `roleId`); `PermissionAuditLog`, `StockAlert` tables removed
27. **Shipping via service**: All shipping must go through `ShipOrderService` - cannot set lineStatus='shipped' via bulk-update
28. **Migration-ship**: Use `POST /fulfillment/:id/migration-ship` for onboarding orders (admin only, skips inventory)
29. **RTO orders excluded from LTV**: Customer tier upgrades exclude RTO (returned) orders. Use `OR[trackingStatus=null OR NOT IN rto_*]` not just `!=null` because unshipped orders must count
30. **Batch update limits**: Updating 5000+ customers at once hits PostgreSQL bind variable limits; use `chunkProcess()` helper in batches of 5000
31. **Generated columns (PostgreSQL)**: Use `GENERATED ALWAYS AS (expression) STORED` to auto-extract JSON fields. Prisma `db push` creates regular columns, so run raw SQL migration AFTER to convert. Pattern: Drop column, recreate as generated (can't ALTER existing). No backfills needed - data populates instantly from `rawData`. Example: `ALTER TABLE "ShopifyOrderCache" ADD COLUMN "totalPrice" TEXT GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_price')) STORED;` Then add nullable field to Prisma schema. Trade-off: Stores computed values, increases storage on limited plans.

## Environment

`.env` requires: `DATABASE_URL`, `JWT_SECRET`

**Safe commands**: `npm run dev`, `npm test`, `curl` to localhost:3001

## Session Cleanup

Run `.claude/agents/session-cleanup.md` after: 3+ features, 5+ files modified, major refactors, or before ending long sessions. Captures learnings and triggers doc optimizer.

## Recommended Agents

| Task Type | Agent | When to Use |
|-----------|-------|-------------|
| New features | `fullstack-erp-engineer` | Multi-layer changes (DB + API + UI) |
| Bug fixes | `error-solver` | Runtime errors, failing tests |
| Errors after coding | `error-solver` | Diagnose and fix errors quickly |
| Code review | `code-simplifier` | After completing a feature |
| Logic verification | `logic-auditor` | Complex business logic validation |
| Planning | `feature-planner` | Before implementing new features |
| Refactoring | `systems-simplifier` | Reduce complexity, consolidate |
| Documentation | `doc-optimizer` | Keep docs concise and current |
| Cleanup | `code-cleanup-auditor` | Find dead code, unused imports |

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
