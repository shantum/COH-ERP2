/**
 * Shared utilities for order mutations
 * Contains invalidation helpers and common types used across mutation hooks
 *
 * IMPORTANT: Never use broad `['orders']` query key for invalidation.
 * This causes ALL order queries (all views, all pages) to refetch simultaneously,
 * resulting in 10K+ component re-renders and 3+ second UI freezes.
 *
 * Instead, use the targeted helpers in this file:
 * - invalidateView(view) - invalidate a specific view
 * - invalidateAllViewsStale() - mark all views stale (lazy refetch on navigation)
 * - invalidateCurrentViewOnly(view) - force refetch current, mark others stale
 */

import { useQueryClient, QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { orderTabInvalidationMap, ORDERS_PAGE_SIZE } from '../../constants/queryKeys';

// Re-export for backwards compatibility
export const PAGE_SIZE = ORDERS_PAGE_SIZE;

// All order views
export const ORDER_VIEWS = ['all', 'in_transit', 'delivered', 'rto', 'cancelled'] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

// Map view names to query input
export const viewToQueryInput: Record<string, { view: string; limit?: number }> = {
    all: { view: 'all', limit: PAGE_SIZE },
    in_transit: { view: 'in_transit', limit: PAGE_SIZE },
    delivered: { view: 'delivered', limit: PAGE_SIZE },
    rto: { view: 'rto', limit: PAGE_SIZE },
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
        invalidateAllOrders: () => invalidateTab('all'),
        invalidateInTransitOrders: () => invalidateTab('in_transit'),
        invalidateDeliveredOrders: () => invalidateTab('delivered'),
        invalidateRtoOrders: () => invalidateTab('rto'),
        invalidateCancelledOrders: () => invalidateTab('cancelled'),
        // Legacy aliases (Phase 2 cleanup: remove when mutation hooks are updated)
        invalidateOpenOrders: () => invalidateTab('all'),
        invalidateShippedOrders: () => invalidateTab('in_transit'),
        invalidateCodPendingOrders: () => invalidateTab('all'),
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

// ============================================================================
// SMART INVALIDATION HELPERS
// These prevent the "10K re-render" problem by using targeted invalidation
// ============================================================================

/**
 * Predicate to match all order list queries regardless of view/page/filters.
 * Query key format: ['orders', 'list', 'server-fn', { view, page, limit, ...filters }]
 */
function isOrderListQuery(queryKey: readonly unknown[]): boolean {
    return queryKey[0] === 'orders' && queryKey[1] === 'list' && queryKey[2] === 'server-fn';
}

/**
 * Predicate to match order list queries for a specific view.
 */
function isOrderListQueryForView(queryKey: readonly unknown[], view: string): boolean {
    if (!isOrderListQuery(queryKey)) return false;
    const params = queryKey[3] as { view?: string } | undefined;
    return params?.view === view;
}

/**
 * Mark ALL order list queries as stale WITHOUT forcing immediate refetch.
 * Only queries that are actively being observed will refetch.
 * Use this for buffer overflow or when you don't know what changed.
 *
 * This is the key to preventing the 10K re-render problem:
 * - Current view: refetches immediately (it's being observed)
 * - Other views: marked stale, will refetch when navigated to
 */
export function invalidateAllOrderViewsStale(queryClient: QueryClient): void {
    queryClient.invalidateQueries({
        predicate: (query) => isOrderListQuery(query.queryKey),
        refetchType: 'active', // Only refetch queries that are actively being rendered
    });
    // Also invalidate view counts (lightweight, OK to always refetch)
    queryClient.invalidateQueries({ queryKey: ['orders', 'viewCounts'] });
}

/**
 * Force refetch a specific view only.
 * Use when you know exactly which view was affected.
 */
export function invalidateOrderView(queryClient: QueryClient, view: string): void {
    queryClient.invalidateQueries({
        predicate: (query) => isOrderListQueryForView(query.queryKey, view),
    });
}

/**
 * Invalidate multiple specific views.
 * Use for operations that affect specific views (e.g., shipping affects 'open' and 'shipped').
 */
export function invalidateOrderViews(queryClient: QueryClient, views: string[]): void {
    const viewSet = new Set(views);
    queryClient.invalidateQueries({
        predicate: (query) => {
            if (!isOrderListQuery(query.queryKey)) return false;
            const params = query.queryKey[3] as { view?: string } | undefined;
            return params?.view != null && viewSet.has(params.view);
        },
    });
}

/**
 * Cancel queries for a specific view only.
 * Use before optimistic updates to prevent race conditions.
 */
export async function cancelOrderViewQueries(queryClient: QueryClient, view: string): Promise<void> {
    await queryClient.cancelQueries({
        predicate: (query) => isOrderListQueryForView(query.queryKey, view),
    });
}

/**
 * Cancel queries for multiple views.
 */
export async function cancelOrderViewsQueries(queryClient: QueryClient, views: string[]): Promise<void> {
    const viewSet = new Set(views);
    await queryClient.cancelQueries({
        predicate: (query) => {
            if (!isOrderListQuery(query.queryKey)) return false;
            const params = query.queryKey[3] as { view?: string } | undefined;
            return params?.view != null && viewSet.has(params.view);
        },
    });
}
