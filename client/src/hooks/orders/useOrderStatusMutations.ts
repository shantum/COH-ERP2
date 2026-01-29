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
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation } from './orderMutationUtils';
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
import {
    optimisticInventoryUpdate,
    rollbackInventoryUpdate,
} from './optimistic/inventoryHelpers';
import type { InventoryBalanceItem } from '../../server/functions/inventory';

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

    // Build query input for cache operations (used for rollback context)
    const queryInput = getOrdersQueryInput(currentView, page);

    /**
     * Create a predicate to match all order list queries for a specific view.
     * This matches regardless of filters (allocatedFilter, productionFilter) or pagination.
     * Query key format: ['orders', 'list', 'server-fn', { view, page, limit, ...filters }]
     */
    const createViewPredicate = (view: string) => (query: { queryKey: readonly unknown[] }) => {
        const key = query.queryKey;
        if (key[0] !== 'orders' || key[1] !== 'list' || key[2] !== 'server-fn') return false;
        const params = key[3] as { view?: string } | undefined;
        return params?.view === view;
    };

    // Predicate for current view
    const viewQueryPredicate = createViewPredicate(currentView);

    // Helper to get current cache data - finds any matching query for the view
    const getCachedData = (): OrdersListData | undefined => {
        const queries = queryClient.getQueriesData<OrdersListData>({ predicate: viewQueryPredicate });
        return queries[0]?.[1];
    };

    // Helper to set cache data for ALL matching queries in a view
    const setCachedDataForView = (
        view: string,
        updater: (old: OrdersListData | undefined) => OrdersListData | undefined
    ) => {
        queryClient.setQueriesData<OrdersListData>(
            { predicate: createViewPredicate(view) },
            updater
        );
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
            // Cancel queries for this view (matches any filter/page combination)
            await queryClient.cancelQueries({ predicate: viewQueryPredicate });
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

            // Optimistically cancel all lines in the order - update ALL caches for this view
            setCachedDataForView(
                currentView,
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
            // Rollback all view caches to the previous value
            if (context?.previousData) {
                setCachedDataForView(currentView, () => context.previousData);
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
            // For uncancel, we target the cancelled view
            const cancelledViewPredicate = createViewPredicate('cancelled');
            const cancelledQueryInput = getOrdersQueryInput('cancelled', page);
            await queryClient.cancelQueries({ predicate: cancelledViewPredicate });

            // Get data from any matching cancelled view query
            const queries = queryClient.getQueriesData<OrdersListData>({ predicate: cancelledViewPredicate });
            const previousData = queries[0]?.[1];

            // Update ALL cancelled view caches
            setCachedDataForView(
                'cancelled',
                (old) => optimisticUncancelOrder(old, orderId) as OrdersListData | undefined
            );

            return { previousData, queryInput: cancelledQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            // Rollback all cancelled view caches
            if (context?.previousData) {
                setCachedDataForView('cancelled', () => context.previousData);
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
            // Cancel queries for this view (matches any filter/page combination)
            await queryClient.cancelQueries({ predicate: viewQueryPredicate });
            // Also cancel inventory balance queries to prevent stale data from overwriting
            await queryClient.cancelQueries({ queryKey: inventoryQueryKeys.balance });

            // Snapshot previous value
            const previousData = getCachedData();

            // Calculate inventory delta before updating (cancel restores inventory if allocated)
            const row = getRowByLineId(previousData, lineId);
            const inventoryDelta = row
                ? calculateInventoryDelta(row.lineStatus || 'pending', 'cancelled', row.qty || 0)
                : 0;

            // Optimistically update ALL orders caches for this view
            setCachedDataForView(
                currentView,
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
            // Rollback all view caches to the previous value
            if (context?.previousData) {
                setCachedDataForView(currentView, () => context.previousData);
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
            // Cancel queries for this view (matches any filter/page combination)
            await queryClient.cancelQueries({ predicate: viewQueryPredicate });
            const previousData = getCachedData();

            // Optimistically update ALL orders caches for this view
            setCachedDataForView(
                currentView,
                (old) => optimisticUncancelLine(old, lineId) as OrdersListData | undefined
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            // Rollback all view caches to the previous value
            if (context?.previousData) {
                setCachedDataForView(currentView, () => context.previousData);
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
