/**
 * Inventory-related helpers for Optimistic Updates
 * Re-exports from @coh/shared for consistency.
 */

import type { QueryClient } from '@tanstack/react-query';
import { inventoryQueryKeys } from '../../../constants/queryKeys';
import type { InventoryBalanceItem } from '../../../server/functions/inventory';

export { calculateInventoryDelta, hasAllocatedInventory, computeOrderStatus } from '@coh/shared/domain';

/**
 * Optimistically update all inventory balance caches for affected SKUs
 * Returns a map of query keys to previous data for rollback
 */
export function optimisticInventoryUpdate(
    queryClient: QueryClient,
    skuDeltas: Map<string, number> // skuId -> delta (negative = allocated, positive = freed)
): Map<string, InventoryBalanceItem[] | undefined> {
    const previousInventoryData = new Map<string, InventoryBalanceItem[] | undefined>();

    // Get all inventory balance queries from the cache
    const queries = queryClient.getQueriesData<InventoryBalanceItem[]>({
        queryKey: inventoryQueryKeys.balance,
    });

    let queriesUpdated = 0;
    let totalItemsScanned = 0;

    // Update each matching query
    for (const [queryKey, oldData] of queries) {
        if (!oldData) continue;

        // Check if any SKUs in this cache need updating
        let hasChanges = false;
        const newData = oldData.map((item: InventoryBalanceItem) => {
            totalItemsScanned++;
            const delta = skuDeltas.get(item.skuId);
            if (delta !== undefined && delta !== 0) {
                hasChanges = true;
                return {
                    ...item,
                    currentBalance: item.currentBalance + delta,
                    availableBalance: item.availableBalance + delta,
                };
            }
            return item;
        });

        if (hasChanges) {
            queriesUpdated++;
            // Save previous data for rollback (use stringified key for Map)
            const keyStr = JSON.stringify(queryKey);
            previousInventoryData.set(keyStr, oldData);

            // Update the cache
            queryClient.setQueryData<InventoryBalanceItem[]>(queryKey, newData);
        }
    }

    console.log(`[inventoryHelpers] optimisticInventoryUpdate: queries=${queries.length}, queriesUpdated=${queriesUpdated}, itemsScanned=${totalItemsScanned}, skusToUpdate=${skuDeltas.size}`);
    return previousInventoryData;
}

/**
 * Rollback inventory balance caches to previous state
 */
export function rollbackInventoryUpdate(
    queryClient: QueryClient,
    previousData: Map<string, InventoryBalanceItem[] | undefined>
): void {
    for (const [keyStr, data] of previousData) {
        const queryKey = JSON.parse(keyStr);
        queryClient.setQueryData(queryKey, data);
    }
}
