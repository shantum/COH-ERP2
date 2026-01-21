/**
 * Order CRUD mutations
 * Handles creating, updating, deleting orders and notes
 */

import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { trpc } from '../../services/trpc';
import { useOrderInvalidation } from './orderMutationUtils';
import { showError } from '../../utils/toast';
import {
    createOrder as createOrderFn,
    updateOrder as updateOrderFn,
    markPaid as markPaidFn,
    deleteOrder as deleteOrderFn,
} from '../../server/functions/orderMutations';

export interface UseOrderCrudMutationsOptions {
    onCreateSuccess?: () => void;
    onDeleteSuccess?: () => void;
    onEditSuccess?: () => void;
    onNotesSuccess?: () => void;
}

// Input type for createOrder Server Function
interface CreateOrderInput {
    orderNumber?: string;
    channel?: string;
    customerId?: string | null;
    customerName: string;
    customerEmail?: string | null;
    customerPhone?: string | null;
    shippingAddress?: string | null;
    internalNotes?: string | null;
    totalAmount?: number;
    shipByDate?: string | null;
    paymentMethod?: 'Prepaid' | 'COD';
    paymentStatus?: 'pending' | 'paid';
    isExchange?: boolean;
    originalOrderId?: string | null;
    lines: Array<{
        skuId: string;
        qty: number;
        unitPrice?: number;
        shippingAddress?: string | null;
    }>;
}

export function useOrderCrudMutations(options: UseOrderCrudMutationsOptions = {}) {
    const { invalidateOpenOrders, invalidateAll } = useOrderInvalidation();
    const trpcUtils = trpc.useUtils();

    // Server Function wrappers
    const createOrderServerFn = useServerFn(createOrderFn);
    const updateOrderServerFn = useServerFn(updateOrderFn);
    // markPaidServerFn will be used when markPaid mutation is added
    void markPaidFn; // Prevent unused import warning
    const deleteOrderServerFn = useServerFn(deleteOrderFn);

    // ============================================
    // CREATE ORDER
    // ============================================
    const createOrder = useMutation({
        mutationFn: async (input: CreateOrderInput) => {
            const result = await createOrderServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to create order');
            }
            return result.data;
        },
        onSuccess: () => {
            invalidateOpenOrders();
            options.onCreateSuccess?.();
        },
        onError: (err) => {
            showError('Failed to create order', { description: err instanceof Error ? err.message : String(err) });
        }
    });

    // ============================================
    // DELETE ORDER
    // ============================================
    const deleteOrderMutation = useMutation({
        mutationFn: async (input: { orderId: string }) => {
            const result = await deleteOrderServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to delete order');
            }
            return result.data;
        },
        onSuccess: () => {
            invalidateAll();
            options.onDeleteSuccess?.();
        },
        onError: (err) => showError('Failed to delete order', { description: err instanceof Error ? err.message : String(err) })
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const deleteOrder = useMemo(() => ({
        mutate: (id: string) => deleteOrderMutation.mutate({ orderId: id }),
        mutateAsync: (id: string) => deleteOrderMutation.mutateAsync({ orderId: id }),
        isPending: deleteOrderMutation.isPending,
        isError: deleteOrderMutation.isError,
        error: deleteOrderMutation.error,
    }), [deleteOrderMutation.isPending, deleteOrderMutation.isError, deleteOrderMutation.error]);

    // ============================================
    // UPDATE ORDER
    // ============================================
    const updateOrderMutation = useMutation({
        mutationFn: async (input: { orderId: string; customerName?: string; customerEmail?: string | null; customerPhone?: string | null; shippingAddress?: string | null; internalNotes?: string | null; shipByDate?: string | null; isExchange?: boolean }) => {
            const result = await updateOrderServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update order');
            }
            return result.data;
        },
        onSuccess: () => {
            invalidateOpenOrders();
            options.onEditSuccess?.();
        },
        onError: (err) => showError('Failed to update order', { description: err instanceof Error ? err.message : String(err) })
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

    // ============================================
    // UPDATE ORDER NOTES
    // Note: Uses the same updateOrder mutation but with specific field
    // ============================================
    const updateOrderNotesMutation = useMutation({
        mutationFn: async (input: { orderId: string; internalNotes: string }) => {
            const result = await updateOrderServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update notes');
            }
            return result.data;
        },
        onSuccess: () => {
            invalidateOpenOrders();
            options.onNotesSuccess?.();
        },
        onError: (err) => showError('Failed to update notes', { description: err instanceof Error ? err.message : String(err) })
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

    // ============================================
    // UPDATE LINE NOTES - Always tRPC (no Server Function equivalent)
    // ============================================
    const updateLineNotesMutation = trpc.orders.updateLine.useMutation({
        onSuccess: () => {
            // Simple: invalidate current view's cache, let it refetch
            trpcUtils.orders.list.invalidate();
            options.onNotesSuccess?.();
        },
        onError: (err) => {
            showError('Failed to update line notes', { description: err.message });
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

    // ============================================
    // UPDATE SHIP BY DATE
    // Note: Uses the same updateOrder mutation but with specific field
    // ============================================
    const updateShipByDateMutation = useMutation({
        mutationFn: async (input: { orderId: string; shipByDate: string | null }) => {
            const result = await updateOrderServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update ship by date');
            }
            return result.data;
        },
        onSuccess: () => {
            trpcUtils.orders.list.invalidate();
        },
        onError: (err) => {
            showError('Failed to update ship by date', { description: err instanceof Error ? err.message : String(err) });
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
