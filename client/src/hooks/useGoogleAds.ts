/**
 * React Query hooks for Google Ads analytics (via BigQuery).
 */

import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    getGAdsAccountSummary, getGAdsCampaigns, getGAdsDailyTrend,
    getGAdsProducts, getGAdsGeo, getGAdsHourly, getGAdsDevices,
    getGAdsAge, getGAdsGender, getGAdsSearchTerms, getGAdsKeywords,
    getGAdsLandingPages, getGAdsImpressionShare, getGAdsBudgets,
    getGAdsCreatives, getGAdsVideos, getGAdsAssetGroups, getGAdsAudienceSegments,
} from '../server/functions/googleAds';

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

export function useGAdsProducts(days: number) {
    const fn = useServerFn(getGAdsProducts);
    return useQuery({
        queryKey: ['google-ads', 'products', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsGeo(days: number) {
    const fn = useServerFn(getGAdsGeo);
    return useQuery({
        queryKey: ['google-ads', 'geo', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsHourly(days: number) {
    const fn = useServerFn(getGAdsHourly);
    return useQuery({
        queryKey: ['google-ads', 'hourly', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsDevices(days: number) {
    const fn = useServerFn(getGAdsDevices);
    return useQuery({
        queryKey: ['google-ads', 'devices', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsAge(days: number) {
    const fn = useServerFn(getGAdsAge);
    return useQuery({
        queryKey: ['google-ads', 'age', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsGender(days: number) {
    const fn = useServerFn(getGAdsGender);
    return useQuery({
        queryKey: ['google-ads', 'gender', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsSearchTerms(days: number) {
    const fn = useServerFn(getGAdsSearchTerms);
    return useQuery({
        queryKey: ['google-ads', 'search-terms', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsKeywords(days: number) {
    const fn = useServerFn(getGAdsKeywords);
    return useQuery({
        queryKey: ['google-ads', 'keywords', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsLandingPages(days: number) {
    const fn = useServerFn(getGAdsLandingPages);
    return useQuery({
        queryKey: ['google-ads', 'landing-pages', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsImpressionShare(days: number) {
    const fn = useServerFn(getGAdsImpressionShare);
    return useQuery({
        queryKey: ['google-ads', 'impression-share', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsBudgets(days: number) {
    const fn = useServerFn(getGAdsBudgets);
    return useQuery({
        queryKey: ['google-ads', 'budgets', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsCreatives(days: number) {
    const fn = useServerFn(getGAdsCreatives);
    return useQuery({
        queryKey: ['google-ads', 'creatives', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsVideos(days: number) {
    const fn = useServerFn(getGAdsVideos);
    return useQuery({
        queryKey: ['google-ads', 'videos', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsAssetGroups(days: number) {
    const fn = useServerFn(getGAdsAssetGroups);
    return useQuery({
        queryKey: ['google-ads', 'asset-groups', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGAdsAudienceSegments(days: number) {
    const fn = useServerFn(getGAdsAudienceSegments);
    return useQuery({
        queryKey: ['google-ads', 'audience-segments', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}
