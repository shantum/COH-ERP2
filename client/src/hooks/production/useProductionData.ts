/**
 * Production data hooks using TanStack Query + Server Functions
 *
 * Query hooks for production batches, tailors, capacity, and requirements.
 * Migrated from tRPC to Server Functions for TanStack Start.
 *
 * @example
 * // In a component
 * const { data: batches, isLoading } = useBatches({ startDate, endDate });
 * const { data: tailors } = useTailors();
 * const { data: capacity } = useCapacity(selectedDate);
 */

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { trpc } from '../../services/trpc';

// Server Functions - Queries
import {
    getProductionTailors,
    getProductionBatches,
    getProductionLockedDates,
    getProductionCapacity,
    getProductionRequirements,
    getProductionPendingBySku,
} from '../../server/functions/production';

// Server Functions - Mutations
import {
    createBatch,
    updateBatch,
    deleteBatch,
    completeBatch,
    uncompleteBatch,
    createTailor,
    lockDate,
    unlockDate,
} from '../../server/functions/productionMutations';

// ============================================
// QUERY HOOKS
// ============================================

/**
 * Get all active tailors
 */
export function useTailors() {
    const getTailorsFn = useServerFn(getProductionTailors);
    return useQuery({
        queryKey: ['production', 'tailors'],
        queryFn: () => getTailorsFn(),
    });
}

/**
 * Get production batches with optional filters
 */
export interface BatchListOptions {
    status?: 'planned' | 'in_progress' | 'completed' | 'cancelled';
    tailorId?: string;
    startDate?: string;
    endDate?: string;
    customOnly?: boolean;
}

export function useBatches(options?: BatchListOptions) {
    const getBatchesFn = useServerFn(getProductionBatches);
    return useQuery({
        queryKey: ['production', 'batches', options],
        queryFn: () => getBatchesFn({ data: options ?? {} }),
    });
}

/**
 * Get locked production dates
 */
export function useLockedDates() {
    const getLockedDatesFn = useServerFn(getProductionLockedDates);
    return useQuery({
        queryKey: ['production', 'lockedDates'],
        queryFn: () => getLockedDatesFn(),
    });
}

/**
 * Get tailor capacity for a specific date
 */
export function useCapacity(date?: string) {
    const getCapacityFn = useServerFn(getProductionCapacity);
    return useQuery({
        queryKey: ['production', 'capacity', date],
        queryFn: () => getCapacityFn({ data: { date } }),
    });
}

/**
 * Get production requirements from open orders
 * @param enabled - Whether to enable the query (for lazy loading)
 */
export function useRequirements(enabled = true) {
    const getRequirementsFn = useServerFn(getProductionRequirements);
    return useQuery({
        queryKey: ['production', 'requirements'],
        queryFn: () => getRequirementsFn(),
        enabled,
    });
}

/**
 * Get pending production batches for a specific SKU
 */
export function usePendingBySku(skuId: string, enabled = true) {
    const getPendingBySkuFn = useServerFn(getProductionPendingBySku);
    return useQuery({
        queryKey: ['production', 'pendingBySku', skuId],
        queryFn: () => getPendingBySkuFn({ data: { skuId } }),
        enabled: enabled && !!skuId,
    });
}

// ============================================
// MUTATION HOOKS
// ============================================

/**
 * Input types for mutations
 */
interface CreateBatchInput {
    name?: string;
    batchDate?: string;
    skuId?: string;
    sampleName?: string;
    sampleColour?: string;
    sampleSize?: string;
    quantity: number;
    tailorId?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent' | 'order_fulfillment';
    sourceOrderLineId?: string;
    notes?: string;
}

interface UpdateBatchInput {
    batchId: string;
    batchDate?: string;
    quantity?: number;
    tailorId?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent' | 'order_fulfillment';
    notes?: string;
}

interface CompleteBatchInput {
    batchId: string;
    actualQuantity?: number;
}

interface CreateTailorInput {
    name: string;
    phone?: string;
    specializations?: string;
    dailyCapacityMins?: number;
    notes?: string;
}

interface LockDateInput {
    date: string;
}

/**
 * Hook for production mutations with cache invalidation
 *
 * @example
 * const mutations = useProductionMutations();
 * mutations.createBatch.mutate({ skuId, quantity: 10, batchDate: '2026-01-20' });
 */
export function useProductionMutations() {
    const queryClient = useQueryClient();
    const trpcUtils = trpc.useUtils();

    // Get Server Function references at hook level
    const createBatchFn = useServerFn(createBatch);
    const updateBatchFn = useServerFn(updateBatch);
    const deleteBatchFn = useServerFn(deleteBatch);
    const completeBatchFn = useServerFn(completeBatch);
    const uncompleteBatchFn = useServerFn(uncompleteBatch);
    const createTailorFn = useServerFn(createTailor);
    const lockDateFn = useServerFn(lockDate);
    const unlockDateFn = useServerFn(unlockDate);

    /**
     * Invalidate production-related queries
     */
    const invalidateProduction = () => {
        queryClient.invalidateQueries({ queryKey: ['production', 'batches'] });
        queryClient.invalidateQueries({ queryKey: ['production', 'capacity'] });
        queryClient.invalidateQueries({ queryKey: ['production', 'requirements'] });
        queryClient.invalidateQueries({ queryKey: ['production', 'pendingBySku'] });
        // Also invalidate tRPC cache for backwards compatibility
        trpcUtils.production.getBatches.invalidate();
        trpcUtils.production.getCapacity.invalidate();
        trpcUtils.production.getRequirements.invalidate();
    };

    /**
     * Invalidate inventory queries
     */
    const invalidateInventory = () => {
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        trpcUtils.inventory.getBalances.invalidate();
        trpcUtils.inventory.getAllBalances.invalidate();
    };

    // ============================================
    // CREATE TAILOR
    // ============================================
    const createTailorMutation = useMutation({
        mutationFn: async (input: CreateTailorInput) => {
            const result = await createTailorFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to create tailor');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['production', 'tailors'] });
            trpcUtils.production.getTailors.invalidate();
        },
    });

    // Wrapper for backward compatibility
    const createTailorWrapper = useMemo(() => ({
        mutate: (input: CreateTailorInput) => createTailorMutation.mutate(input),
        mutateAsync: (input: CreateTailorInput) => createTailorMutation.mutateAsync(input),
        isPending: createTailorMutation.isPending,
        isError: createTailorMutation.isError,
        error: createTailorMutation.error,
    }), [createTailorMutation.isPending, createTailorMutation.isError, createTailorMutation.error]);

    // ============================================
    // CREATE BATCH
    // ============================================
    const createBatchMutation = useMutation({
        mutationFn: async (input: CreateBatchInput) => {
            const result = await createBatchFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to create batch');
            }
            return result.data;
        },
        onSuccess: () => {
            invalidateProduction();
            invalidateInventory();
        },
    });

    // Wrapper for backward compatibility
    const createBatchWrapper = useMemo(() => ({
        mutate: (input: CreateBatchInput) => createBatchMutation.mutate(input),
        mutateAsync: (input: CreateBatchInput) => createBatchMutation.mutateAsync(input),
        isPending: createBatchMutation.isPending,
        isError: createBatchMutation.isError,
        error: createBatchMutation.error,
    }), [createBatchMutation.isPending, createBatchMutation.isError, createBatchMutation.error]);

    // ============================================
    // UPDATE BATCH
    // ============================================
    const updateBatchMutation = useMutation({
        mutationFn: async (input: UpdateBatchInput) => {
            const result = await updateBatchFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update batch');
            }
            return result.data;
        },
        onSuccess: () => {
            invalidateProduction();
        },
    });

    // Wrapper for backward compatibility
    const updateBatchWrapper = useMemo(() => ({
        mutate: (input: UpdateBatchInput) => updateBatchMutation.mutate(input),
        mutateAsync: (input: UpdateBatchInput) => updateBatchMutation.mutateAsync(input),
        isPending: updateBatchMutation.isPending,
        isError: updateBatchMutation.isError,
        error: updateBatchMutation.error,
    }), [updateBatchMutation.isPending, updateBatchMutation.isError, updateBatchMutation.error]);

    // ============================================
    // DELETE BATCH
    // ============================================
    const deleteBatchMutation = useMutation({
        mutationFn: async (input: { batchId: string }) => {
            const result = await deleteBatchFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to delete batch');
            }
            return result.data;
        },
        onSuccess: () => {
            invalidateProduction();
        },
    });

    // Wrapper for backward compatibility
    const deleteBatchWrapper = useMemo(() => ({
        mutate: (input: { batchId: string }) => deleteBatchMutation.mutate(input),
        mutateAsync: (input: { batchId: string }) => deleteBatchMutation.mutateAsync(input),
        isPending: deleteBatchMutation.isPending,
        isError: deleteBatchMutation.isError,
        error: deleteBatchMutation.error,
    }), [deleteBatchMutation.isPending, deleteBatchMutation.isError, deleteBatchMutation.error]);

    // ============================================
    // COMPLETE BATCH
    // ============================================
    const completeBatchMutation = useMutation({
        mutationFn: async (input: CompleteBatchInput) => {
            const result = await completeBatchFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to complete batch');
            }
            return result.data;
        },
        onSuccess: () => {
            invalidateProduction();
            invalidateInventory();
        },
    });

    // Wrapper for backward compatibility
    const completeBatchWrapper = useMemo(() => ({
        mutate: (input: CompleteBatchInput) => completeBatchMutation.mutate(input),
        mutateAsync: (input: CompleteBatchInput) => completeBatchMutation.mutateAsync(input),
        isPending: completeBatchMutation.isPending,
        isError: completeBatchMutation.isError,
        error: completeBatchMutation.error,
    }), [completeBatchMutation.isPending, completeBatchMutation.isError, completeBatchMutation.error]);

    // ============================================
    // UNCOMPLETE BATCH
    // ============================================
    const uncompleteBatchMutation = useMutation({
        mutationFn: async (input: { batchId: string }) => {
            const result = await uncompleteBatchFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to uncomplete batch');
            }
            return result.data;
        },
        onSuccess: () => {
            invalidateProduction();
            invalidateInventory();
        },
    });

    // Wrapper for backward compatibility
    const uncompleteBatchWrapper = useMemo(() => ({
        mutate: (input: { batchId: string }) => uncompleteBatchMutation.mutate(input),
        mutateAsync: (input: { batchId: string }) => uncompleteBatchMutation.mutateAsync(input),
        isPending: uncompleteBatchMutation.isPending,
        isError: uncompleteBatchMutation.isError,
        error: uncompleteBatchMutation.error,
    }), [uncompleteBatchMutation.isPending, uncompleteBatchMutation.isError, uncompleteBatchMutation.error]);

    // ============================================
    // LOCK DATE
    // ============================================
    const lockDateMutation = useMutation({
        mutationFn: async (input: LockDateInput) => {
            const result = await lockDateFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to lock date');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['production', 'lockedDates'] });
            trpcUtils.production.getLockedDates.invalidate();
        },
    });

    // Wrapper for backward compatibility
    const lockDateWrapper = useMemo(() => ({
        mutate: (input: LockDateInput) => lockDateMutation.mutate(input),
        mutateAsync: (input: LockDateInput) => lockDateMutation.mutateAsync(input),
        isPending: lockDateMutation.isPending,
        isError: lockDateMutation.isError,
        error: lockDateMutation.error,
    }), [lockDateMutation.isPending, lockDateMutation.isError, lockDateMutation.error]);

    // ============================================
    // UNLOCK DATE
    // ============================================
    const unlockDateMutation = useMutation({
        mutationFn: async (input: LockDateInput) => {
            const result = await unlockDateFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to unlock date');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['production', 'lockedDates'] });
            trpcUtils.production.getLockedDates.invalidate();
        },
    });

    // Wrapper for backward compatibility
    const unlockDateWrapper = useMemo(() => ({
        mutate: (input: LockDateInput) => unlockDateMutation.mutate(input),
        mutateAsync: (input: LockDateInput) => unlockDateMutation.mutateAsync(input),
        isPending: unlockDateMutation.isPending,
        isError: unlockDateMutation.isError,
        error: unlockDateMutation.error,
    }), [unlockDateMutation.isPending, unlockDateMutation.isError, unlockDateMutation.error]);

    return {
        createTailor: createTailorWrapper,
        createBatch: createBatchWrapper,
        updateBatch: updateBatchWrapper,
        deleteBatch: deleteBatchWrapper,
        completeBatch: completeBatchWrapper,
        uncompleteBatch: uncompleteBatchWrapper,
        lockDate: lockDateWrapper,
        unlockDate: unlockDateWrapper,
    };
}
