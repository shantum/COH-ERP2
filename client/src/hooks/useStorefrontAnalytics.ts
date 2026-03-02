/**
 * React Query hooks for Storefront Live dashboard.
 *
 * Live feed + on-site-now: 15s polling (near real-time).
 * Aggregate data: 60s stale time (funnel, products, geo, etc.).
 */

import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    getStorefrontHeroMetrics,
    getStorefrontOnSiteNow,
    getStorefrontProductFunnel,
    getStorefrontLiveFeed,
    getStorefrontTrafficSources,
    getStorefrontCampaignAttribution,
    getStorefrontGeoBreakdown,
    getStorefrontTopPages,
    getStorefrontTopSearches,
    getStorefrontDeviceBreakdown,
} from '../server/functions/storefrontAnalytics';

const LIVE_STALE = 10_000;       // 10s
const LIVE_REFETCH = 15_000;     // 15s polling
const AGGREGATE_STALE = 60_000;  // 1 min

export function useHeroMetrics(days: number) {
    const fn = useServerFn(getStorefrontHeroMetrics);
    return useQuery({
        queryKey: ['storefront', 'hero', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: AGGREGATE_STALE,
    });
}

export function useOnSiteNow() {
    const fn = useServerFn(getStorefrontOnSiteNow);
    return useQuery({
        queryKey: ['storefront', 'on-site-now'],
        queryFn: () => fn({}),
        staleTime: LIVE_STALE,
        refetchInterval: LIVE_REFETCH,
    });
}

export function useProductFunnel(days: number, limit = 10) {
    const fn = useServerFn(getStorefrontProductFunnel);
    return useQuery({
        queryKey: ['storefront', 'product-funnel', days, limit],
        queryFn: () => fn({ data: { days, limit } }),
        staleTime: AGGREGATE_STALE,
    });
}

export function useLiveFeed(limit = 20) {
    const fn = useServerFn(getStorefrontLiveFeed);
    return useQuery({
        queryKey: ['storefront', 'live-feed'],
        queryFn: () => fn({ data: { limit } }),
        staleTime: LIVE_STALE,
        refetchInterval: LIVE_REFETCH,
    });
}

export function useTrafficSources(days: number) {
    const fn = useServerFn(getStorefrontTrafficSources);
    return useQuery({
        queryKey: ['storefront', 'traffic-sources', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: AGGREGATE_STALE,
    });
}

export function useCampaignAttribution(days: number) {
    const fn = useServerFn(getStorefrontCampaignAttribution);
    return useQuery({
        queryKey: ['storefront', 'campaign-attribution', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: AGGREGATE_STALE,
    });
}

export function useGeoBreakdown(days: number, limit = 10) {
    const fn = useServerFn(getStorefrontGeoBreakdown);
    return useQuery({
        queryKey: ['storefront', 'geo', days, limit],
        queryFn: () => fn({ data: { days, limit } }),
        staleTime: AGGREGATE_STALE,
    });
}

export function useTopPages(days: number, limit = 10) {
    const fn = useServerFn(getStorefrontTopPages);
    return useQuery({
        queryKey: ['storefront', 'top-pages', days, limit],
        queryFn: () => fn({ data: { days, limit } }),
        staleTime: AGGREGATE_STALE,
    });
}

export function useTopSearches(days: number, limit = 10) {
    const fn = useServerFn(getStorefrontTopSearches);
    return useQuery({
        queryKey: ['storefront', 'top-searches', days, limit],
        queryFn: () => fn({ data: { days, limit } }),
        staleTime: AGGREGATE_STALE,
    });
}

export function useDeviceBreakdown(days: number) {
    const fn = useServerFn(getStorefrontDeviceBreakdown);
    return useQuery({
        queryKey: ['storefront', 'device', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: AGGREGATE_STALE,
    });
}
