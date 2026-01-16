/**
 * Order delivery tracking mutations with optimistic updates
 * Handles marking orders/lines as delivered, RTO, and receiving RTO
 *
 * Line-level mutations (preferred):
 * - markLineDelivered: Mark single line as delivered
 * - markLineRto: Initiate RTO for single line
 * - receiveLineRto: Receive RTO for single line
 *
 * Order-level mutations (backward compat):
 * - markDelivered: Mark all shipped lines as delivered
 * - markRto: Initiate RTO for all shipped lines
 * - receiveRto: Receive RTO for all RTO-initiated lines
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save previous data, update cache optimistically
 * 2. onError: Rollback to previous data + invalidate for consistency
 * 3. onSettled: Invalidate caches to confirm server state
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

export interface MarkLineDeliveredInput {
    lineId: string;
    deliveredAt?: string;
}

export interface MarkLineRtoInput {
    lineId: string;
}

export interface ReceiveLineRtoInput {
    lineId: string;
    condition?: 'good' | 'damaged' | 'missing';
    notes?: string;
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
            // Invalidate after rollback to ensure consistency
            invalidateShippedOrders();
            invalidateCodPendingOrders();
            alert(err.message || 'Failed to mark as delivered');
        },
        onSettled: () => {
            // No invalidation needed - optimistic update + SSE handles it
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
            // Invalidate after rollback to ensure consistency
            invalidateShippedOrders();
            invalidateRtoOrders();
            alert(err.message || 'Failed to mark as RTO');
        },
        onSettled: () => {
            // No invalidation needed - optimistic update + SSE handles it
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
            // Invalidate after rollback to ensure consistency
            invalidateRtoOrders();
            invalidateOpenOrders();
            alert(err.message || 'Failed to receive RTO');
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance for RTO restore)
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

    // ============================================
    // LINE-LEVEL MUTATIONS (PREFERRED)
    // ============================================

    // Mark single line as delivered
    const markLineDeliveredMutation = trpc.orders.markLineDelivered.useMutation({
        onMutate: async ({ lineId }) => {
            // For line delivery, update shipped view optimistically
            const shippedQueryInput = getOrdersQueryInput('shipped', page, undefined);
            await trpcUtils.orders.list.cancel(shippedQueryInput);
            const previousData = trpcUtils.orders.list.getData(shippedQueryInput);

            // Update the specific line in the cache
            trpcUtils.orders.list.setData(shippedQueryInput, (old: any) => {
                if (!old?.rows) return old;
                return {
                    ...old,
                    rows: old.rows.map((row: any) =>
                        row.lineId === lineId
                            ? { ...row, deliveredAt: new Date().toISOString(), trackingStatus: 'delivered' }
                            : row
                    ),
                };
            });

            return { previousData, queryInput: shippedQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            invalidateShippedOrders();
            invalidateCodPendingOrders();
            alert(err.message || 'Failed to mark line as delivered');
        },
        onSettled: () => {
            // SSE handles real-time updates
        },
    });

    const markLineDelivered = {
        mutate: (input: MarkLineDeliveredInput) => markLineDeliveredMutation.mutate(input),
        mutateAsync: (input: MarkLineDeliveredInput) => markLineDeliveredMutation.mutateAsync(input),
        isPending: markLineDeliveredMutation.isPending,
        isError: markLineDeliveredMutation.isError,
        error: markLineDeliveredMutation.error,
    };

    // Initiate RTO for single line
    const markLineRtoMutation = trpc.orders.markLineRto.useMutation({
        onMutate: async ({ lineId }) => {
            const shippedQueryInput = getOrdersQueryInput('shipped', page, undefined);
            await trpcUtils.orders.list.cancel(shippedQueryInput);
            const previousData = trpcUtils.orders.list.getData(shippedQueryInput);

            trpcUtils.orders.list.setData(shippedQueryInput, (old: any) => {
                if (!old?.rows) return old;
                return {
                    ...old,
                    rows: old.rows.map((row: any) =>
                        row.lineId === lineId
                            ? { ...row, rtoInitiatedAt: new Date().toISOString(), trackingStatus: 'rto_initiated' }
                            : row
                    ),
                };
            });

            return { previousData, queryInput: shippedQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            invalidateShippedOrders();
            invalidateRtoOrders();
            alert(err.message || 'Failed to initiate RTO for line');
        },
        onSettled: () => {
            // SSE handles real-time updates
        },
    });

    const markLineRto = {
        mutate: (input: MarkLineRtoInput) => markLineRtoMutation.mutate(input),
        mutateAsync: (input: MarkLineRtoInput) => markLineRtoMutation.mutateAsync(input),
        isPending: markLineRtoMutation.isPending,
        isError: markLineRtoMutation.isError,
        error: markLineRtoMutation.error,
    };

    // Receive RTO for single line
    const receiveLineRtoMutation = trpc.orders.receiveLineRto.useMutation({
        onMutate: async ({ lineId, condition }) => {
            const rtoQueryInput = getOrdersQueryInput('rto', page, undefined);
            await trpcUtils.orders.list.cancel(rtoQueryInput);
            const previousData = trpcUtils.orders.list.getData(rtoQueryInput);

            trpcUtils.orders.list.setData(rtoQueryInput, (old: any) => {
                if (!old?.rows) return old;
                return {
                    ...old,
                    rows: old.rows.map((row: any) =>
                        row.lineId === lineId
                            ? {
                                  ...row,
                                  rtoReceivedAt: new Date().toISOString(),
                                  rtoCondition: condition || 'good',
                                  trackingStatus: 'rto_delivered',
                              }
                            : row
                    ),
                };
            });

            return { previousData, queryInput: rtoQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            invalidateRtoOrders();
            invalidateOpenOrders();
            alert(err.message || 'Failed to receive RTO for line');
        },
        onSettled: () => {
            // Invalidate inventory balance since RTO restores stock
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
    });

    const receiveLineRto = {
        mutate: (input: ReceiveLineRtoInput) => receiveLineRtoMutation.mutate(input),
        mutateAsync: (input: ReceiveLineRtoInput) => receiveLineRtoMutation.mutateAsync(input),
        isPending: receiveLineRtoMutation.isPending,
        isError: receiveLineRtoMutation.isError,
        error: receiveLineRtoMutation.error,
    };

    return {
        // Order-level mutations (backward compat)
        markDelivered,
        markRto,
        receiveRto,
        // Line-level mutations (preferred)
        markLineDelivered,
        markLineRto,
        receiveLineRto,
    };
}
