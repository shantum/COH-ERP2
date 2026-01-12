# tRPC Migration Guide

This document explains how to use tRPC alongside existing Axios calls for gradual migration.

## Setup Complete

- tRPC client is configured in `/client/src/services/trpc.ts`
- TRPCProvider wraps the app in `/client/src/App.tsx`
- Uses existing React Query setup (no duplicate QueryClient)
- Matches existing auth patterns (localStorage token, auth:unauthorized event)

## Available Routers

The server has 6 tRPC routers ready to use:

- **auth**: Authentication and user management
- **customers**: Customer management and statistics
- **inventory**: Inventory tracking and transactions
- **orders**: Order management
- **products**: Product catalog (products, variations, SKUs)
- **returns**: Return request management

## Usage Examples

### Query (GET requests)

```tsx
import { trpc } from '@/services/trpc';

function OrdersList() {
  // Fully type-safe - autocomplete for input and return types
  const { data, isLoading, error } = trpc.orders.list.useQuery({
    view: 'open',
    limit: 100,
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {data?.orders.map(order => (
        <div key={order.id}>{order.orderNumber}</div>
      ))}
    </div>
  );
}
```

### Mutation (POST/PUT/DELETE requests)

```tsx
import { trpc } from '@/services/trpc';

function UpdateOrderButton({ orderId }: { orderId: string }) {
  const utils = trpc.useUtils();

  const updateMutation = trpc.orders.update.useMutation({
    onSuccess: () => {
      // Invalidate and refetch orders list
      utils.orders.list.invalidate();
    },
  });

  const handleUpdate = () => {
    updateMutation.mutate({
      id: orderId,
      status: 'shipped',
    });
  };

  return (
    <button
      onClick={handleUpdate}
      disabled={updateMutation.isPending}
    >
      {updateMutation.isPending ? 'Updating...' : 'Mark Shipped'}
    </button>
  );
}
```

### Parallel Queries

```tsx
import { trpc } from '@/services/trpc';

function Dashboard() {
  const orders = trpc.orders.list.useQuery({ view: 'open' });
  const customers = trpc.customers.list.useQuery({ limit: 10 });
  const inventory = trpc.inventory.balance.useQuery();

  // All three queries run in parallel
  // React Query handles loading states automatically

  if (orders.isLoading || customers.isLoading || inventory.isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <h2>Orders: {orders.data?.total}</h2>
      <h2>Customers: {customers.data?.length}</h2>
      <h2>Inventory Items: {inventory.data?.length}</h2>
    </div>
  );
}
```

### Dependent Queries

```tsx
import { trpc } from '@/services/trpc';

function OrderDetails({ orderId }: { orderId: string }) {
  // First query
  const { data: order } = trpc.orders.getById.useQuery({ id: orderId });

  // Second query only runs when order data is available
  const { data: customer } = trpc.customers.getById.useQuery(
    { id: order?.customerId! },
    { enabled: !!order?.customerId }
  );

  return (
    <div>
      <h3>Order #{order?.orderNumber}</h3>
      <p>Customer: {customer?.name}</p>
    </div>
  );
}
```

## Migration Strategy

1. **Keep existing Axios calls working** - Don't break anything
2. **Use tRPC for new features** - Get type safety benefits immediately
3. **Gradually migrate high-value endpoints** - Focus on frequently used APIs
4. **Test thoroughly** - Both clients can coexist during migration

## When to Use tRPC vs Axios

### Use tRPC when:
- Building new features
- You need type safety and autocomplete
- The endpoint exists in tRPC routers
- You want automatic request batching

### Keep using Axios when:
- Existing code works fine
- tRPC endpoint doesn't exist yet
- File uploads (use Axios FormData)
- Streaming responses

## Type Safety Benefits

```tsx
// ❌ Axios - No type safety
const { data } = await ordersApi.getAll({ view: 'open' });
data.orders[0].customerName; // No autocomplete, runtime error if field doesn't exist

// ✅ tRPC - Full type safety
const { data } = trpc.orders.list.useQuery({ view: 'open' });
data.orders[0].customerName; // TypeScript error if field doesn't exist
                              // Perfect autocomplete for all fields
```

## Request Batching

tRPC automatically batches requests made within 10ms into a single HTTP call:

```tsx
// These 3 queries are batched into 1 HTTP request automatically
const orders = trpc.orders.list.useQuery({ view: 'open' });
const products = trpc.products.list.useQuery({ limit: 20 });
const customers = trpc.customers.list.useQuery({ limit: 10 });
```

## Error Handling

```tsx
import { trpc } from '@/services/trpc';

function MyComponent() {
  const { data, error, isError } = trpc.orders.list.useQuery({ view: 'open' });

  if (isError) {
    // tRPC errors have consistent structure
    console.error('Error code:', error.data?.code);
    console.error('Error message:', error.message);

    // Handle specific error codes
    if (error.data?.code === 'UNAUTHORIZED') {
      // Redirect to login (auth:unauthorized event already fired)
    }
  }

  return <div>{/* ... */}</div>;
}
```

## Cache Management

```tsx
import { trpc } from '@/services/trpc';

function MyComponent() {
  const utils = trpc.useUtils();

  // Invalidate specific query
  utils.orders.list.invalidate();

  // Invalidate all order queries
  utils.orders.invalidate();

  // Set query data manually (optimistic update)
  utils.orders.list.setData({ view: 'open' }, (old) => {
    if (!old) return old;
    return {
      ...old,
      orders: [...old.orders, newOrder],
    };
  });

  // Refetch query
  utils.orders.list.refetch();

  return <div>{/* ... */}</div>;
}
```

## Troubleshooting

### Type errors after server changes

If you modify server tRPC routers, TypeScript may show outdated types in the client. Restart your dev server:

```bash
# In client directory
npm run dev
```

### 401 Unauthorized

Make sure you're logged in. The tRPC client uses the same localStorage token as Axios.

### CORS errors

tRPC endpoint is at `http://localhost:3001/trpc`. Make sure server CORS is configured for your client origin.

## Next Steps

1. Try using tRPC in a small component to get familiar
2. Compare the developer experience with Axios
3. Gradually migrate endpoints as you work on features
4. Add new tRPC procedures on the server as needed
