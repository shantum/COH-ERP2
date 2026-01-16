/**
 * Order release mutations
 * Handles releasing orders to shipped/cancelled views and migration
 */

import { useMutation } from '@tanstack/react-query';
import { ordersApi } from '../../services/api';
import { useOrderInvalidation } from './orderMutationUtils';

export function useOrderReleaseMutations() {
    const { invalidateOpenOrders, invalidateShippedOrders, invalidateCancelledOrders } = useOrderInvalidation();

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
        releaseToShipped,
        releaseToCancelled,
        migrateShopifyFulfilled,
    };
}
