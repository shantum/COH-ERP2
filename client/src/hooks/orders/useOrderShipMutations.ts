/**
 * Order ship mutations with optimistic updates
 * Handles shipping orders and line-level shipping operations
 * Uses tRPC for all operations
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save previous data, update cache optimistically
 * 2. onError: Rollback to previous data + invalidate for consistency
 * 3. onSettled: Invalidate caches to confirm server state + trigger callbacks
 */

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../services/trpc';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation } from './orderMutationUtils';
import {
    getOrdersQueryInput,
    optimisticShipOrder,
    optimisticShipLines,
    optimisticUnshipOrder,
    optimisticUpdateLineTracking,
    optimisticLineStatusUpdate,
    type OrdersListData,
    type OptimisticUpdateContext,
} from './optimisticUpdateHelpers';

export interface UseOrderShipMutationsOptions {
    onShipSuccess?: () => void;
    currentView?: string;
    page?: number;
    shippedFilter?: 'rto' | 'cod_pending';
}

export function useOrderShipMutations(options: UseOrderShipMutationsOptions = {}) {
    const { currentView = 'open', page = 1, shippedFilter, onShipSuccess } = options;
    const queryClient = useQueryClient();
    const trpcUtils = trpc.useUtils();
    const { invalidateOpenOrders, invalidateShippedOrders } = useOrderInvalidation();

    // Build query input for cache operations
    const queryInput = getOrdersQueryInput(currentView, page, shippedFilter);

    // Helper to get current cache data
    const getCachedData = (): OrdersListData | undefined => {
        return trpcUtils.orders.list.getData(queryInput);
    };

    // Ship entire order with optimistic update (tRPC)
    const shipOrderMutation = trpc.orders.shipOrder.useMutation({
        onMutate: async ({ orderId, awbNumber, courier }) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            // Optimistically update all lines to shipped
            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticShipOrder(old, orderId, {
                    lineStatus: 'shipped',
                    awbNumber,
                    courier,
                    shippedAt: new Date().toISOString(),
                }) as any
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
            invalidateShippedOrders();

            const errorMsg = err.message || '';
            if (errorMsg.includes('validation')) {
                alert(`Validation failed:\n${errorMsg}`);
            } else {
                alert(errorMsg || 'Failed to ship order');
            }
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
            onShipSuccess?.();
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const ship = useMemo(() => ({
        mutate: ({ id, data }: { id: string; data: { awbNumber: string; courier: string } }) =>
            shipOrderMutation.mutate({ orderId: id, awbNumber: data.awbNumber, courier: data.courier }),
        mutateAsync: ({ id, data }: { id: string; data: { awbNumber: string; courier: string } }) =>
            shipOrderMutation.mutateAsync({ orderId: id, awbNumber: data.awbNumber, courier: data.courier }),
        isPending: shipOrderMutation.isPending,
        isError: shipOrderMutation.isError,
        error: shipOrderMutation.error,
    }), [shipOrderMutation.isPending, shipOrderMutation.isError, shipOrderMutation.error]);

    // Ship specific lines with optimistic update (already tRPC)
    const shipLines = trpc.orders.ship.useMutation({
        onMutate: async ({ lineIds, awbNumber, courier }) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            // Ship the specified lines
            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticShipLines(old, lineIds, {
                    lineStatus: 'shipped',
                    awbNumber,
                    courier,
                    shippedAt: new Date().toISOString(),
                }) as any
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();

            const errorMsg = err.message || '';
            if (errorMsg.includes('not packed')) {
                alert(`Cannot ship: Some lines are not packed yet`);
            } else if (errorMsg.includes('validation')) {
                alert(`Validation failed: ${errorMsg}`);
            } else {
                alert(errorMsg || 'Failed to ship lines');
            }
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
            onShipSuccess?.();
        }
    });

    // Admin ship with optimistic update (already tRPC)
    const adminShip = trpc.orders.adminShip.useMutation({
        onMutate: async ({ lineIds, awbNumber, courier }) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            // Ship the specified lines (provide defaults for optional fields)
            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticShipLines(old, lineIds, {
                    lineStatus: 'shipped',
                    awbNumber: awbNumber || 'ADMIN-MANUAL',
                    courier: courier || 'Manual',
                    shippedAt: new Date().toISOString(),
                }) as any
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            alert(err.message || 'Failed to admin ship order');
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
            onShipSuccess?.();
        }
    });

    // Unship order with optimistic update (tRPC)
    const unshipMutation = trpc.orders.unship.useMutation({
        onMutate: async ({ orderId }) => {
            // For unship, we may be in shipped view
            const shippedQueryInput = getOrdersQueryInput('shipped', page, undefined);
            await trpcUtils.orders.list.cancel(shippedQueryInput);
            const previousData = trpcUtils.orders.list.getData(shippedQueryInput);

            trpcUtils.orders.list.setData(
                shippedQueryInput,
                (old: any) => optimisticUnshipOrder(old, orderId) as any
            );

            return { previousData, queryInput: shippedQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            alert(err.message || 'Failed to unship order');
        },
        onSettled: () => {
            // No invalidation needed - optimistic update + SSE handles it
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const unship = useMemo(() => ({
        mutate: (id: string) => unshipMutation.mutate({ orderId: id }),
        mutateAsync: (id: string) => unshipMutation.mutateAsync({ orderId: id }),
        isPending: unshipMutation.isPending,
        isError: unshipMutation.isError,
        error: unshipMutation.error,
    }), [unshipMutation.isPending, unshipMutation.isError, unshipMutation.error]);

    // Mark single line as shipped with optimistic update (tRPC - uses setLineStatus)
    const markShippedLineMutation = trpc.orders.setLineStatus.useMutation({
        onMutate: async ({ lineId, status, awbNumber, courier }) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            // Update line status to shipped
            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => {
                    if (!old) return old;

                    return {
                        ...old,
                        rows: old.rows.map((row: any) => {
                            if (row.lineId !== lineId) return row;
                            return {
                                ...row,
                                lineStatus: status,
                                ...(awbNumber && { awbNumber }),
                                ...(courier && { courier }),
                                lineShippedAt: status === 'shipped' ? new Date().toISOString() : null,
                            };
                        }),
                        orders: old.orders.map((order: any) => ({
                            ...order,
                            orderLines: order.orderLines?.map((line: any) =>
                                line.id === lineId
                                    ? {
                                        ...line,
                                        lineStatus: status,
                                        ...(awbNumber && { awbNumber }),
                                        ...(courier && { courier }),
                                        shippedAt: status === 'shipped' ? new Date().toISOString() : null,
                                    }
                                    : line
                            ),
                        })),
                    };
                }
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            alert(err.message || 'Failed to update line status');
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const markShippedLine = useMemo(() => ({
        mutate: ({ lineId, data }: { lineId: string; data?: { awbNumber?: string; courier?: string } }) =>
            markShippedLineMutation.mutate({ lineId, status: 'shipped', awbNumber: data?.awbNumber, courier: data?.courier }),
        mutateAsync: ({ lineId, data }: { lineId: string; data?: { awbNumber?: string; courier?: string } }) =>
            markShippedLineMutation.mutateAsync({ lineId, status: 'shipped', awbNumber: data?.awbNumber, courier: data?.courier }),
        isPending: markShippedLineMutation.isPending,
        isError: markShippedLineMutation.isError,
        error: markShippedLineMutation.error,
    }), [markShippedLineMutation.isPending, markShippedLineMutation.isError, markShippedLineMutation.error]);

    // Unmark shipped line with optimistic update (tRPC - uses setLineStatus)
    const unmarkShippedLineMutation = trpc.orders.setLineStatus.useMutation({
        onMutate: async ({ lineId }) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticLineStatusUpdate(old, lineId, 'packed') as any
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            alert(err.message || 'Failed to unship line');
        },
        onSettled: () => {
            // No invalidation needed - optimistic update + SSE handles it
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const unmarkShippedLine = useMemo(() => ({
        mutate: (lineId: string) => unmarkShippedLineMutation.mutate({ lineId, status: 'packed' }),
        mutateAsync: (lineId: string) => unmarkShippedLineMutation.mutateAsync({ lineId, status: 'packed' }),
        isPending: unmarkShippedLineMutation.isPending,
        isError: unmarkShippedLineMutation.isError,
        error: unmarkShippedLineMutation.error,
    }), [unmarkShippedLineMutation.isPending, unmarkShippedLineMutation.isError, unmarkShippedLineMutation.error]);

    // Update line tracking with optimistic update (tRPC)
    const updateLineTrackingMutation = trpc.orders.updateLine.useMutation({
        onMutate: async ({ lineId, awbNumber, courier }) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticUpdateLineTracking(old, lineId, { awbNumber, courier }) as any
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            console.error('Tracking update failed:', err.message);
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const updateLineTracking = useMemo(() => ({
        mutate: ({ lineId, data }: { lineId: string; data: { awbNumber?: string; courier?: string } }) =>
            updateLineTrackingMutation.mutate({ lineId, ...data }),
        mutateAsync: ({ lineId, data }: { lineId: string; data: { awbNumber?: string; courier?: string } }) =>
            updateLineTrackingMutation.mutateAsync({ lineId, ...data }),
        isPending: updateLineTrackingMutation.isPending,
        isError: updateLineTrackingMutation.isError,
        error: updateLineTrackingMutation.error,
    }), [updateLineTrackingMutation.isPending, updateLineTrackingMutation.isError, updateLineTrackingMutation.error]);

    return {
        ship,
        shipLines,
        adminShip,
        unship,
        markShippedLine,
        unmarkShippedLine,
        updateLineTracking,
    };
}
