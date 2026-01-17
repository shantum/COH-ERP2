/**
 * iThink Tracking Hook
 * TanStack Query hook for fetching iThink Logistics tracking data
 */

import { useQuery } from '@tanstack/react-query';
import { trackingApi } from '../services/api';

/**
 * Last scan details from iThink tracking
 */
export interface IThinkLastScan {
    status: string;
    statusCode: string;
    location: string;
    datetime: string;
    remark?: string;
    reason?: string;
}

/**
 * Scan history item from iThink tracking
 */
export interface IThinkScanHistoryItem {
    status: string;
    statusCode: string;
    location: string;
    datetime: string;
    remark?: string;
    reason?: string;
}

/**
 * Full tracking data from iThink Logistics
 */
export interface IThinkTrackingData {
    awbNumber: string;
    courier: string;
    currentStatus: string;
    statusCode: string;
    expectedDeliveryDate: string | null;
    promiseDeliveryDate: string | null;
    ofdCount: number;
    isRto: boolean;
    rtoAwb: string | null;
    orderType: string | null;
    cancelStatus: string | null;
    lastScan: IThinkLastScan | null;
    orderDetails: {
        orderNumber: string;
        subOrderNumber: string;
        orderType: string;
        weight: string;
        length: string;
        breadth: string;
        height: string;
        netPayment: string;
    } | null;
    customerDetails: {
        name: string;
        phone: string;
        address1: string;
        address2: string;
        city: string;
        state: string;
        country: string;
        pincode: string;
    } | null;
    scanHistory: IThinkScanHistoryItem[];
}

export interface UseIThinkTrackingOptions {
    /** AWB number to track */
    awbNumber: string;
    /** Whether to fetch data (useful for lazy loading) */
    enabled?: boolean;
}

/**
 * Hook to fetch iThink tracking data for an AWB
 *
 * @example
 * const { data, isLoading, error } = useIThinkTracking({
 *   awbNumber: '21025852704255',
 *   enabled: isExpanded,
 * });
 */
export function useIThinkTracking({
    awbNumber,
    enabled = true,
}: UseIThinkTrackingOptions) {
    return useQuery<IThinkTrackingData>({
        queryKey: ['ithink-tracking', awbNumber],
        queryFn: async () => {
            const response = await trackingApi.getAwbTracking(awbNumber);
            return response.data;
        },
        enabled: enabled && !!awbNumber,
        staleTime: 2 * 60 * 1000, // 2 minutes - tracking updates frequently
        gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
        retry: 1, // Only retry once on failure
    });
}
