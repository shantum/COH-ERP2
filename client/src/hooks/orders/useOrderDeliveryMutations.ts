/**
 * Order delivery tracking mutations
 * Handles marking orders as delivered, RTO, and receiving RTO
 */

import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../services/trpc';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation } from './orderMutationUtils';

export function useOrderDeliveryMutations() {
    const queryClient = useQueryClient();
    const { invalidateOpenOrders, invalidateShippedOrders, invalidateRtoOrders, invalidateCodPendingOrders } = useOrderInvalidation();

    const markDeliveredMutation = trpc.orders.markDelivered.useMutation({
        onSuccess: () => {
            invalidateShippedOrders();
            invalidateCodPendingOrders();
        },
        onError: (err) => alert(err.message || 'Failed to mark as delivered')
    });

    const markDelivered = {
        mutate: (id: string) => markDeliveredMutation.mutate({ orderId: id }),
        mutateAsync: (id: string) => markDeliveredMutation.mutateAsync({ orderId: id }),
        isPending: markDeliveredMutation.isPending,
        isError: markDeliveredMutation.isError,
        error: markDeliveredMutation.error,
    };

    const markRtoMutation = trpc.orders.markRto.useMutation({
        onSuccess: () => {
            invalidateShippedOrders();
            invalidateRtoOrders();
        },
        onError: (err) => alert(err.message || 'Failed to mark as RTO')
    });

    const markRto = {
        mutate: (id: string) => markRtoMutation.mutate({ orderId: id }),
        mutateAsync: (id: string) => markRtoMutation.mutateAsync({ orderId: id }),
        isPending: markRtoMutation.isPending,
        isError: markRtoMutation.isError,
        error: markRtoMutation.error,
    };

    const receiveRtoMutation = trpc.orders.receiveRto.useMutation({
        onSuccess: () => {
            invalidateRtoOrders();
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
        onError: (err) => alert(err.message || 'Failed to receive RTO')
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
