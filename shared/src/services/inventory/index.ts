/**
 * Inventory Services
 *
 * Exports inventory-related services including the balance cache.
 */

export {
    inventoryBalanceCache,
    fabricColourBalanceCache,
    BalanceCache,
    InventoryBalanceCache,
    FabricColourBalanceCache,
    type CachedBalance,
    type CachedFabricColourBalance,
} from './balanceCache.js';

export {
    applyInventoryFilters,
    sortInventoryItems,
    computeInventoryStats,
    inventoryFilterPredicate,
    type InventoryItemForQuery,
    type InventoryFilterParams,
    type TopStockedProduct as SharedTopStockedProduct,
    type InventoryStats as SharedInventoryStats,
} from './inventoryQuery.js';

export {
    createInwardTransaction,
    createOutwardTransaction,
    deleteInventoryTransaction,
    invalidateInventoryCaches,
    recalculateBalance,
    InsufficientStockError,
    NegativeBalanceError,
    type CreateInwardParams,
    type CreateOutwardParams,
    type InwardTransactionResult,
    type OutwardTransactionResult,
    type DeleteTransactionInfo,
} from './inventoryMutationService.js';
