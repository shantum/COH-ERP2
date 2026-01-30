/**
 * useFabricMappingMutations - Mutations for Fabric Mapping view
 *
 * Handles batch saving of fabric assignments and clear operations.
 * Groups changes by colourId and calls the link-variations Server Function for each.
 * Clear operations are handled separately via clearVariationsFabricMapping.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { linkVariationsToColour, clearVariationsFabricMapping } from '../../../../server/functions/bomMutations';
import type { PendingFabricChange } from '../types';
import { CLEAR_FABRIC_VALUE } from '../types';
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
    const linkVariationsToColourFn = useServerFn(linkVariationsToColour);
    const clearVariationsFabricMappingFn = useServerFn(clearVariationsFabricMapping);

    const saveAssignments = useMutation<SaveResult, Error, SaveFabricAssignmentsParams>({
        mutationFn: async ({ changes, roleId }) => {
            if (changes.length === 0) {
                return { success: true, savedCount: 0, errors: [] };
            }

            // Separate clear operations from assignment operations
            const clearChanges: string[] = [];
            const assignmentChanges: PendingFabricChange[] = [];

            for (const change of changes) {
                if (change.isClear || change.colourId === CLEAR_FABRIC_VALUE) {
                    clearChanges.push(change.variationId);
                } else {
                    assignmentChanges.push(change);
                }
            }

            // Group assignment changes by colourId (each colour can have multiple variations)
            const changesByColour = new Map<string, string[]>();
            for (const change of assignmentChanges) {
                const existing = changesByColour.get(change.colourId) || [];
                existing.push(change.variationId);
                changesByColour.set(change.colourId, existing);
            }

            // Execute all operations
            const errors: Array<{ colourId: string; error: string }> = [];
            let savedCount = 0;

            // Process clear operations
            if (clearChanges.length > 0) {
                try {
                    const result = await clearVariationsFabricMappingFn({
                        data: { variationIds: clearChanges, roleId },
                    });
                    if (result.success) {
                        savedCount += clearChanges.length;
                    } else {
                        errors.push({
                            colourId: CLEAR_FABRIC_VALUE,
                            error: result.error?.message || 'Failed to clear assignments',
                        });
                    }
                } catch (err: unknown) {
                    errors.push({
                        colourId: CLEAR_FABRIC_VALUE,
                        error: err instanceof Error ? err.message : 'Unknown error',
                    });
                }
            }

            // Process assignment changes in parallel
            const promises = Array.from(changesByColour.entries()).map(
                async ([colourId, variationIds]) => {
                    try {
                        const result = await linkVariationsToColourFn({
                            data: { colourId, variationIds, roleId },
                        });
                        if (result.success) {
                            savedCount += variationIds.length;
                        } else {
                            errors.push({
                                colourId,
                                error: result.error?.message || 'Unknown error',
                            });
                        }
                    } catch (err: unknown) {
                        errors.push({
                            colourId,
                            error: err instanceof Error ? err.message : 'Unknown error',
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
