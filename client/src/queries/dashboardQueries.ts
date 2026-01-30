/**
 * Dashboard Query Options
 *
 * Query options for TanStack Router route loaders.
 * These are used to prefetch data before the component renders,
 * eliminating the waterfall loading pattern.
 *
 * Uses TanStack Start Server Functions for data fetching.
 *
 * Usage in route loader:
 *   await queryClient.ensureQueryData(ordersAnalyticsQueryOptions)
 *
 * Usage in component (reads from cache):
 *   const { data } = useQuery(ordersAnalyticsQueryOptions)
 */

import { queryOptions } from '@tanstack/react-query';
import { getTopProductsForDashboard, getTopCustomersForDashboard } from '../server/functions/reports';
import { getTopFabricsForDashboard } from '../server/functions/fabrics';
import { getOrdersAnalytics } from '../server/functions/orders';

/**
 * Orders analytics (summary counts for analytics bar)
 * Uses Server Function
 */
export const ordersAnalyticsQueryOptions = queryOptions({
  queryKey: ['ordersAnalytics'],
  queryFn: () => getOrdersAnalytics(),
  staleTime: 30 * 1000, // 30 seconds
});

/**
 * Top products report (Server Function)
 */
export const topProductsQueryOptions = (days: number, level: 'product' | 'variation') =>
  queryOptions({
    queryKey: ['topProducts', days, level],
    queryFn: () => getTopProductsForDashboard({ data: { days, level, limit: 15 } }),
    staleTime: 60 * 1000, // 1 minute
  });

/**
 * Top fabrics report (Server Function)
 * NOTE: getTopFabricsForDashboard is deprecated - returns empty array
 */
export const topFabricsQueryOptions = (days: number, level: 'type' | 'color') =>
  queryOptions({
    queryKey: ['topFabrics', days, level],
    queryFn: () => getTopFabricsForDashboard(),
    staleTime: 60 * 1000, // 1 minute
  });

/**
 * Top customers report (Server Function)
 */
export const topCustomersQueryOptions = (period: string) =>
  queryOptions({
    queryKey: ['topCustomers', period],
    queryFn: () => getTopCustomersForDashboard({ data: { period, limit: 10 } }),
    staleTime: 60 * 1000, // 1 minute
  });
