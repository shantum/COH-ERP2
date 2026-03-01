/**
 * React Query hooks for Meta Ads analytics.
 */

import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    getMetaCampaigns, getMetaDailyTrend, getMetaSummary,
    getMetaAdsets, getMetaAds, getMetaAgeGender,
    getMetaPlacements, getMetaRegions, getMetaDevices,
    getMetaProducts,
} from '../server/functions/metaAds';

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

export function useMetaAdsets(days: number) {
    const fn = useServerFn(getMetaAdsets);
    return useQuery({
        queryKey: ['meta-ads', 'adsets', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useMetaAds(days: number) {
    const fn = useServerFn(getMetaAds);
    return useQuery({
        queryKey: ['meta-ads', 'ads', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useMetaAgeGender(days: number) {
    const fn = useServerFn(getMetaAgeGender);
    return useQuery({
        queryKey: ['meta-ads', 'age-gender', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useMetaPlacements(days: number) {
    const fn = useServerFn(getMetaPlacements);
    return useQuery({
        queryKey: ['meta-ads', 'placements', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useMetaRegions(days: number) {
    const fn = useServerFn(getMetaRegions);
    return useQuery({
        queryKey: ['meta-ads', 'regions', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useMetaDevices(days: number) {
    const fn = useServerFn(getMetaDevices);
    return useQuery({
        queryKey: ['meta-ads', 'devices', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useMetaProducts(days: number) {
    const fn = useServerFn(getMetaProducts);
    return useQuery({
        queryKey: ['meta-ads', 'products', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}
