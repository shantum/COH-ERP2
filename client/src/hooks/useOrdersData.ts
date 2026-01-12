/**
 * useOrdersData hook
 * Centralizes all data queries for the Orders page
 *
 * Loading strategy:
 * 1. Active tab loads immediately
 * 2. Once active tab completes, remaining tabs load sequentially in background
 * 3. Priority order: Open → Shipped → RTO → COD Pending → Cancelled → Archived
 *
 * Migration status:
 * - Order list queries: tRPC (type-safe, auto-cached)
 * - Inventory balance: tRPC (migrated)
 * - Summary queries: Axios (pending tRPC procedures)
 * - Supporting queries: Axios (different API domains)
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ordersApi, fabricsApi, productionApi, adminApi, customersApi } from '../services/api';
import { orderQueryKeys, inventoryQueryKeys } from '../constants/queryKeys';
import { trpc } from '../services/trpc';

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

    // tRPC query - type-safe, auto-cached with key [['orders', 'list'], { input: { view: 'open' } }]
    // Note: Using limit=500 (server max) to ensure all open orders are fetched
    // The open view sorts by orderDate ASC (FIFO), so without high limit, newest orders are cut off
    const openOrdersQuery = trpc.orders.list.useQuery(
        { view: 'open', limit: 500 },
        {
            staleTime: STALE_TIME,
            refetchOnWindowFocus: false,
            refetchInterval: activeTab === 'open' ? POLL_INTERVAL : false,
            refetchIntervalInBackground: false,
            // Open tab is the default, always fetch it immediately
        }
    );

    // Shipped loads: when tab is active OR after open completes
    const shippedOrdersQuery = trpc.orders.list.useQuery(
        { view: 'shipped', page: shippedPage, days: shippedDays },
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

    // Archived loads last: when tab is active OR after Cancelled completes
    const archivedOrdersQuery = trpc.orders.list.useQuery(
        {
            view: 'archived',
            ...(archivedDays > 0 ? { days: archivedDays } : {}),
            limit: archivedLimit,
            sortBy: archivedSortBy,
        },
        {
            staleTime: STALE_TIME,
            refetchOnWindowFocus: false,
            refetchInterval: activeTab === 'archived' ? POLL_INTERVAL : false,
            refetchIntervalInBackground: false,
            enabled: activeTab === 'archived' || cancelledOrdersQuery.isSuccess,
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

    // Supporting data queries - lazy loaded based on what's needed for active tab
    // allSkus and inventoryBalance are heavy queries only needed for Open tab
    // Migrated to tRPC - fetches all products with variations and SKUs (limit=1000 for comprehensive list)
    const allSkusQuery = trpc.products.list.useQuery(
        { limit: 1000 }, // Fetch all products with high limit to get comprehensive SKU list
        {
            staleTime: 60000, // SKU list doesn't change often
            refetchOnWindowFocus: false,
            enabled: activeTab === 'open', // Only needed for Open tab (to change SKU)
            // Transform the response to match the expected flat SKU structure
            select: (data) => {
                const skus: any[] = [];
                data.products.forEach((product: any) => {
                    product.variations?.forEach((variation: any) => {
                        variation.skus?.forEach((sku: any) => {
                            skus.push({
                                ...sku,
                                variation,
                                // Keep original structure for compatibility
                            });
                        });
                    });
                });
                return skus;
            }
        }
    );

    // Extract unique SKU IDs from open orders for targeted inventory balance fetch
    // This reduces payload from ~3MB (all SKUs) to ~50-100KB (only SKUs in open orders)
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

    // tRPC query - type-safe inventory balance for ONLY SKUs in open orders
    // Optimized: fetches ~100-200 SKUs (~50-100KB) instead of ~4000+ SKUs (~3MB)
    // Starts fetching as soon as SKU IDs are available (not gated by tab)
    // so data is ready when user views the Open tab
    const inventoryBalanceQuery = trpc.inventory.getBalances.useQuery(
        { skuIds: openOrderSkuIds },
        {
            staleTime: 60000, // Inventory balance doesn't change rapidly (60s cache)
            refetchOnWindowFocus: false,
            // Fetch as soon as we have SKU IDs (not gated by activeTab)
            enabled: openOrderSkuIds.length > 0,
        }
    );

    const fabricStockQuery = useQuery({
        queryKey: inventoryQueryKeys.fabric,
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

    // Extract orders from tRPC response shape: { orders, pagination, view, viewName }
    const openOrders = openOrdersQuery.data?.orders || [];

    // Extract shipped orders and pagination from response
    const shippedData = shippedOrdersQuery.data;
    const shippedOrders = shippedData?.orders || [];
    const shippedPagination = shippedData?.pagination || { total: 0, page: 1, totalPages: 1 };

    // Extract archived orders and total count from response
    const archivedData = archivedOrdersQuery.data;
    const archivedOrders = archivedData?.orders || [];
    const archivedTotalCount = archivedData?.pagination?.total ?? 0;

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

    // Extract cancelled orders from response
    const cancelledOrders = cancelledOrdersQuery.data?.orders || [];

    return {
        // Order data (extracted from tRPC response shape)
        openOrders,
        shippedOrders,
        shippedPagination,
        rtoOrders,
        rtoTotalCount,
        codPendingOrders,
        codPendingTotalCount,
        codPendingTotalAmount,
        cancelledOrders,
        archivedOrders,
        archivedTotalCount,

        // Summary data
        shippedSummary: shippedSummaryQuery.data,
        loadingShippedSummary: shippedSummaryQuery.isLoading,
        rtoSummary: rtoSummaryQuery.data,
        loadingRtoSummary: rtoSummaryQuery.isLoading,

        // Supporting data
        allSkus: allSkusQuery.data,
        // getBalances returns array directly (optimized query for open order SKUs only)
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
