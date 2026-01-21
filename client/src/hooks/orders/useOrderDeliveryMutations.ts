/**
 * Order delivery tracking mutations with optimistic updates
 * Handles marking orders/lines as delivered, RTO, and receiving RTO
 *
 * Line-level mutations (preferred) - Server Functions:
 * - markLineDelivered: Mark single line as delivered
 * - markLineRto: Initiate RTO for single line
 * - receiveLineRto: Receive RTO for single line
 *
 * Order-level mutations (backward compat) - tRPC only:
 * - markDelivered: Mark all shipped lines as delivered
 * - markRto: Initiate RTO for all shipped lines
 * - receiveRto: Receive RTO for all RTO-initiated lines
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save previous data, update cache optimistically
 * 2. onError: Rollback to previous data + invalidate for consistency
 * 3. onSettled: Invalidate caches to confirm server state
 */

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { trpc } from '../../services/trpc';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation } from './orderMutationUtils';
import { showError } from '../../utils/toast';
import {
    markLineDelivered as markLineDeliveredFn,
    markLineRto as markLineRtoFn,
    receiveLineRto as receiveLineRtoFn,
} from '../../server/functions/orderMutations';
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

    // Server Function wrappers
    const markLineDeliveredServerFn = useServerFn(markLineDeliveredFn);
    const markLineRtoServerFn = useServerFn(markLineRtoFn);
    const receiveLineRtoServerFn = useServerFn(receiveLineRtoFn);

    // ============================================
    // ORDER-LEVEL MUTATIONS (backward compat, tRPC only)
    // ============================================

    // Mark delivered with optimistic update (order-level - backward compat, always tRPC)
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
            showError('Failed to mark as delivered', { description: err.message });
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

    // Mark RTO with optimistic update (order-level - backward compat, always tRPC)
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
            showError('Failed to mark as RTO', { description: err.message });
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

    // Receive RTO with optimistic update (order-level - backward compat, always tRPC)
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
            showError('Failed to receive RTO', { description: err.message });
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
    // LINE-LEVEL MUTATIONS (PREFERRED) - Server Functions
    // ============================================

    // Mark single line as delivered - Server Function
    const markLineDeliveredMutation = useMutation({
        mutationFn: async (input: MarkLineDeliveredInput) => {
            const result = await markLineDeliveredServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to mark line as delivered');
            }
            return result.data;
        },
        onMutate: async ({ lineId }) => {
            // For line delivery, update shipped view optimistically
            const shippedQueryInput = getOrdersQueryInput('shipped', page, undefined);
            await queryClient.cancelQueries({ queryKey: ['orders'] });
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
            showError('Failed to mark line as delivered', { description: err instanceof Error ? err.message : String(err) });
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

    // Initiate RTO for single line - Server Function
    const markLineRtoMutation = useMutation({
        mutationFn: async (input: MarkLineRtoInput) => {
            const result = await markLineRtoServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to initiate RTO for line');
            }
            return result.data;
        },
        onMutate: async ({ lineId }) => {
            const shippedQueryInput = getOrdersQueryInput('shipped', page, undefined);
            await queryClient.cancelQueries({ queryKey: ['orders'] });
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
            showError('Failed to initiate RTO for line', { description: err instanceof Error ? err.message : String(err) });
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

    // Receive RTO for single line - Server Function
    const receiveLineRtoMutation = useMutation({
        mutationFn: async (input: ReceiveLineRtoInput) => {
            const result = await receiveLineRtoServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to receive RTO for line');
            }
            return result.data;
        },
        onMutate: async ({ lineId, condition }) => {
            const rtoQueryInput = getOrdersQueryInput('rto', page, undefined);
            await queryClient.cancelQueries({ queryKey: ['orders'] });
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
            showError('Failed to receive RTO for line', { description: err instanceof Error ? err.message : String(err) });
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
