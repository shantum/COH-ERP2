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

// STRIPPED: useOrderWorkflowMutations, useOrderShipMutations, useOrderDeliveryMutations,
// useOrderReleaseMutations removed — fulfillment now managed in Google Sheets
export { useOrderCrudMutations } from './useOrderCrudMutations';
export { useOrderStatusMutations } from './useOrderStatusMutations';
export { useOrderLineMutations } from './useOrderLineMutations';
export { useProductionBatchMutations } from './useProductionBatchMutations';
export { useOrderInvalidation } from './orderMutationUtils';
export { useLineStatus, getLineStatusFlags } from './useLineStatus';

// Re-export types
export type { UseOrderCrudMutationsOptions } from './useOrderCrudMutations';
export type { UseOrderLineMutationsOptions } from './useOrderLineMutations';
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
