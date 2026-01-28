/**
 * Optimistic Update Helpers for Orders
 *
 * Provides utilities for optimistic UI updates that instantly reflect changes
 * while background revalidation ensures data consistency.
 *
 * Key concepts:
 * - Optimistic updates show changes immediately without waiting for server
 * - On error, we rollback to previous state
 * - onSettled always revalidates in background for consistency
 *
 * Split into modules:
 * - types.ts: Type definitions and constants
 * - inventoryHelpers.ts: Inventory delta calculations
 * - cacheTargeting.ts: Query input builders and row access helpers
 * - statusUpdateHelpers.ts: Optimistic update transformation functions
 */

// Types and constants
export {
    PAGE_SIZE,
    type OrdersQueryInput,
    type OrdersListData,
    type OptimisticUpdateContext,
    type ShipData,
} from './types';

// Inventory helpers
export {
    calculateInventoryDelta,
    hasAllocatedInventory,
} from './inventoryHelpers';

// Cache targeting
export {
    getOrdersQueryInput,
    getRowByLineId,
    getRowsByLineIds,
    getRowsByOrderId,
    getRowByBatchId,
} from './cacheTargeting';

// Status update helpers
export {
    // Line status updates
    optimisticLineStatusUpdate,
    optimisticBatchLineStatusUpdate,
    optimisticCancelLine,
    optimisticUncancelLine,
    // Shipping updates (line-level only - no order-level shipping)
    optimisticShipLines,
    optimisticUnshipLines,
    optimisticUpdateLineTracking,
    // Delivery updates
    optimisticMarkDelivered,
    optimisticMarkRto,
    optimisticReceiveRto,
    // Order status updates
    optimisticCancelOrder,
    optimisticUncancelOrder,
    // Production batch updates
    optimisticCreateBatch,
    optimisticUpdateBatch,
    optimisticDeleteBatch,
} from './statusUpdateHelpers';
