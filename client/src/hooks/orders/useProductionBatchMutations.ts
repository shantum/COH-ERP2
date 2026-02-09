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
import { useOrderInvalidation } from './orderMutationUtils';
import { getTodayString } from '../../components/orders/OrdersTable/utils/dateFormatters';
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
}

export function useProductionBatchMutations(options: UseProductionBatchMutationsOptions = {}) {
    const { currentView = 'open', page = 1 } = options;
    const queryClient = useQueryClient();
    const { invalidateOpenOrders } = useOrderInvalidation();

    // Build query input for cache operations (used for rollback context)
    const queryInput = getOrdersQueryInput(currentView, page);

    /**
     * Predicate to match all order list queries for the current view.
     * This matches regardless of filters (allocatedFilter, productionFilter) or pagination.
     * Query key format: ['orders', 'list', 'server-fn', { view, page, limit, ...filters }]
     */
    const viewQueryPredicate = (query: { queryKey: readonly unknown[] }) => {
        const key = query.queryKey;
        if (key[0] !== 'orders' || key[1] !== 'list' || key[2] !== 'server-fn') return false;
        const params = key[3] as { view?: string } | undefined;
        return params?.view === currentView;
    };

    // Helper to get current cache data - finds any matching query for the view
    const getCachedData = (): OrdersListData | undefined => {
        const queries = queryClient.getQueriesData<OrdersListData>({ predicate: viewQueryPredicate });
        return queries[0]?.[1];
    };

    // Helper to set cache data for ALL matching queries in this view
    const setCachedData = (updater: (old: OrdersListData | undefined) => OrdersListData | undefined) => {
        queryClient.setQueriesData<OrdersListData>({ predicate: viewQueryPredicate }, updater);
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
            priority?: 'low' | 'normal' | 'high' | 'urgent' | 'order_fulfillment';
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
            // Cancel queries for this view (matches any filter/page combination)
            await queryClient.cancelQueries({ predicate: viewQueryPredicate });

            // Snapshot previous data for rollback
            const previousData = getCachedData();

            // Generate a temp ID for optimistic update
            const tempBatchId = `temp-${Date.now()}`;
            const batchDate = data.batchDate || getTodayString(); // Use local date to avoid timezone issues

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
                            orders: old.orders.map((order) => ({
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
            // Rollback all view caches to the previous value
            if (context?.previousData) {
                queryClient.setQueriesData<OrdersListData>(
                    { predicate: viewQueryPredicate },
                    () => context.previousData
                );
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
            // Cancel queries for this view (matches any filter/page combination)
            await queryClient.cancelQueries({ predicate: viewQueryPredicate });
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
            // Rollback all view caches to the previous value
            if (context?.previousData) {
                queryClient.setQueriesData<OrdersListData>(
                    { predicate: viewQueryPredicate },
                    () => context.previousData
                );
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
            // Cancel queries for this view (matches any filter/page combination)
            await queryClient.cancelQueries({ predicate: viewQueryPredicate });
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
            // Rollback all view caches to the previous value
            if (context?.previousData) {
                queryClient.setQueriesData<OrdersListData>(
                    { predicate: viewQueryPredicate },
                    () => context.previousData
                );
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
