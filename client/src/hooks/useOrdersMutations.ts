/**
 * useOrdersMutations hook
 * Centralizes all mutations for the Orders page
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi, productionApi } from '../services/api';

interface UseOrdersMutationsOptions {
    onShipSuccess?: () => void;
    onCreateSuccess?: () => void;
    onDeleteSuccess?: () => void;
    onEditSuccess?: () => void;
    onNotesSuccess?: () => void;
}

export function useOrdersMutations(options: UseOrdersMutationsOptions = {}) {
    const queryClient = useQueryClient();

    // Invalidate all order-related queries
    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: ['openOrders'] });
        queryClient.invalidateQueries({ queryKey: ['shippedOrders'] });
        queryClient.invalidateQueries({ queryKey: ['cancelledOrders'] });
        queryClient.invalidateQueries({ queryKey: ['archivedOrders'] });
        queryClient.invalidateQueries({ queryKey: ['inventoryBalance'] });
    };

    // Ship order mutation
    const ship = useMutation({
        mutationFn: ({ id, data }: { id: string; data: { awbNumber: string; courier: string } }) =>
            ordersApi.ship(id, data),
        onSuccess: () => {
            invalidateAll();
            options.onShipSuccess?.();
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to ship order');
        }
    });

    // Allocate/unallocate line mutations
    const allocate = useMutation({
        mutationFn: (lineId: string) => ordersApi.allocateLine(lineId),
        onSettled: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to allocate line')
    });

    const unallocate = useMutation({
        mutationFn: (lineId: string) => ordersApi.unallocateLine(lineId),
        onSettled: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to unallocate line')
    });

    // Pick/unpick line mutations
    const pickLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.pickLine(lineId),
        onSettled: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to pick line')
    });

    const unpickLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.unpickLine(lineId),
        onSettled: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to unpick line')
    });

    // Production batch mutations
    const createBatch = useMutation({
        mutationFn: (data: any) => productionApi.createBatch(data),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to add to production')
    });

    const updateBatch = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => productionApi.updateBatch(id, data),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update batch')
    });

    const deleteBatch = useMutation({
        mutationFn: (id: string) => productionApi.deleteBatch(id),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to delete batch')
    });

    // Order CRUD mutations
    const createOrder = useMutation({
        mutationFn: (data: any) => ordersApi.create(data),
        onSuccess: () => {
            invalidateAll();
            options.onCreateSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create order')
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
            invalidateAll();
            options.onEditSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update order')
    });

    const updateOrderNotes = useMutation({
        mutationFn: ({ id, notes }: { id: string; notes: string }) =>
            ordersApi.update(id, { internalNotes: notes }),
        onSuccess: () => {
            invalidateAll();
            options.onNotesSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update notes')
    });

    // Shipping status mutations
    const unship = useMutation({
        mutationFn: (id: string) => ordersApi.unship(id),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to unship order')
    });

    // Delivery tracking mutations
    const markDelivered = useMutation({
        mutationFn: (id: string) => ordersApi.markDelivered(id),
        onSuccess: () => {
            invalidateAll();
            queryClient.invalidateQueries({ queryKey: ['shippedSummary'] });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to mark as delivered')
    });

    const markRto = useMutation({
        mutationFn: (id: string) => ordersApi.markRto(id),
        onSuccess: () => {
            invalidateAll();
            queryClient.invalidateQueries({ queryKey: ['shippedSummary'] });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to mark as RTO')
    });

    const receiveRto = useMutation({
        mutationFn: (id: string) => ordersApi.receiveRto(id),
        onSuccess: () => {
            invalidateAll();
            queryClient.invalidateQueries({ queryKey: ['shippedSummary'] });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to receive RTO')
    });

    // Order status mutations
    const cancelOrder = useMutation({
        mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
            ordersApi.cancel(id, reason),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to cancel order')
    });

    const uncancelOrder = useMutation({
        mutationFn: (id: string) => ordersApi.uncancel(id),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to restore order')
    });

    const archiveOrder = useMutation({
        mutationFn: (id: string) => ordersApi.archive(id),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to archive order')
    });

    const unarchiveOrder = useMutation({
        mutationFn: (id: string) => ordersApi.unarchive(id),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to restore order')
    });

    // Order line mutations
    const cancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.cancelLine(lineId),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to cancel line')
    });

    const uncancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.uncancelLine(lineId),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to restore line')
    });

    const updateLine = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data: any }) =>
            ordersApi.updateLine(lineId, data),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update line')
    });

    const addLine = useMutation({
        mutationFn: ({ orderId, data }: { orderId: string; data: any }) =>
            ordersApi.addLine(orderId, data),
        onSuccess: () => {
            invalidateAll();
            options.onEditSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to add line')
    });

    // Customization mutations
    const customizeLine = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data: { type: string; value: string; notes?: string } }) =>
            ordersApi.customizeLine(lineId, data),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to customize line')
    });

    const removeCustomization = useMutation({
        mutationFn: (lineId: string) => ordersApi.removeCustomization(lineId),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to remove customization')
    });

    return {
        // Ship
        ship,
        unship,

        // Delivery tracking
        markDelivered,
        markRto,
        receiveRto,

        // Allocate/Pick
        allocate,
        unallocate,
        pickLine,
        unpickLine,

        // Production
        createBatch,
        updateBatch,
        deleteBatch,

        // Order CRUD
        createOrder,
        deleteOrder,
        updateOrder,
        updateOrderNotes,

        // Order status
        cancelOrder,
        uncancelOrder,
        archiveOrder,
        unarchiveOrder,

        // Order lines
        cancelLine,
        uncancelLine,
        updateLine,
        addLine,

        // Customization
        customizeLine,
        removeCustomization,

        // Helper
        invalidateAll,
    };
}

export default useOrdersMutations;
