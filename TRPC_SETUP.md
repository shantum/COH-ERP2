# tRPC Client Setup Complete

The tRPC client infrastructure is now ready for gradual migration from Axios to tRPC.

## What Was Installed

```bash
pnpm add @trpc/client @trpc/react-query superjson --filter client
```

## Files Created

### Core Setup Files
1. **`client/src/services/trpc.ts`**
   - tRPC React hooks with full type safety
   - Auth token integration (uses localStorage 'token')
   - SuperJSON transformer for Date/Map/Set support
   - Points to `http://localhost:3001/trpc` endpoint

2. **`client/src/providers/TRPCProvider.tsx`**
   - Wraps app with tRPC provider
   - Reuses existing React Query client
   - Handles auth:unauthorized events

3. **`client/src/services/index.ts`**
   - Central export for both Axios and tRPC
   - Allows `import { trpc } from '@/services'`

### Documentation Files
4. **`client/src/services/TRPC_MIGRATION.md`**
   - Complete migration guide
   - Usage examples for queries and mutations
   - Troubleshooting tips

5. **`client/src/examples/TRPCExample.tsx`**
   - 7 comprehensive examples showing tRPC patterns
   - Copy-paste ready code snippets
   - Safe to delete once familiar with tRPC

### App Integration
6. **`client/src/App.tsx`** (modified)
   - Added TRPCProvider wrapper
   - Maintains existing QueryClient
   - No breaking changes to existing code

## Available tRPC Routers

The server already has 6 routers ready to use:

| Router | Procedures | Description |
|--------|-----------|-------------|
| `auth` | login, register, me, changePassword | Authentication |
| `customers` | list, getById, stats, create | Customer management |
| `inventory` | balance, transactions, alerts | Inventory tracking |
| `orders` | list, getById, update, ship | Order management |
| `products` | list, getById, create, update | Product catalog |
| `returns` | list, getById, create, resolve | Return requests |

## Quick Start

### Basic Query
```tsx
import { trpc } from '@/services/trpc';

function MyComponent() {
  const { data, isLoading } = trpc.orders.list.useQuery({ view: 'open' });

  return <div>Total: {data?.total}</div>;
}
```

### Mutation
```tsx
const mutation = trpc.orders.update.useMutation({
  onSuccess: () => {
    // Invalidate and refetch
    utils.orders.list.invalidate();
  }
});

mutation.mutate({ id: orderId, status: 'shipped' });
```

## Key Benefits

1. **Full Type Safety**: TypeScript autocomplete for all API calls
2. **Automatic Batching**: Multiple queries batched into 1 HTTP request
3. **Shared Types**: Server and client use same type definitions
4. **Better DX**: No manual API client code, just call procedures
5. **Gradual Migration**: Works alongside existing Axios calls

## Migration Strategy

### Phase 1: New Features (Immediate)
- Use tRPC for all new features
- Get familiar with patterns
- Build confidence with type safety

### Phase 2: High-Traffic Endpoints (Next)
- Migrate frequently used APIs
- Focus on performance-critical paths
- Keep Axios as fallback

### Phase 3: Complete Migration (Future)
- Migrate remaining endpoints
- Remove Axios dependency
- Full end-to-end type safety

## Testing the Setup

### 1. Start the servers
```bash
# Terminal 1 - Server
cd server
npm run dev

# Terminal 2 - Client
cd client
npm run dev
```

### 2. Login
Open http://localhost:5173 and login with:
- Email: `admin@coh.com`
- Password: `XOFiya@34`

### 3. Open browser console
```javascript
// The tRPC client is available globally for testing
import { trpc } from './services/trpc';

// Try a query (paste in a component)
const { data } = trpc.orders.list.useQuery({ view: 'open' });
console.log(data);
```

### 4. Check network tab
- Look for requests to `http://localhost:3001/trpc`
- Should see batched requests (multiple procedures in one HTTP call)
- Should see Authorization header with JWT token

## Next Steps

1. **Try the examples**: Open `/client/src/examples/TRPCExample.tsx` and copy patterns
2. **Pick a component**: Choose a simple component using Axios
3. **Migrate one API call**: Replace Axios with tRPC
4. **Compare the experience**: Notice the type safety and autocomplete
5. **Repeat**: Gradually migrate more endpoints as you work

## Important Notes

- **Don't break existing code**: All 276 Axios calls still work
- **No rush**: Migrate at your own pace
- **Ask questions**: Check migration guide for common patterns
- **File uploads**: Keep using Axios for FormData (tRPC batching doesn't support it)
- **Streaming**: Keep using Axios for streaming responses

## Troubleshooting

### Types not updating
Restart the dev server after changing server tRPC routers

### CORS errors
Server is configured for localhost:5173, should work out of the box

### 401 errors
Make sure you're logged in - tRPC uses same auth as Axios

### Import errors
Make sure you're importing from `@/services/trpc` not `@/services/api`

## Resources

- [tRPC Docs](https://trpc.io/docs)
- [React Query Docs](https://tanstack.com/query/latest)
- Migration Guide: `/client/src/services/TRPC_MIGRATION.md`
- Examples: `/client/src/examples/TRPCExample.tsx`

---

Setup completed: 2026-01-12
Ready for gradual migration from Axios to tRPC
