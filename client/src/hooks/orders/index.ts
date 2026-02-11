/**
 * Order mutations hooks - barrel export
 *
 * Individual hooks for focused mutation groups:
 * - useOrderCrudMutations: create/update/delete orders
 * - useOrderStatusMutations: cancel/uncancel (order-level)
 * - useOrderLineMutations: line operations + customization
 * - useProductionBatchMutations: production batches
 *
 * Shared utilities:
 * - useOrderInvalidation: cache invalidation helpers
 */

export { useOrderCrudMutations } from './useOrderCrudMutations';
export { useOrderStatusMutations } from './useOrderStatusMutations';
export { useOrderLineMutations } from './useOrderLineMutations';
export { useProductionBatchMutations } from './useProductionBatchMutations';
export { useOrderInvalidation } from './orderMutationUtils';

// Re-export types
export type { UseOrderCrudMutationsOptions } from './useOrderCrudMutations';
export type { UseOrderLineMutationsOptions } from './useOrderLineMutations';
export type { UseOrderStatusMutationsOptions } from './useOrderStatusMutations';
export type { MutationOptions } from './orderMutationUtils';
export { PAGE_SIZE } from './orderMutationUtils';
