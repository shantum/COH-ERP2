# CLAUDE.md

## Core Principles

1. **Simplicity above all.** Remove bloat. Reduce → Perfect → Repeat.
2. **First principles.** Reason from fundamentals, solve efficiently.
3. **Living memory.** Update this file with learnings/mistakes as you work. Top priority.
4. **Document as you go.** Comment undocumented code when you encounter it.
5. **Use agents liberally.** Spawn sub-agents for parallel/complex work. Don't do everything yourself.

## Quick Start

```bash
cd server && npm run dev    # Port 3001
cd client && npm run dev    # Port 5173
npm run db:generate && npm run db:push
```

Login: `admin@coh.com` / `XOFiya@34`

## Stack

- **Backend**: Express + tRPC + Prisma + PostgreSQL
- **Frontend**: React 19 + TanStack Query + AG-Grid + Tailwind
- **Integrations**: Shopify (orders), iThink Logistics (tracking)

## Orders

Single page `/orders` with tabs: Open, Shipped, Archived, Cancelled

**Files**: `Orders.tsx` (orchestrator), `OrdersGrid.tsx` (grid), `orderViews.ts` (configs)

**Line status**: `pending → allocated → picked → packed → shipped`

**Data model**: Each row = one order line. `isFirstLine` marks header row.

**Views**:
- Open: Not shipped/cancelled, OR shipped but `releasedToShipped=false`
- Shipped: All lines shipped AND `releasedToShipped=true`
- Archived: `isArchived=true`

**Column pattern** (line-level with order fallback):
```typescript
valueGetter: (p) => {
    const line = p.data?.order?.orderLines?.find(l => l.id === p.data?.lineId);
    return line?.field || p.data?.order?.field || null;
}
```

**Data sources**: `shopifyCache.*` (specific fields only, NEVER rawData), `order.trackingStatus` (iThink, not Shopify)

## Inventory

- **Balance**: `SUM(inward) - SUM(outward)`
- **Allocate**: Creates OUTWARD immediately

## Before Commit

```bash
cd client && npm run build && cd ../server && npx tsc --noEmit
```

## Gotchas

1. Router: specific routes before parameterized (`:id`)
2. Wrap async routes with `asyncHandler()`
3. Mutations must invalidate TanStack Query + tRPC
4. AG-Grid cellRenderer: return JSX, not strings
5. `shopifyCache.rawData` excluded from queries—use specific fields

## Environment

`.env`: `DATABASE_URL`, `JWT_SECRET`

**Deployment**: Railway. Use `railway` CLI to connect/manage.

## When to Use Agents

**Use sub-agents for:**
- Exploring codebase ("where is X handled?", "how does Y work?") → `Explore` agent
- Multi-file searches when unsure of location → `general-purpose` agent
- Complex implementations → `elite-engineer` or `fullstack-erp-engineer`
- Logic verification after changes → `logic-auditor`
- Documentation updates → `doc-optimizer` or `codebase-steward`
- Planning complex features → `Plan` agent

**Run in parallel when possible:** Launch multiple agents simultaneously for independent tasks.

**Don't use agents for:** Simple file reads, single grep, quick edits—do those directly.
