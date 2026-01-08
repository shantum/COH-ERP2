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

// Context types for optimistic update mutations
type LineUpdateContext = { skipped: true } | { skipped?: false; previousOrders: unknown };
type InventoryUpdateContext = { skipped: true } | { skipped?: false; previousOrders: unknown; previousInventory: unknown };

export function useOrdersMutations(options: UseOrdersMutationsOptions = {}) {
    const queryClient = useQueryClient();

    // Debounced invalidation for rapid-fire operations (allocate/unallocate/pick/pack)
    // Waits for 800ms of inactivity before syncing with server
    const debounceTimerRef = { current: null as ReturnType<typeof setTimeout> | null };

    const debouncedInvalidateOpenOrders = () => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['openOrders'] });
            queryClient.invalidateQueries({ queryKey: ['inventoryBalance'] });
            debounceTimerRef.current = null;
        }, 800);
    };

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

    // Helper to get current line status from cache
    const getLineStatus = (lineId: string): string | null => {
        const orders = queryClient.getQueryData(['openOrders']) as any[] | undefined;
        if (!orders) return null;
        for (const order of orders) {
            const line = order.orderLines?.find((l: any) => l.id === lineId);
            if (line) return line.lineStatus;
        }
        return null;
    };

    // Helper for optimistic inventory balance updates (allocate/unallocate)
    // delta: +1 for allocate (increase reserved), -1 for unallocate (decrease reserved)
    const optimisticInventoryUpdate = async (lineId: string, newStatus: string, delta: number) => {
        await queryClient.cancelQueries({ queryKey: ['openOrders'] });
        await queryClient.cancelQueries({ queryKey: ['inventoryBalance'] });

        const previousOrders = queryClient.getQueryData(['openOrders']);
        const previousInventory = queryClient.getQueryData(['inventoryBalance']);

        // Find the line to get skuId and qty
        let skuId: string | null = null;
        let qty = 0;
        const orders = previousOrders as any[] | undefined;
        if (orders) {
            for (const order of orders) {
                const line = order.orderLines?.find((l: any) => l.id === lineId);
                if (line) {
                    skuId = line.skuId;
                    qty = line.qty || 1;
                    break;
                }
            }
        }

        // Update line status in openOrders
        queryClient.setQueryData(['openOrders'], (old: any[] | undefined) => {
            if (!old) return old;
            return old.map(order => ({
                ...order,
                orderLines: order.orderLines?.map((line: any) =>
                    line.id === lineId ? { ...line, lineStatus: newStatus } : line
                )
            }));
        });

        // Update inventory balance for the affected SKU
        if (skuId && previousInventory) {
            queryClient.setQueryData(['inventoryBalance'], (old: any[] | undefined) => {
                if (!old) return old;
                return old.map((item: any) => {
                    if (item.skuId === skuId) {
                        const reservedChange = qty * delta;
                        return {
                            ...item,
                            totalReserved: (item.totalReserved || 0) + reservedChange,
                            availableBalance: (item.availableBalance || 0) - reservedChange,
                        };
                    }
                    return item;
                });
            });
        }

        return { previousOrders, previousInventory };
    };

    // Allocate/unallocate line mutations - only affects open orders (with optimistic updates)
    // These also optimistically update inventory balance for instant stock column feedback
    // Uses debounced invalidation for rapid-fire clicking through the table
    const allocate = useMutation<unknown, any, string, InventoryUpdateContext>({
        mutationFn: (lineId: string) => ordersApi.allocateLine(lineId),
        onMutate: async (lineId): Promise<InventoryUpdateContext> => {
            const status = getLineStatus(lineId);
            // Skip if already allocated or has wrong status
            if (status !== 'pending') return { skipped: true };
            return optimisticInventoryUpdate(lineId, 'allocated', 1);
        },
        onError: (err: any, _lineId, context) => {
            if (context?.skipped) return;
            const errorMsg = err.response?.data?.error || '';
            // Suppress state-mismatch errors from rapid clicking - just sync with server
            if (errorMsg.includes('pending') || errorMsg.includes('allocated')) {
                debouncedInvalidateOpenOrders();
                return;
            }
            // Rollback for other errors
            if (context && 'previousOrders' in context) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            if (context && 'previousInventory' in context) {
                queryClient.setQueryData(['inventoryBalance'], context.previousInventory);
            }
            alert(errorMsg || 'Failed to allocate line');
        },
        onSettled: (_data, _err, _lineId, context) => {
            if (context?.skipped) return;
            debouncedInvalidateOpenOrders();
        }
    });

    const unallocate = useMutation<unknown, any, string, InventoryUpdateContext>({
        mutationFn: (lineId: string) => ordersApi.unallocateLine(lineId),
        onMutate: async (lineId): Promise<InventoryUpdateContext> => {
            const status = getLineStatus(lineId);
            // Skip if not allocated
            if (status !== 'allocated') return { skipped: true };
            return optimisticInventoryUpdate(lineId, 'pending', -1);
        },
        onError: (err: any, _lineId, context) => {
            if (context?.skipped) return;
            const errorMsg = err.response?.data?.error || '';
            // Suppress state-mismatch errors from rapid clicking - just sync with server
            if (errorMsg.includes('pending') || errorMsg.includes('allocated')) {
                debouncedInvalidateOpenOrders();
                return;
            }
            // Rollback for other errors
            if (context && 'previousOrders' in context) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            if (context && 'previousInventory' in context) {
                queryClient.setQueryData(['inventoryBalance'], context.previousInventory);
            }
            alert(errorMsg || 'Failed to unallocate line');
        },
        onSettled: (_data, _err, _lineId, context) => {
            if (context?.skipped) return;
            debouncedInvalidateOpenOrders();
        }
    });

    // Pick/unpick line mutations - only affects open orders (with optimistic updates)
    const pickLine = useMutation<unknown, any, string, LineUpdateContext>({
        mutationFn: (lineId: string) => ordersApi.pickLine(lineId),
        onMutate: async (lineId): Promise<LineUpdateContext> => {
            const status = getLineStatus(lineId);
            if (status !== 'allocated') return { skipped: true };
            return optimisticLineUpdate(lineId, 'picked');
        },
        onError: (err: any, _lineId, context) => {
            if (context?.skipped) return;
            const errorMsg = err.response?.data?.error || '';
            // Suppress state-mismatch errors from rapid clicking
            if (errorMsg.includes('allocated') || errorMsg.includes('picked')) {
                debouncedInvalidateOpenOrders();
                return;
            }
            if (context && 'previousOrders' in context) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(errorMsg || 'Failed to pick line');
        },
        onSettled: (_data, _err, _lineId, context) => {
            if (context?.skipped) return;
            debouncedInvalidateOpenOrders();
        }
    });

    const unpickLine = useMutation<unknown, any, string, LineUpdateContext>({
        mutationFn: (lineId: string) => ordersApi.unpickLine(lineId),
        onMutate: async (lineId): Promise<LineUpdateContext> => {
            const status = getLineStatus(lineId);
            if (status !== 'picked') return { skipped: true };
            return optimisticLineUpdate(lineId, 'allocated');
        },
        onError: (err: any, _lineId, context) => {
            if (context?.skipped) return;
            const errorMsg = err.response?.data?.error || '';
            // Suppress state-mismatch errors from rapid clicking
            if (errorMsg.includes('allocated') || errorMsg.includes('picked')) {
                debouncedInvalidateOpenOrders();
                return;
            }
            if (context && 'previousOrders' in context) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(errorMsg || 'Failed to unpick line');
        },
        onSettled: (_data, _err, _lineId, context) => {
            if (context?.skipped) return;
            debouncedInvalidateOpenOrders();
        }
    });

    // Pack/unpack line mutations - only affects open orders (with optimistic updates)
    const packLine = useMutation<unknown, any, string, LineUpdateContext>({
        mutationFn: (lineId: string) => ordersApi.packLine(lineId),
        onMutate: async (lineId): Promise<LineUpdateContext> => {
            const status = getLineStatus(lineId);
            if (status !== 'picked') return { skipped: true };
            return optimisticLineUpdate(lineId, 'packed');
        },
        onError: (err: any, _lineId, context) => {
            if (context?.skipped) return;
            const errorMsg = err.response?.data?.error || '';
            // Suppress state-mismatch errors from rapid clicking
            if (errorMsg.includes('picked') || errorMsg.includes('packed')) {
                debouncedInvalidateOpenOrders();
                return;
            }
            if (context && 'previousOrders' in context) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(errorMsg || 'Failed to pack line');
        },
        onSettled: (_data, _err, _lineId, context) => {
            if (context?.skipped) return;
            debouncedInvalidateOpenOrders();
        }
    });

    const unpackLine = useMutation<unknown, any, string, LineUpdateContext>({
        mutationFn: (lineId: string) => ordersApi.unpackLine(lineId),
        onMutate: async (lineId): Promise<LineUpdateContext> => {
            const status = getLineStatus(lineId);
            if (status !== 'packed') return { skipped: true };
            return optimisticLineUpdate(lineId, 'picked');
        },
        onError: (err: any, _lineId, context) => {
            if (context?.skipped) return;
            const errorMsg = err.response?.data?.error || '';
            // Suppress state-mismatch errors from rapid clicking
            if (errorMsg.includes('picked') || errorMsg.includes('packed')) {
                debouncedInvalidateOpenOrders();
                return;
            }
            if (context && 'previousOrders' in context) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(errorMsg || 'Failed to unpack line');
        },
        onSettled: (_data, _err, _lineId, context) => {
            if (context?.skipped) return;
            debouncedInvalidateOpenOrders();
        }
    });

    // Production batch mutations - only affects open orders (with optimistic updates)
    const createBatch = useMutation({
        mutationFn: (data: any) => productionApi.createBatch(data),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to add to production')
    });

    const updateBatch = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => productionApi.updateBatch(id, data),
        onMutate: async ({ id, data }) => {
            // Cancel outgoing refetches to avoid overwriting optimistic update
            await queryClient.cancelQueries({ queryKey: ['openOrders'] });

            // Snapshot previous value for rollback
            const previousOrders = queryClient.getQueryData(['openOrders']);

            // Optimistically update the batch in nested orderLines
            queryClient.setQueryData(['openOrders'], (old: any[] | undefined) => {
                if (!old) return old;
                return old.map(order => ({
                    ...order,
                    orderLines: order.orderLines?.map((line: any) =>
                        line.productionBatch?.id === id
                            ? { ...line, productionBatch: { ...line.productionBatch, ...data } }
                            : line
                    )
                }));
            });

            return { previousOrders };
        },
        onError: (err: any, _vars, context) => {
            // Rollback on error
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to update batch');
        },
        onSettled: () => invalidateOpenOrders()
    });

    const deleteBatch = useMutation({
        mutationFn: (id: string) => productionApi.deleteBatch(id),
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: ['openOrders'] });
            const previousOrders = queryClient.getQueryData(['openOrders']);

            // Optimistically remove the batch from orderLines
            queryClient.setQueryData(['openOrders'], (old: any[] | undefined) => {
                if (!old) return old;
                return old.map(order => ({
                    ...order,
                    orderLines: order.orderLines?.map((line: any) =>
                        line.productionBatch?.id === id
                            ? { ...line, productionBatch: null, productionBatchId: null }
                            : line
                    )
                }));
            });

            return { previousOrders };
        },
        onError: (err: any, _id, context) => {
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to delete batch');
        },
        onSettled: () => invalidateOpenOrders()
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

    // Update line notes - affects open orders (with optimistic updates for instant feedback)
    const updateLineNotes = useMutation({
        mutationFn: ({ lineId, notes }: { lineId: string; notes: string }) =>
            ordersApi.updateLine(lineId, { notes }),
        onMutate: async ({ lineId, notes }) => {
            // Cancel outgoing refetches
            await queryClient.cancelQueries({ queryKey: ['openOrders'] });
            const previousOrders = queryClient.getQueryData(['openOrders']);

            // Optimistically update line notes in cache (openOrders is stored as array)
            queryClient.setQueryData(['openOrders'], (old: any[] | undefined) => {
                if (!old) return old;
                return old.map(order => ({
                    ...order,
                    orderLines: order.orderLines?.map((line: any) =>
                        line.id === lineId ? { ...line, notes } : line
                    )
                }));
            });

            return { previousOrders };
        },
        onError: (err: any, _vars, context) => {
            // Rollback on error
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to update line notes');
        },
        onSuccess: () => options.onNotesSuccess?.(),
        // No need to invalidate - optimistic update is sufficient, server confirmed
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

    // Quick ship - force ship without allocate/pick/pack (testing only)
    const quickShip = useMutation({
        mutationFn: (id: string) => ordersApi.quickShip(id),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to quick ship order')
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
        onSuccess: () => {
            invalidateOpenOrders();
        },
        onError: (err: any) => {
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
        quickShip,

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
        updateLineNotes,
        addLine,

        // Customization
        customizeLine,
        removeCustomization,

        // Helper
        invalidateAll,
    };
}

export default useOrdersMutations;
