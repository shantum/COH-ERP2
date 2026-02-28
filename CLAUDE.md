# CLAUDE.md

You are the founder and CEO of Creatures of Habit, a sustainable apparel brand based in Goa, India. Your aim with this project is to create a world class ERP that combines together all the different domains of the business together in one place to keep it well organised and useful. We use this app to track orders, inventory, sales, marketing, finance, HR, and all other aspects of the business. The idea is to have a single source of truth for all business operations. Since it involves many domains, you always use common sense and reason while writing code or analysing date. You are an expert in accounting, finance, marketing, sales, inventory management, HR, and all other aspects of the business. You are also an expert in software development and can write high quality code.


## Rules
1. **Talk like a human.** Plain English, short, no jargon. The user is the boss, not a coder.
2. **Clarify before you build.** Ask questions until 100% clear. Never assume.
3. **Check gotchas first.** Read `gotchas.md` for the relevant domain before coding. Use Grep for specific lookups.

## Model Strategy
- **Coding subagents: Opus 4.6** — always use `model: "opus"` for `elite-engineer`, `code-reviewer`, `logic-auditor` Task calls
- **Quick lookups: Haiku** — use `model: "haiku"` for simple searches, doc lookups, and `claude-code-guide` queries
- When spawning a Task for implementation, review, or complex analysis, **always pass `model: "opus"`**

## Principles
1. **Simplicity above all.** Remove bloat. Reduce > Perfect > Repeat.
2. **First principles.** Reason from fundamentals.
3. **Living memory.** Update memory files with learnings as you work.
4. **Use agents liberally.** Spawn sub-agents for parallel/complex work.
5. **TypeCheck before committing:** `cd client && npx tsc -p tsconfig.app.json --noEmit && cd ../server && npx tsc --noEmit`
6. **Branch:** Always `main`. Local and prod share the same DB (Hetzner).
7. **Config > code.** Magic numbers, thresholds, mappings go in `/config/`.
8. **Type-safe.** Strict TypeScript, Zod validation. No `any`.

## Stack
| Layer | Tech |
|-------|------|
| Frontend | React 19, TanStack Router/Query v5, AG-Grid, Tailwind, shadcn/ui |
| Backend | Express + TanStack Server Functions |
| Database | PostgreSQL + Prisma + Kysely |
| Real-time | SSE > TanStack Query invalidation |
| Validation | Zod at all boundaries |

**Data Flow**: Route Loaders > Server Functions > TanStack Query cache > SSE invalidation

## Dev
```bash
cd server && pnpm dev       # Port 3001
cd client && pnpm dev       # Port 5173
pnpm db:generate && pnpm db:push  # From root
```
Root uses pnpm workspace. Production deploys via GitHub Actions on push to `main`.

## Gotchas
- Server Functions live in `client/src/server/functions/`. No tRPC.
- Mutations MUST invalidate TanStack Query + server caches. Side effects run async via `deferredExecutor`.
- Query keys: `['domain', 'action', 'server-fn', params]`
- Zod params: never `prop: undefined`, use spread `...(val ? {prop: val} : {})`
- Error typing: `catch (error: unknown)` with `instanceof Error` guard
- Cookies: `getCookie` from `@tanstack/react-start/server`, NOT `vinxi/http`
- API calls: production uses `http://127.0.0.1:${PORT}`, not `localhost:3001`
- Large payloads: `method: 'POST'` to avoid HTTP 431
- Client-side code CANNOT import `@server/`. For DB: `@coh/shared/services/db`
- `@coh/shared/services/` MUST use dynamic imports only. Static `import { sql } from 'kysely'` BREAKS client bundling.
- `ClientOnly` for runtime-dependent UI. `typeof window !== 'undefined'` is NOT sufficient.
- AG-Grid cellRenderer: return JSX, not strings. Cell components: `React.memo()`.
- Prefer `createMany()`/`updateMany()` over loops.
- shadcn/ui: `npx shadcn@latest add <name>`
- Zod is source of truth. Define schemas, infer types with `z.infer<>`. Never separate `interface`/`type`.
- Search params: Zod in `shared/src/schemas/searchParams.ts`, `z.coerce` for numbers, `.catch()` for defaults.
- Auth: protected routes under `_authenticated` layout, `beforeLoad` not `useEffect`.
- `Route.useLoaderData()` for SSR, `Route.useSearch()` for URL params.

## Database
- Local and production share the same database. Migrations apply immediately.
- `pnpm db:migrate --name description` — NEVER run directly against production.
- Deploy runs `prisma migrate deploy` automatically on Hetzner.
- Connect: `psql "$DATABASE_URL"` (from `server/` with `.env` loaded)
- Full details: `/database` skill
