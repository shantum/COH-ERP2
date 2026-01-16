/**
 * Order ship mutations with optimistic updates
 * Handles shipping orders and line-level shipping operations
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save previous data, update cache optimistically
 * 2. onError: Rollback to previous data + invalidate for consistency
 * 3. onSettled: Invalidate caches to confirm server state + trigger callbacks
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '../../services/api';
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

    // Ship entire order with optimistic update
    const ship = useMutation({
        mutationFn: ({ id, data }: { id: string; data: { awbNumber: string; courier: string } }) =>
            ordersApi.ship(id, data),
        onMutate: async ({ id, data }) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            // Optimistically update all lines to shipped
            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticShipOrder(old, id, {
                    lineStatus: 'shipped',
                    awbNumber: data.awbNumber,
                    courier: data.courier,
                    shippedAt: new Date().toISOString(),
                }) as any
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err: any, _vars, context) => {
            // Rollback on error
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();

            const errorData = err.response?.data;
            if (errorData?.details && Array.isArray(errorData.details)) {
                const messages = errorData.details.map((d: any) => d.message).join('\n');
                alert(`Validation failed:\n${messages}`);
            } else {
                alert(errorData?.error || 'Failed to ship order');
            }
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
            onShipSuccess?.();
        }
    });

    // Ship specific lines with optimistic update
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

    // Force ship with optimistic update
    const forceShip = useMutation({
        mutationFn: ({ id, data }: { id: string; data: { awbNumber: string; courier: string } }) =>
            ordersApi.forceShip(id, data),
        onMutate: async ({ id, data }) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticShipOrder(old, id, {
                    lineStatus: 'shipped',
                    awbNumber: data.awbNumber,
                    courier: data.courier,
                    shippedAt: new Date().toISOString(),
                }) as any
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err: any, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            alert(err.response?.data?.error || 'Failed to force ship order');
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
            onShipSuccess?.();
        }
    });

    // Unship order with optimistic update
    const unship = useMutation({
        mutationFn: (id: string) => ordersApi.unship(id),
        onMutate: async (id) => {
            // For unship, we may be in shipped view
            const shippedQueryInput = getOrdersQueryInput('shipped', page, undefined);
            await trpcUtils.orders.list.cancel(shippedQueryInput);
            const previousData = trpcUtils.orders.list.getData(shippedQueryInput);

            trpcUtils.orders.list.setData(
                shippedQueryInput,
                (old: any) => optimisticUnshipOrder(old, id) as any
            );

            return { previousData, queryInput: shippedQueryInput } as OptimisticUpdateContext;
        },
        onError: (err: any, _id, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            alert(err.response?.data?.error || 'Failed to unship order');
        },
        onSettled: () => {
            // No invalidation needed - optimistic update + SSE handles it
        }
    });

    // Mark single line as shipped with optimistic update
    const markShippedLine = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data?: { awbNumber?: string; courier?: string } }) =>
            ordersApi.setLineStatus(lineId, 'shipped', data),
        onMutate: async ({ lineId, data }) => {
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
                                lineStatus: 'shipped',
                                ...(data?.awbNumber && { awbNumber: data.awbNumber }),
                                ...(data?.courier && { courier: data.courier }),
                                lineShippedAt: new Date().toISOString(),
                            };
                        }),
                        orders: old.orders.map((order: any) => ({
                            ...order,
                            orderLines: order.orderLines?.map((line: any) =>
                                line.id === lineId
                                    ? {
                                        ...line,
                                        lineStatus: 'shipped',
                                        ...(data?.awbNumber && { awbNumber: data.awbNumber }),
                                        ...(data?.courier && { courier: data.courier }),
                                        shippedAt: new Date().toISOString(),
                                    }
                                    : line
                            ),
                        })),
                    };
                }
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err: any, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            alert(err.response?.data?.error || 'Failed to ship line');
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        }
    });

    // Unmark shipped line with optimistic update
    const unmarkShippedLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.setLineStatus(lineId, 'packed'),
        onMutate: async (lineId) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticLineStatusUpdate(old, lineId, 'packed') as any
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err: any, _lineId, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            alert(err.response?.data?.error || 'Failed to unship line');
        },
        onSettled: () => {
            // No invalidation needed - optimistic update + SSE handles it
        }
    });

    // Update line tracking with optimistic update
    const updateLineTracking = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data: { awbNumber?: string; courier?: string } }) =>
            ordersApi.updateLine(lineId, data),
        onMutate: async ({ lineId, data }) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticUpdateLineTracking(old, lineId, data) as any
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err: any, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            console.error('Tracking update failed:', err.response?.data?.error || err.message);
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        }
    });

    return {
        ship,
        shipLines,
        forceShip,
        unship,
        markShippedLine,
        unmarkShippedLine,
        updateLineTracking,
    };
}
