/**
 * useFabricMappingMutations - Mutations for Fabric Mapping view
 *
 * Handles batch saving of fabric assignments.
 * Groups changes by colourId and calls the link-variations endpoint for each.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bomApi } from '../../../../services/api';
import type { PendingFabricChange } from '../types';
import { productsTreeKeys } from '../../hooks/useProductsTree';
import { materialsTreeKeys } from '../../../materials/hooks/useMaterialsTree';

interface SaveFabricAssignmentsParams {
    changes: PendingFabricChange[];
    roleId: string;
}

interface SaveResult {
    success: boolean;
    savedCount: number;
    errors: Array<{ colourId: string; error: string }>;
}

/**
 * Hook for fabric mapping mutations
 */
export function useFabricMappingMutations() {
    const queryClient = useQueryClient();

    const saveAssignments = useMutation<SaveResult, Error, SaveFabricAssignmentsParams>({
        mutationFn: async ({ changes, roleId }) => {
            if (changes.length === 0) {
                return { success: true, savedCount: 0, errors: [] };
            }

            // Group changes by colourId (each colour can have multiple variations)
            const changesByColour = new Map<string, string[]>();
            for (const change of changes) {
                const existing = changesByColour.get(change.colourId) || [];
                existing.push(change.variationId);
                changesByColour.set(change.colourId, existing);
            }

            // Execute all link operations
            const errors: Array<{ colourId: string; error: string }> = [];
            let savedCount = 0;

            // Process each colour group in parallel
            const promises = Array.from(changesByColour.entries()).map(
                async ([colourId, variationIds]) => {
                    try {
                        await bomApi.linkVariationsToColour(colourId, variationIds, roleId);
                        savedCount += variationIds.length;
                    } catch (err: any) {
                        errors.push({
                            colourId,
                            error: err.response?.data?.error || err.message || 'Unknown error',
                        });
                    }
                }
            );

            await Promise.all(promises);

            return {
                success: errors.length === 0,
                savedCount,
                errors,
            };
        },
        onSuccess: () => {
            // Invalidate relevant queries
            queryClient.invalidateQueries({ queryKey: ['fabricMappingAssignments'] });
            queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
            queryClient.invalidateQueries({ queryKey: materialsTreeKeys.tree() });
        },
    });

    return {
        saveAssignments,
        isSaving: saveAssignments.isPending,
    };
}
