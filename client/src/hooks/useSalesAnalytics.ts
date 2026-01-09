/**
 * Sales Analytics Hook
 * TanStack Query hook for fetching sales analytics data
 */

import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../services/api';
import type { SalesDimension, OrderStatusFilter, SalesAnalyticsResponse } from '../types';

export interface UseSalesAnalyticsOptions {
    dimension?: SalesDimension;
    startDate?: string;
    endDate?: string;
    orderStatus?: OrderStatusFilter;
    enabled?: boolean;
}

export function useSalesAnalytics({
    dimension = 'summary',
    startDate,
    endDate,
    orderStatus = 'shipped',
    enabled = true,
}: UseSalesAnalyticsOptions = {}) {
    return useQuery<SalesAnalyticsResponse>({
        queryKey: ['salesAnalytics', dimension, startDate, endDate, orderStatus],
        queryFn: async () => {
            const response = await reportsApi.getSalesAnalytics({
                dimension,
                startDate,
                endDate,
                orderStatus,
            });
            return response.data;
        },
        enabled,
        staleTime: 60000, // 1 minute - analytics don't need real-time updates
    });
}

// Helper to calculate date ranges for presets
export function getDateRange(preset: '7d' | '30d' | '90d' | 'custom', customStart?: string, customEnd?: string) {
    const now = new Date();
    const end = now.toISOString().split('T')[0];

    if (preset === 'custom' && customStart && customEnd) {
        return { startDate: customStart, endDate: customEnd };
    }

    const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
    const start = new Date(now);
    start.setDate(start.getDate() - days);

    return {
        startDate: start.toISOString().split('T')[0],
        endDate: end,
    };
}
