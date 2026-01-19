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
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../services/trpc';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation } from './orderMutationUtils';
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

export function useOrderStatusMutations(options: UseOrderStatusMutationsOptions = {}) {
    const { currentView = 'open', page = 1, shippedFilter } = options;
    const queryClient = useQueryClient();
    const trpcUtils = trpc.useUtils();
    const { invalidateOpenOrders, invalidateCancelledOrders } = useOrderInvalidation();

    // Build query input for cache operations
    const queryInput = getOrdersQueryInput(currentView, page, shippedFilter);

    // Helper to get current cache data
    const getCachedData = (): OrdersListData | undefined => {
        return trpcUtils.orders.list.getData(queryInput);
    };

    // Cancel order with optimistic update
    const cancelOrderMutation = trpc.orders.cancelOrder.useMutation({
        onMutate: async ({ orderId }) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            // Optimistically cancel all lines in the order
            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticCancelOrder(old, orderId) as any
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            // Rollback on error
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateCancelledOrders();
            alert(err.message || 'Failed to cancel order');
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

    // Uncancel order with optimistic update
    const uncancelOrderMutation = trpc.orders.uncancelOrder.useMutation({
        onMutate: async ({ orderId }) => {
            // For uncancel, we may be in cancelled view
            const cancelledQueryInput = getOrdersQueryInput('cancelled', page, undefined);
            await trpcUtils.orders.list.cancel(cancelledQueryInput);
            const previousData = trpcUtils.orders.list.getData(cancelledQueryInput);

            trpcUtils.orders.list.setData(
                cancelledQueryInput,
                (old: any) => optimisticUncancelOrder(old, orderId) as any
            );

            return { previousData, queryInput: cancelledQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateCancelledOrders();
            alert(err.message || 'Failed to restore order');
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

    // Cancel line with optimistic updates (tRPC)
    const cancelLineMutation = trpc.orders.cancelLine.useMutation({
        onMutate: async ({ lineId }) => {
            // Cancel inflight refetches
            await trpcUtils.orders.list.cancel(queryInput);

            // Snapshot previous value
            const previousData = getCachedData();

            // Optimistically update
            // Cast through `any` as tRPC inferred types are stricter than our FlattenedOrderRow
            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticCancelLine(old, lineId) as any
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            // Rollback on error
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            alert(err.message || 'Failed to cancel line');
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

    // Uncancel line with optimistic updates (tRPC)
    const uncancelLineMutation = trpc.orders.uncancelLine.useMutation({
        onMutate: async ({ lineId }) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            // Optimistically update
            // Cast through `any` as tRPC inferred types are stricter than our FlattenedOrderRow
            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticUncancelLine(old, lineId) as any
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            alert(err.message || 'Failed to restore line');
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
