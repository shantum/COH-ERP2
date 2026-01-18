/**
 * useSearchOrders hook
 * Fetches search results across all order statuses for grid display
 * Returns same row format as useUnifiedOrdersData for seamless grid integration
 */

import { useQuery } from '@tanstack/react-query';
import { ordersApi } from '../services/api';

// Cache search results for 30 seconds
const STALE_TIME = 30000;

interface UseSearchOrdersOptions {
    query: string;
    page?: number;
    pageSize?: number;
    enabled?: boolean;
}

interface SearchResult {
    data: any[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    };
    searchQuery: string;
}

export function useSearchOrders({
    query,
    page = 1,
    pageSize = 100,
    enabled = true,
}: UseSearchOrdersOptions) {
    const searchQuery = useQuery<SearchResult>({
        queryKey: ['orders', 'search-unified', query, page, pageSize],
        queryFn: async () => {
            const response = await ordersApi.searchUnified(query, page, pageSize);
            return response.data;
        },
        enabled: enabled && query.length >= 2,
        staleTime: STALE_TIME,
        placeholderData: (prev) => prev, // Keep showing previous results while fetching
    });

    return {
        // Pre-flattened rows for grid display (same shape as useUnifiedOrdersData)
        rows: searchQuery.data?.data || [],
        pagination: searchQuery.data?.pagination,
        searchQuery: searchQuery.data?.searchQuery || query,

        // Loading states
        isLoading: searchQuery.isLoading,
        isFetching: searchQuery.isFetching,
        isError: searchQuery.isError,
        error: searchQuery.error,

        // Refetch
        refetch: searchQuery.refetch,
    };
}

export default useSearchOrders;
