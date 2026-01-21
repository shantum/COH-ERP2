/**
 * iThink Tracking Hook
 * TanStack Query hook for fetching iThink Logistics tracking data
 *
 * Migrated to use Server Functions instead of Axios API calls.
 */

import { useQuery } from '@tanstack/react-query';
import { getAwbTracking } from '../server/functions/tracking';
import type { AwbTrackingResponse, TrackingLastScan, TrackingScan } from '../server/functions/tracking';

/**
 * Last scan details from iThink tracking
 * Re-export from server function types for backwards compatibility
 */
export type IThinkLastScan = TrackingLastScan;

/**
 * Scan history item from iThink tracking
 * Re-export from server function types for backwards compatibility
 */
export type IThinkScanHistoryItem = TrackingScan;

/**
 * Full tracking data from iThink Logistics
 * Re-export from server function types for backwards compatibility
 */
export type IThinkTrackingData = AwbTrackingResponse;

export interface UseIThinkTrackingOptions {
    /** AWB number to track */
    awbNumber: string;
    /** Whether to fetch data (useful for lazy loading) */
    enabled?: boolean;
}

/**
 * Hook to fetch iThink tracking data for an AWB
 *
 * @example
 * const { data, isLoading, error } = useIThinkTracking({
 *   awbNumber: '21025852704255',
 *   enabled: isExpanded,
 * });
 */
export function useIThinkTracking({
    awbNumber,
    enabled = true,
}: UseIThinkTrackingOptions) {
    return useQuery<IThinkTrackingData>({
        queryKey: ['ithink-tracking', awbNumber],
        queryFn: async () => {
            const result = await getAwbTracking({
                data: { awbNumber },
            });
            return result;
        },
        enabled: enabled && !!awbNumber,
        staleTime: 2 * 60 * 1000, // 2 minutes - tracking updates frequently
        gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
        retry: 1, // Only retry once on failure
    });
}
