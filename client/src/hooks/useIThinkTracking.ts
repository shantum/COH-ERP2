/**
 * iThink Tracking Hooks
 *
 * - useIThinkTracking: single AWB (for modals, detail views)
 * - useBatchTracking: multiple AWBs in one call (for table views)
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { getAwbTracking, getBatchAwbTracking } from '../server/functions/tracking';
import type { AwbTrackingResponse, TrackingLastScan, TrackingScan } from '../server/functions/tracking';

// Re-exports for backwards compatibility
export type IThinkLastScan = TrackingLastScan;
export type IThinkScanHistoryItem = TrackingScan;
export type IThinkTrackingData = AwbTrackingResponse;

const STALE_TIME = 15 * 60 * 1000; // 15 minutes
const GC_TIME = 30 * 60 * 1000;    // 30 minutes

export interface UseIThinkTrackingOptions {
    awbNumber: string;
    enabled?: boolean;
}

/**
 * Single AWB tracking — for modals and detail views.
 * For table views with many AWBs, use useBatchTracking instead.
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
        staleTime: STALE_TIME,
        gcTime: GC_TIME,
        retry: 1,
    });
}

/**
 * Batch tracking — fetches all AWBs in one server call, populates individual query caches.
 * Use this in table views to avoid N+1 API calls.
 *
 * Returns the batch data + a manual refresh function.
 */
export function useBatchTracking(awbNumbers: string[]) {
    const queryClient = useQueryClient();

    // Dedupe + sort — memoized to produce a stable reference
    const uniqueKey = useMemo(() => {
        const deduped = [...new Set(awbNumbers.filter(Boolean))];
        deduped.sort();
        return deduped.join(',');
    }, [awbNumbers]);

    const unique = useMemo(() => (uniqueKey ? uniqueKey.split(',') : []), [uniqueKey]);

    const query = useQuery<Record<string, AwbTrackingResponse>>({
        queryKey: ['ithink-tracking-batch', uniqueKey],
        queryFn: async () => {
            if (unique.length === 0) return {};

            const result = await getBatchAwbTracking({
                data: { awbNumbers: unique },
            });

            // Populate individual AWB caches so useIThinkTracking reads from cache
            for (const [awb, data] of Object.entries(result)) {
                queryClient.setQueryData(['ithink-tracking', awb], data);
            }

            return result;
        },
        enabled: unique.length > 0,
        staleTime: STALE_TIME,
        gcTime: GC_TIME,
        retry: 1,
    });

    const refresh = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['ithink-tracking-batch'] });
        for (const awb of unique) {
            queryClient.invalidateQueries({ queryKey: ['ithink-tracking', awb] });
        }
    }, [queryClient, unique]);

    return { ...query, refresh };
}
