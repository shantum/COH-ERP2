/**
 * Order workflow mutations with optimistic updates
 * Handles allocate/unallocate/pick/pack line status transitions
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save previous data, update cache optimistically
 * 2. onError: Rollback to previous data + invalidate for consistency
 * 3. onSettled: Only invalidate non-SSE-synced data (e.g., inventory balance)
 *
 * Note: Order list invalidation removed from onSettled to prevent UI flicker.
 * SSE handles cross-user synchronization; error rollback ensures consistency.
 */

import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../services/trpc';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation } from './orderMutationUtils';
import type { MutationOptions } from './orderMutationUtils';
import {
    getOrdersQueryInput,
    optimisticLineStatusUpdate,
    optimisticBatchLineStatusUpdate,
    calculateInventoryDelta,
    getRowByLineId,
    getRowsByLineIds,
    type OrdersListData,
    type OptimisticUpdateContext,
} from './optimisticUpdateHelpers';

export interface UseOrderWorkflowMutationsOptions {
    currentView?: string;
    page?: number;
    shippedFilter?: 'rto' | 'cod_pending';
}

export function useOrderWorkflowMutations(options: UseOrderWorkflowMutationsOptions = {}) {
    const { currentView = 'open', page = 1, shippedFilter } = options;
    const queryClient = useQueryClient();
    const trpcUtils = trpc.useUtils();
    const { invalidateOpenOrders } = useOrderInvalidation();

    // Build query input for cache operations
    const queryInput = getOrdersQueryInput(currentView, page, shippedFilter);

    // Helper to get current cache data
    const getCachedData = (): OrdersListData | undefined => {
        return trpcUtils.orders.list.getData(queryInput);
    };

    // Allocate mutation with optimistic updates
    const allocate = trpc.orders.allocate.useMutation({
        onMutate: async ({ lineIds }) => {
            // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
            await trpcUtils.orders.list.cancel(queryInput);

            // Snapshot the previous value
            const previousData = getCachedData();

            // Get rows to calculate inventory deltas
            const rows = getRowsByLineIds(previousData, lineIds);
            const inventoryDeltas = new Map<string, number>();
            rows.forEach((row) => {
                if (row.lineId) {
                    const delta = calculateInventoryDelta(row.lineStatus || 'pending', 'allocated', row.qty || 0);
                    inventoryDeltas.set(row.lineId, delta);
                }
            });

            // Optimistically update the cache
            // Cast through `any` as tRPC inferred types are stricter than our FlattenedOrderRow
            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticBatchLineStatusUpdate(old, lineIds, 'allocated', inventoryDeltas) as any
            );

            // Also update inventory balance cache surgically
            const affectedSkuIds = new Set<string>();
            const skuDeltas = new Map<string, number>();
            rows.forEach((row) => {
                if (row.skuId) {
                    affectedSkuIds.add(row.skuId);
                    const currentDelta = skuDeltas.get(row.skuId) || 0;
                    const delta = calculateInventoryDelta(row.lineStatus || 'pending', 'allocated', row.qty || 0);
                    skuDeltas.set(row.skuId, currentDelta + delta);
                }
            });

            // Return context with data for rollback
            return { previousData, queryInput, skuDeltas } as OptimisticUpdateContext & { skuDeltas: Map<string, number> };
        },
        onError: (err, _vars, context) => {
            // Rollback to the previous value on error
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();

            // Show error alert for insufficient stock
            const errorMsg = err.message || '';
            if (errorMsg.includes('Insufficient stock')) {
                alert(errorMsg);
            } else if (!errorMsg.includes('pending') && !errorMsg.includes('allocated')) {
                alert(errorMsg || 'Failed to allocate');
            }
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            // Order list updates are handled by optimistic updates + SSE
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
    });

    // Line status mutation with optimistic updates
    const setLineStatusMutation = trpc.orders.setLineStatus.useMutation({
        onMutate: async ({ lineId, status: newStatus }) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            // Get the row to calculate inventory delta
            const row = getRowByLineId(previousData, lineId);
            const inventoryDelta = row
                ? calculateInventoryDelta(row.lineStatus || 'pending', newStatus, row.qty || 0)
                : 0;

            // Optimistically update
            // Cast through `any` as tRPC inferred types are stricter than our FlattenedOrderRow
            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticLineStatusUpdate(old, lineId, newStatus, inventoryDelta) as any
            );

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Invalidate after rollback to ensure consistency
            invalidateOpenOrders();

            const msg = err.message || 'Failed to update line status';
            if (!msg.includes('Cannot transition')) {
                alert(msg);
            }
        },
        onSettled: () => {
            // Only invalidate non-SSE-synced data (inventory balance)
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
    });

    // Wrapper mutations that use setLineStatus with specific statuses
    const unallocate = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'pending' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'pending' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    const pickLine = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'picked' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'picked' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    const unpickLine = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'allocated' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'allocated' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    const packLine = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'packed' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'packed' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    const unpackLine = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'picked' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'picked' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    return {
        allocate,
        unallocate,
        pickLine,
        unpickLine,
        packLine,
        unpackLine,
    };
}
