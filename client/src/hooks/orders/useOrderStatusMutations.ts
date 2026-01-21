/**
 * Order status mutations with optimistic updates
 * Handles cancelling and uncancelling orders and lines
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save previous data, update cache optimistically
 * 2. onError: Rollback to previous data + invalidate for consistency
 * 3. onSettled: Invalidate caches to confirm server state
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
    type OrdersListData,
    type OptimisticUpdateContext,
} from './optimisticUpdateHelpers';

export interface UseOrderStatusMutationsOptions {
    currentView?: string;
    page?: number;
    shippedFilter?: 'rto' | 'cod_pending';
}

/**
 * Helper to build tRPC-compatible query key for orders.list
 */
function getOrdersListQueryKey(input: { view: string; page: number; limit: number; shippedFilter?: string }) {
    return [['orders', 'list'], { input, type: 'query' }];
}

export function useOrderStatusMutations(options: UseOrderStatusMutationsOptions = {}) {
    const { currentView = 'open', page = 1, shippedFilter } = options;
    const queryClient = useQueryClient();
    const { invalidateOpenOrders, invalidateCancelledOrders } = useOrderInvalidation();

    // Server Function wrappers
    const cancelLineServerFn = useServerFn(cancelLineFn);
    const uncancelLineServerFn = useServerFn(uncancelLineFn);
    const cancelOrderServerFn = useServerFn(cancelOrderFn);
    const uncancelOrderServerFn = useServerFn(uncancelOrderFn);

    // Build query input for cache operations
    const queryInput = getOrdersQueryInput(currentView, page, shippedFilter);
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
            await queryClient.cancelQueries({ queryKey: ['orders'] });
            const previousData = getCachedData();

            // Optimistically cancel all lines in the order
            queryClient.setQueryData<OrdersListData>(
                queryKey,
                (old) => optimisticCancelOrder(old, orderId) as OrdersListData | undefined
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            // Rollback on error
            if (context?.previousData) {
                const rollbackKey = getOrdersListQueryKey(context.queryInput);
                queryClient.setQueryData(rollbackKey, context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateCancelledOrders();
            showError('Failed to cancel order', { description: err instanceof Error ? err.message : String(err) });
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
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
            const cancelledQueryInput = getOrdersQueryInput('cancelled', page, undefined);
            const cancelledQueryKey = getOrdersListQueryKey(cancelledQueryInput);
            await queryClient.cancelQueries({ queryKey: ['orders'] });
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
            // Cancel inflight refetches
            await queryClient.cancelQueries({ queryKey: ['orders'] });

            // Snapshot previous value
            const previousData = getCachedData();

            // Optimistically update
            queryClient.setQueryData<OrdersListData>(
                queryKey,
                (old) => optimisticCancelLine(old, lineId) as OrdersListData | undefined
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            // Rollback on error
            if (context?.previousData) {
                const rollbackKey = getOrdersListQueryKey(context.queryInput);
                queryClient.setQueryData(rollbackKey, context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            showError('Failed to cancel line', { description: err instanceof Error ? err.message : String(err) });
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
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
            await queryClient.cancelQueries({ queryKey: ['orders'] });
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
