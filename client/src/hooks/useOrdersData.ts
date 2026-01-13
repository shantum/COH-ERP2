/**
 * useOrdersData hook
 * Centralizes all data queries for the Orders page (Open and Cancelled tabs)
 *
 * Loading strategy:
 * 1. Active tab loads immediately
 * 2. Once active tab completes, remaining tab loads in background
 * 3. Priority order: Open → Cancelled
 *
 * Note: Shipped-related queries (shipped, RTO, COD pending, archived) are now in useShipmentsData.ts
 *
 * Migration status:
 * - Order list queries: tRPC (type-safe, auto-cached)
 * - Inventory balance: tRPC (migrated)
 * - Supporting queries: Axios (different API domains)
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fabricsApi, productionApi, adminApi, customersApi } from '../services/api';
import { inventoryQueryKeys } from '../constants/queryKeys';
import { trpc } from '../services/trpc';

// Poll interval for data refresh (30 seconds)
const POLL_INTERVAL = 30000;
// Stale time prevents double-fetches when data is still fresh
const STALE_TIME = 25000;

export type OrderTab = 'open' | 'cancelled';

interface UseOrdersDataOptions {
    activeTab: OrderTab;
    selectedCustomerId?: string | null;
}

export function useOrdersData({ activeTab, selectedCustomerId }: UseOrdersDataOptions) {
    // Order queries with SEQUENTIAL BACKGROUND LOADING
    // Active tab loads immediately, then remaining tab loads in background
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

    // Cancelled loads after open completes (or immediately if active tab)
    const cancelledOrdersQuery = trpc.orders.list.useQuery(
        { view: 'cancelled' },
        {
            staleTime: STALE_TIME,
            refetchOnWindowFocus: false,
            refetchInterval: activeTab === 'cancelled' ? POLL_INTERVAL : false,
            refetchIntervalInBackground: false,
            enabled: activeTab === 'cancelled' || openOrdersQuery.isSuccess,
        }
    );

    // Supporting data queries
    // allSkus is needed for CreateOrderModal product search (can be opened from any tab)
    // Migrated to tRPC - fetches all products with variations and SKUs (limit=1000 for comprehensive list)
    const allSkusQuery = trpc.products.list.useQuery(
        { limit: 1000 }, // Fetch all products with high limit to get comprehensive SKU list
        {
            staleTime: 60000, // SKU list doesn't change often
            refetchOnWindowFocus: false,
            // Always enabled - needed for CreateOrderModal product search from any tab
            // Transform the response to match the expected flat SKU structure
            // CreateOrderModal expects sku.variation?.product?.name for display
            select: (data) => {
                const skus: any[] = [];
                data.products.forEach((product: any) => {
                    product.variations?.forEach((variation: any) => {
                        variation.skus?.forEach((sku: any) => {
                            skus.push({
                                ...sku,
                                // Include variation with product reference for display
                                variation: {
                                    ...variation,
                                    product, // Add product for sku.variation.product.name access
                                },
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
        cancelledOrdersQuery.isLoading;

    // Extract orders from tRPC response shape: { orders, pagination, view, viewName }
    const openOrders = openOrdersQuery.data?.orders || [];
    const cancelledOrders = cancelledOrdersQuery.data?.orders || [];

    return {
        // Order data (extracted from tRPC response shape)
        openOrders,
        cancelledOrders,

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
        loadingCancelled: cancelledOrdersQuery.isLoading,
    };
}

export default useOrdersData;
