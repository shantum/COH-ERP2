/**
 * useUnifiedOrdersData hook
 * Centralizes all data queries for the unified Orders page (all 6 tabs)
 *
 * Loading strategy:
 * 1. Active tab loads immediately
 * 2. Once active tab completes, remaining tabs load sequentially in background
 * 3. Priority order: Open → Shipped → RTO → COD Pending → Cancelled → Archived
 *
 * This combines the previous useOrdersData and useShipmentsData hooks
 * into a single hook supporting all order views.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fabricsApi, productionApi, adminApi, customersApi, ordersApi } from '../services/api';
import { inventoryQueryKeys, orderQueryKeys } from '../constants/queryKeys';
import { trpc } from '../services/trpc';

// Poll interval for data refresh (30 seconds)
const POLL_INTERVAL = 30000;
// Stale time prevents double-fetches when data is still fresh
const STALE_TIME = 25000;

export type UnifiedOrderTab = 'open' | 'shipped' | 'rto' | 'cod-pending' | 'archived' | 'cancelled';

interface UseUnifiedOrdersDataOptions {
    activeTab: UnifiedOrderTab;
    selectedCustomerId?: string | null;
    // Shipped tab options
    shippedDays?: number;
    // Archived tab options
    archivedDays?: number;
    archivedLimit?: number;
    archivedSortBy?: 'orderDate' | 'archivedAt';
}

export function useUnifiedOrdersData({
    activeTab,
    selectedCustomerId,
    shippedDays = 30,
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
    // Priority: Open → Shipped → RTO → COD Pending → Cancelled → Archived

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
    const shippedOrdersQuery = trpc.orders.list.useQuery(
        { view: 'shipped', days: shippedDays, limit: 500 },
        {
            staleTime: STALE_TIME,
            refetchOnWindowFocus: false,
            refetchInterval: activeTab === 'shipped' ? POLL_INTERVAL : false,
            refetchIntervalInBackground: false,
            enabled: activeTab === 'shipped' || openOrdersQuery.isSuccess,
        }
    );

    // RTO loads: when tab is active OR after shipped completes
    const rtoOrdersQuery = trpc.orders.list.useQuery(
        { view: 'rto' },
        {
            staleTime: STALE_TIME,
            refetchOnWindowFocus: false,
            refetchInterval: activeTab === 'rto' ? POLL_INTERVAL : false,
            refetchIntervalInBackground: false,
            enabled: activeTab === 'rto' || shippedOrdersQuery.isSuccess,
        }
    );

    // COD Pending loads: when tab is active OR after RTO completes
    const codPendingOrdersQuery = trpc.orders.list.useQuery(
        { view: 'cod_pending' },
        {
            staleTime: STALE_TIME,
            refetchOnWindowFocus: false,
            refetchInterval: activeTab === 'cod-pending' ? POLL_INTERVAL : false,
            refetchIntervalInBackground: false,
            enabled: activeTab === 'cod-pending' || rtoOrdersQuery.isSuccess,
        }
    );

    // Cancelled loads: when tab is active OR after COD Pending completes
    const cancelledOrdersQuery = trpc.orders.list.useQuery(
        { view: 'cancelled' },
        {
            staleTime: STALE_TIME,
            refetchOnWindowFocus: false,
            refetchInterval: activeTab === 'cancelled' ? POLL_INTERVAL : false,
            refetchIntervalInBackground: false,
            enabled: activeTab === 'cancelled' || codPendingOrdersQuery.isSuccess,
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
    // SUMMARY QUERIES (for Shipped and RTO tabs)
    // ==========================================

    const shippedSummaryQuery = useQuery({
        queryKey: [...orderQueryKeys.shippedSummary, shippedDays],
        queryFn: () => ordersApi.getShippedSummary({ days: shippedDays }).then(r => r.data),
        staleTime: STALE_TIME,
        enabled: activeTab === 'shipped' || shippedOrdersQuery.isSuccess,
    });

    const rtoSummaryQuery = useQuery({
        queryKey: orderQueryKeys.rtoSummary,
        queryFn: () => ordersApi.getRtoSummary().then(r => r.data),
        staleTime: STALE_TIME,
        enabled: activeTab === 'rto' || rtoOrdersQuery.isSuccess,
    });

    // ==========================================
    // COMPUTED VALUES
    // ==========================================

    // Determine loading state based on active tab
    const isLoading =
        activeTab === 'open' ? openOrdersQuery.isLoading :
        activeTab === 'shipped' ? shippedOrdersQuery.isLoading :
        activeTab === 'rto' ? rtoOrdersQuery.isLoading :
        activeTab === 'cod-pending' ? codPendingOrdersQuery.isLoading :
        activeTab === 'cancelled' ? cancelledOrdersQuery.isLoading :
        archivedOrdersQuery.isLoading;

    // Extract orders from tRPC responses
    const openOrders = openOrdersQuery.data?.orders || [];
    const shippedOrders = shippedOrdersQuery.data?.orders || [];
    const rtoOrders = rtoOrdersQuery.data?.orders || [];
    const codPendingOrders = codPendingOrdersQuery.data?.orders || [];
    const cancelledOrders = cancelledOrdersQuery.data?.orders || [];
    const archivedOrders = archivedOrdersQuery.data?.orders || [];

    // Get orders for current tab
    const currentOrders = useMemo(() => {
        switch (activeTab) {
            case 'open': return openOrders;
            case 'shipped': return shippedOrders;
            case 'rto': return rtoOrders;
            case 'cod-pending': return codPendingOrders;
            case 'cancelled': return cancelledOrders;
            case 'archived': return archivedOrders;
            default: return openOrders;
        }
    }, [activeTab, openOrders, shippedOrders, rtoOrders, codPendingOrders, cancelledOrders, archivedOrders]);

    // Tab counts for badges
    const tabCounts = useMemo(() => ({
        open: openOrdersQuery.data?.pagination?.total ?? openOrders.length,
        shipped: shippedOrdersQuery.data?.pagination?.total ?? shippedOrders.length,
        rto: rtoOrdersQuery.data?.pagination?.total ?? rtoOrders.length,
        'cod-pending': codPendingOrdersQuery.data?.pagination?.total ?? codPendingOrders.length,
        cancelled: cancelledOrdersQuery.data?.pagination?.total ?? cancelledOrders.length,
        archived: archivedOrdersQuery.data?.pagination?.total ?? archivedOrders.length,
    }), [
        openOrdersQuery.data, openOrders,
        shippedOrdersQuery.data, shippedOrders,
        rtoOrdersQuery.data, rtoOrders,
        codPendingOrdersQuery.data, codPendingOrders,
        cancelledOrdersQuery.data, cancelledOrders,
        archivedOrdersQuery.data, archivedOrders,
    ]);

    return {
        // Current tab orders (use this for the grid)
        currentOrders,

        // All orders by view (for cross-view access if needed)
        openOrders,
        shippedOrders,
        rtoOrders,
        codPendingOrders,
        cancelledOrders,
        archivedOrders,

        // Tab counts for badges
        tabCounts,

        // Supporting data
        allSkus: allSkusQuery.data,
        inventoryBalance: inventoryBalanceQuery.data,
        fabricStock: fabricStockQuery.data,
        channels: channelsQuery.data,
        lockedDates: lockedDatesQuery.data,

        // Summary data
        shippedSummary: shippedSummaryQuery.data,
        rtoSummary: rtoSummaryQuery.data,
        loadingShippedSummary: shippedSummaryQuery.isLoading,
        loadingRtoSummary: rtoSummaryQuery.isLoading,

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
        loadingRto: rtoOrdersQuery.isLoading,
        loadingCodPending: codPendingOrdersQuery.isLoading,
        loadingCancelled: cancelledOrdersQuery.isLoading,
        loadingArchived: archivedOrdersQuery.isLoading,

        // Individual fetching states
        isFetchingOpen: openOrdersQuery.isFetching,
        isFetchingShipped: shippedOrdersQuery.isFetching,
        isFetchingRto: rtoOrdersQuery.isFetching,
        isFetchingCodPending: codPendingOrdersQuery.isFetching,
        isFetchingCancelled: cancelledOrdersQuery.isFetching,
        isFetchingArchived: archivedOrdersQuery.isFetching,

        // Refetch functions
        refetchOpen: openOrdersQuery.refetch,
        refetchShipped: shippedOrdersQuery.refetch,
        refetchRto: rtoOrdersQuery.refetch,
        refetchCodPending: codPendingOrdersQuery.refetch,
        refetchCancelled: cancelledOrdersQuery.refetch,
        refetchArchived: archivedOrdersQuery.refetch,
        refetchAll: () => {
            openOrdersQuery.refetch();
            shippedOrdersQuery.refetch();
            rtoOrdersQuery.refetch();
            codPendingOrdersQuery.refetch();
            cancelledOrdersQuery.refetch();
            archivedOrdersQuery.refetch();
        },
    };
}

export default useUnifiedOrdersData;
