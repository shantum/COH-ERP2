/**
 * useOrdersData hook
 * Centralizes all data queries for the Orders page
 *
 * Loading strategy:
 * 1. Active tab loads immediately
 * 2. Once active tab completes, remaining tabs load sequentially in background
 * 3. Priority order: Open → Shipped → RTO → COD Pending → Cancelled → Archived
 */

import { useQuery } from '@tanstack/react-query';
import { ordersApi, productsApi, inventoryApi, fabricsApi, productionApi, adminApi, customersApi } from '../services/api';

// Poll interval for data refresh (30 seconds)
const POLL_INTERVAL = 30000;
// Stale time prevents double-fetches when data is still fresh
const STALE_TIME = 25000;

export type OrderTab = 'open' | 'shipped' | 'rto' | 'cod-pending' | 'cancelled' | 'archived';

interface UseOrdersDataOptions {
    activeTab: OrderTab;
    selectedCustomerId?: string | null;
    shippedPage?: number;
    shippedDays?: number;
    archivedDays?: number;
    archivedLimit?: number;
    archivedSortBy?: 'orderDate' | 'archivedAt';
}

export function useOrdersData({ activeTab, selectedCustomerId, shippedPage = 1, shippedDays = 30, archivedDays = 90, archivedLimit = 100, archivedSortBy = 'archivedAt' }: UseOrdersDataOptions) {
    // Order queries with SEQUENTIAL BACKGROUND LOADING
    // Active tab loads immediately, then remaining tabs load one-by-one after it completes
    // This ensures:
    // 1. Active tab data appears as fast as possible
    // 2. Tab counts populate progressively as background loads complete
    // 3. Switching tabs feels instant since data is pre-loaded

    const openOrdersQuery = useQuery({
        queryKey: ['openOrders'],
        queryFn: () => ordersApi.getOpen().then(r => r.data.orders || r.data),
        staleTime: STALE_TIME,
        refetchOnWindowFocus: false,
        refetchInterval: activeTab === 'open' ? POLL_INTERVAL : false,
        refetchIntervalInBackground: false,
        // Open tab is the default, always fetch it immediately
    });

    // Shipped loads: when tab is active OR after open completes
    const shippedOrdersQuery = useQuery({
        queryKey: ['shippedOrders', shippedPage, shippedDays],
        queryFn: () => ordersApi.getShipped({ page: shippedPage, days: shippedDays }).then(r => r.data),
        staleTime: STALE_TIME,
        refetchOnWindowFocus: false,
        refetchInterval: activeTab === 'shipped' ? POLL_INTERVAL : false,
        refetchIntervalInBackground: false,
        enabled: activeTab === 'shipped' || openOrdersQuery.isSuccess,
    });

    // RTO loads: when tab is active OR after shipped completes
    const rtoOrdersQuery = useQuery({
        queryKey: ['rtoOrders'],
        queryFn: () => ordersApi.getRto().then(r => r.data),
        staleTime: STALE_TIME,
        refetchOnWindowFocus: false,
        refetchInterval: activeTab === 'rto' ? POLL_INTERVAL : false,
        refetchIntervalInBackground: false,
        enabled: activeTab === 'rto' || shippedOrdersQuery.isSuccess,
    });

    // COD Pending loads: when tab is active OR after RTO completes
    const codPendingOrdersQuery = useQuery({
        queryKey: ['codPendingOrders'],
        queryFn: () => ordersApi.getCodPending().then(r => r.data),
        staleTime: STALE_TIME,
        refetchOnWindowFocus: false,
        refetchInterval: activeTab === 'cod-pending' ? POLL_INTERVAL : false,
        refetchIntervalInBackground: false,
        enabled: activeTab === 'cod-pending' || rtoOrdersQuery.isSuccess,
    });

    // Cancelled loads: when tab is active OR after COD Pending completes
    const cancelledOrdersQuery = useQuery({
        queryKey: ['cancelledOrders'],
        queryFn: () => ordersApi.getCancelled().then(r => r.data),
        staleTime: STALE_TIME,
        refetchOnWindowFocus: false,
        refetchInterval: activeTab === 'cancelled' ? POLL_INTERVAL : false,
        refetchIntervalInBackground: false,
        enabled: activeTab === 'cancelled' || codPendingOrdersQuery.isSuccess,
    });

    // Archived loads last: when tab is active OR after Cancelled completes
    const archivedOrdersQuery = useQuery({
        queryKey: ['archivedOrders', archivedDays, archivedLimit, archivedSortBy],
        queryFn: () => ordersApi.getArchived({
            ...(archivedDays > 0 ? { days: archivedDays } : {}),
            limit: archivedLimit,
            sortBy: archivedSortBy
        }).then(r => r.data),
        staleTime: STALE_TIME,
        refetchOnWindowFocus: false,
        refetchInterval: activeTab === 'archived' ? POLL_INTERVAL : false,
        refetchIntervalInBackground: false,
        enabled: activeTab === 'archived' || cancelledOrdersQuery.isSuccess,
    });

    // Summary queries - load with their respective tabs or in background
    const shippedSummaryQuery = useQuery({
        queryKey: ['shippedSummary', shippedDays],
        queryFn: () => ordersApi.getShippedSummary({ days: shippedDays }).then(r => r.data),
        staleTime: STALE_TIME,
        enabled: activeTab === 'shipped' || shippedOrdersQuery.isSuccess,
    });

    const rtoSummaryQuery = useQuery({
        queryKey: ['rtoSummary'],
        queryFn: () => ordersApi.getRtoSummary().then(r => r.data),
        staleTime: STALE_TIME,
        enabled: activeTab === 'rto' || rtoOrdersQuery.isSuccess,
    });

    // Supporting data queries - lazy loaded based on what's needed for active tab
    // allSkus and inventoryBalance are heavy queries only needed for Open tab
    const allSkusQuery = useQuery({
        queryKey: ['allSkus'],
        queryFn: () => productsApi.getAllSkus().then(r => r.data),
        staleTime: 60000, // SKU list doesn't change often
        enabled: activeTab === 'open', // Only needed for Open tab (to change SKU)
    });

    const inventoryBalanceQuery = useQuery({
        queryKey: ['inventoryBalance'],
        // Include custom SKUs so orders with customized lines show correct stock
        queryFn: () => inventoryApi.getBalance({ includeCustomSkus: 'true' }).then(r => r.data.items || r.data),
        staleTime: 60000, // Inventory balance doesn't change rapidly (60s cache)
        enabled: activeTab === 'open', // Only needed for Open tab (stock column)
    });

    const fabricStockQuery = useQuery({
        queryKey: ['fabricStock'],
        queryFn: () => fabricsApi.getStockAnalysis().then(r => r.data),
        staleTime: 60000, // Fabric stock doesn't change rapidly
        enabled: activeTab === 'open', // Only needed for Open tab (fabric column)
    });

    const channelsQuery = useQuery({
        queryKey: ['orderChannels'],
        queryFn: () => adminApi.getChannels().then(r => r.data),
        staleTime: 300000, // Channels rarely change (5 min cache)
    });

    const lockedDatesQuery = useQuery({
        queryKey: ['lockedProductionDates'],
        queryFn: () => productionApi.getLockedDates().then(r => r.data),
        staleTime: 60000, // Locked dates don't change rapidly
        enabled: activeTab === 'open', // Only needed for Open tab (production date picker)
    });

    // Customer detail query - only fetches when a customer is selected
    const customerDetailQuery = useQuery({
        queryKey: ['customer', selectedCustomerId],
        queryFn: () => customersApi.getById(selectedCustomerId!).then(r => r.data),
        enabled: !!selectedCustomerId
    });

    // Determine current loading state based on active tab
    const isLoading =
        activeTab === 'open' ? openOrdersQuery.isLoading :
        activeTab === 'shipped' ? shippedOrdersQuery.isLoading :
        activeTab === 'rto' ? rtoOrdersQuery.isLoading :
        activeTab === 'cod-pending' ? codPendingOrdersQuery.isLoading :
        activeTab === 'cancelled' ? cancelledOrdersQuery.isLoading :
        archivedOrdersQuery.isLoading;

    // Extract shipped orders and pagination from response
    const shippedData = shippedOrdersQuery.data;
    const shippedOrders = shippedData?.orders || [];
    const shippedPagination = shippedData?.pagination || { total: 0, page: 1, totalPages: 1 };

    // Extract archived orders and total count from response
    // Handles both legacy (totalCount) and unified (pagination.total) response shapes
    const archivedData = archivedOrdersQuery.data;
    const archivedOrders = archivedData?.orders || [];
    const archivedTotalCount = archivedData?.totalCount ?? archivedData?.pagination?.total ?? 0;

    // Extract RTO orders from response
    // Handles both legacy (total) and unified (pagination.total) response shapes
    const rtoData = rtoOrdersQuery.data;
    const rtoOrders = rtoData?.orders || [];
    const rtoTotalCount = rtoData?.total ?? rtoData?.pagination?.total ?? 0;

    // Extract COD pending orders from response
    // Handles both legacy (total, totalPendingAmount) and unified (pagination.total) response shapes
    const codPendingData = codPendingOrdersQuery.data;
    const codPendingOrders = codPendingData?.orders || [];
    const codPendingTotalCount = codPendingData?.total ?? codPendingData?.pagination?.total ?? 0;
    const codPendingTotalAmount = codPendingData?.totalPendingAmount ?? 0;

    return {
        // Order data
        openOrders: openOrdersQuery.data,
        shippedOrders,
        shippedPagination,
        rtoOrders,
        rtoTotalCount,
        codPendingOrders,
        codPendingTotalCount,
        codPendingTotalAmount,
        cancelledOrders: cancelledOrdersQuery.data,
        archivedOrders,
        archivedTotalCount,

        // Summary data
        shippedSummary: shippedSummaryQuery.data,
        loadingShippedSummary: shippedSummaryQuery.isLoading,
        rtoSummary: rtoSummaryQuery.data,
        loadingRtoSummary: rtoSummaryQuery.isLoading,

        // Supporting data
        allSkus: allSkusQuery.data,
        inventoryBalance: inventoryBalanceQuery.data,
        fabricStock: fabricStockQuery.data,
        channels: channelsQuery.data,
        lockedDates: lockedDatesQuery.data,

        // Customer detail
        customerDetail: customerDetailQuery.data,
        customerLoading: customerDetailQuery.isLoading,

        // Loading state for current tab
        isLoading,

        // Individual loading states if needed
        loadingOpen: openOrdersQuery.isLoading,
        loadingShipped: shippedOrdersQuery.isLoading,
        loadingRto: rtoOrdersQuery.isLoading,
        loadingCodPending: codPendingOrdersQuery.isLoading,
        loadingCancelled: cancelledOrdersQuery.isLoading,
        loadingArchived: archivedOrdersQuery.isLoading,
    };
}

export default useOrdersData;
