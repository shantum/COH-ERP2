/**
 * useUnifiedOrdersData hook
 * Centralizes all data queries for the unified Orders page
 *
 * Loading strategy (hybrid):
 * 1. Current view loads immediately
 * 2. Shipped prefetches after Open completes
 * 3. All other views load on-demand when selected
 *
 * Views: open, shipped, rto, cod_pending, cancelled, archived
 * Pagination: 500 orders per page
 */

import { useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fabricsApi, productionApi, adminApi, customersApi } from '../services/api';
import { inventoryQueryKeys } from '../constants/queryKeys';
import { trpc } from '../services/trpc';

// Poll interval for data refresh (30 seconds)
const POLL_INTERVAL = 30000;
// Stale time prevents double-fetches when data is still fresh
const STALE_TIME = 25000;
// Orders per page
const PAGE_SIZE = 500;

// All available views
export type OrderView = 'open' | 'shipped' | 'rto' | 'cod_pending' | 'cancelled' | 'archived';

// Legacy type alias for backwards compatibility
export type UnifiedOrderTab = OrderView;

interface UseUnifiedOrdersDataOptions {
    currentView: OrderView;
    page: number;
    selectedCustomerId?: string | null;
    shippedFilter?: 'shipped' | 'not_shipped';
}

export function useUnifiedOrdersData({
    currentView,
    page,
    selectedCustomerId,
    shippedFilter,
}: UseUnifiedOrdersDataOptions) {
    const queryClient = useQueryClient();

    // ==========================================
    // MAIN ORDER QUERY - Fetches current view with pagination
    // ==========================================

    const ordersQuery = trpc.orders.list.useQuery(
        {
            view: currentView,
            page,
            limit: PAGE_SIZE,
            shippedFilter: currentView === 'archived' ? shippedFilter : undefined,
        },
        {
            staleTime: STALE_TIME,
            refetchOnWindowFocus: false,
            refetchInterval: POLL_INTERVAL,
            refetchIntervalInBackground: false,
        }
    );

    // ==========================================
    // HYBRID LOADING: Prefetch shipped page 1 after open loads
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

    // Extract unique SKU IDs from orders for targeted inventory balance fetch
    const orderSkuIds = useMemo(() => {
        const orders = ordersQuery.data?.orders;
        if (!orders) return [];
        const skuSet = new Set<string>();
        orders.forEach((order: any) => {
            order.orderLines?.forEach((line: any) => {
                if (line.skuId) skuSet.add(line.skuId);
            });
        });
        return Array.from(skuSet);
    }, [ordersQuery.data]);

    // Inventory balance for SKUs in current orders
    const inventoryBalanceQuery = trpc.inventory.getBalances.useQuery(
        { skuIds: orderSkuIds },
        {
            staleTime: 60000,
            refetchOnWindowFocus: false,
            enabled: orderSkuIds.length > 0,
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
