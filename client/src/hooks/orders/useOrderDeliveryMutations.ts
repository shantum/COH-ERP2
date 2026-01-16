/**
 * Order delivery tracking mutations with optimistic updates
 * Handles marking orders as delivered, RTO, and receiving RTO
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save previous data, update cache optimistically
 * 2. onError: Rollback to previous data
 * 3. onSettled: Invalidate to ensure consistency (background revalidation)
 */

import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../services/trpc';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation } from './orderMutationUtils';
import {
    getOrdersQueryInput,
    optimisticMarkDelivered,
    optimisticMarkRto,
    optimisticReceiveRto,
    type OptimisticUpdateContext,
} from './optimisticUpdateHelpers';

export interface UseOrderDeliveryMutationsOptions {
    page?: number;
}

export function useOrderDeliveryMutations(options: UseOrderDeliveryMutationsOptions = {}) {
    const { page = 1 } = options;
    const queryClient = useQueryClient();
    const trpcUtils = trpc.useUtils();
    const { invalidateOpenOrders, invalidateShippedOrders, invalidateRtoOrders, invalidateCodPendingOrders } = useOrderInvalidation();

    // Mark delivered with optimistic update
    const markDeliveredMutation = trpc.orders.markDelivered.useMutation({
        onMutate: async ({ orderId }) => {
            // For delivery operations, we're typically in shipped view
            const shippedQueryInput = getOrdersQueryInput('shipped', page, undefined);
            await trpcUtils.orders.list.cancel(shippedQueryInput);
            const previousData = trpcUtils.orders.list.getData(shippedQueryInput);

            trpcUtils.orders.list.setData(
                shippedQueryInput,
                (old: any) => optimisticMarkDelivered(old, orderId, new Date().toISOString()) as any
            );

            return { previousData, queryInput: shippedQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            alert(err.message || 'Failed to mark as delivered');
        },
        onSettled: () => {
            invalidateShippedOrders();
            invalidateCodPendingOrders();
        }
    });

    const markDelivered = {
        mutate: (id: string) => markDeliveredMutation.mutate({ orderId: id }),
        mutateAsync: (id: string) => markDeliveredMutation.mutateAsync({ orderId: id }),
        isPending: markDeliveredMutation.isPending,
        isError: markDeliveredMutation.isError,
        error: markDeliveredMutation.error,
    };

    // Mark RTO with optimistic update
    const markRtoMutation = trpc.orders.markRto.useMutation({
        onMutate: async ({ orderId }) => {
            // For RTO operations, we're typically in shipped view
            const shippedQueryInput = getOrdersQueryInput('shipped', page, undefined);
            await trpcUtils.orders.list.cancel(shippedQueryInput);
            const previousData = trpcUtils.orders.list.getData(shippedQueryInput);

            trpcUtils.orders.list.setData(
                shippedQueryInput,
                (old: any) => optimisticMarkRto(old, orderId, new Date().toISOString()) as any
            );

            return { previousData, queryInput: shippedQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            alert(err.message || 'Failed to mark as RTO');
        },
        onSettled: () => {
            invalidateShippedOrders();
            invalidateRtoOrders();
        }
    });

    const markRto = {
        mutate: (id: string) => markRtoMutation.mutate({ orderId: id }),
        mutateAsync: (id: string) => markRtoMutation.mutateAsync({ orderId: id }),
        isPending: markRtoMutation.isPending,
        isError: markRtoMutation.isError,
        error: markRtoMutation.error,
    };

    // Receive RTO with optimistic update (restores inventory)
    const receiveRtoMutation = trpc.orders.receiveRto.useMutation({
        onMutate: async ({ orderId }) => {
            // For receive RTO, we're typically in RTO view
            const rtoQueryInput = getOrdersQueryInput('rto', page, undefined);
            await trpcUtils.orders.list.cancel(rtoQueryInput);
            const previousData = trpcUtils.orders.list.getData(rtoQueryInput);

            trpcUtils.orders.list.setData(
                rtoQueryInput,
                (old: any) => optimisticReceiveRto(old, orderId) as any
            );

            return { previousData, queryInput: rtoQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            alert(err.message || 'Failed to receive RTO');
        },
        onSettled: () => {
            invalidateRtoOrders();
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        }
    });

    const receiveRto = {
        mutate: (id: string) => receiveRtoMutation.mutate({ orderId: id }),
        mutateAsync: (id: string) => receiveRtoMutation.mutateAsync({ orderId: id }),
        isPending: receiveRtoMutation.isPending,
        isError: receiveRtoMutation.isError,
        error: receiveRtoMutation.error,
    };

    return {
        markDelivered,
        markRto,
        receiveRto,
    };
}
