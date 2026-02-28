/**
 * Order line mutations
 * Handles updating lines, adding lines, and customization
 */

import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useOrderInvalidation } from './orderMutationUtils';
import { showError, showInfo } from '../../utils/toast';
import {
    updateLine as updateLineFn,
    addLine as addLineFn,
    customizeLine as customizeLineFn,
    removeLineCustomization as removeLineCustomizationFn,
} from '../../server/functions/orderMutations';

export interface UseOrderLineMutationsOptions {
    onEditSuccess?: () => void;
}

export function useOrderLineMutations(options: UseOrderLineMutationsOptions = {}) {
    const { invalidateOpenOrders } = useOrderInvalidation();

    // Server Function wrappers
    const updateLineServerFn = useServerFn(updateLineFn);
    const addLineServerFn = useServerFn(addLineFn);
    const customizeLineServerFn = useServerFn(customizeLineFn);
    const removeLineCustomizationServerFn = useServerFn(removeLineCustomizationFn);

    // ============================================
    // UPDATE LINE
    // ============================================
    const updateLineMutation = useMutation({
        mutationFn: async (input: { lineId: string; qty?: number; unitPrice?: number; notes?: string; awbNumber?: string; courier?: string }) => {
            const result = await updateLineServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update line');
            }
            return result.data;
        },
        onSuccess: () => invalidateOpenOrders(),
        onError: (err) => showError('Failed to update line', { description: err instanceof Error ? err.message : String(err) })
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const updateLine = useMemo(() => ({
        mutate: ({ lineId, data }: { lineId: string; data: { qty?: number; unitPrice?: number; notes?: string; awbNumber?: string; courier?: string } }) =>
            updateLineMutation.mutate({ lineId, ...data }),
        mutateAsync: ({ lineId, data }: { lineId: string; data: { qty?: number; unitPrice?: number; notes?: string; awbNumber?: string; courier?: string } }) =>
            updateLineMutation.mutateAsync({ lineId, ...data }),
        isPending: updateLineMutation.isPending,
        isError: updateLineMutation.isError,
        error: updateLineMutation.error,
    }), [updateLineMutation]);

    // ============================================
    // ADD LINE
    // ============================================
    const addLineMutation = useMutation({
        mutationFn: async (input: { orderId: string; skuId: string; qty: number; unitPrice: number }) => {
            const result = await addLineServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to add line');
            }
            return result.data;
        },
        onSuccess: () => {
            invalidateOpenOrders();
            options.onEditSuccess?.();
        },
        onError: (err) => showError('Failed to add line', { description: err instanceof Error ? err.message : String(err) })
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const addLine = useMemo(() => ({
        mutate: ({ orderId, data }: { orderId: string; data: { skuId: string; qty: number; unitPrice: number } }) =>
            addLineMutation.mutate({ orderId, ...data }),
        mutateAsync: ({ orderId, data }: { orderId: string; data: { skuId: string; qty: number; unitPrice: number } }) =>
            addLineMutation.mutateAsync({ orderId, ...data }),
        isPending: addLineMutation.isPending,
        isError: addLineMutation.isError,
        error: addLineMutation.error,
    }), [addLineMutation]);

    // ============================================
    // CUSTOMIZE LINE
    // ============================================
    const customizeLineMutation = useMutation({
        mutationFn: async (input: { lineId: string; type: 'length' | 'size' | 'measurements' | 'other'; value: string; notes?: string }) => {
            const result = await customizeLineServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to customize line');
            }
            return result.data;
        },
        onSuccess: () => invalidateOpenOrders(),
        onError: (err) => {
            const errorMsg = err instanceof Error ? err.message : String(err);
            if (errorMsg.includes('allocated') || errorMsg.includes('picked') || errorMsg.includes('packed')) {
                showError('Cannot customize', { description: 'Line is already allocated/picked/packed. Unallocate first.' });
            } else if (errorMsg.includes('already customized')) {
                showError('Cannot customize', { description: 'This line is already customized.' });
            } else {
                showError('Failed to customize line', { description: errorMsg });
            }
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const customizeLine = useMemo(() => ({
        mutate: ({ lineId, data }: { lineId: string; data: { type: 'length' | 'size' | 'measurements' | 'other'; value: string; notes?: string } }, mutationOptions?: { onSuccess?: () => void; onError?: (err: unknown) => void; onSettled?: () => void }) =>
            customizeLineMutation.mutate({ lineId, type: data.type, value: data.value, notes: data.notes }, mutationOptions),
        mutateAsync: ({ lineId, data }: { lineId: string; data: { type: 'length' | 'size' | 'measurements' | 'other'; value: string; notes?: string } }) =>
            customizeLineMutation.mutateAsync({ lineId, type: data.type, value: data.value, notes: data.notes }),
        isPending: customizeLineMutation.isPending,
        isError: customizeLineMutation.isError,
        error: customizeLineMutation.error,
    }), [customizeLineMutation]);

    // ============================================
    // REMOVE CUSTOMIZATION
    // ============================================
    const removeCustomizationMutation = useMutation({
        mutationFn: async (input: { lineId: string; force?: boolean }) => {
            const result = await removeLineCustomizationServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to remove customization');
            }
            return result.data;
        },
        onSuccess: (data) => {
            invalidateOpenOrders();
            if (data?.forcedCleanup) {
                // Server Function result includes these fields when force is used
                const deletedTransactions = (data as { deletedTransactions?: number }).deletedTransactions || 0;
                const deletedBatches = (data as { deletedBatches?: number }).deletedBatches || 0;
                showInfo('Customization removed', { description: `Cleared ${deletedTransactions} inventory transactions and ${deletedBatches} production batches.` });
            }
        },
        onError: (err, variables) => {
            const errorMsg = err instanceof Error ? err.message : String(err);

            if (errorMsg.includes('inventory transactions exist') || errorMsg.includes('production batch exists')) {
                const confirmMsg = errorMsg.includes('inventory')
                    ? 'Inventory transactions exist for this custom SKU.\n\nForce remove? This will delete all inventory records for this custom item.'
                    : 'Production batches exist for this custom SKU.\n\nForce remove? This will delete all production records for this custom item.';

                if (window.confirm(confirmMsg)) {
                    removeCustomizationMutation.mutate({ lineId: variables.lineId, force: true });
                }
            } else {
                showError('Failed to remove customization', { description: errorMsg });
            }
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const removeCustomization = useMemo(() => ({
        mutate: ({ lineId, force = false }: { lineId: string; force?: boolean }, mutationOptions?: { onSuccess?: () => void; onError?: (err: unknown) => void; onSettled?: () => void }) =>
            removeCustomizationMutation.mutate({ lineId, force }, mutationOptions),
        mutateAsync: ({ lineId, force = false }: { lineId: string; force?: boolean }) =>
            removeCustomizationMutation.mutateAsync({ lineId, force }),
        isPending: removeCustomizationMutation.isPending,
        isError: removeCustomizationMutation.isError,
        error: removeCustomizationMutation.error,
    }), [removeCustomizationMutation]);

    return {
        updateLine,
        addLine,
        customizeLine,
        removeCustomization,
    };
}
