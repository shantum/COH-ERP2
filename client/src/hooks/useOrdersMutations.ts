/**
 * useOrdersMutations hook
 * Centralizes all mutations for the Orders page
 *
 * SIMPLIFIED: No optimistic updates.
 * - Mutations complete in 100-300ms (fast enough)
 * - SSE broadcasts changes to other users in <1s
 * - No race conditions, no cache sync issues
 * - Loading states in UI provide feedback
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi, productionApi } from '../services/api';
import { inventoryQueryKeys, orderTabInvalidationMap } from '../constants/queryKeys';
import { trpc } from '../services/trpc';

interface UseOrdersMutationsOptions {
    onShipSuccess?: () => void;
    onCreateSuccess?: () => void;
    onDeleteSuccess?: () => void;
    onEditSuccess?: () => void;
    onNotesSuccess?: () => void;
}

export function useOrdersMutations(options: UseOrdersMutationsOptions = {}) {
    const queryClient = useQueryClient();
    const trpcUtils = trpc.useUtils();

    // Map view names to tRPC query input
    const viewToTrpcInput: Record<string, { view: string; limit?: number }> = {
        open: { view: 'open', limit: 2000 },
        shipped: { view: 'shipped' },
        rto: { view: 'rto' },
        cod_pending: { view: 'cod_pending' },
        cancelled: { view: 'cancelled' },
        archived: { view: 'archived' },
    };

    // Consolidated invalidation function - invalidates both Axios and tRPC query caches
    const invalidateTab = (tab: keyof typeof orderTabInvalidationMap) => {
        // Invalidate old Axios query keys (for any remaining Axios queries)
        const keysToInvalidate = orderTabInvalidationMap[tab];
        if (keysToInvalidate) {
            keysToInvalidate.forEach(key => {
                queryClient.invalidateQueries({ queryKey: [key] });
            });
        }

        // Invalidate tRPC query cache
        const trpcInput = viewToTrpcInput[tab];
        if (trpcInput) {
            trpcUtils.orders.list.invalidate(trpcInput);
        }
    };

    // Convenience wrappers
    const invalidateOpenOrders = () => invalidateTab('open');
    const invalidateShippedOrders = () => invalidateTab('shipped');
    const invalidateRtoOrders = () => invalidateTab('rto');
    const invalidateCodPendingOrders = () => invalidateTab('cod_pending');
    const invalidateCancelledOrders = () => invalidateTab('cancelled');

    // Keep invalidateAll for operations that truly affect multiple tabs
    const invalidateAll = () => {
        Object.keys(orderTabInvalidationMap).forEach(tab => {
            invalidateTab(tab as keyof typeof orderTabInvalidationMap);
        });
    };

    // ============================================
    // SHIP MUTATIONS
    // ============================================

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
                const messages = errorData.details.map((d: any) => d.message).join('\n');
                alert(`Validation failed:\n${messages}`);
            } else {
                alert(errorData?.error || 'Failed to ship order');
            }
        }
    });

    const shipLines = trpc.orders.ship.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            options.onShipSuccess?.();
        },
        onError: (err) => {
            const errorMsg = err.message || '';
            if (errorMsg.includes('not packed')) {
                alert(`Cannot ship: Some lines are not packed yet`);
            } else if (errorMsg.includes('validation')) {
                alert(`Validation failed: ${errorMsg}`);
            } else {
                alert(errorMsg || 'Failed to ship lines');
            }
        }
    });

    const forceShip = useMutation({
        mutationFn: ({ id, data }: { id: string; data: { awbNumber: string; courier: string } }) =>
            ordersApi.forceShip(id, data),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            options.onShipSuccess?.();
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to force ship order');
        }
    });

    const unship = useMutation({
        mutationFn: (id: string) => ordersApi.unship(id),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to unship order')
    });

    // ============================================
    // WORKFLOW MUTATIONS (allocate/pick/pack)
    // ============================================

    const allocate = trpc.orders.allocate.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
        onError: (err) => {
            const errorMsg = err.message || '';
            if (errorMsg.includes('Insufficient stock')) {
                alert(errorMsg);
            } else if (!errorMsg.includes('pending') && !errorMsg.includes('allocated')) {
                alert(errorMsg || 'Failed to allocate');
            }
        }
    });

    const unallocate = useMutation({
        mutationFn: (lineId: string) => ordersApi.setLineStatus(lineId, 'pending'),
        onSuccess: () => {
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to unallocate');
        }
    });

    const pickLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.setLineStatus(lineId, 'picked'),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to pick line');
        }
    });

    const unpickLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.setLineStatus(lineId, 'allocated'),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to unpick line');
        }
    });

    const packLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.setLineStatus(lineId, 'packed'),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to pack line');
        }
    });

    const unpackLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.setLineStatus(lineId, 'picked'),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to unpack line');
        }
    });

    const markShippedLine = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data?: { awbNumber?: string; courier?: string } }) =>
            ordersApi.setLineStatus(lineId, 'shipped', data),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to ship line');
        }
    });

    const unmarkShippedLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.setLineStatus(lineId, 'packed'),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to unship line');
        }
    });

    const updateLineTracking = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data: { awbNumber?: string; courier?: string } }) =>
            ordersApi.updateLine(lineId, data),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => {
            console.error('Tracking update failed:', err.response?.data?.error || err.message);
        }
    });

    // ============================================
    // PRODUCTION BATCH MUTATIONS
    // ============================================

    const createBatch = useMutation({
        mutationFn: (data: any) => productionApi.createBatch(data),
        onSuccess: () => {
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to add to production');
        }
    });

    const updateBatch = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: any }) => {
            if (id.startsWith('temp-')) {
                return { data: { success: true } } as any;
            }
            return productionApi.updateBatch(id, data);
        },
        onSuccess: () => {
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to update batch');
        }
    });

    const deleteBatch = useMutation({
        mutationFn: async (id: string) => {
            if (id.startsWith('temp-')) {
                return { data: { success: true } } as any;
            }
            return productionApi.deleteBatch(id);
        },
        onSuccess: () => {
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to delete batch');
        }
    });

    // ============================================
    // ORDER CRUD MUTATIONS
    // ============================================

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

    // ============================================
    // DELIVERY TRACKING MUTATIONS
    // ============================================

    const markDelivered = useMutation({
        mutationFn: (id: string) => ordersApi.markDelivered(id),
        onSuccess: () => {
            invalidateShippedOrders();
            invalidateCodPendingOrders();
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
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to receive RTO')
    });

    // ============================================
    // ORDER STATUS MUTATIONS
    // ============================================

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

    const cancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.cancelLine(lineId),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to cancel line');
        }
    });

    const uncancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.uncancelLine(lineId),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to restore line');
        }
    });

    // ============================================
    // RELEASE MUTATIONS
    // ============================================

    const releaseToShipped = useMutation({
        mutationFn: (orderIds?: string[]) => ordersApi.releaseToShipped(orderIds),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to release orders')
    });

    const releaseToCancelled = useMutation({
        mutationFn: (orderIds?: string[]) => ordersApi.releaseToCancelled(orderIds),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateCancelledOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to release cancelled orders')
    });

    // ============================================
    // LINE MUTATIONS
    // ============================================

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

    // ============================================
    // CUSTOMIZATION MUTATIONS
    // ============================================

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

    // ============================================
    // MIGRATION (onboarding)
    // ============================================

    const migrateShopifyFulfilled = useMutation({
        mutationFn: () => ordersApi.migrateShopifyFulfilled(),
        onSuccess: (response: any) => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            const { skipped, message } = response.data;
            alert(message + (skipped > 0 ? ` (${skipped} already shipped)` : ''));
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to migrate fulfilled orders')
    });

    return {
        // Ship
        ship,
        shipLines,
        forceShip,
        unship,

        // Delivery tracking
        markDelivered,
        markRto,
        receiveRto,

        // Allocate/Pick/Pack
        allocate,
        unallocate,
        pickLine,
        unpickLine,
        packLine,
        unpackLine,

        // Ship line (direct: packed → shipped)
        markShippedLine,
        unmarkShippedLine,
        updateLineTracking,

        // Migration (onboarding)
        migrateShopifyFulfilled,

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

        // Order lines
        cancelLine,
        uncancelLine,
        updateLine,
        updateLineNotes,
        updateShipByDate,
        addLine,

        // Release to shipped view
        releaseToShipped,

        // Release to cancelled view
        releaseToCancelled,

        // Customization
        customizeLine,
        removeCustomization,

        // Helper
        invalidateAll,
    };
}

export default useOrdersMutations;
