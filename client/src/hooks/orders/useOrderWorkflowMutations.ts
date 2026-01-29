/**
 * Order workflow mutations with optimistic updates
 * Handles allocate/unallocate/pick/pack line status transitions
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save ALL view cache data, update cache optimistically
 *    - Updates BOTH orders cache AND inventory balance cache for consistency
 *    - Saves ALL cached queries for proper rollback (handles filter/page variants)
 * 2. onError: Rollback ALL cached queries to previous state + invalidate for consistency
 * 3. onSettled: Only invalidate non-SSE-synced data (e.g., inventory balance)
 *
 * Note: Order list invalidation removed from onSettled to prevent UI flicker.
 * SSE handles cross-user synchronization; error rollback ensures consistency.
 *
 * IMPORTANT: Inventory balance cache must be updated alongside orders cache to prevent
 * enrichRowsWithInventory from overwriting optimistic skuStock values with stale data.
 */

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation } from './orderMutationUtils';
import { showError } from '../../utils/toast';
import {
    allocateOrder as allocateOrderFn,
    setLineStatus as setLineStatusFn,
} from '../../server/functions/orderMutations';
import type { MutationOptions } from './orderMutationUtils';
import {
    optimisticLineStatusUpdate,
    optimisticBatchLineStatusUpdate,
    calculateInventoryDelta,
    // View-based cache utilities
    getViewCacheSnapshot,
    restoreViewCacheSnapshot,
    updateViewCache,
    cancelViewQueries,
    findRowInViewCache,
    findRowsInViewCache,
    type ViewCacheSnapshot,
} from './optimisticUpdateHelpers';
import {
    optimisticInventoryUpdate,
    rollbackInventoryUpdate,
} from './optimistic/inventoryHelpers';
import type { InventoryBalanceItem } from '../../server/functions/inventory';

export interface UseOrderWorkflowMutationsOptions {
    currentView?: string;
    page?: number;
}

/** Context for optimistic updates with proper multi-query rollback */
interface WorkflowOptimisticContext {
    /** Snapshot of ALL cached queries for the view */
    viewSnapshot: ViewCacheSnapshot;
    /** The view being operated on */
    view: string;
    /** Previous inventory data for rollback */
    previousInventoryData?: Map<string, InventoryBalanceItem[] | undefined>;
}

export function useOrderWorkflowMutations(options: UseOrderWorkflowMutationsOptions = {}) {
    const { currentView = 'open' } = options;
    const queryClient = useQueryClient();
    const { invalidateOpenOrders } = useOrderInvalidation();

    // Server Function wrappers
    const allocateOrderServerFn = useServerFn(allocateOrderFn);
    const setLineStatusServerFn = useServerFn(setLineStatusFn);

    // ============================================
    // ALLOCATE
    // ============================================
    const allocate = useMutation({
        mutationFn: async (input: { lineIds: string[] }) => {
            // Find orderId from any cache that contains the line
            const row = findRowInViewCache(queryClient, currentView, input.lineIds[0]);
            if (!row?.orderId) {
                throw new Error('Could not determine order ID for allocation');
            }
            const result = await allocateOrderServerFn({ data: { orderId: row.orderId, lineIds: input.lineIds } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to allocate');
            }
            return result.data;
        },
        onMutate: async ({ lineIds }) => {
            // Cancel any outgoing refetches for this view
            await cancelViewQueries(queryClient, currentView);
            // Also cancel inventory balance queries
            await queryClient.cancelQueries({ queryKey: inventoryQueryKeys.balance });

            // Snapshot ALL cached queries for this view (for proper rollback)
            const viewSnapshot = getViewCacheSnapshot(queryClient, currentView);

            // Find rows across ALL cached queries (handles different filter/page combinations)
            const rows = findRowsInViewCache(queryClient, currentView, lineIds);
            const inventoryDeltas = new Map<string, number>(); // lineId -> delta
            const skuDeltas = new Map<string, number>(); // skuId -> delta (aggregated)

            for (const row of rows) {
                if (row.lineId) {
                    const delta = calculateInventoryDelta(row.lineStatus || 'pending', 'allocated', row.qty || 0);
                    inventoryDeltas.set(row.lineId, delta);

                    if (row.skuId && delta !== 0) {
                        const existing = skuDeltas.get(row.skuId) || 0;
                        skuDeltas.set(row.skuId, existing + delta);
                    }
                }
            }

            // Optimistically update ALL orders caches for this view
            updateViewCache(queryClient, currentView, (old) =>
                optimisticBatchLineStatusUpdate(old, lineIds, 'allocated', inventoryDeltas)
            );

            // Also update the inventory balance cache
            const previousInventoryData = optimisticInventoryUpdate(queryClient, skuDeltas);

            return { viewSnapshot, view: currentView, previousInventoryData } as WorkflowOptimisticContext;
        },
        onError: (err, _vars, context) => {
            // Rollback ALL cached queries to their previous state
            if (context?.viewSnapshot) {
                restoreViewCacheSnapshot(queryClient, context.viewSnapshot);
            }
            if (context?.previousInventoryData) {
                rollbackInventoryUpdate(queryClient, context.previousInventoryData);
            }
            invalidateOpenOrders();

            const errorMsg = err instanceof Error ? err.message : String(err);
            if (errorMsg.includes('Insufficient stock')) {
                showError('Insufficient stock', { description: errorMsg });
            } else if (!errorMsg.includes('pending') && !errorMsg.includes('allocated')) {
                showError('Failed to allocate', { description: errorMsg });
            }
        },
        onSettled: () => {
            // SSE handles syncing; don't invalidate to prevent flicker
        },
    });

    // ============================================
    // SET LINE STATUS
    // ============================================
    const setLineStatusMutation = useMutation({
        mutationFn: async (input: { lineId: string; status: 'pending' | 'allocated' | 'picked' | 'packed' | 'cancelled' }) => {
            const result = await setLineStatusServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update line status');
            }
            return result.data;
        },
        onMutate: async ({ lineId, status: newStatus }) => {
            await cancelViewQueries(queryClient, currentView);
            await queryClient.cancelQueries({ queryKey: inventoryQueryKeys.balance });

            // Snapshot ALL cached queries for this view
            const viewSnapshot = getViewCacheSnapshot(queryClient, currentView);

            // Find the row across ALL cached queries
            const row = findRowInViewCache(queryClient, currentView, lineId);
            const inventoryDelta = row
                ? calculateInventoryDelta(row.lineStatus || 'pending', newStatus, row.qty || 0)
                : 0;

            // Update ALL orders caches for this view
            updateViewCache(queryClient, currentView, (old) =>
                optimisticLineStatusUpdate(old, lineId, newStatus, inventoryDelta)
            );

            // Update inventory balance cache
            let previousInventoryData: Map<string, InventoryBalanceItem[] | undefined> | undefined;
            if (row?.skuId && inventoryDelta !== 0) {
                const skuDeltas = new Map<string, number>([[row.skuId, inventoryDelta]]);
                previousInventoryData = optimisticInventoryUpdate(queryClient, skuDeltas);
            }

            return { viewSnapshot, view: currentView, previousInventoryData } as WorkflowOptimisticContext;
        },
        onError: (err, _vars, context) => {
            if (context?.viewSnapshot) {
                restoreViewCacheSnapshot(queryClient, context.viewSnapshot);
            }
            if (context?.previousInventoryData) {
                rollbackInventoryUpdate(queryClient, context.previousInventoryData);
            }
            invalidateOpenOrders();

            const msg = err instanceof Error ? err.message : 'Failed to update line status';
            if (!msg.includes('Cannot transition')) {
                showError('Failed to update line status', { description: msg });
            }
        },
        onSettled: () => {
            // SSE handles syncing; don't invalidate to prevent flicker
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
