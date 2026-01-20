/**
 * Dashboard Query Options
 *
 * Query options for TanStack Router route loaders.
 * These are used to prefetch data before the component renders,
 * eliminating the waterfall loading pattern.
 *
 * Usage in route loader:
 *   await queryClient.ensureQueryData(ordersAnalyticsQueryOptions)
 *
 * Usage in component (reads from cache):
 *   const { data } = useQuery(ordersAnalyticsQueryOptions)
 */

import { queryOptions } from '@tanstack/react-query';
import { ordersApi, reportsApi, fabricsApi } from '../services/api';

/**
 * Orders analytics (summary counts for analytics bar)
 */
export const ordersAnalyticsQueryOptions = queryOptions({
  queryKey: ['ordersAnalytics'],
  queryFn: () => ordersApi.getAnalytics().then(r => r.data),
  staleTime: 30 * 1000, // 30 seconds
});

/**
 * Top products report
 */
export const topProductsQueryOptions = (days: number, level: 'product' | 'variation') =>
  queryOptions({
    queryKey: ['topProducts', days, level],
    queryFn: () => reportsApi.getTopProducts({ days, level, limit: 15 }).then(r => r.data),
    staleTime: 60 * 1000, // 1 minute
  });

/**
 * Top fabrics report
 */
export const topFabricsQueryOptions = (days: number, level: 'type' | 'color') =>
  queryOptions({
    queryKey: ['topFabrics', days, level],
    queryFn: () => fabricsApi.getTopFabrics({ days, level, limit: 12 }).then(r => r.data),
    staleTime: 60 * 1000, // 1 minute
  });

/**
 * Top customers report
 */
export const topCustomersQueryOptions = (period: string) =>
  queryOptions({
    queryKey: ['topCustomers', period],
    queryFn: () => reportsApi.getTopCustomers({ period, limit: 10 }).then(r => r.data),
    staleTime: 60 * 1000, // 1 minute
  });
