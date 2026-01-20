/**
 * Production data hooks using tRPC
 *
 * Query hooks for production batches, tailors, capacity, and requirements.
 *
 * @example
 * // In a component
 * const { data: batches, isLoading } = useBatches({ startDate, endDate });
 * const { data: tailors } = useTailors();
 * const { data: capacity } = useCapacity(selectedDate);
 */

import { trpc } from '../../services/trpc';

// ============================================
// QUERY HOOKS
// ============================================

/**
 * Get all active tailors
 */
export function useTailors() {
    return trpc.production.getTailors.useQuery();
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
    return trpc.production.getBatches.useQuery(options ?? {});
}

/**
 * Get locked production dates
 */
export function useLockedDates() {
    return trpc.production.getLockedDates.useQuery();
}

/**
 * Get tailor capacity for a specific date
 */
export function useCapacity(date?: string) {
    return trpc.production.getCapacity.useQuery({ date });
}

/**
 * Get production requirements from open orders
 * @param enabled - Whether to enable the query (for lazy loading)
 */
export function useRequirements(enabled = true) {
    return trpc.production.getRequirements.useQuery(undefined, { enabled });
}

/**
 * Get pending production batches for a specific SKU
 */
export function usePendingBySku(skuId: string, enabled = true) {
    return trpc.production.getPendingBySku.useQuery({ skuId }, { enabled: enabled && !!skuId });
}

// ============================================
// MUTATION HOOKS
// ============================================

/**
 * Hook for production mutations with cache invalidation
 *
 * @example
 * const mutations = useProductionMutations();
 * mutations.createBatch.mutate({ skuId, qtyPlanned: 10, batchDate: '2026-01-20' });
 */
export function useProductionMutations() {
    const trpcUtils = trpc.useUtils();

    const invalidateProduction = () => {
        trpcUtils.production.getBatches.invalidate();
        trpcUtils.production.getCapacity.invalidate();
        trpcUtils.production.getRequirements.invalidate();
    };

    const createTailor = trpc.production.createTailor.useMutation({
        onSuccess: () => {
            trpcUtils.production.getTailors.invalidate();
        },
    });

    const createBatch = trpc.production.createBatch.useMutation({
        onSuccess: () => {
            invalidateProduction();
            trpcUtils.inventory.getBalances.invalidate();
        },
    });

    const updateBatch = trpc.production.updateBatch.useMutation({
        onSuccess: () => {
            invalidateProduction();
        },
    });

    const deleteBatch = trpc.production.deleteBatch.useMutation({
        onSuccess: () => {
            invalidateProduction();
        },
    });

    const completeBatch = trpc.production.completeBatch.useMutation({
        onSuccess: () => {
            invalidateProduction();
            trpcUtils.inventory.getBalances.invalidate();
            trpcUtils.inventory.getAllBalances.invalidate();
        },
    });

    const uncompleteBatch = trpc.production.uncompleteBatch.useMutation({
        onSuccess: () => {
            invalidateProduction();
            trpcUtils.inventory.getBalances.invalidate();
            trpcUtils.inventory.getAllBalances.invalidate();
        },
    });

    const lockDate = trpc.production.lockDate.useMutation({
        onSuccess: () => {
            trpcUtils.production.getLockedDates.invalidate();
        },
    });

    const unlockDate = trpc.production.unlockDate.useMutation({
        onSuccess: () => {
            trpcUtils.production.getLockedDates.invalidate();
        },
    });

    return {
        createTailor,
        createBatch,
        updateBatch,
        deleteBatch,
        completeBatch,
        uncompleteBatch,
        lockDate,
        unlockDate,
    };
}
