/**
 * useShipmentsData hook
 * Centralizes all data queries for the Shipments page
 *
 * Loading strategy:
 * 1. Active tab loads immediately
 * 2. Once active tab completes, remaining tabs load sequentially in background
 * 3. Priority order: Shipped → RTO → COD Pending → Archived
 *
 * Migration status:
 * - Order list queries: tRPC (type-safe, auto-cached)
 * - Summary queries: Axios (pending tRPC procedures)
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ordersApi } from '../services/api';
import { orderQueryKeys } from '../constants/queryKeys';
import { trpc } from '../services/trpc';

// Poll interval for data refresh (30 seconds)
const POLL_INTERVAL = 30000;
// Stale time prevents double-fetches when data is still fresh
const STALE_TIME = 25000;

export type ShipmentTab = 'shipped' | 'rto' | 'cod-pending' | 'archived';

interface UseShipmentsDataOptions {
    activeTab: ShipmentTab;
    shippedPage?: number;
    shippedDays?: number;
    archivedDays?: number;
    archivedLimit?: number;
    archivedSortBy?: 'orderDate' | 'archivedAt';
}

export function useShipmentsData({
    activeTab,
    shippedPage = 1,
    shippedDays = 30,
    archivedDays = 90,
    archivedLimit = 100,
    archivedSortBy = 'archivedAt'
}: UseShipmentsDataOptions) {
    // Pagination state for shipped
    const [shippedPageState, setShippedPage] = useState(shippedPage);

    // Pagination state for archived
    const [archivedLimitState, setArchivedLimit] = useState(archivedLimit);
    const [archivedDaysState, setArchivedDays] = useState(archivedDays);
    const [archivedSortByState, setArchivedSortBy] = useState(archivedSortBy);

    // Order queries with SEQUENTIAL BACKGROUND LOADING
    // Active tab loads immediately, then remaining tabs load one-by-one after it completes
    // This ensures:
    // 1. Active tab data appears as fast as possible
    // 2. Tab counts populate progressively as background loads complete
    // 3. Switching tabs feels instant since data is pre-loaded

    // Shipped loads first (default tab) - with pagination
    // tRPC query - type-safe, auto-cached with key [['orders', 'list'], { input: { view: 'shipped', page, days } }]
    const shippedOrdersQuery = trpc.orders.list.useQuery(
        { view: 'shipped', page: shippedPageState, days: shippedDays },
        {
            staleTime: STALE_TIME,
            refetchOnWindowFocus: false,
            refetchInterval: activeTab === 'shipped' ? POLL_INTERVAL : false,
            refetchIntervalInBackground: false,
            // Shipped tab is the default, always fetch it immediately
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
    // Note: Server view name is 'cod_pending' (underscore)
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

    // Archived loads last: when tab is active OR after COD Pending completes
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
            enabled: activeTab === 'archived' || codPendingOrdersQuery.isSuccess,
        }
    );

    // Summary queries - load with their respective tabs or in background
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

    // Determine current loading state based on active tab
    const isLoading =
        activeTab === 'shipped' ? shippedOrdersQuery.isLoading :
        activeTab === 'rto' ? rtoOrdersQuery.isLoading :
        activeTab === 'cod-pending' ? codPendingOrdersQuery.isLoading :
        archivedOrdersQuery.isLoading;

    // Extract shipped orders and pagination from response
    const shippedData = shippedOrdersQuery.data;
    const shippedOrders = shippedData?.orders || [];
    const shippedPagination = shippedData?.pagination || { total: 0, page: 1, totalPages: 1 };

    // Extract RTO orders from response
    const rtoData = rtoOrdersQuery.data;
    const rtoOrders = rtoData?.orders || [];
    const rtoTotalCount = rtoData?.pagination?.total ?? 0;

    // Extract COD pending orders from response
    const codPendingData = codPendingOrdersQuery.data;
    const codPendingOrders = codPendingData?.orders || [];
    const codPendingTotalCount = codPendingData?.pagination?.total ?? 0;
    // Note: totalPendingAmount not available in tRPC response - needs server-side addition
    const codPendingTotalAmount = 0;

    // Extract archived orders and total count from response
    const archivedData = archivedOrdersQuery.data;
    const archivedOrders = archivedData?.orders || [];
    const archivedTotalCount = archivedData?.pagination?.total ?? 0;

    return {
        // Order data (extracted from tRPC response shape)
        shippedOrders,
        shippedPagination,
        rtoOrders,
        rtoTotalCount,
        codPendingOrders,
        codPendingTotalCount,
        codPendingTotalAmount,
        archivedOrders,
        archivedTotalCount,

        // Summary data
        shippedSummary: shippedSummaryQuery.data,
        loadingShippedSummary: shippedSummaryQuery.isLoading,
        rtoSummary: rtoSummaryQuery.data,
        loadingRtoSummary: rtoSummaryQuery.isLoading,

        // Pagination state for shipped
        shippedPage: shippedPageState,
        setShippedPage,

        // Pagination state for archived
        archivedLimit: archivedLimitState,
        setArchivedLimit,
        archivedDays: archivedDaysState,
        setArchivedDays,
        archivedSortBy: archivedSortByState,
        setArchivedSortBy,

        // Loading state for current tab
        isLoading,

        // Individual loading states if needed
        loadingShipped: shippedOrdersQuery.isLoading,
        loadingRto: rtoOrdersQuery.isLoading,
        loadingCodPending: codPendingOrdersQuery.isLoading,
        loadingArchived: archivedOrdersQuery.isLoading,

        // Refetch functions for manual refresh
        refetchShipped: shippedOrdersQuery.refetch,
        refetchRto: rtoOrdersQuery.refetch,
        refetchCodPending: codPendingOrdersQuery.refetch,
        refetchArchived: archivedOrdersQuery.refetch,
    };
}

export default useShipmentsData;
