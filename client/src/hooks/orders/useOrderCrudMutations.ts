/**
 * Order CRUD mutations
 * Handles creating, updating, deleting orders and notes
 * Uses tRPC for all operations
 */

import { useMemo } from 'react';
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
    const trpcUtils = trpc.useUtils();

    // Create order (already tRPC)
    const createOrder = trpc.orders.create.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            options.onCreateSuccess?.();
        },
        onError: (err) => {
            alert(err.message || 'Failed to create order');
        }
    });

    // Delete order via tRPC
    const deleteOrderMutation = trpc.orders.deleteOrder.useMutation({
        onSuccess: () => {
            invalidateAll();
            options.onDeleteSuccess?.();
        },
        onError: (err) => alert(err.message || 'Failed to delete order')
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const deleteOrder = useMemo(() => ({
        mutate: (id: string) => deleteOrderMutation.mutate({ orderId: id }),
        mutateAsync: (id: string) => deleteOrderMutation.mutateAsync({ orderId: id }),
        isPending: deleteOrderMutation.isPending,
        isError: deleteOrderMutation.isError,
        error: deleteOrderMutation.error,
    }), [deleteOrderMutation.isPending, deleteOrderMutation.isError, deleteOrderMutation.error]);

    // Update order via tRPC
    const updateOrderMutation = trpc.orders.updateOrder.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            options.onEditSuccess?.();
        },
        onError: (err) => alert(err.message || 'Failed to update order')
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const updateOrder = useMemo(() => ({
        mutate: ({ id, data }: { id: string; data: { customerName?: string; customerEmail?: string | null; customerPhone?: string | null; shippingAddress?: string | null; internalNotes?: string | null; shipByDate?: string | null; isExchange?: boolean } }) =>
            updateOrderMutation.mutate({ orderId: id, ...data }),
        mutateAsync: ({ id, data }: { id: string; data: { customerName?: string; customerEmail?: string | null; customerPhone?: string | null; shippingAddress?: string | null; internalNotes?: string | null; shipByDate?: string | null; isExchange?: boolean } }) =>
            updateOrderMutation.mutateAsync({ orderId: id, ...data }),
        isPending: updateOrderMutation.isPending,
        isError: updateOrderMutation.isError,
        error: updateOrderMutation.error,
    }), [updateOrderMutation.isPending, updateOrderMutation.isError, updateOrderMutation.error]);

    // Update order notes via tRPC
    const updateOrderNotesMutation = trpc.orders.updateOrder.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            options.onNotesSuccess?.();
        },
        onError: (err) => alert(err.message || 'Failed to update notes')
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const updateOrderNotes = useMemo(() => ({
        mutate: ({ id, notes }: { id: string; notes: string }) =>
            updateOrderNotesMutation.mutate({ orderId: id, internalNotes: notes }),
        mutateAsync: ({ id, notes }: { id: string; notes: string }) =>
            updateOrderNotesMutation.mutateAsync({ orderId: id, internalNotes: notes }),
        isPending: updateOrderNotesMutation.isPending,
        isError: updateOrderNotesMutation.isError,
        error: updateOrderNotesMutation.error,
    }), [updateOrderNotesMutation.isPending, updateOrderNotesMutation.isError, updateOrderNotesMutation.error]);

    // Update line notes via tRPC
    const updateLineNotesMutation = trpc.orders.updateLine.useMutation({
        onSuccess: () => {
            // Simple: invalidate current view's cache, let it refetch
            trpcUtils.orders.list.invalidate();
            options.onNotesSuccess?.();
        },
        onError: (err) => {
            alert(err.message || 'Failed to update line notes');
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const updateLineNotes = useMemo(() => ({
        mutate: ({ lineId, notes }: { lineId: string; notes: string }) =>
            updateLineNotesMutation.mutate({ lineId, notes }),
        mutateAsync: ({ lineId, notes }: { lineId: string; notes: string }) =>
            updateLineNotesMutation.mutateAsync({ lineId, notes }),
        isPending: updateLineNotesMutation.isPending,
        isError: updateLineNotesMutation.isError,
        error: updateLineNotesMutation.error,
    }), [updateLineNotesMutation.isPending, updateLineNotesMutation.isError, updateLineNotesMutation.error]);

    // Update ship by date via tRPC
    const updateShipByDateMutation = trpc.orders.updateOrder.useMutation({
        onSuccess: () => {
            trpcUtils.orders.list.invalidate();
        },
        onError: (err) => {
            alert(err.message || 'Failed to update ship by date');
        }
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const updateShipByDate = useMemo(() => ({
        mutate: ({ orderId, date }: { orderId: string; date: string | null }) =>
            updateShipByDateMutation.mutate({ orderId, shipByDate: date }),
        mutateAsync: ({ orderId, date }: { orderId: string; date: string | null }) =>
            updateShipByDateMutation.mutateAsync({ orderId, shipByDate: date }),
        isPending: updateShipByDateMutation.isPending,
        isError: updateShipByDateMutation.isError,
        error: updateShipByDateMutation.error,
    }), [updateShipByDateMutation.isPending, updateShipByDateMutation.isError, updateShipByDateMutation.error]);

    return {
        createOrder,
        deleteOrder,
        updateOrder,
        updateOrderNotes,
        updateLineNotes,
        updateShipByDate,
    };
}
