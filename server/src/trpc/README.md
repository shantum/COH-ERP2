# tRPC Infrastructure

## Overview

tRPC v11 is set up alongside the existing Express REST API for gradual migration. The infrastructure is fully functional and type-safe.

## Current Status

✅ Base infrastructure (`trpc/index.ts`)
✅ Auth router with 3 procedures (`trpc/routers/auth.ts`)
✅ App router (`trpc/routers/_app.ts`)
✅ TypeScript compilation passes

## Architecture

```
trpc/
├── index.ts              # Core tRPC setup (context, procedures)
├── routers/
│   ├── _app.ts          # Root router combining all domain routers
│   └── auth.ts          # Auth procedures: login, me, changePassword
└── README.md            # This file
```

## Mounting tRPC in Express (TODO)

To enable tRPC endpoints, add the following to `server/src/index.js` after the `authenticateToken` middleware setup:

```typescript
import * as trpcExpress from '@trpc/server/adapters/express';
import { appRouter } from './trpc/routers/_app.js';
import { createContext } from './trpc/index.js';
import { authenticateToken } from './middleware/auth.js';

// Mount tRPC with optional authentication
// authenticateToken will populate req.user and req.userPermissions
// which are used by createContext
app.use(
    '/trpc',
    authenticateToken, // Optional: Remove this line for unauthenticated procedures
    trpcExpress.createExpressMiddleware({
        router: appRouter,
        createContext,
    })
);
```

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

The tRPC setup uses a **hybrid approach**:
1. Express REST API remains primary
2. New features can be built with tRPC
3. Existing endpoints can be gradually migrated
4. Both systems share the same database (Prisma) and authentication middleware

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
