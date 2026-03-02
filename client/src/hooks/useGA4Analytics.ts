/**
 * React Query hooks for GA4 Growth Analytics.
 * All hooks use 5-minute stale time since GA4 data updates slowly.
 */

import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    getConversionFunnel,
    getLandingPages,
    getTrafficSources,
    getCampaigns,
    getGeoConversion,
    getDeviceBreakdown,
    getGrowthOverview,
    getGA4Health,
    getProductPerformance,
} from '../server/functions/ga4Analytics';

const STALE_TIME = 5 * 60 * 1000; // 5 minutes

export function useConversionFunnel(days: number) {
    const fn = useServerFn(getConversionFunnel);
    return useQuery({
        queryKey: ['ga4', 'funnel', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useLandingPages(days: number, limit = 50) {
    const fn = useServerFn(getLandingPages);
    return useQuery({
        queryKey: ['ga4', 'landing-pages', days, limit],
        queryFn: () => fn({ data: { days, limit } }),
        staleTime: STALE_TIME,
    });
}

export function useTrafficSources(days: number) {
    const fn = useServerFn(getTrafficSources);
    return useQuery({
        queryKey: ['ga4', 'traffic-sources', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useCampaigns(days: number) {
    const fn = useServerFn(getCampaigns);
    return useQuery({
        queryKey: ['ga4', 'campaigns', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGeoConversion(days: number, limit = 50) {
    const fn = useServerFn(getGeoConversion);
    return useQuery({
        queryKey: ['ga4', 'geo', days, limit],
        queryFn: () => fn({ data: { days, limit } }),
        staleTime: STALE_TIME,
    });
}

export function useDeviceBreakdown(days: number) {
    const fn = useServerFn(getDeviceBreakdown);
    return useQuery({
        queryKey: ['ga4', 'device', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useGrowthOverview(days: number) {
    const fn = useServerFn(getGrowthOverview);
    return useQuery({
        queryKey: ['ga4', 'overview', days],
        queryFn: () => fn({ data: { days } }),
        staleTime: STALE_TIME,
    });
}

export function useProductPerformance(days: number, limit = 50) {
    const fn = useServerFn(getProductPerformance);
    return useQuery({
        queryKey: ['ga4', 'products', days, limit],
        queryFn: () => fn({ data: { days, limit } }),
        staleTime: STALE_TIME,
    });
}

export function useGA4Health() {
    const fn = useServerFn(getGA4Health);
    return useQuery({
        queryKey: ['ga4', 'health'],
        queryFn: () => fn({}),
        staleTime: 60 * 1000, // Check every minute
    });
}
