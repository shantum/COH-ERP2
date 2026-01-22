/**
 * Production batch mutations with optimistic updates
 * Handles creating, updating, and deleting production batches
 *
 * Uses Server Functions for API calls with optimistic cache updates for the orders grid.
 *
 * Optimistic update strategy:
 * 1. onMutate: Cancel inflight queries, save previous data, update cache optimistically
 * 2. onError: Rollback to previous data + invalidate for consistency
 * 3. onSettled: Invalidate related caches (inventory, fabric)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation, getOrdersListQueryKey } from './orderMutationUtils';
import {
    createBatch as createBatchFn,
    updateBatch as updateBatchFn,
    deleteBatch as deleteBatchFn,
} from '../../server/functions/productionMutations';
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
    const { invalidateOpenOrders } = useOrderInvalidation();

    // Build query input for cache operations
    const queryInput = getOrdersQueryInput(currentView, page, shippedFilter);

    // Query key for TanStack Query cache operations
    const ordersQueryKey = getOrdersListQueryKey(queryInput);

    // Helper to get current cache data
    const getCachedData = (): OrdersListData | undefined => {
        return queryClient.getQueryData(ordersQueryKey);
    };

    // Helper to set cache data
    const setCachedData = (updater: (old: OrdersListData | undefined) => OrdersListData | undefined) => {
        queryClient.setQueryData(ordersQueryKey, updater);
    };

    // Server function wrappers
    const createBatchSF = useServerFn(createBatchFn);
    const updateBatchSF = useServerFn(updateBatchFn);
    const deleteBatchSF = useServerFn(deleteBatchFn);

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
            // Map qtyPlanned to quantity for Server Function schema
            const result = await createBatchSF({
                data: {
                    batchDate: data.batchDate,
                    tailorId: data.tailorId,
                    skuId: data.skuId,
                    sampleName: data.sampleName,
                    sampleColour: data.sampleColour,
                    sampleSize: data.sampleSize,
                    quantity: data.qtyPlanned,
                    priority: data.priority,
                    sourceOrderLineId: data.sourceOrderLineId,
                    notes: data.notes,
                },
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to create batch');
            }
            return { id: result.data!.batchId, ...result.data };
        },
        onMutate: async (data) => {
            // Cancel any outgoing refetches
            await queryClient.cancelQueries({ queryKey: ordersQueryKey });

            // Snapshot previous data for rollback
            const previousData = getCachedData();

            // Generate a temp ID for optimistic update
            const tempBatchId = `temp-${Date.now()}`;
            const batchDate = data.batchDate || new Date().toISOString().split('T')[0];

            // Only apply optimistic update if we have a sourceOrderLineId
            if (data.sourceOrderLineId) {
                setCachedData(
                    (old) => optimisticCreateBatch(old, data.sourceOrderLineId!, tempBatchId, batchDate) as OrdersListData | undefined
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
                setCachedData((old) => {
                    if (!old) return old;
                    return {
                        ...old,
                        rows: old.rows.map((row) => {
                            if (row.productionBatchId === context.tempBatchId) {
                                return {
                                    ...row,
                                    productionBatchId: response.id,
                                };
                            }
                            return row;
                        }),
                        // Also update nested order.orderLines if present on each row
                        ...(old.orders ? {
                            orders: old.orders.map((order: { orderLines?: Array<{ productionBatchId?: string | null }> }) => ({
                                ...order,
                                orderLines: order.orderLines?.map((line) =>
                                    line.productionBatchId === context.tempBatchId
                                        ? { ...line, productionBatchId: response.id }
                                        : line
                                ),
                            })),
                        } : {}),
                    };
                });
            }

            // Invalidate production queries
            queryClient.invalidateQueries({ queryKey: ['production', 'batches'] });
            queryClient.invalidateQueries({ queryKey: ['production', 'capacity'] });
            queryClient.invalidateQueries({ queryKey: ['production', 'requirements'] });
        },
        onError: (err: Error, _data, context) => {
            // Rollback on error
            if (context?.previousData) {
                queryClient.setQueryData(ordersQueryKey, context.previousData);
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
                return { success: true, id, ...data };
            }
            const result = await updateBatchSF({
                data: {
                    batchId: id,
                    batchDate: data.batchDate,
                    quantity: data.qtyPlanned,
                    tailorId: data.tailorId,
                    priority: data.priority,
                    notes: data.notes,
                },
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update batch');
            }
            return result.data;
        },
        onMutate: async ({ id, data }) => {
            await queryClient.cancelQueries({ queryKey: ordersQueryKey });
            const previousData = getCachedData();

            // Optimistically update the batch date
            if (data.batchDate) {
                setCachedData(
                    (old) => optimisticUpdateBatch(old, id, data.batchDate!) as OrdersListData | undefined
                );
            }

            return { previousData, queryInput } as OptimisticUpdateContext;
        },
        onSuccess: () => {
            // Invalidate production queries
            queryClient.invalidateQueries({ queryKey: ['production', 'batches'] });
            queryClient.invalidateQueries({ queryKey: ['production', 'capacity'] });
        },
        onError: (err: Error, _vars, context) => {
            if (context?.previousData) {
                queryClient.setQueryData(ordersQueryKey, context.previousData);
            }
            invalidateOpenOrders();
            alert(err.message || 'Failed to update batch');
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
    });

    const deleteBatch = useMutation({
        mutationFn: async (id: string) => {
            // Skip API call for temp IDs
            if (id.startsWith('temp-')) {
                return { success: true };
            }
            const result = await deleteBatchSF({ data: { batchId: id } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to delete batch');
            }
            return result.data;
        },
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: ordersQueryKey });
            const previousData = getCachedData();

            // Find the line ID before deleting (for potential rollback info)
            const row = getRowByBatchId(previousData, id);

            // Optimistically remove the batch
            setCachedData(
                (old) => optimisticDeleteBatch(old, id) as OrdersListData | undefined
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
            queryClient.invalidateQueries({ queryKey: ['production', 'batches'] });
            queryClient.invalidateQueries({ queryKey: ['production', 'capacity'] });
            queryClient.invalidateQueries({ queryKey: ['production', 'requirements'] });
        },
        onError: (err: Error, _id, context) => {
            if (context?.previousData) {
                queryClient.setQueryData(ordersQueryKey, context.previousData);
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
