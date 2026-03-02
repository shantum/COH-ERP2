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
    getStorefrontProductVariants,
    getStorefrontLiveFeed,
    getStorefrontTrafficSources,
    getStorefrontCampaignAttribution,
    getStorefrontGeoBreakdown,
    getStorefrontTopPages,
    getStorefrontTopSearches,
    getStorefrontDeviceBreakdown,
    getStorefrontVisitorList,
    getStorefrontVisitorDetail,
    getStorefrontClickIdBreakdown,
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

export function useProductVariants(productTitle: string, gender: string | null, days: number, enabled: boolean) {
    const fn = useServerFn(getStorefrontProductVariants);
    return useQuery({
        queryKey: ['storefront', 'product-variants', productTitle, gender, days],
        queryFn: () => fn({ data: { productTitle, gender, days } }),
        staleTime: AGGREGATE_STALE,
        enabled,
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

export function useVisitorList(days: number, limit = 50, offset = 0, filter?: { status?: string; source?: string; deviceType?: string }) {
    const fn = useServerFn(getStorefrontVisitorList);
    return useQuery({
        queryKey: ['storefront', 'visitor-list', days, limit, offset, filter],
        queryFn: () => fn({ data: { days, limit, offset, ...(filter ? { filter } : {}) } }),
        staleTime: AGGREGATE_STALE,
    });
}

export function useVisitorDetail(visitorId: string | null) {
    const fn = useServerFn(getStorefrontVisitorDetail);
    return useQuery({
        queryKey: ['storefront', 'visitor-detail', visitorId],
        queryFn: () => fn({ data: { visitorId: visitorId! } }),
        staleTime: AGGREGATE_STALE,
        enabled: !!visitorId,
    });
}

export function useClickIdBreakdown(days: number) {
    const fn = useServerFn(getStorefrontClickIdBreakdown);
    return useQuery({
        queryKey: ['storefront', 'click-id-breakdown', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: AGGREGATE_STALE,
    });
}
