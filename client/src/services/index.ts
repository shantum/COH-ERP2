/**
 * Services Index
 *
 * Central export point for both Axios and tRPC clients.
 * Use whichever is most convenient for your use case.
 *
 * @example Axios (existing pattern)
 * import { ordersApi } from '@/services';
 * const { data } = await ordersApi.getAll({ view: 'open' });
 *
 * @example tRPC (new pattern - fully type-safe)
 * import { trpc } from '@/services';
 * const { data } = trpc.orders.list.useQuery({ view: 'open' });
 */

// Re-export all Axios APIs for backward compatibility
export * from './api';

// Export tRPC client for new code
export { trpc } from './trpc';
