# tRPC Quick Reference

Quick lookup for common tRPC patterns in the COH-ERP2 frontend.

## Import

```tsx
import { trpc } from '@/services/trpc';
// or
import { trpc } from '../services/trpc';
```

## Query (GET)

```tsx
const { data, isLoading, error } = trpc.orders.list.useQuery({
  view: 'open',
  limit: 50,
});
```

## Mutation (POST/PUT/DELETE)

```tsx
const mutation = trpc.orders.update.useMutation({
  onSuccess: () => {
    utils.orders.list.invalidate();
  },
});

mutation.mutate({ id: orderId, status: 'shipped' });
```

## Utils Hook

```tsx
const utils = trpc.useUtils();

// Invalidate query
utils.orders.list.invalidate();

// Refetch query
utils.orders.list.refetch();

// Set data manually
utils.orders.list.setData({ view: 'open' }, newData);
```

## Available Routers

| Router | Example Procedures |
|--------|-------------------|
| `trpc.auth.*` | login, register, me |
| `trpc.customers.*` | list, getById, stats |
| `trpc.inventory.*` | balance, transactions, alerts |
| `trpc.orders.*` | list, getById, update, ship |
| `trpc.products.*` | list, getById, create, update |
| `trpc.returns.*` | list, getById, create, resolve |

## Common Patterns

### Disabled Query
```tsx
const { data } = trpc.customers.getById.useQuery(
  { id: customerId },
  { enabled: !!customerId }
);
```

### Optimistic Update
```tsx
const mutation = trpc.orders.update.useMutation({
  onMutate: async (newData) => {
    await utils.orders.list.cancel();
    const prev = utils.orders.list.getData();
    utils.orders.list.setData(params, (old) => ({
      ...old,
      orders: [...],
    }));
    return { prev };
  },
  onError: (err, vars, context) => {
    utils.orders.list.setData(params, context?.prev);
  },
});
```

### Error Handling
```tsx
if (error) {
  const code = error.data?.code;
  if (code === 'UNAUTHORIZED') return <Login />;
  if (code === 'FORBIDDEN') return <NoAccess />;
  return <div>Error: {error.message}</div>;
}
```

## Migration

### Before (Axios)
```tsx
import { ordersApi } from '@/services/api';
import { useQuery } from '@tanstack/react-query';

const { data } = useQuery({
  queryKey: ['orders', 'open'],
  queryFn: () => ordersApi.getAll({ view: 'open' }),
});
```

### After (tRPC)
```tsx
import { trpc } from '@/services/trpc';

const { data } = trpc.orders.list.useQuery({ view: 'open' });
```

## When to Use What

- **Use tRPC**: New features, type safety needed, frequent API calls
- **Keep Axios**: File uploads, streaming, already working code

## Need Help?

- See `/client/src/services/TRPC_MIGRATION.md` for detailed guide
- See `/client/src/examples/TRPCExample.tsx` for 7 examples
- See `/TRPC_SETUP.md` for setup details
