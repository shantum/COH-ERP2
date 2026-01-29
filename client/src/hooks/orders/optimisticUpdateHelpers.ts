/**
 * Optimistic Update Helpers for Orders
 *
 * REFACTORED: This file now re-exports from modular files in ./optimistic/
 * This maintains backward compatibility for existing imports.
 *
 * The implementation has been split into:
 * - optimistic/types.ts: Type definitions and constants
 * - optimistic/inventoryHelpers.ts: Inventory delta calculations
 * - optimistic/cacheTargeting.ts: Query input builders and row access helpers
 * - optimistic/statusUpdateHelpers.ts: Optimistic update transformation functions
 *
 * New code should import directly from './optimistic' or the specific submodule.
 */

// Re-export everything from the modular structure
export {
    // Types and constants
    PAGE_SIZE,
    type OrdersQueryInput,
    type OrdersListData,
    type OptimisticUpdateContext,
    type ViewOptimisticContext,
    type ViewCacheSnapshot,
    type ShipData,
    // Inventory helpers
    calculateInventoryDelta,
    hasAllocatedInventory,
    // Cache targeting (legacy single-query helpers)
    getOrdersQueryInput,
    getRowByLineId,
    getRowsByLineIds,
    getRowsByOrderId,
    getRowByBatchId,
    // View-based cache utilities (handles all filter/page variants)
    createViewPredicate,
    getViewCacheSnapshot,
    restoreViewCacheSnapshot,
    updateViewCache,
    cancelViewQueries,
    findRowInViewCache,
    findRowsInViewCache,
    findOrderRowsInViewCache,
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
} from './optimistic';
