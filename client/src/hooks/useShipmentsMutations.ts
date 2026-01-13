/**
 * useShipmentsMutations hook
 * Centralizes all mutations for the Shipments page (post-shipment operations)
 *
 * Includes mutations for:
 * - Archive/unarchive orders
 * - Batch archive delivered prepaid orders
 * - Delivery tracking (mark delivered, mark RTO, receive RTO)
 * - Order status changes that affect shipment tabs
 *
 * Error handling: Uses alert() for consistency with useOrdersMutations
 * Cache invalidation: Supports both TanStack Query and tRPC caches
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '../services/api';
import { inventoryQueryKeys, orderTabInvalidationMap } from '../constants/queryKeys';
import { trpc } from '../services/trpc';

interface UseShipmentsMutationsOptions {
    onArchiveSuccess?: () => void;
    onUnarchiveSuccess?: () => void;
    onDeliverySuccess?: () => void;
    onRtoSuccess?: () => void;
}

export function useShipmentsMutations(options: UseShipmentsMutationsOptions = {}) {
    const queryClient = useQueryClient();
    const trpcUtils = trpc.useUtils();

    // Map view names to tRPC query input
    const viewToTrpcInput: Record<string, { view: string; limit?: number }> = {
        shipped: { view: 'shipped' },
        rto: { view: 'rto' },
        cod_pending: { view: 'cod_pending' },
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

    // Convenience wrappers for specific tabs
    const invalidateShippedOrders = () => invalidateTab('shipped');
    const invalidateRtoOrders = () => invalidateTab('rto');
    const invalidateCodPendingOrders = () => invalidateTab('cod_pending');
    const invalidateArchivedOrders = () => invalidateTab('archived');

    // Archive single order - moves from shipped to archived
    const archiveOrder = useMutation({
        mutationFn: (id: string) => ordersApi.archive(id),
        onSuccess: () => {
            invalidateShippedOrders();
            invalidateArchivedOrders();
            options.onArchiveSuccess?.();
        },
        onError: (err: any) => {
            const errorMsg = err.response?.data?.error || 'Failed to archive order';
            alert(errorMsg);
        }
    });

    // Unarchive order - restores from archived to shipped
    const unarchiveOrder = useMutation({
        mutationFn: (id: string) => ordersApi.unarchive(id),
        onSuccess: () => {
            invalidateShippedOrders();
            invalidateArchivedOrders();
            options.onUnarchiveSuccess?.();
        },
        onError: (err: any) => {
            const errorMsg = err.response?.data?.error || 'Failed to restore order';
            alert(errorMsg);
        }
    });

    // Batch archive delivered prepaid orders (and paid COD orders)
    const archivePrepaidMutation = useMutation({
        mutationFn: () => ordersApi.archiveDeliveredPrepaid(),
        onSuccess: (response: any) => {
            const data = response.data;
            const { archived = 0, prepaid = 0, cod = 0 } = data;

            invalidateShippedOrders();
            invalidateCodPendingOrders(); // COD orders might move from here
            invalidateArchivedOrders();

            if (archived > 0) {
                const breakdown = [];
                if (prepaid > 0) breakdown.push(`${prepaid} prepaid`);
                if (cod > 0) breakdown.push(`${cod} COD`);

                alert(`Archived ${archived} delivered order${archived !== 1 ? 's' : ''} (${breakdown.join(', ')})`);
            } else {
                alert('No delivered orders ready to archive');
            }

            options.onArchiveSuccess?.();
        },
        onError: (err: any) => {
            const errorMsg = err.response?.data?.error || 'Failed to archive orders';
            alert(errorMsg);
        }
    });

    // Mark order as delivered - moves from shipped to COD pending (if COD) or stays in shipped
    const markDelivered = useMutation({
        mutationFn: (id: string) => ordersApi.markDelivered(id),
        onSuccess: () => {
            invalidateShippedOrders();
            invalidateCodPendingOrders(); // May affect COD pending if it's a COD order
            options.onDeliverySuccess?.();
        },
        onError: (err: any) => {
            const errorMsg = err.response?.data?.error || 'Failed to mark as delivered';
            alert(errorMsg);
        }
    });

    // Mark order as RTO - moves from shipped to RTO tab
    const markRto = useMutation({
        mutationFn: (id: string) => ordersApi.markRto(id),
        onSuccess: () => {
            invalidateShippedOrders();
            invalidateRtoOrders();
            options.onRtoSuccess?.();
        },
        onError: (err: any) => {
            const errorMsg = err.response?.data?.error || 'Failed to mark as RTO';
            alert(errorMsg);
        }
    });

    // Receive RTO - restores inventory, moves from RTO to open
    const receiveRto = useMutation({
        mutationFn: (id: string) => ordersApi.receiveRto(id),
        onSuccess: () => {
            invalidateRtoOrders();
            // Note: open orders are handled by separate hook, but we need to invalidate inventory
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
            options.onRtoSuccess?.();
        },
        onError: (err: any) => {
            const errorMsg = err.response?.data?.error || 'Failed to receive RTO';
            alert(errorMsg);
        }
    });

    // Unship order - moves from shipped back to open
    const unship = useMutation({
        mutationFn: (id: string) => ordersApi.unship(id),
        onSuccess: () => {
            invalidateShippedOrders();
            // Note: open orders are handled by separate hook (useOrdersData/useOrdersMutations)
            // but we need to invalidate the query key for when user navigates back to Orders page
            queryClient.invalidateQueries({ queryKey: ['openOrders'] });
            // Also invalidate tRPC cache for open orders
            trpcUtils.orders.list.invalidate({ view: 'open', limit: 500 });
        },
        onError: (err: any) => {
            const errorMsg = err.response?.data?.error || 'Failed to unship order';
            alert(errorMsg);
        }
    });

    return {
        // Archive operations
        archiveOrder,
        unarchiveOrder,
        archivePrepaidMutation,

        // Delivery tracking
        markDelivered,
        markRto,
        receiveRto,

        // Shipping status
        unship,
    };
}

export default useShipmentsMutations;
