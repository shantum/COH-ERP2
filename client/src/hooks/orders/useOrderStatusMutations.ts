/**
 * Order status mutations with optimistic updates
 * Handles cancelling and uncancelling orders and lines
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save previous data, update cache optimistically
 * 2. onError: Rollback to previous data
 * 3. onSettled: Invalidate to ensure consistency (background revalidation)
 */

import { useMutation } from '@tanstack/react-query';
import { ordersApi } from '../../services/api';
import { trpc } from '../../services/trpc';
import { useOrderInvalidation } from './orderMutationUtils';
import {
    getOrdersQueryInput,
    optimisticCancelLine,
    optimisticUncancelLine,
    type OrdersListData,
    type OptimisticUpdateContext,
} from './optimisticUpdateHelpers';

export interface UseOrderStatusMutationsOptions {
    currentView?: string;
    page?: number;
    shippedFilter?: 'shipped' | 'not_shipped';
}

export function useOrderStatusMutations(options: UseOrderStatusMutationsOptions = {}) {
    const { currentView = 'open', page = 1, shippedFilter } = options;
    const trpcUtils = trpc.useUtils();
    const { invalidateOpenOrders, invalidateCancelledOrders } = useOrderInvalidation();

    // Build query input for cache operations
    const queryInput = getOrdersQueryInput(currentView, page, shippedFilter);

    // Helper to get current cache data
    const getCachedData = (): OrdersListData | undefined => {
        return trpcUtils.orders.list.getData(queryInput);
    };

    // Cancel/uncancel order using tRPC (no optimistic update - these are less frequent)
    const cancelOrderMutation = trpc.orders.cancelOrder.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateCancelledOrders();
        },
        onError: (err) => alert(err.message || 'Failed to cancel order')
    });

    // Wrapper to match existing API (id instead of orderId)
    const cancelOrder = {
        mutate: ({ id, reason }: { id: string; reason?: string }) =>
            cancelOrderMutation.mutate({ orderId: id, reason }),
        mutateAsync: ({ id, reason }: { id: string; reason?: string }) =>
            cancelOrderMutation.mutateAsync({ orderId: id, reason }),
        isPending: cancelOrderMutation.isPending,
        isError: cancelOrderMutation.isError,
        error: cancelOrderMutation.error,
    };

    const uncancelOrderMutation = trpc.orders.uncancelOrder.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateCancelledOrders();
        },
        onError: (err) => alert(err.message || 'Failed to restore order')
    });

    const uncancelOrder = {
        mutate: (id: string) => uncancelOrderMutation.mutate({ orderId: id }),
        mutateAsync: (id: string) => uncancelOrderMutation.mutateAsync({ orderId: id }),
        isPending: uncancelOrderMutation.isPending,
        isError: uncancelOrderMutation.isError,
        error: uncancelOrderMutation.error,
    };

    // Cancel line with optimistic updates
    const cancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.cancelLine(lineId),
        onMutate: async (lineId: string) => {
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
        onError: (err: any, _lineId, context) => {
            // Rollback on error
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            alert(err.response?.data?.error || 'Failed to cancel line');
        },
        onSettled: () => {
            invalidateOpenOrders();
        },
    });

    // Uncancel line with optimistic updates
    const uncancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.uncancelLine(lineId),
        onMutate: async (lineId: string) => {
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
        onError: (err: any, _lineId, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            alert(err.response?.data?.error || 'Failed to restore line');
        },
        onSettled: () => {
            invalidateOpenOrders();
        },
    });

    return {
        cancelOrder,
        uncancelOrder,
        cancelLine,
        uncancelLine,
    };
}
