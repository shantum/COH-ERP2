/**
 * useUnifiedOrdersData hook
 * Centralizes all data queries for the unified Orders page
 *
 * Views: all, in_transit, delivered, rto, cancelled (5 views)
 * Pagination: 250 orders per page
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { ORDERS_PAGE_SIZE } from '../constants/queryKeys';
import { getOrders, getOrderViewCounts, type FlattenedOrderRow } from '../server/functions/orders';
import { getChannels } from '../server/functions/admin';

type GetOrdersResponse = {
    rows: FlattenedOrderRow[];
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

const STALE_TIME = 120000;
const GC_TIME = 5 * 60 * 1000;
const POLL_INTERVAL_ACTIVE = 15000;
const POLL_INTERVAL_PASSIVE = 45000;

export type OrderView = 'all' | 'in_transit' | 'delivered' | 'rto' | 'cancelled';

export const getPageSize = (): number => {
    return ORDERS_PAGE_SIZE;
};

interface UseUnifiedOrdersDataOptions {
    currentView: OrderView;
    page: number;
    limit?: number;
    selectedCustomerId?: string | null;
    isSSEConnected?: boolean;
    initialData?: GetOrdersResponse | null;
}

export function useUnifiedOrdersData({
    currentView,
    page,
    limit = ORDERS_PAGE_SIZE,
    isSSEConnected = false,
    initialData,
}: UseUnifiedOrdersDataOptions) {
    const pollInterval = useMemo(() => {
        if (isSSEConnected) return false as const;
        return currentView === 'all' ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_PASSIVE;
    }, [isSSEConnected, currentView]);

    const queryParams = useMemo(() => ({
        view: currentView,
        page,
        limit,
    }), [currentView, page, limit]);

    const getOrdersFn = useServerFn(getOrders);

    const initialDataMatchesQuery = initialData &&
        initialData.view === currentView &&
        initialData.pagination?.page === page;

    const ordersQuery = useQuery<GetOrdersResponse>({
        queryKey: ['orders', 'list', 'server-fn', queryParams],
        queryFn: async () => {
            const result = await getOrdersFn({ data: queryParams });
            return result as GetOrdersResponse;
        },
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

    const getOrderViewCountsFn = useServerFn(getOrderViewCounts);
    const viewCountsQuery = useQuery({
        queryKey: ['orders', 'viewCounts'],
        queryFn: () => getOrderViewCountsFn(),
        staleTime: 30000,
        refetchOnWindowFocus: false,
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

    const rows = useMemo(() => ordersQuery.data?.rows || [], [ordersQuery.data?.rows]);
    const pagination = ordersQuery.data?.pagination;

    const orders = useMemo(() => {
        if (rows.length === 0) return [];
        const orderMap = new Map<string, Record<string, unknown>>();
        for (const row of rows) {
            if (!orderMap.has(row.orderId) && row.order) {
                orderMap.set(row.orderId, {
                    id: row.orderId,
                    orderNumber: row.orderNumber,
                    orderLines: row.order.orderLines || [],
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
        rows,
        orders,
        pagination,
        viewCounts: viewCountsQuery.data,
        viewCountsLoading: viewCountsQuery.isLoading,
        channels: channelsQuery.data,
        isLoading: ordersQuery.isLoading,
        isFetching: ordersQuery.isFetching,
        refetch: ordersQuery.refetch,
    };
}

export default useUnifiedOrdersData;
