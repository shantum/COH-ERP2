/**
 * Order CRUD mutations
 * Handles creating, updating, deleting orders and notes
 */

import { useMutation } from '@tanstack/react-query';
import { ordersApi } from '../../services/api';
import { trpc } from '../../services/trpc';
import { useOrderInvalidation } from './orderMutationUtils';

export interface UseOrderCrudMutationsOptions {
    onCreateSuccess?: () => void;
    onDeleteSuccess?: () => void;
    onEditSuccess?: () => void;
    onNotesSuccess?: () => void;
}

export function useOrderCrudMutations(options: UseOrderCrudMutationsOptions = {}) {
    const { invalidateOpenOrders, invalidateAll } = useOrderInvalidation();

    const createOrder = trpc.orders.create.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            options.onCreateSuccess?.();
        },
        onError: (err) => {
            alert(err.message || 'Failed to create order');
        }
    });

    const deleteOrder = useMutation({
        mutationFn: (id: string) => ordersApi.delete(id),
        onSuccess: () => {
            invalidateAll();
            options.onDeleteSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to delete order')
    });

    const updateOrder = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => ordersApi.update(id, data),
        onSuccess: () => {
            invalidateOpenOrders();
            options.onEditSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update order')
    });

    const updateOrderNotes = useMutation({
        mutationFn: ({ id, notes }: { id: string; notes: string }) =>
            ordersApi.update(id, { internalNotes: notes }),
        onSuccess: () => {
            invalidateOpenOrders();
            options.onNotesSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update notes')
    });

    const updateLineNotes = useMutation({
        mutationFn: ({ lineId, notes }: { lineId: string; notes: string }) =>
            ordersApi.updateLine(lineId, { notes }),
        onSuccess: () => {
            invalidateOpenOrders();
            options.onNotesSuccess?.();
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to update line notes');
        }
    });

    const updateShipByDate = useMutation({
        mutationFn: ({ orderId, date }: { orderId: string; date: string | null }) =>
            ordersApi.update(orderId, { shipByDate: date }),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to update ship by date');
        }
    });

    return {
        createOrder,
        deleteOrder,
        updateOrder,
        updateOrderNotes,
        updateLineNotes,
        updateShipByDate,
    };
}
