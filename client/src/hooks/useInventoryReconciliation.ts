/**
 * Inventory Reconciliation Hooks
 *
 * TanStack Query hooks for inventory reconciliation using Server Functions.
 * CSV upload remains on Axios due to multipart/form-data requirements.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { inventoryApi } from '../services/api';
import {
    startReconciliation as startReconciliationFn,
    updateReconciliationItems as updateReconciliationItemsFn,
    submitReconciliation as submitReconciliationFn,
    deleteReconciliation as deleteReconciliationFn,
    getReconciliationHistory as getReconciliationHistoryFn,
    getReconciliationById as getReconciliationByIdFn,
    type ReconciliationItem,
    type StartReconciliationResult,
    type UpdateReconciliationItemsResult,
    type SubmitReconciliationResult,
    type GetReconciliationHistoryResult,
    type GetReconciliationResult,
} from '../server/functions/reconciliationMutations';

// Re-export types for convenience
export type { ReconciliationItem };

// ============================================
// QUERY HOOKS
// ============================================

/**
 * Query hook for reconciliation history
 */
export function useReconciliationHistory(limit: number = 50) {
    const getHistoryFn = useServerFn(getReconciliationHistoryFn);

    return useQuery({
        queryKey: ['inventoryReconciliationHistory', limit],
        queryFn: async () => {
            const result = await getHistoryFn({ data: { limit } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to fetch reconciliation history');
            }
            return result.data as GetReconciliationHistoryResult;
        },
    });
}

/**
 * Query hook for a single reconciliation by ID
 */
export function useReconciliationById(reconciliationId: string | null) {
    const getByIdFn = useServerFn(getReconciliationByIdFn);

    return useQuery({
        queryKey: ['inventoryReconciliation', reconciliationId],
        queryFn: async () => {
            if (!reconciliationId) throw new Error('No reconciliation ID');
            const result = await getByIdFn({ data: { reconciliationId } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to fetch reconciliation');
            }
            return result.data as GetReconciliationResult;
        },
        enabled: !!reconciliationId,
    });
}

// ============================================
// MUTATION HOOKS
// ============================================

export interface UseInventoryReconciliationOptions {
    onStartSuccess?: (data: StartReconciliationResult) => void;
    onUpdateSuccess?: (data: UpdateReconciliationItemsResult) => void;
    onSubmitSuccess?: (data: SubmitReconciliationResult) => void;
    onDeleteSuccess?: () => void;
    onUploadSuccess?: (result: { message: string; results?: unknown }) => void;
    onUploadError?: (error: string) => void;
}

/**
 * Hook for inventory reconciliation mutations
 */
export function useInventoryReconciliationMutations(options: UseInventoryReconciliationOptions = {}) {
    const queryClient = useQueryClient();

    // Server Function wrappers
    const startServerFn = useServerFn(startReconciliationFn);
    const updateServerFn = useServerFn(updateReconciliationItemsFn);
    const submitServerFn = useServerFn(submitReconciliationFn);
    const deleteServerFn = useServerFn(deleteReconciliationFn);

    // ============================================
    // START RECONCILIATION
    // ============================================
    const startMutation = useMutation({
        mutationFn: async (skuIds?: string[] | void) => {
            const result = await startServerFn({ data: { skuIds: skuIds || undefined } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to start reconciliation');
            }
            return result.data as StartReconciliationResult;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['inventoryReconciliationHistory'] });
            options.onStartSuccess?.(data);
        },
    });

    // ============================================
    // UPDATE RECONCILIATION ITEMS
    // ============================================
    const updateMutation = useMutation({
        mutationFn: async ({
            reconciliationId,
            items,
        }: {
            reconciliationId: string;
            items: Array<{
                id: string;
                physicalQty: number | null;
                systemQty: number;
                adjustmentReason?: string | null;
                notes?: string | null;
            }>;
        }) => {
            const result = await updateServerFn({ data: { reconciliationId, items } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update reconciliation');
            }
            return result.data as UpdateReconciliationItemsResult;
        },
        onSuccess: (data) => {
            options.onUpdateSuccess?.(data);
        },
    });

    // ============================================
    // SUBMIT RECONCILIATION
    // ============================================
    const submitMutation = useMutation({
        mutationFn: async ({
            reconciliationId,
            applyAdjustments = true,
        }: {
            reconciliationId: string;
            applyAdjustments?: boolean;
        }) => {
            const result = await submitServerFn({ data: { reconciliationId, applyAdjustments } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to submit reconciliation');
            }
            return result.data as SubmitReconciliationResult;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['inventoryReconciliationHistory'] });
            queryClient.invalidateQueries({ queryKey: ['inventoryBalance'] });
            options.onSubmitSuccess?.(data);
        },
    });

    // ============================================
    // DELETE RECONCILIATION
    // ============================================
    const deleteMutation = useMutation({
        mutationFn: async (reconciliationId: string) => {
            const result = await deleteServerFn({ data: { reconciliationId } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to delete reconciliation');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventoryReconciliationHistory'] });
            options.onDeleteSuccess?.();
        },
    });

    // ============================================
    // UPLOAD CSV (stays on Axios - multipart/form-data)
    // ============================================
    const uploadMutation = useMutation({
        mutationFn: async ({ reconciliationId, file }: { reconciliationId: string; file: File }) => {
            const response = await inventoryApi.uploadReconciliationCsv(reconciliationId, file);
            return response.data;
        },
        onSuccess: (data) => {
            options.onUploadSuccess?.({ message: data.message, results: data.results });
        },
        onError: (error: unknown) => {
            const message = error instanceof Error
                ? error.message
                : (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to upload CSV';
            options.onUploadError?.(message);
        },
    });

    return {
        // Mutations
        startMutation,
        updateMutation,
        submitMutation,
        deleteMutation,
        uploadMutation,
    };
}
