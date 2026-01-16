/**
 * Order status mutations
 * Handles cancelling and uncancelling orders and lines
 */

import { useMutation } from '@tanstack/react-query';
import { ordersApi } from '../../services/api';
import { trpc } from '../../services/trpc';
import { useOrderInvalidation } from './orderMutationUtils';

export function useOrderStatusMutations() {
    const { invalidateOpenOrders, invalidateCancelledOrders } = useOrderInvalidation();

    // Cancel/uncancel using tRPC
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

    const cancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.cancelLine(lineId),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to cancel line');
        }
    });

    const uncancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.uncancelLine(lineId),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to restore line');
        }
    });

    return {
        cancelOrder,
        uncancelOrder,
        cancelLine,
        uncancelLine,
    };
}
