# CLAUDE.md

## #1 Rule: Talk Like a Human, Not a Robot

> **Claude Code is the senior developer on this project.** The user is the boss — not a coder. Every response must be plain English, short, and easy for anyone to understand. No jargon, no walls of text, no showing off technical knowledge.
>
> **Your job:** Translate complex technical stuff into simple words so the team can make good decisions. If a 5-year-old couldn't follow the gist, rewrite it simpler.

## #2 Rule: Clarify Before You Build

> **Ask as many questions as needed to be 100% clear before you start working.** Don't assume, don't guess, don't fill in blanks yourself. If anything is ambiguous — scope, behavior, edge cases, priorities — ask first. It's always cheaper to ask one more question than to redo work.

---

## CRITICAL: Load Domain Skills First

> **BEFORE starting any task**, load relevant skills using `/skill-name` and use **Grep** for specific lookups.

| Skill | Use When Working On |
|-------|---------------------|
| `/orders` | Orders, fulfillment, tracking, shipping, RTO, state machine |
| `/inventory` | SKU stock, transactions, balance triggers, allocation |
| `/products` | Products, variations, SKUs, BOM system |
| `/materials` | Materials, fabrics, fabric colours, 3-tier hierarchy |
| `/returns` | Returns, refunds, exchanges, return eligibility |
| `/customers` | Customer tiers, LTV, customer stats |
| `/production` | Production batches, tailors, capacity planning |
| `/shopify` | Shopify webhooks, product/order sync, fulfillment |
| `/tracking` | iThink API, AWB, tracking sync, RTO workflow |
| `/finance` | Ledger, invoices, payments, double-entry accounting |
| `/payroll` | Employees, salary structure, PF/ESIC/PT, monthly payroll runs |
| `/database` | Prisma, Kysely, triggers, migrations |
| `/railway` | Railway CLI, deployments, database access |
| `/google-sheets` | Sheets hybrid system, buffer tabs, ingestion |
| `/sync-from-sheet` | Sheet Sync UI, CSV uploads, sync jobs |
| `/review` | Strict code review of recent changes |
| `/plan` | Multi-session implementation plans |
| `/update-skill` | Refresh skill files after codebase changes |

---

## Core Principles

1. **Simplicity above all.** Remove bloat. Reduce > Perfect > Repeat.
2. **First principles.** Reason from fundamentals, solve efficiently.
3. **Living memory.** Update MEMORY.md with learnings as you work.
4. **Use agents liberally.** Spawn sub-agents for parallel/complex work.
5. **Commit early, commit often.** Run `cd client && npx tsc -p tsconfig.app.json --noEmit && cd ../server && npx tsc --noEmit` before committing.
6. **STRICT: Branch discipline.** Work on `main` branch. All deployments use the production database.
7. **Separate config from code.** Magic numbers, thresholds, mappings > `/config/`.
8. **Type-safe by default.** Strict TypeScript, Zod validation. No `any`, no shortcuts.

---

## Quick Start

```bash
cd server && pnpm dev       # Port 3001
cd client && pnpm dev       # Port 5173
pnpm db:generate && pnpm db:push  # From root
```

Root uses pnpm workspace. Railway builds use npm (`nixpacks.toml`). Login creds in user project instructions.

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

---

## Gotchas (These Prevent Real Mistakes)

### Data & Caching
- Server Functions live in `client/src/server/functions/`. No tRPC.
- Mutations MUST invalidate TanStack Query + server caches
- Mutations return immediately; side effects run async via `deferredExecutor`
- Query keys: `['domain', 'action', 'server-fn', params]`

### TypeScript & Validation
- Zod params: never `prop: undefined`, use spread `...(val ? {prop: val} : {})`
- TypeScript check BEFORE committing (see Principle #5)
- Error typing: `catch (error: unknown)` with `instanceof Error` guard
- Express body: Zod `safeParse()`, not `req.body as SomeInterface`

### Server Functions
- Cookies: `getCookie` from `@tanstack/react-start/server`, NOT `vinxi/http`
- API calls: production uses `http://127.0.0.1:${PORT}`, not `localhost:3001`
- Large payloads: `method: 'POST'` to avoid HTTP 431 header size error
- Client-side code CANNOT import `@server/`. For DB: `@coh/shared/services/db`

### Shared Package (CRITICAL)
- `@coh/shared/services/` MUST use dynamic imports only. Static `import { sql } from 'kysely'` BREAKS client bundling. Always: `const { sql } = await import('kysely')`

### SSR & Hydration
- Use `ClientOnly` for runtime-dependent UI (router state, `new Date()`). `typeof window !== 'undefined'` is NOT sufficient

### UI & Components
- AG-Grid cellRenderer: return JSX, not strings
- Cell components: modularize into `/cells/` directory, wrap with `React.memo()`
- Prefer `createMany()`/`updateMany()` over loops
- shadcn/ui in `client/src/components/ui/`. Add new: `npx shadcn@latest add <name>`

> **For domain-specific gotchas, load the relevant skill.**

---

## Type Safety

- **Zod is source of truth.** Define schemas in Zod, infer types with `z.infer<>`. Never write separate `interface`/`type`.
- Search params: Zod schema in `shared/src/schemas/searchParams.ts`, use `z.coerce` for numbers/booleans, `.catch(defaultValue)` for fallback
- File-based routing in `client/src/routes/`. Let generator handle route tree
- Auth: protected routes under `_authenticated` layout, use `beforeLoad` not `useEffect`
- Use `Route.useLoaderData()` for SSR initial data, `Route.useSearch()` for URL params (SSR-safe)

---

## Database

> **Full details:** Load `/database` skill

- **Golden Rule:** Local and production share the same database. Migrations apply immediately.
- Create migration: `pnpm db:migrate --name description`
- NEVER run `db:migrate` against production directly. Railway auto-migrates on `main` push.

### Remote DB (Railway PostgreSQL)
```
Host: caboose.proxy.rlwy.net
Port: 20615
Database: railway
User: postgres
```
- Public URL is in `server/.env` as `DATABASE_URL`
- Both local dev and production point to this same Railway database
- To connect via CLI: `psql "$DATABASE_URL"` (from `server/` directory with `.env` loaded)
