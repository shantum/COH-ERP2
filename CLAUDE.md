# CLAUDE.md

## CRITICAL: Use Domain Skills & QMD

> **BEFORE starting any task, you MUST:**
> 1. **Load relevant domain skills** using `/skill-name` (e.g., `/orders`, `/inventory`, `/products`)
> 2. **Use Grep** for specific function/variable lookups, **QMD vsearch** for conceptual queries
> 3. **Check skill files** in `.claude/skills/` for deep domain knowledge

### Available Domain Skills

| Skill | Use When Working On |
|-------|---------------------|
| `/orders` | Orders, order lines, fulfillment, tracking, shipping, RTO, state machine |
| `/inventory` | SKU stock, transactions, balance triggers, txnType system, allocation |
| `/products` | Products, variations, SKUs, BOM system, component types |
| `/materials` | Materials, fabrics, fabric colours, 3-tier hierarchy |
| `/returns` | Customer returns, refunds, exchanges, return eligibility |
| `/customers` | Customer tiers, LTV calculation, customer stats |
| `/production` | Production batches, tailors, capacity planning |
| `/shopify` | Shopify webhooks, product/order sync, fulfillment, cache-first pattern |
| `/tracking` | iThink API, AWB generation, tracking sync, RTO workflow, courier integration |
| `/database` | Prisma, Kysely, triggers, migrations, transactions |
| `/railway` | Railway CLI, deployments, database access |
| `/google-sheets` | Google Sheets hybrid system, buffer tabs, balance push, ingestion |
| `/sync-from-sheet` | Sheet Sync feature in Settings, CSV uploads, sync jobs |
| `/review` | Strict code review of recent changes |
| `/plan` | Multi-session implementation plans, phase tracking |
| `/update-skill` | Refresh skill files after codebase changes |
| `/qmd` | QMD search engine config, collections, indexing |

### Search Tools: Grep vs QMD vsearch

**Use Grep for:** specific lookups (functions, variables, schemas, where something is used)
**Use QMD vsearch for:** conceptual questions, cross-domain understanding, workflow explanations

| Use Case | Tool | Example |
|----------|------|---------|
| Function lookup | Grep | `Grep({ pattern: "releaseToShipped" })` |
| Schema discovery | Grep | `Grep({ pattern: "lineStatusSchema" })` |
| Where is X used | Grep | `Grep({ pattern: "TXN_TYPE" })` |
| "How does X work?" | vsearch | `mcp__qmd__vsearch({ query: "how does RTO workflow work" })` |
| Cross-domain logic | vsearch | `mcp__qmd__vsearch({ query: "how production batches affect inventory" })` |
| Business rules | vsearch | `mcp__qmd__vsearch({ query: "order fulfillment stages" })` |

**Why vsearch works for concepts:** It searches 12 skill docs that explain *why* things work, not just *where* they are. Grep can't find "how does RTO work" - it needs exact keywords.

**Avoid:** `mcp__qmd__search` (keyword) - Grep is always better. `mcp__qmd__get` - files are 1000-3500 lines.

---

## Core Principles

1. **Simplicity above all.** Remove bloat. Reduce > Perfect > Repeat.
2. **First principles.** Reason from fundamentals, solve efficiently.
3. **Living memory.** Update this file with learnings/mistakes as you work.
4. **Document as you go.** Comment undocumented code when you encounter it.
5. **Use agents liberally.** Spawn sub-agents for parallel/complex work.
6. **Commit early, commit often.** Small, frequent commits. **Run `cd client && npx tsc -p tsconfig.app.json --noEmit && cd ../server && npx tsc --noEmit` before committing.**
7. **STRICT: Branch discipline.** Work on `main` branch. All deployments use the production database.
8. **Separate config from code.** Magic numbers, thresholds, mappings > `/config/`.
9. **Clean architecture.** Dependencies point inward. Business logic independent of frameworks/UI/DB.
10. **Build for the long term.** Maintainability over cleverness.
11. **Type-safe by default.** Strict TypeScript, Zod validation. No `any`, no shortcuts.

---

## Quick Start

```bash
# Using pnpm (recommended - workspace mode)
cd server && pnpm dev       # Port 3001
cd client && pnpm dev       # Port 5173
pnpm db:generate && pnpm db:push  # From root

# Using npm (works for individual packages)
cd server && npm run dev
cd client && npm run dev
```

**Note:** Root uses pnpm workspace (`pnpm-workspace.yaml`). Railway builds use npm (`nixpacks.toml`).

Login: See user project instructions (not checked into git)

---

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TanStack Router/Query v5, AG-Grid, Tailwind, shadcn/ui |
| Backend | Express (auth/webhooks/SSE/uploads) + TanStack Server Functions |
| Database | PostgreSQL + Prisma ORM + Kysely (performance queries) |
| Real-time | SSE > TanStack Query invalidation |
| Validation | Zod at all boundaries |

**Data Flow**: Route Loaders > Server Functions > TanStack Query cache > SSE invalidation

```typescript
// Standard pattern: loader prefetch + TanStack Query
loader: async ({ search }) => getOrders({ data: search })

const { data } = useQuery({
  queryKey: ['orders', search],
  queryFn: () => getOrders({ data: search }),
  initialData: Route.useLoaderData(),
});
```

---

## Gotchas (Critical Cross-Cutting Rules)

### Data & Caching
| Rule |
|------|
| Server Functions in `client/src/server/functions/`. No tRPC. |
| Mutations MUST invalidate TanStack Query + server caches |
| Mutations return immediately; side effects run async via `deferredExecutor` |
| Query keys: `['domain', 'action', 'server-fn', params]` |

### TypeScript & Validation
| Rule |
|------|
| Zod params: never `prop: undefined`, use spread `...(val ? {prop: val} : {})` |
| TypeScript check BEFORE committing (see Principle #6) |
| Error typing: `catch (error: unknown)` with `instanceof Error` guard |
| Express body: Zod `safeParse()`, not `req.body as SomeInterface` |

### Server Functions
| Rule |
|------|
| Cookies: `getCookie` from `@tanstack/react-start/server`, NOT `vinxi/http` |
| API calls: production uses `http://127.0.0.1:${PORT}`, not `localhost:3001` |
| Large payloads: `method: 'POST'` to avoid HTTP 431 header size error |
| Client-side code CANNOT import `@server/`. For DB: `@coh/shared/services/db` |

### Shared Package (CRITICAL)
| Rule |
|------|
| `@coh/shared/services/` MUST use dynamic imports only. Static `import { sql } from 'kysely'` BREAKS client bundling. Always: `const { sql } = await import('kysely')` |

### SSR & Hydration
| Rule |
|------|
| Use `ClientOnly` for runtime-dependent UI (router state, `new Date()`). `typeof window !== 'undefined'` is NOT sufficient |

### UI & Components
| Rule |
|------|
| AG-Grid cellRenderer: return JSX, not strings |
| Cell components: modularize into `/cells/` directory, wrap with `React.memo()` |
| Prefer `createMany()`/`updateMany()` over loops |

> **For domain-specific gotchas, load the relevant skill:**
> - Inventory rules → `/inventory`
> - Orders/tracking rules → `/orders`
> - Materials/fabric rules → `/materials`

---

## Type Safety

> **Zod is source of truth.** Define schemas in Zod, infer types with `z.infer<>`. Never write separate `interface`/`type`.

```typescript
// Error handling
} catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
}

// Prisma typing
type PrismaInstance = InstanceType<typeof PrismaClient>;
type PrismaTransaction = Omit<PrismaInstance, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// WHERE clause builders
function buildWhereClause(view: string): Prisma.OrderWhereInput { ... }
```

### TanStack Router Rules
- Search params: Zod schema in `shared/src/schemas/searchParams.ts`, use `z.coerce` for numbers/booleans
- Search params use `.catch(defaultValue)` for graceful fallback on invalid input
- File-based routing in `client/src/routes/`. Let generator handle route tree
- Auth: protected routes under `_authenticated` layout, use `beforeLoad` not `useEffect`
- Use `Route.useLoaderData()` for SSR initial data, `Route.useSearch()` for URL params (SSR-safe)

---

## Database Migration Workflow

> **Full details:** Load `/database` skill or search QMD

**Golden Rule:** All environments (local, production) share the same production database. Migrations apply immediately.

| Environment | Database | How Migrations Run |
|-------------|----------|-------------------|
| **Local** | Railway (caboose.proxy.rlwy.net) | Shared production DB |
| **Production** | Railway (caboose.proxy.rlwy.net) | **Auto** on `main` push |

```bash
# LOCAL: Edit schema.prisma, then create migration
pnpm db:migrate --name add_customer_field

# COMMIT: Migration file goes to git
git add prisma/migrations/ prisma/schema.prisma
git commit -m "Add customer field"

# PUSH: Production auto-migrates on deploy
git push origin main
```

**Critical:** NEVER run `db:migrate` against production. Railway handles migrations via `prisma migrate deploy`.

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Auth signing key |
| `PORT` | No | Server port (default: 3001) |
| `NODE_ENV` | No | Environment (default: development) |
| `DISABLE_BACKGROUND_WORKERS` | No | Disable sync workers |
| `INTERNAL_API_SECRET` | No | Server-to-server auth |

See `server/src/config/env.js` for full Zod schema with validation.

> **Shopify/iThink/Railway variables:** Load `/railway` skill or check `server/.env.example`

---

## Key Directory Structure

```
client/src/
  routes/_authenticated/     # Protected pages
  components/{domain}/       # Domain components with cells/ subdirs
  hooks/                     # React hooks, orders/ has 8 mutation hooks
  server/functions/          # Server Functions (queries + mutations)
  constants/queryKeys.ts     # TanStack Query keys

server/src/
  routes/                    # Express routes (auth, webhooks, SSE, etc.)
  services/                  # Background sync, caches
  config/                    # Environment, mappings, thresholds
  utils/                     # Helpers, state machine

shared/src/
  schemas/                   # Zod schemas (CLIENT-SAFE)
  services/                  # SERVER-ONLY, dynamic imports only
  domain/                    # Pure business logic (CLIENT-SAFE)

.claude/skills/              # Domain skill files
prisma/schema.prisma         # Database schema
```

> **For file details:** Use QMD search or load relevant domain skill

---

## When to Use Agents

| Task | Agent |
|------|-------|
| Exploring codebase | `Explore` |
| Multi-file searches | `general-purpose` |
| Complex implementations | `elite-engineer` |
| Logic verification | `logic-auditor` |
| Documentation | `docs-tracker` |
| Planning | `Plan` |

---

## Pages Overview

**Core:**

| Page | Purpose |
|------|---------|
| `/orders` | Order fulfillment (AG-Grid, 4 views) |
| `/orders-simple` | Simplified orders view |
| `/orders-mobile` | Mobile-optimized orders |
| `/order-search` | Cross-order search |
| `/products` | Catalog + BOM (9 tabs) |
| `/customers` | Customer management |
| `/settings` | System settings |
| `/users` | User management |

**Inventory & Materials:**

| Page | Purpose |
|------|---------|
| `/inventory` | Stock management |
| `/inventory-inward` | Inward receipt entry |
| `/inventory-count` | Physical stock count |
| `/inventory-mobile` | Mobile inventory operations |
| `/ledgers` | FabricColour transaction history |
| `/fabric-reconciliation` | Fabric stock reconciliation |
| `/fabric-receipt` | Fabric receipt entry |
| `/costing` | Product costing management |

**Returns & Tracking:**

| Page | Purpose |
|------|---------|
| `/returns` | Customer returns processing |
| `/returns-rto` | RTO (Return to Origin) management |
| `/return-prime` | Return Prime integration |
| `/tracking` | Shipment tracking dashboard |

**Operations:**

| Page | Purpose |
|------|---------|
| `/production` | Production planning |
| `/channels` | Multi-channel order management |
| `/sheets-monitor` | Google Sheets sync monitoring |
| `/analytics` | Revenue/customer/product analytics |

---

## UI Components

- Use shadcn/ui from `client/src/components/ui/`
- Add new: `npx shadcn@latest add <component-name>`
- Nested modals: `DialogStack` from `ui/dialog-stack.tsx`

---

## Skill Files Reference

All domain skills are in `.claude/skills/{domain}/SKILL.md`:

| File | Contains |
|------|----------|
| `orders/SKILL.md` | State machine, tracking, views, optimistic updates |
| `inventory/SKILL.md` | txnType system, balance triggers, allocation patterns |
| `products/SKILL.md` | Product hierarchy, BOM system, component types |
| `materials/SKILL.md` | Material > Fabric > FabricColour, linking |
| `returns/SKILL.md` | Return lifecycle, eligibility, refund calculation |
| `customers/SKILL.md` | Tiers, LTV, customer stats |
| `production/SKILL.md` | Batches, capacity, scheduling |
| `shopify/SKILL.md` | Webhooks, cache-first pattern, product matching, fulfillment sync |
| `tracking/SKILL.md` | iThink API, status mapping, RTO workflow, line-level tracking |
| `database/SKILL.md` | Prisma vs Kysely, triggers, migrations |
| `railway/SKILL.md` | Deployment, CLI, database access |
| `google-sheets/SKILL.md` | Hybrid system, buffer tabs, balance push, ingestion |
| `sync-from-sheet/SKILL.md` | Sheet Sync UI, CSV uploads, sync jobs |
| `review/SKILL.md` | Code review prompts and standards |
| `plan/SKILL.md` | Multi-session plan lifecycle |
| `update-skill/SKILL.md` | Skill file refresh workflow |
| `qmd/SKILL.md` | Search engine config, collections, MCP integration |

---

**Updated:** 2026-02-08 (added 8 missing skills, expanded pages to 25 routes, moved credentials to private instructions)
