# tRPC Infrastructure

## Overview

tRPC v11 is set up alongside the existing Express REST API for gradual migration. The infrastructure is fully functional and type-safe.

## Current Status (Updated Jan 2026)

✅ Base infrastructure (`trpc/index.ts`)
✅ Auth router with 3 procedures (`trpc/routers/auth.ts`)
✅ App router (`trpc/routers/_app.ts`)
✅ **Orders router with 30+ procedures** (3,000 lines - fully migrated)
✅ **Inventory router** (fully migrated)
✅ **Production router** (fully migrated)
✅ Products, Customers, Returns routers
✅ TypeScript compilation passes
✅ **Client fully migrated** to use tRPC for all order/inventory/production operations

## Architecture

```
trpc/
├── index.ts              # Core tRPC setup (context, procedures)
├── routers/
│   ├── _app.ts          # Root router combining all domain routers
│   └── auth.ts          # Auth procedures: login, me, changePassword
└── README.md            # This file
```

## Mounting tRPC in Express

✅ **Already configured** - tRPC is mounted at `/trpc` in `server/src/index.js`

The tRPC endpoint uses the `authenticateToken` middleware which populates `req.user` and `req.userPermissions`, making them available in the tRPC context.

## Auth Router Procedures

### `auth.login` (public mutation)
- Input: `{ email: string, password: string }`
- Output: `{ user, permissions: string[], token: string }`
- Errors: `UNAUTHORIZED` if credentials invalid or account disabled

### `auth.me` (protected query)
- Input: None
- Output: `{ id, email, name, role, roleId, roleName, permissions, mustChangePassword }`
- Errors: `UNAUTHORIZED` if not logged in, `FORBIDDEN` if token invalidated

### `auth.changePassword` (protected mutation)
- Input: `{ currentPassword: string, newPassword: string }`
- Output: `{ message: string }`
- Errors: `BAD_REQUEST` if validation fails, `UNAUTHORIZED` if current password wrong

## Context

The tRPC context matches Express request augmentations:

```typescript
interface Context {
    prisma: PrismaClient;           // From req.prisma
    user: JwtPayload | null;        // From req.user (set by authenticateToken)
    userPermissions: string[];      // From req.userPermissions
}
```

## Procedures

- `publicProcedure`: No authentication required
- `protectedProcedure`: Requires authentication (throws `UNAUTHORIZED` if not logged in)

## Type Safety

The `AppRouter` type can be exported to the frontend for full type inference:

```typescript
// In client code:
import type { AppRouter } from '../../server/src/trpc/routers/_app';

const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: 'http://localhost:3001/trpc' })]
});

// Now fully type-safe:
const result = await trpc.auth.login.mutate({ email: '...', password: '...' });
```

## Migration Strategy

The tRPC migration is **mostly complete** (Jan 2026):
1. ✅ Orders: Fully migrated (30+ procedures)
2. ✅ Inventory: Fully migrated
3. ✅ Production: Fully migrated
4. ✅ Products/Materials: Query endpoints migrated
5. ⏳ Remaining: Shipments page still uses Express (archive/unarchive operations)
6. Express REST API handles: Webhooks, tracking sync, legacy endpoints

Both systems share the same database (Prisma) and authentication middleware.

## Future Routers

To add a new router:

1. Create `trpc/routers/domain.ts`:
```typescript
import { router, publicProcedure, protectedProcedure } from '../index.js';

export const domainRouter = router({
    list: protectedProcedure.query(async ({ ctx }) => {
        return await ctx.prisma.domain.findMany();
    }),
});
```

2. Add to `trpc/routers/_app.ts`:
```typescript
import { domainRouter } from './domain.js';

export const appRouter = router({
    auth: authRouter,
    domain: domainRouter, // Add here
});
```

## Testing

To test the tRPC endpoints once mounted:

```bash
# Login
curl -X POST http://localhost:3001/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@coh.com","password":"XOFiya@34"}'

# Get current user (with token from login)
curl http://localhost:3001/trpc/auth.me \
  -H "Authorization: Bearer <token>"

# Change password
curl -X POST http://localhost:3001/trpc/auth.changePassword \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"...","newPassword":"..."}'
```
