/**
 * Order workflow mutations with optimistic updates
 * Handles allocate/unallocate/pick/pack line status transitions
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save previous data, update cache optimistically
 *    - Updates BOTH orders cache AND inventory balance cache for consistency
 * 2. onError: Rollback to previous data + invalidate for consistency
 * 3. onSettled: Only invalidate non-SSE-synced data (e.g., inventory balance)
 *
 * Note: Order list invalidation removed from onSettled to prevent UI flicker.
 * SSE handles cross-user synchronization; error rollback ensures consistency.
 *
 * IMPORTANT: Inventory balance cache must be updated alongside orders cache to prevent
 * enrichRowsWithInventory from overwriting optimistic skuStock values with stale data.
 */

import { useQueryClient, useMutation, type QueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation, getOrdersListQueryKey } from './orderMutationUtils';
import { showError } from '../../utils/toast';
import {
    allocateOrder as allocateOrderFn,
    setLineStatus as setLineStatusFn,
} from '../../server/functions/orderMutations';
import type { MutationOptions } from './orderMutationUtils';
import {
    getOrdersQueryInput,
    optimisticLineStatusUpdate,
    optimisticBatchLineStatusUpdate,
    calculateInventoryDelta,
    getRowByLineId,
    getRowsByLineIds,
    type OrdersListData,
    type OptimisticUpdateContext,
} from './optimisticUpdateHelpers';
import type { InventoryBalanceItem } from '../../server/functions/inventory';

/**
 * Optimistically update all inventory balance caches for affected SKUs
 * Returns a map of query keys to previous data for rollback
 */
function optimisticInventoryUpdate(
    queryClient: QueryClient,
    skuDeltas: Map<string, number> // skuId -> delta (negative = allocated, positive = freed)
): Map<string, InventoryBalanceItem[] | undefined> {
    const previousInventoryData = new Map<string, InventoryBalanceItem[] | undefined>();

    // Get all inventory balance queries from the cache
    const queries = queryClient.getQueriesData<InventoryBalanceItem[]>({
        queryKey: inventoryQueryKeys.balance,
    });

    // Update each matching query
    for (const [queryKey, oldData] of queries) {
        if (!oldData) continue;

        // Check if any SKUs in this cache need updating
        let hasChanges = false;
        const newData = oldData.map((item: InventoryBalanceItem) => {
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
            // Save previous data for rollback (use stringified key for Map)
            const keyStr = JSON.stringify(queryKey);
            previousInventoryData.set(keyStr, oldData);

            // Update the cache
            queryClient.setQueryData<InventoryBalanceItem[]>(queryKey, newData);
        }
    }

    return previousInventoryData;
}

/**
 * Rollback inventory balance caches to previous state
 */
function rollbackInventoryUpdate(
    queryClient: QueryClient,
    previousData: Map<string, InventoryBalanceItem[] | undefined>
): void {
    for (const [keyStr, data] of previousData) {
        const queryKey = JSON.parse(keyStr);
        queryClient.setQueryData(queryKey, data);
    }
}

export interface UseOrderWorkflowMutationsOptions {
    currentView?: string;
    page?: number;
}

/** Extended context that includes inventory rollback data */
interface WorkflowOptimisticContext extends OptimisticUpdateContext {
    previousInventoryData?: Map<string, InventoryBalanceItem[] | undefined>;
}

export function useOrderWorkflowMutations(options: UseOrderWorkflowMutationsOptions = {}) {
    const { currentView = 'open', page = 1 } = options;
    const queryClient = useQueryClient();
    const { invalidateOpenOrders } = useOrderInvalidation();

    // Server Function wrappers
    const allocateOrderServerFn = useServerFn(allocateOrderFn);
    const setLineStatusServerFn = useServerFn(setLineStatusFn);

    // Build query input for cache operations
    const queryInput = getOrdersQueryInput(currentView, page);
    const queryKey = getOrdersListQueryKey(queryInput);

    // Helper to get current cache data
    const getCachedData = (): OrdersListData | undefined => {
        return queryClient.getQueryData<OrdersListData>(queryKey);
    };

    // ============================================
    // ALLOCATE
    // ============================================
    const allocate = useMutation({
        mutationFn: async (input: { lineIds: string[] }) => {
            // Server Function expects orderId, but we're using lineIds
            // We need to get orderId from the first line
            const cachedData = getCachedData();
            const row = getRowByLineId(cachedData, input.lineIds[0]);
            if (!row?.orderId) {
                throw new Error('Could not determine order ID for allocation');
            }
            const result = await allocateOrderServerFn({ data: { orderId: row.orderId, lineIds: input.lineIds } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to allocate');
            }
            return result.data;
        },
        onMutate: async ({ lineIds }) => {
            // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
            await queryClient.cancelQueries({ queryKey });
            // Also cancel inventory balance queries to prevent stale data from overwriting
            await queryClient.cancelQueries({ queryKey: inventoryQueryKeys.balance });

            // Snapshot the previous value
            const previousData = getCachedData();

            // Get rows and calculate inventory deltas in a single pass
            // Two maps: one by lineId (for order rows), one by skuId (for inventory cache)
            const rows = getRowsByLineIds(previousData, lineIds);
            const inventoryDeltas = new Map<string, number>(); // lineId -> delta
            const skuDeltas = new Map<string, number>(); // skuId -> delta (aggregated)

            for (const row of rows) {
                if (row.lineId) {
                    const delta = calculateInventoryDelta(row.lineStatus || 'pending', 'allocated', row.qty || 0);
                    inventoryDeltas.set(row.lineId, delta);

                    // Aggregate deltas by SKU for inventory cache update
                    if (row.skuId && delta !== 0) {
                        const existing = skuDeltas.get(row.skuId) || 0;
                        skuDeltas.set(row.skuId, existing + delta);
                    }
                }
            }

            // Optimistically update the orders cache
            queryClient.setQueryData<OrdersListData>(
                queryKey,
                (old) => optimisticBatchLineStatusUpdate(old, lineIds, 'allocated', inventoryDeltas) as OrdersListData | undefined
            );

            // Also optimistically update the inventory balance cache
            // This prevents enrichRowsWithInventory from overwriting our optimistic skuStock
            const previousInventoryData = optimisticInventoryUpdate(queryClient, skuDeltas);

            // Return context with data for rollback
            return { previousData, queryInput, previousInventoryData } as WorkflowOptimisticContext;
        },
        onError: (err, _vars, context) => {
            // Rollback to the previous value on error
            if (context?.previousData) {
                const rollbackKey = getOrdersListQueryKey(context.queryInput);
                queryClient.setQueryData(rollbackKey, context.previousData);
            }
            // Rollback inventory cache
            if (context?.previousInventoryData) {
                rollbackInventoryUpdate(queryClient, context.previousInventoryData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();

            // Show error toast for insufficient stock
            const errorMsg = err instanceof Error ? err.message : String(err);
            if (errorMsg.includes('Insufficient stock')) {
                showError('Insufficient stock', { description: errorMsg });
            } else if (!errorMsg.includes('pending') && !errorMsg.includes('allocated')) {
                showError('Failed to allocate', { description: errorMsg });
            }
        },
        onSettled: () => {
            // Don't invalidate inventory here - the optimistic update already handles it
            // Invalidating causes a refetch that can race with server cache and return stale data
            // The server mutation invalidates its cache, so future queries will get fresh data
            // SSE handles syncing for other users
        },
    });

    // ============================================
    // SET LINE STATUS
    // ============================================
    const setLineStatusMutation = useMutation({
        mutationFn: async (input: { lineId: string; status: 'pending' | 'allocated' | 'picked' | 'packed' | 'cancelled' }) => {
            const result = await setLineStatusServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update line status');
            }
            return result.data;
        },
        onMutate: async ({ lineId, status: newStatus }) => {
            await queryClient.cancelQueries({ queryKey });
            // Also cancel inventory balance queries to prevent stale data from overwriting
            await queryClient.cancelQueries({ queryKey: inventoryQueryKeys.balance });

            const previousData = getCachedData();

            // Get the row to calculate inventory delta
            const row = getRowByLineId(previousData, lineId);
            const inventoryDelta = row
                ? calculateInventoryDelta(row.lineStatus || 'pending', newStatus, row.qty || 0)
                : 0;

            // Optimistically update orders cache
            queryClient.setQueryData<OrdersListData>(
                queryKey,
                (old) => optimisticLineStatusUpdate(old, lineId, newStatus, inventoryDelta) as OrdersListData | undefined
            );

            // Also optimistically update the inventory balance cache
            let previousInventoryData: Map<string, InventoryBalanceItem[] | undefined> | undefined;
            if (row?.skuId && inventoryDelta !== 0) {
                const skuDeltas = new Map<string, number>([[row.skuId, inventoryDelta]]);
                previousInventoryData = optimisticInventoryUpdate(queryClient, skuDeltas);
            }

            return { previousData, queryInput, previousInventoryData } as WorkflowOptimisticContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                const rollbackKey = getOrdersListQueryKey(context.queryInput);
                queryClient.setQueryData(rollbackKey, context.previousData);
            }
            // Rollback inventory cache
            if (context?.previousInventoryData) {
                rollbackInventoryUpdate(queryClient, context.previousInventoryData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();

            const msg = err instanceof Error ? err.message : 'Failed to update line status';
            if (!msg.includes('Cannot transition')) {
                showError('Failed to update line status', { description: msg });
            }
        },
        onSettled: () => {
            // Don't invalidate inventory here - the optimistic update already handles it
            // Invalidating causes a refetch that can race with server cache and return stale data
        },
    });

    // Wrapper mutations that use setLineStatus with specific statuses
    const unallocate = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'pending' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'pending' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    const pickLine = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'picked' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'picked' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    const unpickLine = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'allocated' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'allocated' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    const packLine = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'packed' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'packed' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    const unpackLine = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'picked' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'picked' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    return {
        allocate,
        unallocate,
        pickLine,
        unpickLine,
        packLine,
        unpackLine,
    };
}
