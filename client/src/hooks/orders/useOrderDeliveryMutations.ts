/**
 * Order delivery tracking mutations with optimistic updates
 * Handles marking orders/lines as delivered, RTO, and receiving RTO
 *
 * Line-level mutations (preferred) - Server Functions:
 * - markLineDelivered: Mark single line as delivered
 * - markLineRto: Initiate RTO for single line
 * - receiveLineRto: Receive RTO for single line
 *
 * Order-level mutations (backward compat) - Server Functions:
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
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation, getOrdersListQueryKey, cancelOrderViewQueries } from './orderMutationUtils';
import { showError } from '../../utils/toast';
import {
    // Line-level mutations
    markLineDelivered as markLineDeliveredFn,
    markLineRto as markLineRtoFn,
    receiveLineRto as receiveLineRtoFn,
    // Order-level mutations
    markDelivered as markDeliveredFn,
    markRto as markRtoFn,
    receiveRto as receiveRtoFn,
} from '../../server/functions/orderMutations';
import {
    getOrdersQueryInput,
    optimisticMarkDelivered,
    optimisticMarkRto,
    optimisticReceiveRto,
    type OptimisticUpdateContext,
    type OrdersListData,
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

// Input types for order-level mutations
interface MarkDeliveredInput {
    orderId: string;
}

interface MarkRtoInput {
    orderId: string;
}

interface ReceiveRtoInput {
    orderId: string;
    condition?: 'good' | 'damaged' | 'missing';
    notes?: string;
}

export function useOrderDeliveryMutations(options: UseOrderDeliveryMutationsOptions = {}) {
    const { page = 1 } = options;
    const queryClient = useQueryClient();
    const { invalidateOpenOrders, invalidateShippedOrders, invalidateRtoOrders, invalidateCodPendingOrders } = useOrderInvalidation();

    // Server Function wrappers - line-level
    const markLineDeliveredServerFn = useServerFn(markLineDeliveredFn);
    const markLineRtoServerFn = useServerFn(markLineRtoFn);
    const receiveLineRtoServerFn = useServerFn(receiveLineRtoFn);

    // Server Function wrappers - order-level
    const markDeliveredServerFn = useServerFn(markDeliveredFn);
    const markRtoServerFn = useServerFn(markRtoFn);
    const receiveRtoServerFn = useServerFn(receiveRtoFn);

    // ============================================
    // ORDER-LEVEL MUTATIONS (backward compat) - Server Functions
    // ============================================

    // Mark delivered with optimistic update (order-level - backward compat)
    const markDeliveredMutation = useMutation({
        mutationFn: async (input: MarkDeliveredInput) => {
            const result = await markDeliveredServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to mark as delivered');
            }
            return result.data;
        },
        onMutate: async ({ orderId }) => {
            // For delivery operations, we're typically in shipped view
            const shippedQueryInput = getOrdersQueryInput('shipped', page);
            const queryKey = getOrdersListQueryKey(shippedQueryInput);

            await queryClient.cancelQueries({ queryKey });
            const previousData = queryClient.getQueryData<OrdersListData>(queryKey);

            queryClient.setQueryData<OrdersListData>(
                queryKey,
                (old) => optimisticMarkDelivered(old, orderId, new Date().toISOString()) as OrdersListData | undefined
            );

            return { previousData, queryInput: shippedQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                const queryKey = getOrdersListQueryKey(context.queryInput);
                queryClient.setQueryData(queryKey, context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateShippedOrders();
            invalidateCodPendingOrders();
            showError('Failed to mark as delivered', { description: err instanceof Error ? err.message : String(err) });
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

    // Mark RTO with optimistic update (order-level - backward compat)
    const markRtoMutation = useMutation({
        mutationFn: async (input: MarkRtoInput) => {
            const result = await markRtoServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to mark as RTO');
            }
            return result.data;
        },
        onMutate: async ({ orderId }) => {
            // For RTO operations, we're typically in shipped view
            const shippedQueryInput = getOrdersQueryInput('shipped', page);
            const queryKey = getOrdersListQueryKey(shippedQueryInput);

            await queryClient.cancelQueries({ queryKey });
            const previousData = queryClient.getQueryData<OrdersListData>(queryKey);

            queryClient.setQueryData<OrdersListData>(
                queryKey,
                (old) => optimisticMarkRto(old, orderId, new Date().toISOString()) as OrdersListData | undefined
            );

            return { previousData, queryInput: shippedQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                const queryKey = getOrdersListQueryKey(context.queryInput);
                queryClient.setQueryData(queryKey, context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateShippedOrders();
            invalidateRtoOrders();
            showError('Failed to mark as RTO', { description: err instanceof Error ? err.message : String(err) });
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

    // Receive RTO with optimistic update (order-level - backward compat)
    const receiveRtoMutation = useMutation({
        mutationFn: async (input: ReceiveRtoInput) => {
            const result = await receiveRtoServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to receive RTO');
            }
            return result.data;
        },
        onMutate: async ({ orderId }) => {
            // For receive RTO, we're typically in RTO view
            const rtoQueryInput = getOrdersQueryInput('rto', page);
            const queryKey = getOrdersListQueryKey(rtoQueryInput);

            await queryClient.cancelQueries({ queryKey });
            const previousData = queryClient.getQueryData<OrdersListData>(queryKey);

            queryClient.setQueryData<OrdersListData>(
                queryKey,
                (old) => optimisticReceiveRto(old, orderId) as OrdersListData | undefined
            );

            return { previousData, queryInput: rtoQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                const queryKey = getOrdersListQueryKey(context.queryInput);
                queryClient.setQueryData(queryKey, context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateRtoOrders();
            invalidateOpenOrders();
            showError('Failed to receive RTO', { description: err instanceof Error ? err.message : String(err) });
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
            const shippedQueryInput = getOrdersQueryInput('shipped', page);
            const queryKey = getOrdersListQueryKey(shippedQueryInput);

            // Cancel only shipped view queries, not all order queries
            await cancelOrderViewQueries(queryClient, 'shipped');
            const previousData = queryClient.getQueryData<OrdersListData>(queryKey);

            // Update the specific line in the cache
            queryClient.setQueryData<OrdersListData>(queryKey, (old) => {
                if (!old?.rows) return old;
                return {
                    ...old,
                    rows: old.rows.map((row) =>
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
                const queryKey = getOrdersListQueryKey(context.queryInput);
                queryClient.setQueryData(queryKey, context.previousData);
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
            const shippedQueryInput = getOrdersQueryInput('shipped', page);
            const queryKey = getOrdersListQueryKey(shippedQueryInput);

            // Cancel only shipped view queries, not all order queries
            await cancelOrderViewQueries(queryClient, 'shipped');
            const previousData = queryClient.getQueryData<OrdersListData>(queryKey);

            queryClient.setQueryData<OrdersListData>(queryKey, (old) => {
                if (!old?.rows) return old;
                return {
                    ...old,
                    rows: old.rows.map((row) =>
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
                const queryKey = getOrdersListQueryKey(context.queryInput);
                queryClient.setQueryData(queryKey, context.previousData);
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
            const rtoQueryInput = getOrdersQueryInput('rto', page);
            const queryKey = getOrdersListQueryKey(rtoQueryInput);

            // Cancel only RTO view queries, not all order queries
            await cancelOrderViewQueries(queryClient, 'rto');
            const previousData = queryClient.getQueryData<OrdersListData>(queryKey);

            queryClient.setQueryData<OrdersListData>(queryKey, (old) => {
                if (!old?.rows) return old;
                return {
                    ...old,
                    rows: old.rows.map((row) =>
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
                const queryKey = getOrdersListQueryKey(context.queryInput);
                queryClient.setQueryData(queryKey, context.previousData);
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
