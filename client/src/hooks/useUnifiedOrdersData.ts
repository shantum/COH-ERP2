/**
 * useUnifiedOrdersData hook
 * Centralizes all data queries for the unified Orders page
 *
 * Loading strategy (hybrid):
 * 1. Current view loads immediately
 * 2. Shipped prefetches after Open completes
 * 3. All other views load on-demand when selected
 *
 * Views: open, shipped, rto, cod_pending, cancelled
 * Note: Archived view hidden from UI but auto-archive still runs
 * Pagination: 500 orders per page
 */

import { useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fabricsApi, productionApi, adminApi, customersApi } from '../services/api';
import { inventoryQueryKeys } from '../constants/queryKeys';
import { trpc } from '../services/trpc';

// Poll intervals - SSE connection determines frequency
// When SSE connected: longer intervals (fallback only)
// When SSE disconnected: frequent polling to stay in sync
const POLL_INTERVAL_ACTIVE = 5000;    // 5 seconds for 'open' view (no SSE)
const POLL_INTERVAL_PASSIVE = 30000;  // 30 seconds for other views (no SSE)
// Stale time prevents double-fetches when data is still fresh
const STALE_TIME = 60000;  // 1 minute (increased since SSE handles updates)
// Cache retention time (5 minutes) - keeps stale data for instant display
const GC_TIME = 5 * 60 * 1000;
// Orders per page
const PAGE_SIZE = 500;

// All available views (archived hidden from UI but kept on server for auto-archive)
export type OrderView = 'open' | 'shipped' | 'rto' | 'cod_pending' | 'cancelled';

// Legacy type alias for backwards compatibility
export type UnifiedOrderTab = OrderView;

interface UseUnifiedOrdersDataOptions {
    currentView: OrderView;
    page: number;
    selectedCustomerId?: string | null;
    /** Whether SSE is connected - disables polling when true */
    isSSEConnected?: boolean;
}

export function useUnifiedOrdersData({
    currentView,
    page,
    selectedCustomerId,
    isSSEConnected = false,
}: UseUnifiedOrdersDataOptions) {
    const queryClient = useQueryClient();

    // Determine poll interval based on SSE connection status
    // SSE connected: disable polling entirely
    // Trust SSE for real-time updates; lastEventId replay handles reconnects
    // SSE disconnected: poll frequently until reconnected
    const pollInterval = useMemo(() => {
        // SSE connected: disable polling entirely (rely 100% on SSE)
        if (isSSEConnected) {
            return false as const;
        }
        // SSE disconnected: poll frequently to stay in sync
        return currentView === 'open' ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_PASSIVE;
    }, [isSSEConnected, currentView]);

    // ==========================================
    // MAIN ORDER QUERY - Fetches current view with pagination
    // ==========================================

    const ordersQuery = trpc.orders.list.useQuery(
        {
            view: currentView,
            page,
            limit: PAGE_SIZE,
        },
        {
            staleTime: STALE_TIME,
            gcTime: GC_TIME,  // Keep cached data for 5 min for instant display
            refetchOnWindowFocus: true,   // Refetch when user returns to tab
            refetchIntervalInBackground: false,  // No polling when tab hidden
            placeholderData: (prev) => prev,  // Show stale data immediately while fetching
            // Smart polling: only poll if document has focus
            refetchInterval: () => {
                // Don't poll if document not focused (saves network when tab is hidden)
                if (typeof document !== 'undefined' && !document.hasFocus()) {
                    return false;
                }
                return pollInterval;
            },
        }
    );

    // ==========================================
    // HYBRID LOADING: Prefetch adjacent pages and related views
    // ==========================================

    useEffect(() => {
        if (currentView === 'open' && page === 1 && ordersQuery.isSuccess) {
            // Prefetch shipped view page 1 in background
            queryClient.prefetchQuery({
                queryKey: [['orders', 'list'], { input: { view: 'shipped', page: 1, limit: PAGE_SIZE }, type: 'query' }],
                staleTime: STALE_TIME,
            });
        }
    }, [currentView, page, ordersQuery.isSuccess, queryClient]);

    // Prefetch adjacent pages for smoother pagination
    useEffect(() => {
        if (!ordersQuery.isSuccess || !ordersQuery.data?.pagination) return;

        const { totalPages } = ordersQuery.data.pagination;

        // Build base query input
        const baseInput = {
            view: currentView,
            limit: PAGE_SIZE,
        };

        // Prefetch next page if it exists
        if (page < totalPages) {
            queryClient.prefetchQuery({
                queryKey: [['orders', 'list'], { input: { ...baseInput, page: page + 1 }, type: 'query' }],
                staleTime: STALE_TIME,
            });
        }

        // Prefetch previous page if it exists
        if (page > 1) {
            queryClient.prefetchQuery({
                queryKey: [['orders', 'list'], { input: { ...baseInput, page: page - 1 }, type: 'query' }],
                staleTime: STALE_TIME,
            });
        }
    }, [currentView, page, ordersQuery.isSuccess, ordersQuery.data?.pagination, queryClient]);

    // ==========================================
    // SUPPORTING DATA QUERIES
    // ==========================================

    // All SKUs for CreateOrderModal product search
    const allSkusQuery = trpc.products.list.useQuery(
        { limit: 1000 },
        {
            staleTime: 60000,
            refetchOnWindowFocus: false,
            select: (data) => {
                const skus: any[] = [];
                data.products.forEach((product: any) => {
                    product.variations?.forEach((variation: any) => {
                        variation.skus?.forEach((sku: any) => {
                            skus.push({
                                ...sku,
                                variation: { ...variation, product },
                            });
                        });
                    });
                });
                return skus;
            }
        }
    );

    // Check if server already included inventory in the response
    const hasInventoryFromServer = ordersQuery.data?.hasInventory ?? false;

    // Extract unique SKU IDs from orders for targeted inventory balance fetch
    // Only needed if server didn't include inventory
    const orderSkuIds = useMemo(() => {
        if (hasInventoryFromServer) return [];  // Skip if server included inventory
        const orders = ordersQuery.data?.orders;
        if (!orders) return [];
        const skuSet = new Set<string>();
        orders.forEach((order: any) => {
            order.orderLines?.forEach((line: any) => {
                if (line.skuId) skuSet.add(line.skuId);
            });
        });
        return Array.from(skuSet);
    }, [ordersQuery.data, hasInventoryFromServer]);

    // Inventory balance for SKUs in current orders
    // Skip this query if server already included inventory (saves round-trip)
    const inventoryBalanceQuery = trpc.inventory.getBalances.useQuery(
        { skuIds: orderSkuIds },
        {
            staleTime: 60000,
            refetchOnWindowFocus: false,
            enabled: orderSkuIds.length > 0 && !hasInventoryFromServer,
        }
    );

    // Fabric stock - only needed for Open view
    const fabricStockQuery = useQuery({
        queryKey: inventoryQueryKeys.fabric,
        queryFn: () => fabricsApi.getStockAnalysis().then(r => r.data),
        staleTime: 60000,
        enabled: currentView === 'open',
    });

    // Channels for CreateOrderModal
    const channelsQuery = useQuery({
        queryKey: ['orderChannels'],
        queryFn: () => adminApi.getChannels().then(r => r.data),
        staleTime: 300000,
    });

    // Locked production dates - only needed for Open view
    const lockedDatesQuery = useQuery({
        queryKey: ['lockedProductionDates'],
        queryFn: () => productionApi.getLockedDates().then(r => r.data),
        staleTime: 60000,
        enabled: currentView === 'open',
    });

    // Customer detail - only when selected
    const customerDetailQuery = useQuery({
        queryKey: ['customer', selectedCustomerId],
        queryFn: () => customersApi.getById(selectedCustomerId!).then(r => r.data),
        enabled: !!selectedCustomerId
    });

    // ==========================================
    // COMPUTED VALUES
    // ==========================================

    const orders = ordersQuery.data?.orders || [];
    const rows = ordersQuery.data?.rows || [];
    const pagination = ordersQuery.data?.pagination;

    return {
        // Pre-flattened rows from server (primary data source)
        rows,
        // Legacy orders for backwards compatibility
        orders,
        pagination,

        // Supporting data
        allSkus: allSkusQuery.data,
        inventoryBalance: inventoryBalanceQuery.data,
        fabricStock: fabricStockQuery.data,
        channels: channelsQuery.data,
        lockedDates: lockedDatesQuery.data,

        // Customer detail
        customerDetail: customerDetailQuery.data,
        customerLoading: customerDetailQuery.isLoading,

        // Loading states
        isLoading: ordersQuery.isLoading,
        isFetching: ordersQuery.isFetching,

        // Refetch
        refetch: ordersQuery.refetch,
    };
}

export default useUnifiedOrdersData;
