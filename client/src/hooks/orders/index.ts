/**
 * Order mutations hooks - barrel export
 *
 * Individual hooks for focused mutation groups:
 * - useOrderWorkflowMutations: allocate/pick/pack workflow
 * - useOrderShipMutations: shipping operations
 * - useOrderCrudMutations: create/update/delete orders
 * - useOrderStatusMutations: cancel/uncancel
 * - useOrderDeliveryMutations: delivery tracking
 * - useOrderLineMutations: line operations + customization
 * - useOrderReleaseMutations: release workflows
 * - useProductionBatchMutations: production batches
 *
 * Shared utilities:
 * - useOrderInvalidation: cache invalidation helpers
 */

export { useOrderWorkflowMutations } from './useOrderWorkflowMutations';
export { useOrderShipMutations } from './useOrderShipMutations';
export { useOrderCrudMutations } from './useOrderCrudMutations';
export { useOrderStatusMutations } from './useOrderStatusMutations';
export { useOrderDeliveryMutations } from './useOrderDeliveryMutations';
export { useOrderLineMutations } from './useOrderLineMutations';
export { useOrderReleaseMutations } from './useOrderReleaseMutations';
export { useProductionBatchMutations } from './useProductionBatchMutations';
export { useOrderInvalidation } from './orderMutationUtils';

// Re-export types
export type { UseOrderCrudMutationsOptions } from './useOrderCrudMutations';
export type { UseOrderLineMutationsOptions } from './useOrderLineMutations';
export type { UseOrderShipMutationsOptions } from './useOrderShipMutations';
export type { MutationOptions } from './orderMutationUtils';
