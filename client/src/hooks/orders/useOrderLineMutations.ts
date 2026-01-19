/**
 * Order line mutations
 * Handles updating lines, adding lines, and customization
 * Uses tRPC for all operations
 */

import { useMemo } from 'react';
import { trpc } from '../../services/trpc';
import { useOrderInvalidation } from './orderMutationUtils';

export interface UseOrderLineMutationsOptions {
    onEditSuccess?: () => void;
}

export function useOrderLineMutations(options: UseOrderLineMutationsOptions = {}) {
    const { invalidateOpenOrders } = useOrderInvalidation();

    // Update line via tRPC
    const updateLineMutation = trpc.orders.updateLine.useMutation({
        onSuccess: () => invalidateOpenOrders(),
        onError: (err) => alert(err.message || 'Failed to update line')
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
    }), [updateLineMutation.isPending, updateLineMutation.isError, updateLineMutation.error]);

    // Add line via tRPC
    const addLineMutation = trpc.orders.addLine.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            options.onEditSuccess?.();
        },
        onError: (err) => alert(err.message || 'Failed to add line')
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
    }), [addLineMutation.isPending, addLineMutation.isError, addLineMutation.error]);

    // Customize line via tRPC
    const customizeLineMutation = trpc.orders.customizeLine.useMutation({
        onSuccess: () => invalidateOpenOrders(),
        onError: (err) => {
            const errorMsg = err.message || '';
            if (errorMsg.includes('allocated') || errorMsg.includes('picked') || errorMsg.includes('packed')) {
                alert('Cannot customize: Line is already allocated/picked/packed. Unallocate first.');
            } else if (errorMsg.includes('already customized')) {
                alert('This line is already customized.');
            } else {
                alert(errorMsg || 'Failed to customize line');
            }
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const customizeLine = useMemo(() => ({
        mutate: ({ lineId, data }: { lineId: string; data: { type: 'length' | 'size' | 'measurements' | 'other'; value: string; notes?: string } }) =>
            customizeLineMutation.mutate({ lineId, type: data.type, value: data.value, notes: data.notes }),
        mutateAsync: ({ lineId, data }: { lineId: string; data: { type: 'length' | 'size' | 'measurements' | 'other'; value: string; notes?: string } }) =>
            customizeLineMutation.mutateAsync({ lineId, type: data.type, value: data.value, notes: data.notes }),
        isPending: customizeLineMutation.isPending,
        isError: customizeLineMutation.isError,
        error: customizeLineMutation.error,
    }), [customizeLineMutation.isPending, customizeLineMutation.isError, customizeLineMutation.error]);

    // Remove customization via tRPC
    const removeCustomizationMutation = trpc.orders.removeCustomization.useMutation({
        onSuccess: (data) => {
            invalidateOpenOrders();
            if (data.forcedCleanup) {
                alert(`Customization removed.\nCleared ${data.deletedTransactions} inventory transactions and ${data.deletedBatches} production batches.`);
            }
        },
        onError: (err, variables) => {
            const errorMsg = err.message || '';

            if (errorMsg.includes('inventory transactions exist') || errorMsg.includes('production batch exists')) {
                const confirmMsg = errorMsg.includes('inventory')
                    ? 'Inventory transactions exist for this custom SKU.\n\nForce remove? This will delete all inventory records for this custom item.'
                    : 'Production batches exist for this custom SKU.\n\nForce remove? This will delete all production records for this custom item.';

                if (window.confirm(confirmMsg)) {
                    removeCustomizationMutation.mutate({ lineId: variables.lineId, force: true });
                }
            } else {
                alert(errorMsg || 'Failed to remove customization');
            }
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const removeCustomization = useMemo(() => ({
        mutate: ({ lineId, force = false }: { lineId: string; force?: boolean }) =>
            removeCustomizationMutation.mutate({ lineId, force }),
        mutateAsync: ({ lineId, force = false }: { lineId: string; force?: boolean }) =>
            removeCustomizationMutation.mutateAsync({ lineId, force }),
        isPending: removeCustomizationMutation.isPending,
        isError: removeCustomizationMutation.isError,
        error: removeCustomizationMutation.error,
    }), [removeCustomizationMutation.isPending, removeCustomizationMutation.isError, removeCustomizationMutation.error]);

    return {
        updateLine,
        addLine,
        customizeLine,
        removeCustomization,
    };
}
