# tRPC Mount Guide

## Status

✅ tRPC v11 infrastructure complete
✅ Auth router implemented (login, me, changePassword)
✅ TypeScript compilation passes
⏸️  **NOT YET MOUNTED** - Express still using REST endpoints only

## What's Ready

All tRPC files are created and type-safe:

- `/Users/shantumgupta/Desktop/COH-ERP2/server/src/trpc/index.ts` - Core tRPC setup
- `/Users/shantumgupta/Desktop/COH-ERP2/server/src/trpc/routers/auth.ts` - Auth procedures
- `/Users/shantumgupta/Desktop/COH-ERP2/server/src/trpc/routers/_app.ts` - Root router

## To Mount tRPC in Express

Add the following code to `/Users/shantumgupta/Desktop/COH-ERP2/server/src/index.js`:

### 1. Add imports (after existing imports, around line 54)

```javascript
import * as trpcExpress from '@trpc/server/adapters/express';
import { appRouter } from './trpc/routers/_app.js';
import { createContext } from './trpc/index.js';
import { optionalAuth } from './middleware/auth.js';
```

### 2. Mount tRPC middleware (after line 119, after prisma middleware)

```javascript
// Make prisma available to routes
app.use((req, res, next) => {
  req.prisma = prisma;
  next();
});

// Mount tRPC with optional authentication
// optionalAuth will populate req.user and req.userPermissions if token is valid
// Public procedures work without token, protected procedures require it
app.use(
    '/trpc',
    optionalAuth,
    trpcExpress.createExpressMiddleware({
        router: appRouter,
        createContext,
    })
);

// Routes (existing code below)
app.use('/api/auth', authRoutes);
// ...
```

## Why optionalAuth?

We use `optionalAuth` instead of `authenticateToken` because:
- `optionalAuth` allows both public and protected procedures
- Public procedures (like `auth.login`) don't need authentication
- Protected procedures check for auth in the procedure itself and throw `UNAUTHORIZED`
- This matches REST API behavior where `/api/auth/login` doesn't require a token

## Testing After Mount

```bash
# 1. Start server
cd /Users/shantumgupta/Desktop/COH-ERP2/server
npm run dev

# 2. Test login (public procedure)
curl -X POST http://localhost:3001/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@coh.com","password":"XOFiya@34"}'

# 3. Test me endpoint (protected procedure)
# Replace <TOKEN> with token from login response
curl http://localhost:3001/trpc/auth.me \
  -H "Authorization: Bearer <TOKEN>"

# 4. Test change password (protected procedure)
curl -X POST http://localhost:3001/trpc/auth.changePassword \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"XOFiya@34","newPassword":"NewPass@123"}'
```

## Architecture Decision

This is a **hybrid approach**:
- Express REST API remains primary (`/api/*` routes)
- tRPC available at `/trpc` for new features
- Both share same Prisma database and auth middleware
- Gradual migration without breaking existing code

## Next Steps

1. **Mount in Express**: Add code above to `src/index.js`
2. **Test endpoints**: Use curl commands to verify
3. **Frontend integration**: Set up tRPC client in React
4. **Migrate more routers**: Add orders, products, etc. routers as needed

## Current Auth Procedures

### auth.login
- Input: `{ email: string, password: string }`
- Output: `{ user, permissions: string[], token: string }`
- Matches Express `/api/auth/login` endpoint

### auth.me
- Input: None (uses token from Authorization header)
- Output: `{ id, email, name, role, roleId, roleName, permissions, mustChangePassword }`
- Matches Express `/api/auth/me` endpoint

### auth.changePassword
- Input: `{ currentPassword: string, newPassword: string }`
- Output: `{ message: string }`
- Matches Express `/api/auth/change-password` endpoint

## Documentation

See `/Users/shantumgupta/Desktop/COH-ERP2/server/src/trpc/README.md` for full documentation.
