/**
 * Order line mutations
 * Handles updating lines, adding lines, and customization
 */

import { useMutation } from '@tanstack/react-query';
import { ordersApi } from '../../services/api';
import { useOrderInvalidation } from './orderMutationUtils';

export interface UseOrderLineMutationsOptions {
    onEditSuccess?: () => void;
}

export function useOrderLineMutations(options: UseOrderLineMutationsOptions = {}) {
    const { invalidateOpenOrders } = useOrderInvalidation();

    const updateLine = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data: any }) =>
            ordersApi.updateLine(lineId, data),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update line')
    });

    const addLine = useMutation({
        mutationFn: ({ orderId, data }: { orderId: string; data: any }) =>
            ordersApi.addLine(orderId, data),
        onSuccess: () => {
            invalidateOpenOrders();
            options.onEditSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to add line')
    });

    const customizeLine = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data: { type: string; value: string; notes?: string } }) =>
            ordersApi.customizeLine(lineId, data),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => {
            const errorData = err.response?.data;
            if (errorData?.details && Array.isArray(errorData.details)) {
                const messages = errorData.details.map((d: any) => `${d.path}: ${d.message}`).join('\n');
                alert(`Validation failed:\n${messages}`);
            } else if (errorData?.code === 'LINE_NOT_PENDING') {
                alert('Cannot customize: Line is already allocated/picked/packed. Unallocate first.');
            } else if (errorData?.code === 'ALREADY_CUSTOMIZED') {
                alert('This line is already customized.');
            } else {
                alert(errorData?.error || 'Failed to customize line');
            }
        }
    });

    const removeCustomization = useMutation({
        mutationFn: ({ lineId, force = false }: { lineId: string; force?: boolean }) =>
            ordersApi.removeCustomization(lineId, { force }),
        onSuccess: (response: any) => {
            invalidateOpenOrders();
            if (response.data?.forcedCleanup) {
                alert(`Customization removed.\nCleared ${response.data.deletedTransactions} inventory transactions and ${response.data.deletedBatches} production batches.`);
            }
        },
        onError: (err: any, variables) => {
            const errorCode = err.response?.data?.code;
            const errorMsg = err.response?.data?.error;

            if (errorCode === 'CANNOT_UNDO_HAS_INVENTORY' || errorCode === 'CANNOT_UNDO_HAS_PRODUCTION') {
                const confirmMsg = errorCode === 'CANNOT_UNDO_HAS_INVENTORY'
                    ? 'Inventory transactions exist for this custom SKU.\n\nForce remove? This will delete all inventory records for this custom item.'
                    : 'Production batches exist for this custom SKU.\n\nForce remove? This will delete all production records for this custom item.';

                if (window.confirm(confirmMsg)) {
                    removeCustomization.mutate({ lineId: variables.lineId, force: true });
                }
            } else {
                alert(errorMsg || 'Failed to remove customization');
            }
        }
    });

    return {
        updateLine,
        addLine,
        customizeLine,
        removeCustomization,
    };
}
