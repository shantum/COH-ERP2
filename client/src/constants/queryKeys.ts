/**
 * Query key constants for TanStack Query
 * Centralizes cache keys to prevent typos and ensure consistency
 */

// Orders page size - single source of truth for pagination
// All order views use the same page size for consistency
export const ORDERS_PAGE_SIZE = 250;

// Auth query keys - single source of truth for auth state
export const authQueryKeys = {
  user: ['auth', 'user'] as const,
} as const;

// Order query keys - one per tab view
export const orderQueryKeys = {
  open: ['openOrders'] as const,
  shipped: ['shippedOrders'] as const,
  rto: ['rtoOrders'] as const,
  all: ['allOrders'] as const,
  cancelled: ['cancelledOrders'] as const,
  shippedSummary: ['shippedSummary'] as const,
  rtoSummary: ['rtoSummary'] as const,
} as const;

// Inventory and product query keys
export const inventoryQueryKeys = {
  balance: ['inventoryBalance'] as const,
  fabric: ['fabricStock'] as const,
  allSkus: ['allSkus'] as const,
} as const;

// Maps order tabs to the query keys that should be invalidated when that tab's data changes
// This allows a single invalidateTab function to handle all related cache invalidations
export const orderTabInvalidationMap: Record<string, string[]> = {
  open: ['openOrders', 'inventoryBalance'],
  shipped: ['shippedOrders', 'shippedSummary'],
  rto: ['rtoOrders', 'rtoSummary'],
  all: ['allOrders'],
  cancelled: ['cancelledOrders'],
};

// Costing dashboard query keys
export const costingQueryKeys = {
  dashboard: (period: string, channel: string) => ['costing', 'dashboard', period, channel] as const,
  products: (period: string, channel: string) => ['costing', 'products', period, channel] as const,
  config: ['costing', 'config'] as const,
} as const;
