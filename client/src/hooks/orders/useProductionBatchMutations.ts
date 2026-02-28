/**
 * Production batch mutations
 * Handles creating, updating, and deleting production batches
 *
 * Simplified to invalidation-only (optimistic update infrastructure removed).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation } from './orderMutationUtils';
import {
    createBatch as createBatchFn,
    updateBatch as updateBatchFn,
    deleteBatch as deleteBatchFn,
} from '../../server/functions/productionMutations';

export interface UseProductionBatchMutationsOptions {
    currentView?: string;
    page?: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useProductionBatchMutations(_options: UseProductionBatchMutationsOptions = {}) {
    const queryClient = useQueryClient();
    const { invalidateOpenOrders } = useOrderInvalidation();

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
        onSuccess: () => {
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: ['production', 'batches'] });
            queryClient.invalidateQueries({ queryKey: ['production', 'capacity'] });
            queryClient.invalidateQueries({ queryKey: ['production', 'requirements'] });
        },
        onError: (err: Error) => {
            alert(err.message || 'Failed to add to production');
        },
        onSettled: () => {
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
        onSuccess: () => {
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: ['production', 'batches'] });
            queryClient.invalidateQueries({ queryKey: ['production', 'capacity'] });
        },
        onError: (err: Error) => {
            alert(err.message || 'Failed to update batch');
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
    });

    const deleteBatch = useMutation({
        mutationFn: async (id: string) => {
            if (id.startsWith('temp-')) {
                return { success: true };
            }
            const result = await deleteBatchSF({ data: { batchId: id } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to delete batch');
            }
            return result.data;
        },
        onSuccess: () => {
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: ['production', 'batches'] });
            queryClient.invalidateQueries({ queryKey: ['production', 'capacity'] });
            queryClient.invalidateQueries({ queryKey: ['production', 'requirements'] });
        },
        onError: (err: Error) => {
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
