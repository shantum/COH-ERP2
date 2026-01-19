/**
 * Order release mutations
 * Handles releasing orders to shipped/cancelled views and migration
 * Uses tRPC for all operations
 */

import { useMemo } from 'react';
import { trpc } from '../../services/trpc';
import { useOrderInvalidation } from './orderMutationUtils';

export function useOrderReleaseMutations() {
    const { invalidateOpenOrders, invalidateShippedOrders, invalidateCancelledOrders } = useOrderInvalidation();

    // Release to shipped via tRPC
    const releaseToShippedMutation = trpc.orders.releaseToShipped.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err) => alert(err.message || 'Failed to release orders')
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const releaseToShipped = useMemo(() => ({
        mutate: (orderIds?: string[]) => releaseToShippedMutation.mutate({ orderIds }),
        mutateAsync: (orderIds?: string[]) => releaseToShippedMutation.mutateAsync({ orderIds }),
        isPending: releaseToShippedMutation.isPending,
        isError: releaseToShippedMutation.isError,
        error: releaseToShippedMutation.error,
    }), [releaseToShippedMutation.isPending, releaseToShippedMutation.isError, releaseToShippedMutation.error]);

    // Release to cancelled via tRPC
    const releaseToCancelledMutation = trpc.orders.releaseToCancelled.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateCancelledOrders();
        },
        onError: (err) => alert(err.message || 'Failed to release cancelled orders')
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const releaseToCancelled = useMemo(() => ({
        mutate: (orderIds?: string[]) => releaseToCancelledMutation.mutate({ orderIds }),
        mutateAsync: (orderIds?: string[]) => releaseToCancelledMutation.mutateAsync({ orderIds }),
        isPending: releaseToCancelledMutation.isPending,
        isError: releaseToCancelledMutation.isError,
        error: releaseToCancelledMutation.error,
    }), [releaseToCancelledMutation.isPending, releaseToCancelledMutation.isError, releaseToCancelledMutation.error]);

    // Migrate Shopify fulfilled orders via tRPC
    const migrateShopifyFulfilledMutation = trpc.orders.migrateShopifyFulfilled.useMutation({
        onSuccess: (data) => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            const { skipped, message } = data;
            alert(message + (skipped && skipped > 0 ? ` (${skipped} already shipped)` : ''));
        },
        onError: (err) => alert(err.message || 'Failed to migrate fulfilled orders')
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const migrateShopifyFulfilled = useMemo(() => ({
        mutate: () => migrateShopifyFulfilledMutation.mutate({ limit: 50 }),
        mutateAsync: () => migrateShopifyFulfilledMutation.mutateAsync({ limit: 50 }),
        isPending: migrateShopifyFulfilledMutation.isPending,
        isError: migrateShopifyFulfilledMutation.isError,
        error: migrateShopifyFulfilledMutation.error,
    }), [migrateShopifyFulfilledMutation.isPending, migrateShopifyFulfilledMutation.isError, migrateShopifyFulfilledMutation.error]);

    return {
        releaseToShipped,
        releaseToCancelled,
        migrateShopifyFulfilled,
    };
}
