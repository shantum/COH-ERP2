/**
 * Services Index
 *
 * Central export point for API clients.
 *
 * @example Axios (existing pattern)
 * import { ordersApi } from '@/services';
 * const { data } = await ordersApi.getAll({ view: 'open' });
 */

// Re-export all Axios APIs for backward compatibility
export * from './api';
