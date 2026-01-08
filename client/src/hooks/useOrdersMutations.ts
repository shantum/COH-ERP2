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

    // Granular invalidation functions - only invalidate what's actually affected
    const invalidateOpenOrders = () => {
        queryClient.invalidateQueries({ queryKey: ['openOrders'] });
        queryClient.invalidateQueries({ queryKey: ['inventoryBalance'] });
    };

    const invalidateShippedOrders = () => {
        queryClient.invalidateQueries({ queryKey: ['shippedOrders'] });
        queryClient.invalidateQueries({ queryKey: ['shippedSummary'] });
    };

    const invalidateRtoOrders = () => {
        queryClient.invalidateQueries({ queryKey: ['rtoOrders'] });
        queryClient.invalidateQueries({ queryKey: ['rtoSummary'] });
    };

    const invalidateCodPendingOrders = () => {
        queryClient.invalidateQueries({ queryKey: ['codPendingOrders'] });
    };

    const invalidateCancelledOrders = () => {
        queryClient.invalidateQueries({ queryKey: ['cancelledOrders'] });
    };

    const invalidateArchivedOrders = () => {
        queryClient.invalidateQueries({ queryKey: ['archivedOrders'] });
    };

    // Keep invalidateAll for operations that truly affect multiple tabs (creation, deletion)
    const invalidateAll = () => {
        invalidateOpenOrders();
        invalidateShippedOrders();
        invalidateRtoOrders();
        invalidateCodPendingOrders();
        invalidateCancelledOrders();
        invalidateArchivedOrders();
    };

    // Ship order mutation - moves from open to shipped
    const ship = useMutation({
        mutationFn: ({ id, data }: { id: string; data: { awbNumber: string; courier: string } }) =>
            ordersApi.ship(id, data),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            options.onShipSuccess?.();
        },
        onError: (err: any) => {
            const errorData = err.response?.data;
            if (errorData?.details && Array.isArray(errorData.details)) {
                // Show validation details (e.g., AWB must be 8-20 characters)
                const messages = errorData.details.map((d: any) => d.message).join('\n');
                alert(`Validation failed:\n${messages}`);
            } else {
                alert(errorData?.error || 'Failed to ship order');
            }
        }
    });

    // Helper for optimistic line status updates
    // Returns previous data for rollback on error
    const optimisticLineUpdate = async (lineId: string, newStatus: string) => {
        // Cancel any outgoing refetches to avoid overwriting optimistic update
        await queryClient.cancelQueries({ queryKey: ['openOrders'] });

        // Snapshot the previous value
        const previousOrders = queryClient.getQueryData(['openOrders']);

        // Optimistically update the line status
        queryClient.setQueryData(['openOrders'], (old: any[] | undefined) => {
            if (!old) return old;
            return old.map(order => ({
                ...order,
                orderLines: order.orderLines?.map((line: any) =>
                    line.id === lineId ? { ...line, lineStatus: newStatus } : line
                )
            }));
        });

        return { previousOrders };
    };

    // Allocate/unallocate line mutations - only affects open orders (with optimistic updates)
    const allocate = useMutation({
        mutationFn: (lineId: string) => ordersApi.allocateLine(lineId),
        onMutate: (lineId) => optimisticLineUpdate(lineId, 'allocated'),
        onError: (err: any, _lineId, context) => {
            // Rollback on error
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to allocate line');
        },
        onSettled: () => invalidateOpenOrders()
    });

    const unallocate = useMutation({
        mutationFn: (lineId: string) => ordersApi.unallocateLine(lineId),
        onMutate: (lineId) => optimisticLineUpdate(lineId, 'pending'),
        onError: (err: any, _lineId, context) => {
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to unallocate line');
        },
        onSettled: () => invalidateOpenOrders()
    });

    // Pick/unpick line mutations - only affects open orders (with optimistic updates)
    const pickLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.pickLine(lineId),
        onMutate: (lineId) => optimisticLineUpdate(lineId, 'picked'),
        onError: (err: any, _lineId, context) => {
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to pick line');
        },
        onSettled: () => invalidateOpenOrders()
    });

    const unpickLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.unpickLine(lineId),
        onMutate: (lineId) => optimisticLineUpdate(lineId, 'allocated'),
        onError: (err: any, _lineId, context) => {
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to unpick line');
        },
        onSettled: () => invalidateOpenOrders()
    });

    // Pack/unpack line mutations - only affects open orders (with optimistic updates)
    const packLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.packLine(lineId),
        onMutate: (lineId) => optimisticLineUpdate(lineId, 'packed'),
        onError: (err: any, _lineId, context) => {
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to pack line');
        },
        onSettled: () => invalidateOpenOrders()
    });

    const unpackLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.unpackLine(lineId),
        onMutate: (lineId) => optimisticLineUpdate(lineId, 'picked'),
        onError: (err: any, _lineId, context) => {
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to unpack line');
        },
        onSettled: () => invalidateOpenOrders()
    });

    // Production batch mutations - only affects open orders
    const createBatch = useMutation({
        mutationFn: (data: any) => productionApi.createBatch(data),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to add to production')
    });

    const updateBatch = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => productionApi.updateBatch(id, data),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update batch')
    });

    const deleteBatch = useMutation({
        mutationFn: (id: string) => productionApi.deleteBatch(id),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to delete batch')
    });

    // Order CRUD mutations - these affect multiple tabs
    const createOrder = useMutation({
        mutationFn: (data: any) => ordersApi.create(data),
        onSuccess: () => {
            invalidateOpenOrders();
            options.onCreateSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create order')
    });

    const deleteOrder = useMutation({
        mutationFn: (id: string) => ordersApi.delete(id),
        onSuccess: () => {
            invalidateAll(); // Deletion can happen from any tab
            options.onDeleteSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to delete order')
    });

    const updateOrder = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => ordersApi.update(id, data),
        onSuccess: () => {
            invalidateOpenOrders(); // Editing only on open orders
            options.onEditSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update order')
    });

    const updateOrderNotes = useMutation({
        mutationFn: ({ id, notes }: { id: string; notes: string }) =>
            ordersApi.update(id, { internalNotes: notes }),
        onSuccess: () => {
            invalidateOpenOrders(); // Notes editing only on open orders
            options.onNotesSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update notes')
    });

    // Shipping status mutations - moves between shipped and open
    const unship = useMutation({
        mutationFn: (id: string) => ordersApi.unship(id),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to unship order')
    });

    // Delivery tracking mutations - affects shipped tab and potentially COD pending
    const markDelivered = useMutation({
        mutationFn: (id: string) => ordersApi.markDelivered(id),
        onSuccess: () => {
            invalidateShippedOrders();
            invalidateCodPendingOrders(); // May affect COD pending if it's a COD order
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to mark as delivered')
    });

    const markRto = useMutation({
        mutationFn: (id: string) => ordersApi.markRto(id),
        onSuccess: () => {
            invalidateShippedOrders();
            invalidateRtoOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to mark as RTO')
    });

    const receiveRto = useMutation({
        mutationFn: (id: string) => ordersApi.receiveRto(id),
        onSuccess: () => {
            invalidateRtoOrders();
            invalidateOpenOrders(); // Inventory may come back
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to receive RTO')
    });

    // Order status mutations
    const cancelOrder = useMutation({
        mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
            ordersApi.cancel(id, reason),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateCancelledOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to cancel order')
    });

    const uncancelOrder = useMutation({
        mutationFn: (id: string) => ordersApi.uncancel(id),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateCancelledOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to restore order')
    });

    const archiveOrder = useMutation({
        mutationFn: (id: string) => ordersApi.archive(id),
        onSuccess: () => {
            invalidateShippedOrders(); // Can archive from shipped
            invalidateArchivedOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to archive order')
    });

    const unarchiveOrder = useMutation({
        mutationFn: (id: string) => ordersApi.unarchive(id),
        onSuccess: () => {
            invalidateShippedOrders(); // Returns to shipped
            invalidateArchivedOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to restore order')
    });

    // Order line mutations - only affects open orders
    const cancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.cancelLine(lineId),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to cancel line')
    });

    const uncancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.uncancelLine(lineId),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to restore line')
    });

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

    // Customization mutations - only affects open orders
    const customizeLine = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data: { type: string; value: string; notes?: string } }) =>
            ordersApi.customizeLine(lineId, data),
        onSuccess: (response) => {
            console.log('[Customization Success]', response.data);
            invalidateOpenOrders();
        },
        onError: (err: any) => {
            console.error('[Customization Error]', {
                status: err.response?.status,
                data: err.response?.data,
                message: err.message,
            });
            const errorData = err.response?.data;
            if (errorData?.details && Array.isArray(errorData.details)) {
                // Show validation details
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
        mutationFn: (lineId: string) => ordersApi.removeCustomization(lineId),
        onSuccess: () => invalidateOpenOrders(),
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
        packLine,
        unpackLine,

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
