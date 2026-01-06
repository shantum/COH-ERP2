/**
 * useOrdersData hook
 * Centralizes all data queries for the Orders page
 */

import { useQuery } from '@tanstack/react-query';
import { ordersApi, productsApi, inventoryApi, fabricsApi, productionApi, adminApi, customersApi } from '../services/api';

// Poll interval for data refresh (30 seconds)
const POLL_INTERVAL = 30000;

export type OrderTab = 'open' | 'shipped' | 'cancelled' | 'archived';

interface UseOrdersDataOptions {
    activeTab: OrderTab;
    selectedCustomerId?: string | null;
    shippedPage?: number;
    shippedDays?: number;
    archivedDays?: number;
}

export function useOrdersData({ activeTab, selectedCustomerId, shippedPage = 1, shippedDays = 30, archivedDays = 90 }: UseOrdersDataOptions) {
    // Order queries with conditional polling based on active tab
    const openOrdersQuery = useQuery({
        queryKey: ['openOrders'],
        queryFn: () => ordersApi.getOpen().then(r => r.data.orders || r.data),
        refetchInterval: activeTab === 'open' ? POLL_INTERVAL : false
    });

    const shippedOrdersQuery = useQuery({
        queryKey: ['shippedOrders', shippedPage, shippedDays],
        queryFn: () => ordersApi.getShipped({ page: shippedPage, days: shippedDays }).then(r => r.data),
        refetchInterval: activeTab === 'shipped' ? POLL_INTERVAL : false
    });

    const cancelledOrdersQuery = useQuery({
        queryKey: ['cancelledOrders'],
        queryFn: () => ordersApi.getCancelled().then(r => r.data),
        refetchInterval: activeTab === 'cancelled' ? POLL_INTERVAL : false
    });

    const archivedOrdersQuery = useQuery({
        queryKey: ['archivedOrders', archivedDays],
        queryFn: () => ordersApi.getArchived(archivedDays > 0 ? { days: archivedDays } : undefined).then(r => r.data),
        refetchInterval: activeTab === 'archived' ? POLL_INTERVAL : false
    });

    // Summary queries
    const shippedSummaryQuery = useQuery({
        queryKey: ['shippedSummary', shippedDays],
        queryFn: () => ordersApi.getShippedSummary({ days: shippedDays }).then(r => r.data),
        enabled: activeTab === 'shipped',
    });

    // Supporting data queries
    const allSkusQuery = useQuery({
        queryKey: ['allSkus'],
        queryFn: () => productsApi.getAllSkus().then(r => r.data)
    });

    const inventoryBalanceQuery = useQuery({
        queryKey: ['inventoryBalance'],
        queryFn: () => inventoryApi.getBalance().then(r => r.data.items || r.data)
    });

    const fabricStockQuery = useQuery({
        queryKey: ['fabricStock'],
        queryFn: () => fabricsApi.getStockAnalysis().then(r => r.data)
    });

    const channelsQuery = useQuery({
        queryKey: ['orderChannels'],
        queryFn: () => adminApi.getChannels().then(r => r.data)
    });

    const lockedDatesQuery = useQuery({
        queryKey: ['lockedProductionDates'],
        queryFn: () => productionApi.getLockedDates().then(r => r.data)
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
        activeTab === 'cancelled' ? cancelledOrdersQuery.isLoading :
        archivedOrdersQuery.isLoading;

    // Extract shipped orders and pagination from response
    const shippedData = shippedOrdersQuery.data;
    const shippedOrders = shippedData?.orders || [];
    const shippedPagination = shippedData?.pagination || { total: 0, page: 1, totalPages: 1 };

    // Extract archived orders and total count from response
    const archivedData = archivedOrdersQuery.data;
    const archivedOrders = archivedData?.orders || [];
    const archivedTotalCount = archivedData?.totalCount || 0;

    return {
        // Order data
        openOrders: openOrdersQuery.data,
        shippedOrders,
        shippedPagination,
        cancelledOrders: cancelledOrdersQuery.data,
        archivedOrders,
        archivedTotalCount,

        // Summary data
        shippedSummary: shippedSummaryQuery.data,
        loadingShippedSummary: shippedSummaryQuery.isLoading,

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
        loadingCancelled: cancelledOrdersQuery.isLoading,
        loadingArchived: archivedOrdersQuery.isLoading,
    };
}

export default useOrdersData;
