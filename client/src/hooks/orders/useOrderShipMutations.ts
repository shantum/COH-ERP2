/**
 * Order ship mutations with optimistic updates
 * Handles shipping orders and line-level shipping operations
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save previous data, update cache optimistically
 * 2. onError: Rollback to previous data + invalidate for consistency
 * 3. onSettled: Invalidate caches to confirm server state + trigger callbacks
 *
 * Server Functions: ship, adminShip, unship, shipLines, markShippedLine, unmarkShippedLine, updateLineTracking
 */

import { useMemo } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation, getOrdersListQueryKey } from './orderMutationUtils';
import { showError } from '../../utils/toast';
import {
    shipOrder as shipOrderFn,
    adminShipOrder as adminShipOrderFn,
    unshipOrder as unshipOrderFn,
    shipLines as shipLinesFn,
    markShippedLine as markShippedLineFn,
    unmarkShippedLine as unmarkShippedLineFn,
    updateLineTracking as updateLineTrackingFn,
} from '../../server/functions/orderMutations';
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
}

export function useOrderShipMutations(options: UseOrderShipMutationsOptions = {}) {
    const { currentView = 'open', page = 1, onShipSuccess } = options;
    const queryClient = useQueryClient();
    const { invalidateOpenOrders, invalidateShippedOrders } = useOrderInvalidation();

    // Server Function wrappers
    const shipOrderServerFn = useServerFn(shipOrderFn);
    const adminShipOrderServerFn = useServerFn(adminShipOrderFn);
    const unshipOrderServerFn = useServerFn(unshipOrderFn);
    const shipLinesServerFn = useServerFn(shipLinesFn);
    const markShippedLineServerFn = useServerFn(markShippedLineFn);
    const unmarkShippedLineServerFn = useServerFn(unmarkShippedLineFn);
    const updateLineTrackingServerFn = useServerFn(updateLineTrackingFn);

    // Build query input for cache operations
    const queryInput = getOrdersQueryInput(currentView, page);

    // Helper to get current cache data
    const getCachedData = (): OrdersListData | undefined => {
        return queryClient.getQueryData(getOrdersListQueryKey(queryInput));
    };

    // Helper to set cache data with updater function
    const setCachedData = (
        input: { view: string; page?: number; limit?: number },
        updater: (old: OrdersListData | undefined) => OrdersListData | undefined
    ) => {
        queryClient.setQueryData(getOrdersListQueryKey(input), updater);
    };

    // ============================================
    // SHIP ORDER - Server Function
    // ============================================
    const shipOrderMutation = useMutation({
        mutationFn: async (input: { orderId: string; awbNumber: string; courier: string; lineIds?: string[] }) => {
            const result = await shipOrderServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to ship order');
            }
            return result.data;
        },
        onMutate: async ({ orderId, awbNumber, courier }) => {
            await queryClient.cancelQueries({ queryKey: ['orders'] });
            const previousData = getCachedData();

            // Optimistically update all lines to shipped
            setCachedData(
                queryInput,
                (old) => optimisticShipOrder(old, orderId, {
                    lineStatus: 'shipped',
                    awbNumber,
                    courier,
                    shippedAt: new Date().toISOString(),
                })
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            // Rollback on error
            if (context?.previousData) {
                setCachedData(context.queryInput, () => context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();

            const errorMsg = err instanceof Error ? err.message : String(err);
            if (errorMsg.includes('validation')) {
                showError('Validation failed', { description: errorMsg });
            } else {
                showError('Failed to ship order', { description: errorMsg });
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

    // ============================================
    // SHIP LINES - Server Function
    // ============================================
    const shipLinesMutation = useMutation({
        mutationFn: async (input: { lineIds: string[]; awbNumber: string; courier: string }) => {
            const result = await shipLinesServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to ship lines');
            }
            return result.data;
        },
        onMutate: async ({ lineIds, awbNumber, courier }) => {
            await queryClient.cancelQueries({ queryKey: ['orders'] });
            const previousData = getCachedData();

            // Ship the specified lines
            setCachedData(
                queryInput,
                (old) => optimisticShipLines(old, lineIds, {
                    lineStatus: 'shipped',
                    awbNumber,
                    courier,
                    shippedAt: new Date().toISOString(),
                })
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                setCachedData(context.queryInput, () => context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();

            const errorMsg = err instanceof Error ? err.message : String(err);
            if (errorMsg.includes('not packed')) {
                showError('Cannot ship', { description: 'Some lines are not packed yet' });
            } else if (errorMsg.includes('validation')) {
                showError('Validation failed', { description: errorMsg });
            } else {
                showError('Failed to ship lines', { description: errorMsg });
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
    const shipLines = useMemo(() => ({
        mutate: (input: { lineIds: string[]; awbNumber: string; courier: string }) =>
            shipLinesMutation.mutate(input),
        mutateAsync: (input: { lineIds: string[]; awbNumber: string; courier: string }) =>
            shipLinesMutation.mutateAsync(input),
        isPending: shipLinesMutation.isPending,
        isError: shipLinesMutation.isError,
        error: shipLinesMutation.error,
    }), [shipLinesMutation.isPending, shipLinesMutation.isError, shipLinesMutation.error]);

    // ============================================
    // ADMIN SHIP - Server Function
    // ============================================
    const adminShip = useMutation({
        mutationFn: async (input: { lineIds: string[]; awbNumber?: string; courier?: string }) => {
            // Server Function expects orderId, get it from first line
            const cachedData = getCachedData();
            const firstLineRow = cachedData?.rows.find((r: any) => r.lineId === input.lineIds[0]);
            if (!firstLineRow?.orderId) {
                throw new Error('Could not determine order ID for admin ship');
            }
            const result = await adminShipOrderServerFn({ data: { orderId: firstLineRow.orderId, awbNumber: input.awbNumber, courier: input.courier } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to admin ship order');
            }
            return result.data;
        },
        onMutate: async ({ lineIds, awbNumber, courier }) => {
            await queryClient.cancelQueries({ queryKey: ['orders'] });
            const previousData = getCachedData();

            // Ship the specified lines (provide defaults for optional fields)
            setCachedData(
                queryInput,
                (old) => optimisticShipLines(old, lineIds, {
                    lineStatus: 'shipped',
                    awbNumber: awbNumber || 'ADMIN-MANUAL',
                    courier: courier || 'Manual',
                    shippedAt: new Date().toISOString(),
                })
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                setCachedData(context.queryInput, () => context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            showError('Failed to admin ship order', { description: err instanceof Error ? err.message : String(err) });
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
            onShipSuccess?.();
        }
    });

    // ============================================
    // UNSHIP - Server Function
    // ============================================
    const unshipMutation = useMutation({
        mutationFn: async (input: { orderId: string; lineIds?: string[] }) => {
            const result = await unshipOrderServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to unship order');
            }
            return result.data;
        },
        onMutate: async ({ orderId }) => {
            // For unship, we may be in shipped view
            const shippedQueryInput = getOrdersQueryInput('shipped', page);
            await queryClient.cancelQueries({ queryKey: ['orders'] });
            const previousData = queryClient.getQueryData<OrdersListData>(getOrdersListQueryKey(shippedQueryInput));

            setCachedData(
                shippedQueryInput,
                (old) => optimisticUnshipOrder(old, orderId)
            );

            return { previousData, queryInput: shippedQueryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                setCachedData(context.queryInput, () => context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            showError('Failed to unship order', { description: err instanceof Error ? err.message : String(err) });
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

    // ============================================
    // MARK SHIPPED LINE - Server Function
    // ============================================
    const markShippedLineMutation = useMutation({
        mutationFn: async (input: { lineId: string; awbNumber: string; courier: string }) => {
            const result = await markShippedLineServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to mark line as shipped');
            }
            return result.data;
        },
        onMutate: async ({ lineId, awbNumber, courier }) => {
            await queryClient.cancelQueries({ queryKey: ['orders'] });
            const previousData = getCachedData();

            // Update line status to shipped
            setCachedData(
                queryInput,
                (old) => {
                    if (!old) return old;

                    return {
                        ...old,
                        rows: old.rows.map((row: any) => {
                            if (row.lineId !== lineId) return row;
                            return {
                                ...row,
                                lineStatus: 'shipped',
                                awbNumber,
                                courier,
                                lineShippedAt: new Date().toISOString(),
                            };
                        }),
                        ...(old.orders ? { orders: old.orders.map((order: any) => ({
                            ...order,
                            orderLines: order.orderLines?.map((line: any) =>
                                line.id === lineId
                                    ? {
                                        ...line,
                                        lineStatus: 'shipped',
                                        awbNumber,
                                        courier,
                                        shippedAt: new Date().toISOString(),
                                    }
                                    : line
                            ),
                        })) } : {}),
                    };
                }
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                setCachedData(context.queryInput, () => context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            showError('Failed to ship line', { description: err instanceof Error ? err.message : String(err) });
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const markShippedLine = useMemo(() => ({
        mutate: ({ lineId, data }: { lineId: string; data: { awbNumber: string; courier: string } }, mutationOptions?: Parameters<typeof markShippedLineMutation.mutate>[1]) =>
            markShippedLineMutation.mutate({ lineId, awbNumber: data.awbNumber, courier: data.courier }, mutationOptions),
        mutateAsync: ({ lineId, data }: { lineId: string; data: { awbNumber: string; courier: string } }, mutationOptions?: Parameters<typeof markShippedLineMutation.mutateAsync>[1]) =>
            markShippedLineMutation.mutateAsync({ lineId, awbNumber: data.awbNumber, courier: data.courier }, mutationOptions),
        isPending: markShippedLineMutation.isPending,
        isError: markShippedLineMutation.isError,
        error: markShippedLineMutation.error,
    }), [markShippedLineMutation.isPending, markShippedLineMutation.isError, markShippedLineMutation.error]);

    // ============================================
    // UNMARK SHIPPED LINE - Server Function
    // ============================================
    const unmarkShippedLineMutation = useMutation({
        mutationFn: async (input: { lineId: string }) => {
            const result = await unmarkShippedLineServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to unmark line as shipped');
            }
            return result.data;
        },
        onMutate: async ({ lineId }) => {
            await queryClient.cancelQueries({ queryKey: ['orders'] });
            const previousData = getCachedData();

            setCachedData(
                queryInput,
                (old) => optimisticLineStatusUpdate(old, lineId, 'packed')
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                setCachedData(context.queryInput, () => context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            showError('Failed to unship line', { description: err instanceof Error ? err.message : String(err) });
        },
        onSettled: () => {
            // No invalidation needed - optimistic update + SSE handles it
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const unmarkShippedLine = useMemo(() => ({
        mutate: (lineId: string, mutationOptions?: Parameters<typeof unmarkShippedLineMutation.mutate>[1]) => unmarkShippedLineMutation.mutate({ lineId }, mutationOptions),
        mutateAsync: (lineId: string, mutationOptions?: Parameters<typeof unmarkShippedLineMutation.mutateAsync>[1]) => unmarkShippedLineMutation.mutateAsync({ lineId }, mutationOptions),
        isPending: unmarkShippedLineMutation.isPending,
        isError: unmarkShippedLineMutation.isError,
        error: unmarkShippedLineMutation.error,
    }), [unmarkShippedLineMutation.isPending, unmarkShippedLineMutation.isError, unmarkShippedLineMutation.error]);

    // ============================================
    // UPDATE LINE TRACKING - Server Function
    // ============================================
    const updateLineTrackingMutation = useMutation({
        mutationFn: async (input: { lineId: string; awbNumber?: string; courier?: string; trackingStatus?: string }) => {
            const result = await updateLineTrackingServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update line tracking');
            }
            return result.data;
        },
        onMutate: async ({ lineId, awbNumber, courier }) => {
            await queryClient.cancelQueries({ queryKey: ['orders'] });
            const previousData = getCachedData();

            setCachedData(
                queryInput,
                (old) => optimisticUpdateLineTracking(old, lineId, { awbNumber, courier })
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                setCachedData(context.queryInput, () => context.previousData);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();
            invalidateShippedOrders();
            console.error('Tracking update failed:', err instanceof Error ? err.message : String(err));
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const updateLineTracking = useMemo(() => ({
        mutate: ({ lineId, data }: { lineId: string; data: { awbNumber?: string; courier?: string } }, mutationOptions?: Parameters<typeof updateLineTrackingMutation.mutate>[1]) =>
            updateLineTrackingMutation.mutate({ lineId, ...data }, mutationOptions),
        mutateAsync: ({ lineId, data }: { lineId: string; data: { awbNumber?: string; courier?: string } }, mutationOptions?: Parameters<typeof updateLineTrackingMutation.mutateAsync>[1]) =>
            updateLineTrackingMutation.mutateAsync({ lineId, ...data }, mutationOptions),
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
