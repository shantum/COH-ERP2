/**
 * useUnifiedOrdersData hook
 * Centralizes all data queries for the unified Orders page (4 tabs)
 *
 * Loading strategy:
 * 1. Active tab loads immediately
 * 2. Once active tab completes, remaining tabs load sequentially in background
 * 3. Priority order: Open → Shipped → Cancelled → Archived
 *
 * RTO and COD Pending are now filters within the Shipped tab (client-side filtering).
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fabricsApi, productionApi, adminApi, customersApi } from '../services/api';
import { inventoryQueryKeys } from '../constants/queryKeys';
import { trpc } from '../services/trpc';

// Poll interval for data refresh (30 seconds)
const POLL_INTERVAL = 30000;
// Stale time prevents double-fetches when data is still fresh
const STALE_TIME = 25000;

export type UnifiedOrderTab = 'open' | 'shipped' | 'archived' | 'cancelled';

interface UseUnifiedOrdersDataOptions {
    activeTab: UnifiedOrderTab;
    selectedCustomerId?: string | null;
    // Archived tab options
    archivedDays?: number;
    archivedLimit?: number;
    archivedSortBy?: 'orderDate' | 'archivedAt';
}

export function useUnifiedOrdersData({
    activeTab,
    selectedCustomerId,
    archivedDays = 90,
    archivedLimit = 100,
    archivedSortBy = 'archivedAt'
}: UseUnifiedOrdersDataOptions) {
    // Pagination state for archived
    const [archivedLimitState, setArchivedLimit] = useState(archivedLimit);
    const [archivedDaysState, setArchivedDays] = useState(archivedDays);
    const [archivedSortByState, setArchivedSortBy] = useState(archivedSortBy);

    // ==========================================
    // ORDER QUERIES - SEQUENTIAL BACKGROUND LOADING
    // ==========================================
    // Active tab loads immediately, remaining tabs load one-by-one after it completes.
    // Priority: Open → Shipped → Cancelled → Archived

    // Open orders (default tab) - limit 2000 for all open orders
    const openOrdersQuery = trpc.orders.list.useQuery(
        { view: 'open', limit: 2000 },
        {
            staleTime: STALE_TIME,
            refetchOnWindowFocus: false,
            refetchInterval: activeTab === 'open' ? POLL_INTERVAL : false,
            refetchIntervalInBackground: false,
        }
    );

    // Shipped loads: when tab is active OR after open completes
    // Now includes RTO and COD pending orders (filtered client-side)
    const shippedOrdersQuery = trpc.orders.list.useQuery(
        { view: 'shipped', limit: 2000 },
        {
            staleTime: STALE_TIME,
            refetchOnWindowFocus: false,
            refetchInterval: activeTab === 'shipped' ? POLL_INTERVAL : false,
            refetchIntervalInBackground: false,
            enabled: activeTab === 'shipped' || openOrdersQuery.isSuccess,
        }
    );

    // Cancelled loads: when tab is active OR after shipped completes
    const cancelledOrdersQuery = trpc.orders.list.useQuery(
        { view: 'cancelled' },
        {
            staleTime: STALE_TIME,
            refetchOnWindowFocus: false,
            refetchInterval: activeTab === 'cancelled' ? POLL_INTERVAL : false,
            refetchIntervalInBackground: false,
            enabled: activeTab === 'cancelled' || shippedOrdersQuery.isSuccess,
        }
    );

    // Archived loads last: when tab is active OR after cancelled completes
    const archivedOrdersQuery = trpc.orders.list.useQuery(
        {
            view: 'archived',
            ...(archivedDaysState > 0 ? { days: archivedDaysState } : {}),
            limit: archivedLimitState,
            sortBy: archivedSortByState,
        },
        {
            staleTime: STALE_TIME,
            refetchOnWindowFocus: false,
            refetchInterval: activeTab === 'archived' ? POLL_INTERVAL : false,
            refetchIntervalInBackground: false,
            enabled: activeTab === 'archived' || cancelledOrdersQuery.isSuccess,
        }
    );

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

    // Extract unique SKU IDs from open orders for targeted inventory balance fetch
    const openOrderSkuIds = useMemo(() => {
        const orders = openOrdersQuery.data?.orders;
        if (!orders) return [];
        const skuSet = new Set<string>();
        orders.forEach((order: any) => {
            order.orderLines?.forEach((line: any) => {
                if (line.skuId) skuSet.add(line.skuId);
            });
        });
        return Array.from(skuSet);
    }, [openOrdersQuery.data]);

    // Inventory balance for SKUs in open orders only (optimized)
    const inventoryBalanceQuery = trpc.inventory.getBalances.useQuery(
        { skuIds: openOrderSkuIds },
        {
            staleTime: 60000,
            refetchOnWindowFocus: false,
            enabled: openOrderSkuIds.length > 0,
        }
    );

    // Fabric stock - only needed for Open tab
    const fabricStockQuery = useQuery({
        queryKey: inventoryQueryKeys.fabric,
        queryFn: () => fabricsApi.getStockAnalysis().then(r => r.data),
        staleTime: 60000,
        enabled: activeTab === 'open',
    });

    // Channels for CreateOrderModal
    const channelsQuery = useQuery({
        queryKey: ['orderChannels'],
        queryFn: () => adminApi.getChannels().then(r => r.data),
        staleTime: 300000,
    });

    // Locked production dates - only needed for Open tab
    const lockedDatesQuery = useQuery({
        queryKey: ['lockedProductionDates'],
        queryFn: () => productionApi.getLockedDates().then(r => r.data),
        staleTime: 60000,
        enabled: activeTab === 'open',
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

    // Determine loading state based on active tab
    const isLoading =
        activeTab === 'open' ? openOrdersQuery.isLoading :
        activeTab === 'shipped' ? shippedOrdersQuery.isLoading :
        activeTab === 'cancelled' ? cancelledOrdersQuery.isLoading :
        archivedOrdersQuery.isLoading;

    // Extract orders from tRPC responses
    const openOrders = openOrdersQuery.data?.orders || [];
    const shippedOrders = shippedOrdersQuery.data?.orders || [];
    const cancelledOrders = cancelledOrdersQuery.data?.orders || [];
    const archivedOrders = archivedOrdersQuery.data?.orders || [];

    // Compute RTO and COD pending counts from shipped orders (for filter badges)
    const rtoCount = useMemo(() =>
        shippedOrders.filter((o: any) =>
            ['rto_in_transit', 'rto_delivered'].includes(o.trackingStatus)
        ).length,
        [shippedOrders]
    );

    const codPendingCount = useMemo(() =>
        shippedOrders.filter((o: any) =>
            o.paymentMethod === 'COD' &&
            o.trackingStatus === 'delivered' &&
            !o.codRemittedAt
        ).length,
        [shippedOrders]
    );

    // Get orders for current tab
    const currentOrders = useMemo(() => {
        switch (activeTab) {
            case 'open': return openOrders;
            case 'shipped': return shippedOrders;
            case 'cancelled': return cancelledOrders;
            case 'archived': return archivedOrders;
            default: return openOrders;
        }
    }, [activeTab, openOrders, shippedOrders, cancelledOrders, archivedOrders]);

    // Tab counts for badges
    const tabCounts = useMemo(() => ({
        open: openOrdersQuery.data?.pagination?.total ?? openOrders.length,
        shipped: shippedOrdersQuery.data?.pagination?.total ?? shippedOrders.length,
        cancelled: cancelledOrdersQuery.data?.pagination?.total ?? cancelledOrders.length,
        archived: archivedOrdersQuery.data?.pagination?.total ?? archivedOrders.length,
        // RTO and COD counts for filter badges (computed from shipped data)
        rto: rtoCount,
        codPending: codPendingCount,
    }), [
        openOrdersQuery.data, openOrders,
        shippedOrdersQuery.data, shippedOrders,
        cancelledOrdersQuery.data, cancelledOrders,
        archivedOrdersQuery.data, archivedOrders,
        rtoCount, codPendingCount,
    ]);

    return {
        // Current tab orders (use this for the grid)
        currentOrders,

        // All orders by view (for cross-view access if needed)
        openOrders,
        shippedOrders,
        cancelledOrders,
        archivedOrders,

        // Tab counts for badges (includes rto and codPending for filter badges)
        tabCounts,

        // Supporting data
        allSkus: allSkusQuery.data,
        inventoryBalance: inventoryBalanceQuery.data,
        fabricStock: fabricStockQuery.data,
        channels: channelsQuery.data,
        lockedDates: lockedDatesQuery.data,

        // Customer detail
        customerDetail: customerDetailQuery.data,
        customerLoading: customerDetailQuery.isLoading,

        // Archived pagination controls
        archivedLimit: archivedLimitState,
        setArchivedLimit,
        archivedDays: archivedDaysState,
        setArchivedDays,
        archivedSortBy: archivedSortByState,
        setArchivedSortBy,
        archivedPagination: archivedOrdersQuery.data?.pagination,

        // Loading state for current tab
        isLoading,

        // Individual loading states
        loadingOpen: openOrdersQuery.isLoading,
        loadingShipped: shippedOrdersQuery.isLoading,
        loadingCancelled: cancelledOrdersQuery.isLoading,
        loadingArchived: archivedOrdersQuery.isLoading,

        // Individual fetching states
        isFetchingOpen: openOrdersQuery.isFetching,
        isFetchingShipped: shippedOrdersQuery.isFetching,
        isFetchingCancelled: cancelledOrdersQuery.isFetching,
        isFetchingArchived: archivedOrdersQuery.isFetching,

        // Refetch functions
        refetchOpen: openOrdersQuery.refetch,
        refetchShipped: shippedOrdersQuery.refetch,
        refetchCancelled: cancelledOrdersQuery.refetch,
        refetchArchived: archivedOrdersQuery.refetch,
        refetchAll: () => {
            openOrdersQuery.refetch();
            shippedOrdersQuery.refetch();
            cancelledOrdersQuery.refetch();
            archivedOrdersQuery.refetch();
        },
    };
}

export default useUnifiedOrdersData;
