/**
 * React Query hooks for Google Ads analytics (via BigQuery).
 */

import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getGAdsAccountSummary, getGAdsCampaigns, getGAdsDailyTrend } from '../server/functions/googleAds';

const STALE_TIME = 5 * 60 * 1000;

export function useGAdsAccountSummary(days: number) {
    const fn = useServerFn(getGAdsAccountSummary);
    return useQuery({
        queryKey: ['google-ads', 'summary', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsCampaigns(days: number) {
    const fn = useServerFn(getGAdsCampaigns);
    return useQuery({
        queryKey: ['google-ads', 'campaigns', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsDailyTrend(days: number) {
    const fn = useServerFn(getGAdsDailyTrend);
    return useQuery({
        queryKey: ['google-ads', 'daily', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}
