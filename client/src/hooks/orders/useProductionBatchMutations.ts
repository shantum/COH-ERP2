/**
 * Production batch mutations
 * Handles creating, updating, and deleting production batches
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { productionApi } from '../../services/api';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation } from './orderMutationUtils';

export function useProductionBatchMutations() {
    const queryClient = useQueryClient();
    const { invalidateOpenOrders } = useOrderInvalidation();

    const createBatch = useMutation({
        mutationFn: (data: any) => productionApi.createBatch(data),
        onSuccess: () => {
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to add to production');
        }
    });

    const updateBatch = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: any }) => {
            if (id.startsWith('temp-')) {
                return { data: { success: true } } as any;
            }
            return productionApi.updateBatch(id, data);
        },
        onSuccess: () => {
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to update batch');
        }
    });

    const deleteBatch = useMutation({
        mutationFn: async (id: string) => {
            if (id.startsWith('temp-')) {
                return { data: { success: true } } as any;
            }
            return productionApi.deleteBatch(id);
        },
        onSuccess: () => {
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to delete batch');
        }
    });

    return {
        createBatch,
        updateBatch,
        deleteBatch,
    };
}
