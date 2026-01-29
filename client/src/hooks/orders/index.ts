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
export { useLineStatus, getLineStatusFlags } from './useLineStatus';

// Re-export types
export type { UseOrderCrudMutationsOptions } from './useOrderCrudMutations';
export type { UseOrderLineMutationsOptions } from './useOrderLineMutations';
export type { UseOrderShipMutationsOptions } from './useOrderShipMutations';
export type { UseOrderWorkflowMutationsOptions } from './useOrderWorkflowMutations';
export type { UseOrderStatusMutationsOptions } from './useOrderStatusMutations';
export type { MutationOptions } from './orderMutationUtils';
export { PAGE_SIZE } from './orderMutationUtils';
export type { LineStatusFlags } from './useLineStatus';

// Re-export optimistic update helpers for direct use
export {
    getOrdersQueryInput,
    calculateInventoryDelta,
    optimisticLineStatusUpdate,
    optimisticBatchLineStatusUpdate,
    optimisticCancelLine,
    optimisticUncancelLine,
} from './optimisticUpdateHelpers';
export type {
    OrdersQueryInput,
    OrdersListData,
    OptimisticUpdateContext,
    ShipData,
} from './optimisticUpdateHelpers';
