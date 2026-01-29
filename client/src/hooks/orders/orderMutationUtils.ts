/**
 * Shared utilities for order mutations
 * Contains invalidation helpers and common types used across mutation hooks
 */

import { useQueryClient, QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { orderTabInvalidationMap } from '../../constants/queryKeys';

// Page size for orders pagination (must match useUnifiedOrdersData)
export const PAGE_SIZE = 250;

// Map view names to query input
export const viewToQueryInput: Record<string, { view: string; limit?: number }> = {
    open: { view: 'open', limit: PAGE_SIZE },
    shipped: { view: 'shipped', limit: PAGE_SIZE },
    rto: { view: 'rto', limit: PAGE_SIZE },
    all: { view: 'all', limit: PAGE_SIZE },
    cancelled: { view: 'cancelled', limit: PAGE_SIZE },
};

// Type for mutation options (onSettled, onSuccess, onError callbacks)
export type MutationOptions = {
    onSettled?: () => void;
    onSuccess?: () => void;
    onError?: (err: unknown) => void;
};

// Interface for invalidation context
export interface InvalidationContext {
    queryClient: QueryClient;
}

/**
 * Helper to build query key for orders.list
 * Uses Server Function format: ['orders', 'list', 'server-fn', params]
 */
export function getOrdersListQueryKey(input: { view: string; page?: number; limit?: number }) {
    return ['orders', 'list', 'server-fn', input];
}

// Factory for creating invalidation functions
export function createInvalidationHelpers(ctx: InvalidationContext) {
    const { queryClient } = ctx;

    const invalidateTab = (tab: keyof typeof orderTabInvalidationMap) => {
        // Invalidate old Axios query keys (for any remaining Axios queries)
        const keysToInvalidate = orderTabInvalidationMap[tab];
        if (keysToInvalidate) {
            keysToInvalidate.forEach(key => {
                queryClient.invalidateQueries({ queryKey: [key] });
            });
        }

        // Invalidate Server Function query cache using predicate to match all pages
        // The query key format is: ['orders', 'list', 'server-fn', { view, page, limit }]
        // We need to match all pages for a given view
        const queryInput = viewToQueryInput[tab];
        if (queryInput) {
            queryClient.invalidateQueries({
                predicate: (query) => {
                    const key = query.queryKey;
                    if (key[0] !== 'orders' || key[1] !== 'list' || key[2] !== 'server-fn') {
                        return false;
                    }
                    const params = key[3] as { view?: string } | undefined;
                    return params?.view === queryInput.view;
                },
            });
        }
    };

    return {
        invalidateTab,
        invalidateOpenOrders: () => invalidateTab('open'),
        invalidateShippedOrders: () => invalidateTab('shipped'),
        invalidateRtoOrders: () => invalidateTab('rto'),
        invalidateCodPendingOrders: () => invalidateTab('cod_pending'),
        invalidateCancelledOrders: () => invalidateTab('cancelled'),
        invalidateAll: () => {
            Object.keys(orderTabInvalidationMap).forEach(tab => {
                invalidateTab(tab as keyof typeof orderTabInvalidationMap);
            });
        },
    };
}

// Custom hook to get invalidation helpers
export function useOrderInvalidation() {
    const queryClient = useQueryClient();

    return useMemo(
        () => createInvalidationHelpers({ queryClient }),
        [queryClient]
    );
}
