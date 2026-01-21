/**
 * Order release mutations
 * Handles releasing orders to shipped/cancelled views and migration
 */

import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { trpc } from '../../services/trpc';
import { useOrderInvalidation } from './orderMutationUtils';
import { showError, showSuccess } from '../../utils/toast';
import {
    releaseToShipped as releaseToShippedFn,
    releaseToCancelled as releaseToCancelledFn,
} from '../../server/functions/orderMutations';

export function useOrderReleaseMutations() {
    const { invalidateOpenOrders, invalidateShippedOrders, invalidateCancelledOrders } = useOrderInvalidation();

    // Server Function wrappers
    const releaseToShippedServerFn = useServerFn(releaseToShippedFn);
    const releaseToCancelledServerFn = useServerFn(releaseToCancelledFn);

    // ============================================
    // RELEASE TO SHIPPED
    // ============================================
    const releaseToShippedMutation = useMutation({
        mutationFn: async (input: { orderIds?: string[] }) => {
            const result = await releaseToShippedServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to release orders');
            }
            return result.data;
        },
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err) => showError('Failed to release orders', { description: err instanceof Error ? err.message : String(err) })
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const releaseToShipped = useMemo(() => ({
        mutate: (orderIds?: string[]) => releaseToShippedMutation.mutate({ orderIds }),
        mutateAsync: (orderIds?: string[]) => releaseToShippedMutation.mutateAsync({ orderIds }),
        isPending: releaseToShippedMutation.isPending,
        isError: releaseToShippedMutation.isError,
        error: releaseToShippedMutation.error,
    }), [releaseToShippedMutation.isPending, releaseToShippedMutation.isError, releaseToShippedMutation.error]);

    // ============================================
    // RELEASE TO CANCELLED
    // ============================================
    const releaseToCancelledMutation = useMutation({
        mutationFn: async (input: { orderIds?: string[] }) => {
            const result = await releaseToCancelledServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to release cancelled orders');
            }
            return result.data;
        },
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateCancelledOrders();
        },
        onError: (err) => showError('Failed to release cancelled orders', { description: err instanceof Error ? err.message : String(err) })
    });

    // Wrapper for backward compatibility - useMemo ensures isPending updates reactively
    const releaseToCancelled = useMemo(() => ({
        mutate: (orderIds?: string[]) => releaseToCancelledMutation.mutate({ orderIds }),
        mutateAsync: (orderIds?: string[]) => releaseToCancelledMutation.mutateAsync({ orderIds }),
        isPending: releaseToCancelledMutation.isPending,
        isError: releaseToCancelledMutation.isError,
        error: releaseToCancelledMutation.error,
    }), [releaseToCancelledMutation.isPending, releaseToCancelledMutation.isError, releaseToCancelledMutation.error]);

    // ============================================
    // MIGRATE SHOPIFY FULFILLED - Always tRPC (no Server Function equivalent)
    // ============================================
    const migrateShopifyFulfilledMutation = trpc.orders.migrateShopifyFulfilled.useMutation({
        onSuccess: (data) => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            const { skipped, message } = data;
            showSuccess(message, { description: skipped && skipped > 0 ? `${skipped} already shipped` : undefined });
        },
        onError: (err) => showError('Failed to migrate fulfilled orders', { description: err.message })
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
