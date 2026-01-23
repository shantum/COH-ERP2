/**
 * Sales Analytics Hook
 * TanStack Query hook for fetching sales analytics data
 *
 * Migrated to use Server Functions instead of Axios API calls.
 */

import { useQuery } from '@tanstack/react-query';
import { getSalesAnalytics } from '../server/functions/reports';
import type { SalesAnalyticsResponse } from '../server/functions/reports';
import type { SalesDimension, OrderStatusFilter } from '../types';
import { getLocalDateString, getLocalDateStringOffset } from '../components/orders/OrdersTable/utils/dateFormatters';

// Re-export types for consumers
export type { SalesDimension, OrderStatusFilter };

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
            const result = await getSalesAnalytics({
                data: {
                    dimension,
                    startDate,
                    endDate,
                    orderStatus,
                },
            });
            return result;
        },
        enabled,
        staleTime: 60000, // 1 minute - analytics don't need real-time updates
    });
}

// Helper to calculate date ranges for presets
// Uses local dates to match user's timezone expectations
export function getDateRange(preset: '7d' | '30d' | '90d' | 'custom', customStart?: string, customEnd?: string) {
    if (preset === 'custom' && customStart && customEnd) {
        return { startDate: customStart, endDate: customEnd };
    }

    const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;

    return {
        startDate: getLocalDateStringOffset(-days),
        endDate: getLocalDateString(),
    };
}
