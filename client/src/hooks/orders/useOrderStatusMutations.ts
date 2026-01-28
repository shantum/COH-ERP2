/**
 * Order status mutations with optimistic updates
 * Handles cancelling and uncancelling orders and lines
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save previous data, update cache optimistically
 *    - Updates BOTH orders cache AND inventory balance cache for consistency
 * 2. onError: Rollback to previous data + invalidate for consistency
 * 3. onSettled: Invalidate caches to confirm server state
 *
 * IMPORTANT: Inventory balance cache must be updated alongside orders cache to prevent
 * enrichRowsWithInventory from overwriting optimistic skuStock values with stale data.
 */

import { useMemo } from 'react';
import { useQueryClient, useMutation, type QueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation, getOrdersListQueryKey } from './orderMutationUtils';
import { showError } from '../../utils/toast';
import {
    cancelLine as cancelLineFn,
    uncancelLine as uncancelLineFn,
    cancelOrder as cancelOrderFn,
    uncancelOrder as uncancelOrderFn,
} from '../../server/functions/orderMutations';
import {
    getOrdersQueryInput,
    optimisticCancelLine,
    optimisticUncancelLine,
    optimisticCancelOrder,
    optimisticUncancelOrder,
    calculateInventoryDelta,
    getRowByLineId,
    getRowsByOrderId,
    hasAllocatedInventory,
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

/** Extended context that includes inventory rollback data */
interface StatusOptimisticContext extends OptimisticUpdateContext {
    previousInventoryData?: Map<string, InventoryBalanceItem[] | undefined>;
}

export interface UseOrderStatusMutationsOptions {
    currentView?: string;
    page?: number;
}

export function useOrderStatusMutations(options: UseOrderStatusMutationsOptions = {}) {
    const { currentView = 'open', page = 1 } = options;
    const queryClient = useQueryClient();
    const { invalidateOpenOrders, invalidateCancelledOrders } = useOrderInvalidation();

    // Server Function wrappers
    const cancelLineServerFn = useServerFn(cancelLineFn);
    const uncancelLineServerFn = useServerFn(uncancelLineFn);
    const cancelOrderServerFn = useServerFn(cancelOrderFn);
    const uncancelOrderServerFn = useServerFn(uncancelOrderFn);

    // Build query input for cache operations
    const queryInput = getOrdersQueryInput(currentView, page);
    const queryKey = getOrdersListQueryKey(queryInput);

    // Helper to get current cache data
    const getCachedData = (): OrdersListData | undefined => {
        return queryClient.getQueryData<OrdersListData>(queryKey);
    };

    // ============================================
    // CANCEL ORDER
    // ============================================
    const cancelOrderMutation = useMutation({
        mutationFn: async (input: { orderId: string; reason?: string }) => {
            const result = await cancelOrderServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to cancel order');
            }
            return result.data;
        },
        onMutate: async ({ orderId }) => {
            // Cancel only the specific query for this view (per CLAUDE.md rule #41)
            await queryClient.cancelQueries({ queryKey });
            // Also cancel inventory balance queries to prevent stale data from overwriting
            await queryClient.cancelQueries({ queryKey: inventoryQueryKeys.balance });

            const previousData = getCachedData();

            // Calculate inventory deltas for all lines in the order
            // (cancel restores inventory for allocated lines)
            const rows = getRowsByOrderId(previousData, orderId);
            const skuDeltas = new Map<string, number>();

            for (const row of rows) {
                if (row.skuId && hasAllocatedInventory(row.lineStatus)) {
                    // Cancelling an allocated line restores inventory
                    const delta = row.qty || 0;
                    const existing = skuDeltas.get(row.skuId) || 0;
                    skuDeltas.set(row.skuId, existing + delta);
                }
            }

            // Optimistically cancel all lines in the order
            queryClient.setQueryData<OrdersListData>(
                queryKey,
                (old) => optimisticCancelOrder(old, orderId) as OrdersListData | undefined
            );

            // Also optimistically update the inventory balance cache
            let previousInventoryData: Map<string, InventoryBalanceItem[] | undefined> | undefined;
            if (skuDeltas.size > 0) {
                previousInventoryData = optimisticInventoryUpdate(queryClient, skuDeltas);
            }

            return { previousData, queryInput, previousInventoryData } as StatusOptimisticContext;
        },
        onError: (err, _vars, context) => {
            // Rollback on error
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
            invalidateCancelledOrders();
            showError('Failed to cancel order', { description: err instanceof Error ? err.message : String(err) });
        },
        onSettled: () => {
            // Don't invalidate inventory here - the optimistic update already handles it
            // Invalidating causes a refetch that can race with server cache and return stale data
        }
    });

    // Wrapper to match existing API (id instead of orderId)
    // Use useMemo to ensure isPending updates reactively
    const cancelOrder = useMemo(() => ({
        mutate: ({ id, reason }: { id: string; reason?: string }) =>
            cancelOrderMutation.mutate({ orderId: id, reason }),
        mutateAsync: ({ id, reason }: { id: string; reason?: string }) =>
            cancelOrderMutation.mutateAsync({ orderId: id, reason }),
        isPending: cancelOrderMutation.isPending,
        isError: cancelOrderMutation.isError,
        error: cancelOrderMutation.error,
    }), [cancelOrderMutation.isPending, cancelOrderMutation.isError, cancelOrderMutation.error]);

    // ============================================
    // UNCANCEL ORDER
    // ============================================
    const uncancelOrderMutation = useMutation({
        mutationFn: async (input: { orderId: string }) => {
            const result = await uncancelOrderServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to restore order');
            }
            return result.data;
        },
        onMutate: async ({ orderId }) => {
            // For uncancel, we may be in cancelled view
            const cancelledQueryInput = getOrdersQueryInput('cancelled', page);
            const cancelledQueryKey = getOrdersListQueryKey(cancelledQueryInput);
            // Cancel only the specific query for this view (per CLAUDE.md rule #41)
            await queryClient.cancelQueries({ queryKey: cancelledQueryKey });
            const previousData = queryClient.getQueryData<OrdersListData>(cancelledQueryKey);

            queryClient.setQueryData<OrdersListData>(
                cancelledQueryKey,
                (old) => optimisticUncancelOrder(old, orderId) as OrdersListData | undefined
            );

            return { previousData, queryInput: cancelledQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                const rollbackKey = getOrdersListQueryKey(context.queryInput);
                queryClient.setQueryData(rollbackKey, context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateCancelledOrders();
            showError('Failed to restore order', { description: err instanceof Error ? err.message : String(err) });
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        }
    });

    const uncancelOrder = useMemo(() => ({
        mutate: (id: string) => uncancelOrderMutation.mutate({ orderId: id }),
        mutateAsync: (id: string) => uncancelOrderMutation.mutateAsync({ orderId: id }),
        isPending: uncancelOrderMutation.isPending,
        isError: uncancelOrderMutation.isError,
        error: uncancelOrderMutation.error,
    }), [uncancelOrderMutation.isPending, uncancelOrderMutation.isError, uncancelOrderMutation.error]);

    // ============================================
    // CANCEL LINE
    // ============================================
    const cancelLineMutation = useMutation({
        mutationFn: async (input: { lineId: string; reason?: string }) => {
            const result = await cancelLineServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to cancel line');
            }
            return result.data;
        },
        onMutate: async ({ lineId }) => {
            // Cancel only the specific query for this view (per CLAUDE.md rule #41)
            await queryClient.cancelQueries({ queryKey });
            // Also cancel inventory balance queries to prevent stale data from overwriting
            await queryClient.cancelQueries({ queryKey: inventoryQueryKeys.balance });

            // Snapshot previous value
            const previousData = getCachedData();

            // Calculate inventory delta before updating (cancel restores inventory if allocated)
            const row = getRowByLineId(previousData, lineId);
            const inventoryDelta = row
                ? calculateInventoryDelta(row.lineStatus || 'pending', 'cancelled', row.qty || 0)
                : 0;

            // Optimistically update orders cache
            queryClient.setQueryData<OrdersListData>(
                queryKey,
                (old) => optimisticCancelLine(old, lineId) as OrdersListData | undefined
            );

            // Also optimistically update the inventory balance cache
            let previousInventoryData: Map<string, InventoryBalanceItem[] | undefined> | undefined;
            if (row?.skuId && inventoryDelta !== 0) {
                const skuDeltas = new Map<string, number>([[row.skuId, inventoryDelta]]);
                previousInventoryData = optimisticInventoryUpdate(queryClient, skuDeltas);
            }

            return { previousData, queryInput, previousInventoryData } as StatusOptimisticContext;
        },
        onError: (err, _vars, context) => {
            // Rollback on error
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
            showError('Failed to cancel line', { description: err instanceof Error ? err.message : String(err) });
        },
        onSettled: () => {
            // Don't invalidate inventory here - the optimistic update already handles it
            // Invalidating causes a refetch that can race with server cache and return stale data
        },
    });

    // Wrapper for easier usage - useMemo ensures isPending updates reactively
    // Forward mutation options (onSuccess, onError, onSettled) to underlying mutation
    const cancelLine = useMemo(() => ({
        mutate: (lineId: string, options?: { onSuccess?: () => void; onError?: (err: unknown) => void; onSettled?: () => void }) =>
            cancelLineMutation.mutate({ lineId }, options),
        mutateAsync: (lineId: string) => cancelLineMutation.mutateAsync({ lineId }),
        isPending: cancelLineMutation.isPending,
        isError: cancelLineMutation.isError,
        error: cancelLineMutation.error,
    }), [cancelLineMutation.isPending, cancelLineMutation.isError, cancelLineMutation.error]);

    // ============================================
    // UNCANCEL LINE
    // ============================================
    const uncancelLineMutation = useMutation({
        mutationFn: async (input: { lineId: string }) => {
            const result = await uncancelLineServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to restore line');
            }
            return result.data;
        },
        onMutate: async ({ lineId }) => {
            // Cancel only the specific query for this view (per CLAUDE.md rule #41)
            await queryClient.cancelQueries({ queryKey });
            const previousData = getCachedData();

            // Optimistically update
            queryClient.setQueryData<OrdersListData>(
                queryKey,
                (old) => optimisticUncancelLine(old, lineId) as OrdersListData | undefined
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                const rollbackKey = getOrdersListQueryKey(context.queryInput);
                queryClient.setQueryData(rollbackKey, context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            showError('Failed to restore line', { description: err instanceof Error ? err.message : String(err) });
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
    });

    // Wrapper for easier usage - useMemo ensures isPending updates reactively
    // Forward mutation options (onSuccess, onError, onSettled) to underlying mutation
    const uncancelLine = useMemo(() => ({
        mutate: (lineId: string, options?: { onSuccess?: () => void; onError?: (err: unknown) => void; onSettled?: () => void }) =>
            uncancelLineMutation.mutate({ lineId }, options),
        mutateAsync: (lineId: string) => uncancelLineMutation.mutateAsync({ lineId }),
        isPending: uncancelLineMutation.isPending,
        isError: uncancelLineMutation.isError,
        error: uncancelLineMutation.error,
    }), [uncancelLineMutation.isPending, uncancelLineMutation.isError, uncancelLineMutation.error]);

    return {
        cancelOrder,
        uncancelOrder,
        cancelLine,
        uncancelLine,
    };
}
