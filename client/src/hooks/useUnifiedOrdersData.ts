/**
 * useUnifiedOrdersData hook
 * Centralizes all data queries for the unified Orders page
 *
 * Loading strategy: on-demand only (no prefetching)
 * - Current view loads immediately
 * - Other views/pages load when navigated to
 * - Server-side filtering reduces payload size
 *
 * Views: open, shipped, rto, all (4 views)
 * Pagination: 250 orders per page
 *
 * Data fetching uses TanStack Start Server Functions.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { inventoryQueryKeys, ORDERS_PAGE_SIZE } from '../constants/queryKeys';
import { getOrders, getOrderViewCounts } from '../server/functions/orders';
import { getInventoryBalances } from '../server/functions/inventory';
import { getProductionLockedDates } from '../server/functions/production';
import { getFabricStockAnalysis } from '../server/functions/fabrics';
import { getChannels } from '../server/functions/admin';
import { getCustomer } from '../server/functions/customers';

// Server Function types only - actual function loaded dynamically if enabled
// This prevents @tanstack/react-start from being bundled in SPA mode
type GetOrdersResponse = {
    rows: any[];
    view: string;
    hasInventory: boolean;
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasMore: boolean;
    };
};

// Poll intervals - SSE connection determines frequency
// When SSE connected: polling disabled entirely (SSE handles updates)
// When SSE disconnected: moderate polling to stay in sync without overwhelming low-spec devices
const POLL_INTERVAL_ACTIVE = 15000;   // 15 seconds for 'open' view (no SSE) - was 5s, reduced for performance
const POLL_INTERVAL_PASSIVE = 45000;  // 45 seconds for other views (no SSE) - was 30s
// Stale time prevents double-fetches when data is still fresh
const STALE_TIME = 120000;  // 2 minutes (SSE handles real-time updates)
// Cache retention time (5 minutes) - keeps stale data for instant display
const GC_TIME = 5 * 60 * 1000;

// All available views (4 views: Open, Shipped, RTO, All)
export type OrderView = 'open' | 'shipped' | 'rto' | 'all';

// Helper to get page size for a view
export const getPageSize = (_view: OrderView): number => {
    return ORDERS_PAGE_SIZE;
};

// Legacy type alias for backwards compatibility
export type UnifiedOrderTab = OrderView;

interface UseUnifiedOrdersDataOptions {
    currentView: OrderView;
    page: number;
    /** Items per page (defaults to ORDERS_PAGE_SIZE) */
    limit?: number;
    selectedCustomerId?: string | null;
    /** Whether SSE is connected - disables polling when true */
    isSSEConnected?: boolean;
    /** Initial data from route loader (SSR) */
    initialData?: GetOrdersResponse | null;
    /** Allocation filter for Open view (server-side filtering) */
    allocatedFilter?: 'all' | 'allocated' | 'pending';
    /** Production filter for Open view (server-side filtering) */
    productionFilter?: 'all' | 'scheduled' | 'needs' | 'ready';
}

export function useUnifiedOrdersData({
    currentView,
    page,
    limit = ORDERS_PAGE_SIZE,
    selectedCustomerId,
    isSSEConnected = false,
    initialData,
    allocatedFilter,
    productionFilter,
}: UseUnifiedOrdersDataOptions) {
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
    // Uses TanStack Start Server Functions
    // ==========================================

    // Build query params (include filters for Open view server-side filtering)
    const queryParams = useMemo(() => ({
        view: currentView,
        page,
        limit,
        // Only include filters when they have meaningful values (not 'all')
        ...(currentView === 'open' && allocatedFilter && allocatedFilter !== 'all'
            ? { allocatedFilter }
            : {}),
        ...(currentView === 'open' && productionFilter && productionFilter !== 'all'
            ? { productionFilter }
            : {}),
    }), [currentView, page, limit, allocatedFilter, productionFilter]);

    // Server Function path - uses useServerFn hook for proper client-side calls
    const getOrdersFn = useServerFn(getOrders);

    // Check if initial data matches current query params (view/page)
    // Only use initial data if it matches the current request
    const initialDataMatchesQuery = initialData &&
        initialData.view === currentView &&
        initialData.pagination?.page === page;

    const ordersQuery = useQuery<GetOrdersResponse>({
        queryKey: ['orders', 'list', 'server-fn', queryParams],
        queryFn: async () => {
            const result = await getOrdersFn({ data: queryParams });
            return result as GetOrdersResponse;
        },
        // Use initial data from route loader if it matches current query
        // This enables instant page load from SSR
        initialData: initialDataMatchesQuery ? initialData : undefined,
        staleTime: STALE_TIME,
        gcTime: GC_TIME,
        refetchOnWindowFocus: false,
        refetchIntervalInBackground: false,
        placeholderData: (prev) => prev,
        refetchInterval: () => {
            if (typeof document !== 'undefined' && !document.hasFocus()) {
                return false;
            }
            return pollInterval;
        },
    });

    // ==========================================
    // VIEW COUNTS QUERY - For segmented control badges
    // ==========================================

    const getOrderViewCountsFn = useServerFn(getOrderViewCounts);
    const viewCountsQuery = useQuery({
        queryKey: ['orders', 'viewCounts'],
        queryFn: () => getOrderViewCountsFn(),
        staleTime: 30000, // 30 seconds
        refetchOnWindowFocus: false,
    });

    // NOTE: Prefetching disabled - views/pages load on-demand
    // Server-side filtering makes prefetch unreliable (filter params vary)

    // ==========================================
    // SUPPORTING DATA QUERIES
    // ==========================================

    // Check if server already included inventory in the response
    const hasInventoryFromServer = ordersQuery.data?.hasInventory ?? false;

    // Extract unique SKU IDs from rows for targeted inventory balance fetch
    // Only needed if server didn't include inventory (Server Function always includes it)
    const orderSkuIds = useMemo(() => {
        if (hasInventoryFromServer) return [];  // Skip if server included inventory
        // Extract SKU IDs directly from rows
        const dataRows = ordersQuery.data?.rows || [];
        const skuSet = new Set<string>();
        dataRows.forEach((row: any) => {
            if (row.skuId) skuSet.add(row.skuId);
        });
        return Array.from(skuSet);
    }, [ordersQuery.data?.rows, hasInventoryFromServer]);

    // Inventory balance for SKUs in current orders
    // Skip this query if server already included inventory (saves round-trip)
    // IMPORTANT: Use inventoryQueryKeys.balance as base so mutations can invalidate via partial match
    const getInventoryBalancesFn = useServerFn(getInventoryBalances);
    const inventoryBalanceQuery = useQuery({
        queryKey: [...inventoryQueryKeys.balance, orderSkuIds],
        queryFn: () => getInventoryBalancesFn({ data: { skuIds: orderSkuIds } }),
        staleTime: 60000,
        refetchOnWindowFocus: false,
        enabled: orderSkuIds.length > 0 && !hasInventoryFromServer,
    });

    // Fabric stock - only needed for Open view
    const getFabricStockAnalysisFn = useServerFn(getFabricStockAnalysis);
    const fabricStockQuery = useQuery({
        queryKey: inventoryQueryKeys.fabric,
        queryFn: async () => {
            const result = await getFabricStockAnalysisFn({ data: {} });
            return result.analysis;
        },
        staleTime: 60000,
        enabled: currentView === 'open',
    });

    // Channels for CreateOrderModal
    const getChannelsFn = useServerFn(getChannels);
    const channelsQuery = useQuery({
        queryKey: ['orderChannels'],
        queryFn: async () => {
            const result = await getChannelsFn();
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to fetch channels');
            }
            return result.data;
        },
        staleTime: 300000,
    });

    // Locked production dates - only needed for Open view
    const getLockedDatesFn = useServerFn(getProductionLockedDates);
    const lockedDatesQuery = useQuery({
        queryKey: ['production', 'lockedDates'],
        queryFn: () => getLockedDatesFn(),
        staleTime: 60000,
        enabled: currentView === 'open',
    });

    // Customer detail - only when selected
    const getCustomerFn = useServerFn(getCustomer);
    const customerDetailQuery = useQuery({
        queryKey: ['customer', selectedCustomerId],
        queryFn: () => getCustomerFn({ data: { id: selectedCustomerId! } }),
        enabled: !!selectedCustomerId
    });

    // ==========================================
    // COMPUTED VALUES
    // ==========================================

    const rows = ordersQuery.data?.rows || [];
    const pagination = ordersQuery.data?.pagination;

    // Derive orders from rows - Server Function returns only `rows`, not `orders`
    // Groups rows by orderId and extracts the order reference from each unique order
    const orders = useMemo(() => {
        if (rows.length === 0) return [];
        const orderMap = new Map<string, any>();
        for (const row of rows) {
            if (!orderMap.has(row.orderId) && row.order) {
                // Construct an order-like object from the row data
                orderMap.set(row.orderId, {
                    id: row.orderId,
                    orderNumber: row.orderNumber,
                    orderLines: row.order.orderLines || [],
                    // Include other fields needed by client code
                    status: row.orderStatus,
                    isArchived: row.isArchived,
                    releasedToShipped: row.releasedToShipped,
                    releasedToCancelled: row.releasedToCancelled,
                });
            }
        }
        return Array.from(orderMap.values());
    }, [rows]);

    return {
        // Pre-flattened rows from server (primary data source)
        rows,
        // Legacy orders for backwards compatibility
        orders,
        pagination,

        // View counts for segmented control
        viewCounts: viewCountsQuery.data,
        viewCountsLoading: viewCountsQuery.isLoading,

        // Supporting data
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
