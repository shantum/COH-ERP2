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
}

export function useOrdersData({ activeTab, selectedCustomerId }: UseOrdersDataOptions) {
    // Order queries with conditional polling based on active tab
    const openOrdersQuery = useQuery({
        queryKey: ['openOrders'],
        queryFn: () => ordersApi.getOpen().then(r => r.data),
        refetchInterval: activeTab === 'open' ? POLL_INTERVAL : false
    });

    const shippedOrdersQuery = useQuery({
        queryKey: ['shippedOrders'],
        queryFn: () => ordersApi.getShipped({ days: 30 }).then(r => r.data),
        refetchInterval: activeTab === 'shipped' ? POLL_INTERVAL : false
    });

    const cancelledOrdersQuery = useQuery({
        queryKey: ['cancelledOrders'],
        queryFn: () => ordersApi.getCancelled().then(r => r.data),
        refetchInterval: activeTab === 'cancelled' ? POLL_INTERVAL : false
    });

    const archivedOrdersQuery = useQuery({
        queryKey: ['archivedOrders'],
        queryFn: () => ordersApi.getArchived().then(r => r.data),
        refetchInterval: activeTab === 'archived' ? POLL_INTERVAL : false
    });

    // Supporting data queries
    const allSkusQuery = useQuery({
        queryKey: ['allSkus'],
        queryFn: () => productsApi.getAllSkus().then(r => r.data)
    });

    const inventoryBalanceQuery = useQuery({
        queryKey: ['inventoryBalance'],
        queryFn: () => inventoryApi.getBalance().then(r => r.data)
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

    return {
        // Order data
        openOrders: openOrdersQuery.data,
        shippedOrders: shippedOrdersQuery.data,
        cancelledOrders: cancelledOrdersQuery.data,
        archivedOrders: archivedOrdersQuery.data,

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
