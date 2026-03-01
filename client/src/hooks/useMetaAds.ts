/**
 * React Query hooks for Meta Ads analytics.
 */

import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getMetaCampaigns, getMetaDailyTrend, getMetaSummary } from '../server/functions/metaAds';

const STALE_TIME = 5 * 60 * 1000;

export function useMetaCampaigns(days: number) {
    const fn = useServerFn(getMetaCampaigns);
    return useQuery({
        queryKey: ['meta-ads', 'campaigns', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useMetaDailyTrend(days: number) {
    const fn = useServerFn(getMetaDailyTrend);
    return useQuery({
        queryKey: ['meta-ads', 'daily', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useMetaSummary(days: number) {
    const fn = useServerFn(getMetaSummary);
    return useQuery({
        queryKey: ['meta-ads', 'summary', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}
