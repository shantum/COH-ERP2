/**
 * useSearchOrders hook
 * Fetches search results across all order statuses for grid display
 * Returns same row format as useUnifiedOrdersData for seamless grid integration
 *
 * Migrated to use Server Functions instead of Axios API calls.
 */

import { useQuery } from '@tanstack/react-query';
import { searchUnifiedOrders } from '../server/functions/orders';
import type { SearchUnifiedResponse } from '../server/functions/orders';

// Cache search results for 30 seconds
const STALE_TIME = 30000;

interface UseSearchOrdersOptions {
    query: string;
    page?: number;
    pageSize?: number;
    enabled?: boolean;
}

export function useSearchOrders({
    query,
    page = 1,
    pageSize = 100,
    enabled = true,
}: UseSearchOrdersOptions) {
    const searchQuery = useQuery<SearchUnifiedResponse>({
        queryKey: ['orders', 'search-unified', query, page, pageSize],
        queryFn: async () => {
            const result = await searchUnifiedOrders({
                data: { q: query, page, pageSize },
            });
            return result;
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
