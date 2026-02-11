/**
 * Order status mutations — cancel/uncancel at order level
 *
 * Line-level cancel/uncancel removed (fulfillment managed in Google Sheets).
 * Optimistic updates removed — relies on invalidation + SSE for cache freshness.
 */

import { useMemo } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation } from './orderMutationUtils';
import { showError } from '../../utils/toast';
import {
    cancelOrder as cancelOrderFn,
    uncancelOrder as uncancelOrderFn,
} from '../../server/functions/orderMutations';

export interface UseOrderStatusMutationsOptions {
    currentView?: string;
    page?: number;
}

export function useOrderStatusMutations(_options: UseOrderStatusMutationsOptions = {}) {
    const queryClient = useQueryClient();
    const { invalidateOpenOrders, invalidateCancelledOrders } = useOrderInvalidation();

    const cancelOrderServerFn = useServerFn(cancelOrderFn);
    const uncancelOrderServerFn = useServerFn(uncancelOrderFn);

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
        onError: (err) => {
            showError('Failed to cancel order', { description: err instanceof Error ? err.message : String(err) });
        },
        onSettled: () => {
            invalidateOpenOrders();
            invalidateCancelledOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
    });

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
        onError: (err) => {
            showError('Failed to restore order', { description: err instanceof Error ? err.message : String(err) });
        },
        onSettled: () => {
            invalidateOpenOrders();
            invalidateCancelledOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
    });

    const uncancelOrder = useMemo(() => ({
        mutate: (id: string) => uncancelOrderMutation.mutate({ orderId: id }),
        mutateAsync: (id: string) => uncancelOrderMutation.mutateAsync({ orderId: id }),
        isPending: uncancelOrderMutation.isPending,
        isError: uncancelOrderMutation.isError,
        error: uncancelOrderMutation.error,
    }), [uncancelOrderMutation.isPending, uncancelOrderMutation.isError, uncancelOrderMutation.error]);

    return {
        cancelOrder,
        uncancelOrder,
    };
}
