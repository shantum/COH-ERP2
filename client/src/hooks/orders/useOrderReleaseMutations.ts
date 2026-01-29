/**
 * Order release mutations
 * Handles releasing orders to shipped/cancelled views and migration
 */

import { useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useOrderInvalidation } from './orderMutationUtils';
import { showError, showSuccess } from '../../utils/toast';
import {
    releaseToShipped as releaseToShippedFn,
    releaseToCancelled as releaseToCancelledFn,
    migrateShopifyFulfilled as migrateShopifyFulfilledFn,
} from '../../server/functions/orderMutations';

export function useOrderReleaseMutations() {
    const { invalidateOpenOrders, invalidateShippedOrders, invalidateCancelledOrders } = useOrderInvalidation();

    // Server Function wrappers
    const releaseToShippedServerFn = useServerFn(releaseToShippedFn);
    const releaseToCancelledServerFn = useServerFn(releaseToCancelledFn);
    const migrateShopifyFulfilledServerFn = useServerFn(migrateShopifyFulfilledFn);

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
        onSuccess: (data) => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            if (data) {
                showSuccess(data.message);
            }
        },
        onError: (err) => showError('Failed to release orders', { description: err instanceof Error ? err.message : String(err) })
    });

    // Direct pass-through - useMutation returns stable function references
    const releaseToShipped = {
        mutate: (orderIds?: string[]) => releaseToShippedMutation.mutate({ orderIds }),
        mutateAsync: (orderIds?: string[]) => releaseToShippedMutation.mutateAsync({ orderIds }),
        isPending: releaseToShippedMutation.isPending,
        isError: releaseToShippedMutation.isError,
        error: releaseToShippedMutation.error,
    };

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
        onSuccess: (data) => {
            invalidateOpenOrders();
            invalidateCancelledOrders();
            if (data) {
                showSuccess(data.message);
            }
        },
        onError: (err) => showError('Failed to release cancelled orders', { description: err instanceof Error ? err.message : String(err) })
    });

    // Direct pass-through - useMutation returns stable function references
    const releaseToCancelled = {
        mutate: (orderIds?: string[]) => releaseToCancelledMutation.mutate({ orderIds }),
        mutateAsync: (orderIds?: string[]) => releaseToCancelledMutation.mutateAsync({ orderIds }),
        isPending: releaseToCancelledMutation.isPending,
        isError: releaseToCancelledMutation.isError,
        error: releaseToCancelledMutation.error,
    };

    // ============================================
    // MIGRATE SHOPIFY FULFILLED
    // ============================================
    const migrateShopifyFulfilledMutation = useMutation({
        mutationFn: async (input: { limit?: number }) => {
            const result = await migrateShopifyFulfilledServerFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to migrate fulfilled orders');
            }
            return result.data;
        },
        onSuccess: (data) => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            if (data) {
                const { skipped, message } = data;
                showSuccess(message, { description: skipped && skipped > 0 ? `${skipped} already shipped` : undefined });
            }
        },
        onError: (err) => showError('Failed to migrate fulfilled orders', { description: err instanceof Error ? err.message : String(err) })
    });

    // Direct pass-through - useMutation returns stable function references
    const migrateShopifyFulfilled = {
        mutate: () => migrateShopifyFulfilledMutation.mutate({ limit: 50 }),
        mutateAsync: () => migrateShopifyFulfilledMutation.mutateAsync({ limit: 50 }),
        isPending: migrateShopifyFulfilledMutation.isPending,
        isError: migrateShopifyFulfilledMutation.isError,
        error: migrateShopifyFulfilledMutation.error,
    };

    return {
        releaseToShipped,
        releaseToCancelled,
        migrateShopifyFulfilled,
    };
}
