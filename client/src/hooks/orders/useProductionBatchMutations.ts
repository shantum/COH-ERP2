/**
 * Production batch mutations with optimistic updates
 * Handles creating, updating, and deleting production batches
 *
 * Uses tRPC for API calls with optimistic cache updates for the orders grid.
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save previous data, update cache optimistically
 * 2. onError: Rollback to previous data + invalidate for consistency
 * 3. onSettled: Invalidate related caches (inventory, fabric)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation } from './orderMutationUtils';
import { trpc } from '../../services/trpc';
import {
    getOrdersQueryInput,
    optimisticCreateBatch,
    optimisticUpdateBatch,
    optimisticDeleteBatch,
    getRowByBatchId,
    type OrdersListData,
    type OptimisticUpdateContext,
} from './optimisticUpdateHelpers';

export interface UseProductionBatchMutationsOptions {
    currentView?: string;
    page?: number;
    shippedFilter?: 'rto' | 'cod_pending';
}

export function useProductionBatchMutations(options: UseProductionBatchMutationsOptions = {}) {
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

    // Create batch mutation using tRPC
    const createBatchMutation = trpc.production.createBatch.useMutation();

    const createBatch = useMutation({
        mutationFn: async (data: {
            batchDate?: string;
            tailorId?: string;
            skuId?: string;
            sampleName?: string;
            sampleColour?: string;
            sampleSize?: string;
            qtyPlanned: number;
            priority?: 'low' | 'normal' | 'high' | 'urgent';
            sourceOrderLineId?: string;
            notes?: string;
        }) => {
            return createBatchMutation.mutateAsync(data);
        },
        onMutate: async (data) => {
            // Cancel any outgoing refetches
            await trpcUtils.orders.list.cancel(queryInput);

            // Snapshot previous data for rollback
            const previousData = getCachedData();

            // Generate a temp ID for optimistic update
            const tempBatchId = `temp-${Date.now()}`;
            const batchDate = data.batchDate || new Date().toISOString().split('T')[0];

            // Only apply optimistic update if we have a sourceOrderLineId
            if (data.sourceOrderLineId) {
                trpcUtils.orders.list.setData(
                    queryInput,
                    (old: any) => optimisticCreateBatch(old, data.sourceOrderLineId!, tempBatchId, batchDate) as any
                );
            }

            return {
                previousData,
                queryInput,
                tempBatchId,
                sourceOrderLineId: data.sourceOrderLineId,
                batchDate,
            } as OptimisticUpdateContext & {
                tempBatchId: string;
                sourceOrderLineId?: string;
                batchDate: string;
            };
        },
        onSuccess: (response, _data, context) => {
            // Replace temp ID with real ID in cache
            if (context?.sourceOrderLineId && response?.id) {
                trpcUtils.orders.list.setData(
                    queryInput,
                    (old: any) => {
                        if (!old) return old;
                        return {
                            ...old,
                            rows: old.rows.map((row: any) => {
                                if (row.productionBatchId === context.tempBatchId) {
                                    return {
                                        ...row,
                                        productionBatchId: response.id,
                                    };
                                }
                                return row;
                            }),
                            orders: old.orders.map((order: any) => ({
                                ...order,
                                orderLines: order.orderLines?.map((line: any) =>
                                    line.productionBatchId === context.tempBatchId
                                        ? { ...line, productionBatchId: response.id }
                                        : line
                                ),
                            })),
                        };
                    }
                );
            }

            // Invalidate production queries
            trpcUtils.production.getBatches.invalidate();
            trpcUtils.production.getCapacity.invalidate();
            trpcUtils.production.getRequirements.invalidate();
        },
        onError: (err: any, _data, context) => {
            // Rollback on error
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            // Force invalidate to ensure consistency
            invalidateOpenOrders();
            alert(err.message || 'Failed to add to production');
        },
        onSettled: () => {
            // Invalidate related caches
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
    });

    // Update batch mutation using tRPC
    const updateBatchMutation = trpc.production.updateBatch.useMutation();

    const updateBatch = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: {
            batchDate?: string;
            qtyPlanned?: number;
            tailorId?: string;
            priority?: 'low' | 'normal' | 'high' | 'urgent';
            notes?: string;
        }}) => {
            // Skip API call for temp IDs (batch not yet created)
            if (id.startsWith('temp-')) {
                return { success: true, id, ...data } as any;
            }
            return updateBatchMutation.mutateAsync({ id, ...data });
        },
        onMutate: async ({ id, data }) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            // Optimistically update the batch date
            if (data.batchDate) {
                trpcUtils.orders.list.setData(
                    queryInput,
                    (old: any) => optimisticUpdateBatch(old, id, data.batchDate!) as any
                );
            }

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onSuccess: () => {
            // Invalidate production queries
            trpcUtils.production.getBatches.invalidate();
            trpcUtils.production.getCapacity.invalidate();
        },
        onError: (err: any, _vars, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            invalidateOpenOrders();
            alert(err.message || 'Failed to update batch');
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
    });

    // Delete batch mutation using tRPC
    const deleteBatchMutation = trpc.production.deleteBatch.useMutation();

    const deleteBatch = useMutation({
        mutationFn: async (id: string) => {
            // Skip API call for temp IDs
            if (id.startsWith('temp-')) {
                return { success: true } as any;
            }
            return deleteBatchMutation.mutateAsync({ id });
        },
        onMutate: async (id) => {
            await trpcUtils.orders.list.cancel(queryInput);
            const previousData = getCachedData();

            // Find the line ID before deleting (for potential rollback info)
            const row = getRowByBatchId(previousData, id);

            // Optimistically remove the batch
            trpcUtils.orders.list.setData(
                queryInput,
                (old: any) => optimisticDeleteBatch(old, id) as any
            );

            return {
                previousData,
                queryInput,
                deletedBatchId: id,
                lineId: row?.lineId,
            } as OptimisticUpdateContext & { deletedBatchId: string; lineId?: string };
        },
        onSuccess: () => {
            // Invalidate production queries
            trpcUtils.production.getBatches.invalidate();
            trpcUtils.production.getCapacity.invalidate();
            trpcUtils.production.getRequirements.invalidate();
        },
        onError: (err: any, _id, context) => {
            if (context?.previousData) {
                trpcUtils.orders.list.setData(context.queryInput, context.previousData as any);
            }
            invalidateOpenOrders();
            alert(err.message || 'Failed to delete batch');
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
    });

    return {
        createBatch,
        updateBatch,
        deleteBatch,
    };
}
