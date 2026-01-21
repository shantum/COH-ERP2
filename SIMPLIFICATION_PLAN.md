# Aggressive Simplification Plan

## Migration Progress

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 1. Enable SSR | **COMPLETE** | 2026-01-21 | SSR build working, scripts updated |
| 2. Feature Flags | **COMPLETE** | 2026-01-21 | Query flags enabled, mutations on tRPC |
| 3. Kysely → Prisma | **COMPLETE** | 2026-01-21 | All 4 Server Functions migrated |
| 4. Delete Kysely (shared) | **COMPLETE** | 2026-01-21 | Kysely removed from shared; server keeps for tRPC |
| 5. Slim Express | PENDING | - | SSE + webhooks only (after tRPC migration) |
| 6. Deploy | PENDING | - | Railway config |

### Phase 1-2 Completion Details (2026-01-21)

**Changes made:**
- `client/package.json` - Updated scripts:
  - `build` now uses SSR mode (`vite build`)
  - `build:spa` is the fallback (`vite build --config vite.spa.config.ts`)
  - `start` runs `node dist/server/server.js`
- `client/src/config/serverFunctionFlags.ts` - Enabled query flags:
  - `customersList: true`
  - `productsList: true`
  - `inventoryGetBalances: true`
  - `inventoryList: true`
  - `ordersList: true`
  - `ordersGet: true`
  - Mutations remain `false` (safer incremental rollout)
- `client/src/stubs/` - Recreated minimal stubs for SPA fallback mode
- `client/vite.spa.config.ts` - Updated comments (fallback only)

**Verification:**
- TypeScript checks pass (client & server)
- SSR build completes successfully
- SPA fallback mode preserved

**Next steps:**
1. Test Server Functions with live data (start dev server)
2. Begin Phase 3: Migrate Server Functions from Kysely to Prisma

### Phase 3 Completion Details (2026-01-21)

**Server Functions migrated from Kysely to Prisma:**

| File | Lines | Migration Approach |
|------|-------|-------------------|
| `customers.ts` | ~100 | Direct Prisma query with search/tier filters |
| `inventory.ts` | ~150 | Raw SQL for balances + Prisma for SKUs |
| `products.ts` | ~200 | Prisma includes + JS tree transformation |
| `orders.ts` | ~300 | Prisma includes + JS flattening |

**Key patterns used:**
- Dynamic import of `PrismaClient` to prevent bundling in browser
- Global singleton pattern for connection reuse
- `prisma.$queryRaw` for complex aggregations (inventory balances)
- JavaScript-based transformations for tree/flattening (vs SQL JSON_AGG)

**Files to delete (Kysely code):**
- `shared/src/database/queries/ordersListKysely.ts` (766 lines)
- `shared/src/database/queries/productsTreeKysely.ts` (340 lines)
- `shared/src/database/queries/inventoryListKysely.ts` (252 lines)
- `shared/src/database/queries/customersListKysely.ts` (169 lines)
- `shared/src/database/queries/index.ts` (11 lines)
- `shared/src/database/index.ts` (Kysely initialization)

**Total Kysely code to delete:** ~1,538 lines

### Phase 4 Completion Details (2026-01-21)

**Kysely code deleted from shared package:**
- `shared/src/database/queries/*.ts` - All 5 Kysely query files
- `shared/src/database/index.ts` - Kysely initialization
- `shared/src/database/createKysely.ts` - Kysely factory
- `shared/src/database/types.ts` - Kysely types
- Total: ~1,538 lines removed

**Package.json cleanup:**
- `shared/package.json` - Removed `kysely` and `pg` dependencies
- `shared/package.json` - Removed `./database` export
- `client/vite.config.ts` - Removed `kysely` from SSR noExternal

**Server Kysely retained (for now):**
- `server/src/db/` - Kysely queries for tRPC procedures
- Will be removed when mutations migrate to Server Functions

**Current state:**
- Queries: Server Functions → Prisma ✓
- Mutations: tRPC → Express/Kysely (to be migrated)

---

## Goal

Transform COH-ERP2 from a complex hybrid system into a **clean, minimal, fully type-safe** TanStack Start application.

**Target state:**
- One server (TanStack Start)
- One data pattern (Server Functions)
- One query layer (Prisma - drop Kysely)
- ~30-40% less code
- Easy to understand, easy to extend

---

## Current Pain Points

| Problem | Impact |
|---------|--------|
| tRPC + Server Functions (both exist) | Confusion, duplicate patterns |
| Prisma + Kysely (both exist) | Two ORMs to maintain |
| Express + TanStack Start (both exist) | Two servers |
| 8,000 lines of tRPC routers | Boilerplate |
| Feature flags everywhere | Dead code paths |
| SPA stubs | Hacks to make things work |

---

## The Aggressive Approach

Since you have **no users**, we can be bold:

1. **Delete first, rebuild only what's needed**
2. **No backward compatibility concerns**
3. **Start fresh with clean patterns**

---

## Phase 1: Clean Slate Setup (3-4 days)

### 1.1 Create TanStack Start SSR App

```bash
# In project root, create new app structure
mkdir -p app/routes app/server/functions app/server/services
```

Create `app.config.ts`:
```typescript
import { defineConfig } from '@tanstack/react-start/config'

export default defineConfig({
  server: {
    preset: 'node-server',  // For Railway
  },
})
```

### 1.2 Move Prisma to Root

```bash
mv server/prisma ./prisma
```

Update `prisma/schema.prisma` output path.

### 1.3 Keep These Files (copy to new structure)

```
FROM client/src/                    TO app/
├── components/                     → app/components/
├── hooks/ (most)                   → app/hooks/
├── styles/                         → app/styles/
└── routes/ (as starting point)     → app/routes/

FROM shared/src/
├── schemas/                        → Keep in shared (source of truth)
└── types/                          → Keep in shared
```

### 1.4 Delete These Entirely

```
DELETE:
├── server/src/trpc/               # 8,000 lines - replaced by Server Functions
├── server/src/routes/ (most)      # Replaced by Server Functions + API routes
├── client/src/server/functions/   # Old unused Server Functions
├── client/src/stubs/              # SPA hacks
├── client/vite.spa.config.ts      # No more SPA mode
├── shared/src/database/queries/   # Kysely queries (keep Prisma only)
└── client/src/config/serverFunctionFlags.ts  # No more flags
```

---

## Phase 2: Auth (2-3 days)

### 2.1 Server Function for Auth

```typescript
// app/server/functions/auth.ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { prisma } from '../db'
import { createSession, validateSession } from '../session'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const login = createServerFn({ method: 'POST' })
  .validator(LoginSchema)
  .handler(async ({ data }) => {
    const user = await prisma.user.findUnique({
      where: { email: data.email }
    })

    if (!user || !verifyPassword(data.password, user.password)) {
      throw new Error('Invalid credentials')
    }

    const session = await createSession(user.id)
    return { user: { id: user.id, email: user.email, role: user.role } }
  })

export const getSession = createServerFn({ method: 'GET' })
  .handler(async () => {
    const session = await validateSession()
    if (!session) return { user: null }

    const user = await prisma.user.findUnique({
      where: { id: session.userId }
    })
    return { user }
  })
```

### 2.2 Auth Context in Router

```typescript
// app/router.tsx
import { createRouter } from '@tanstack/react-router'
import { getSession } from './server/functions/auth'

export const router = createRouter({
  routeTree,
  context: {
    auth: undefined!, // Will be set by RouterProvider
  },
  beforeLoad: async () => {
    const { user } = await getSession()
    return { auth: { user, isAuthenticated: !!user } }
  },
})
```

---

## Phase 3: Core Server Functions (1 week)

### 3.1 Orders (The Big One)

Instead of 2,766 lines of tRPC, create focused Server Functions:

```typescript
// app/server/functions/orders.ts
import { createServerFn } from '@tanstack/react-start'
import { prisma } from '../db'
import { OrdersSearchParams, ShipOrderSchema } from '@coh/shared/schemas'

// QUERY: List orders
export const getOrders = createServerFn({ method: 'GET' })
  .validator(OrdersSearchParams)
  .handler(async ({ data }) => {
    const { view, page, limit, search } = data

    const where = buildOrdersWhere(view, search)
    const [rows, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { orderLines: true, shopifyCache: true },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where }),
    ])

    return { rows: flattenOrders(rows), total, page, limit }
  })

// MUTATION: Ship order lines
export const shipOrderLines = createServerFn({ method: 'POST' })
  .validator(ShipOrderSchema)
  .handler(async ({ data }) => {
    const { lineIds, awbNumber, courier } = data

    await prisma.$transaction(async (tx) => {
      await tx.orderLine.updateMany({
        where: { id: { in: lineIds } },
        data: {
          status: 'shipped',
          awbNumber,
          courier,
          shippedAt: new Date(),
        },
      })
      // Create inventory outward, etc.
    })

    broadcastSSE('ORDER_SHIPPED', { lineIds })
    return { success: true }
  })

// ... other mutations: allocate, cancel, markDelivered, etc.
```

**Target: ~800 lines** (vs 2,766 in tRPC)

### 3.2 Inventory

```typescript
// app/server/functions/inventory.ts
export const getInventory = createServerFn({ method: 'GET' })
  .validator(InventorySearchParams)
  .handler(async ({ data }) => {
    // Direct Prisma query
  })

export const inwardInventory = createServerFn({ method: 'POST' })
  .validator(InwardSchema)
  .handler(async ({ data }) => {
    // Transaction with Prisma
  })

// ... other inventory functions
```

**Target: ~400 lines** (vs 2,502 in tRPC)

### 3.3 Products, Customers, Returns

Same pattern - direct Prisma, Zod validation, clean functions.

**Estimated total Server Functions: ~2,500 lines** (vs ~8,000 in tRPC)

---

## Phase 4: Route Loaders (3-4 days)

### 4.1 Orders Page

```typescript
// app/routes/_authenticated/orders.tsx
import { createFileRoute } from '@tanstack/react-router'
import { OrdersSearchParams } from '@coh/shared/schemas'
import { getOrders } from '../../server/functions/orders'

export const Route = createFileRoute('/_authenticated/orders')({
  validateSearch: OrdersSearchParams,

  loader: async ({ search }) => {
    return getOrders({ data: search })
  },

  component: OrdersPage,
})

function OrdersPage() {
  const { rows, total } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  // Component uses pre-loaded data - no loading spinners!
  return <OrdersGrid orders={rows} />
}
```

### 4.2 All Other Pages

Same pattern for each page - loader fetches data, component renders it.

---

## Phase 5: Keep Express Minimal (2-3 days)

### 5.1 What Stays on Express

```typescript
// server/src/index.ts - MINIMAL
import express from 'express'
import { sseRouter } from './routes/sse'
import { webhooksRouter } from './routes/webhooks'
import { trackingSyncService } from './services/trackingSync'

const app = express()

// Only these routes stay:
app.use('/api/events', sseRouter)        // SSE for real-time
app.use('/api/webhooks', webhooksRouter)  // Shopify webhooks

// Background services
trackingSyncService.start()

app.listen(3001)
```

### 5.2 Delete from Express

```
DELETE:
├── server/src/trpc/           # All of it
├── server/src/routes/orders/  # Moved to Server Functions
├── server/src/routes/inventory/
├── server/src/routes/products.ts
├── server/src/routes/customers.ts
├── server/src/routes/materials.ts
├── server/src/routes/bom.ts
├── server/src/routes/returns/
├── server/src/routes/auth.ts
└── ... most routes
```

**Express goes from ~15,000 lines to ~2,000 lines** (SSE + webhooks + background jobs)

---

## Phase 6: Deployment (1-2 days)

### 6.1 Railway Config

```json
// railway.json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "node .output/server/index.mjs"
  }
}
```

### 6.2 Single Deploy

TanStack Start serves:
- SSR pages
- Server Functions
- Static assets

Express sidecar (optional):
- SSE endpoint
- Webhooks
- Background jobs

Or merge into one by using TanStack Start API routes for SSE/webhooks.

---

## Final Structure

```
COH-ERP2/
├── app/                          # TanStack Start app
│   ├── routes/                   # File-based routes
│   │   ├── __root.tsx
│   │   ├── _authenticated.tsx
│   │   ├── _authenticated/
│   │   │   ├── orders.tsx
│   │   │   ├── products.tsx
│   │   │   ├── inventory.tsx
│   │   │   └── ...
│   │   └── login.tsx
│   ├── components/               # React components (kept)
│   ├── hooks/                    # Custom hooks (kept)
│   ├── server/
│   │   ├── functions/            # Server Functions (~2,500 lines)
│   │   │   ├── orders.ts
│   │   │   ├── inventory.ts
│   │   │   ├── products.ts
│   │   │   ├── customers.ts
│   │   │   └── auth.ts
│   │   ├── services/             # Shared services
│   │   │   ├── shopify.ts
│   │   │   └── ithink.ts
│   │   └── db.ts                 # Prisma client
│   ├── app.config.ts
│   └── router.tsx
├── server/                       # Minimal Express (SSE + webhooks)
│   └── src/
│       ├── index.ts              # ~200 lines
│       ├── routes/
│       │   ├── sse.ts            # Real-time events
│       │   └── webhooks.ts       # Shopify webhooks
│       └── services/
│           └── trackingSync.ts   # Background job
├── shared/                       # Shared types & schemas
│   └── src/
│       ├── schemas/              # Zod schemas (source of truth)
│       └── types/                # Shared TypeScript types
├── prisma/
│   └── schema.prisma
└── package.json
```

---

## Code Reduction Summary

| Component | Before | After | Reduction |
|-----------|--------|-------|-----------|
| tRPC routers | 8,000 | 0 | -8,000 |
| Server Functions | 755 (unused) | 2,500 (used) | +1,745 |
| Express routes | 12,000 | 2,000 | -10,000 |
| Kysely queries | 2,400 | 0 | -2,400 |
| Stubs/flags | 600 | 0 | -600 |
| Duplicate configs | 200 | 0 | -200 |
| **Net change** | | | **~-19,000 lines** |

**Estimated final codebase: ~125,000 lines** (from ~145,000)

More importantly: **ONE pattern for everything** instead of 3-4 competing patterns.

---

## Timeline

| Phase | Duration | What |
|-------|----------|------|
| 1. Clean Slate | 3-4 days | Project setup, delete old code |
| 2. Auth | 2-3 days | Server Functions for auth |
| 3. Core Functions | 5-7 days | Orders, Inventory, Products |
| 4. Route Loaders | 3-4 days | All pages with SSR data |
| 5. Express Minimal | 2-3 days | Keep only SSE + webhooks |
| 6. Deploy | 1-2 days | Railway config |
| **Total** | **2.5-3.5 weeks** | |

---

## Migration Order (Day by Day)

### Week 1: Foundation
- Day 1-2: Set up TanStack Start structure, move components
- Day 3: Auth Server Functions + protected routes
- Day 4-5: Orders Server Functions (the biggest one)

### Week 2: Core Features
- Day 6-7: Inventory + Products Server Functions
- Day 8: Customers + Returns Server Functions
- Day 9-10: Route loaders for all pages

### Week 3: Polish & Deploy
- Day 11-12: SSE integration, Express minimal
- Day 13: Railway deployment
- Day 14: Testing & fixes

---

## Key Decisions

### 1. Drop Kysely, Keep Prisma Only
Kysely was added for Server Functions that never got used. Prisma is:
- Already working
- Has migrations
- Has good TypeScript support
- One ORM is simpler than two

### 2. SSE Stays on Express (for now)
TanStack Start can do SSE via API routes, but keeping it on Express is simpler for now. Can migrate later if needed.

### 3. No Feature Flags
Either use Server Functions or don't. No "maybe we'll enable this later" code paths.

### 4. Aggressive Deletion
Delete first, then rebuild only what's actually needed. Don't port unused features.

---

## Success Criteria

- [ ] App runs fully on TanStack Start SSR
- [ ] No tRPC code remains
- [ ] No Kysely code remains
- [ ] No SPA stubs remain
- [ ] Express only runs SSE + webhooks (~2K lines)
- [ ] All pages load with SSR data (no loading spinners on initial load)
- [ ] Full type safety from Zod → Server Function → Component
- [ ] Railway deployment works
- [ ] All existing functionality preserved

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Something breaks | Git branches - can always revert |
| Missing a feature | Feature parity checklist before deleting |
| SSE doesn't work | Keep Express SSE running alongside |
| Deploy issues | Test on Railway staging first |

---

## Next Steps

1. **Create feature parity checklist** - List every tRPC procedure and what replaces it
2. **Create a new branch** - `git checkout -b tanstack-start-migration`
3. **Start with auth** - Get login/logout working in TanStack Start
4. **Iterate quickly** - Delete aggressively, rebuild minimally

---

**This plan prioritizes simplicity over backward compatibility.**

Since you have no users, you can afford to be aggressive. The goal is not "migrate safely" but "end up with something clean."
