/**
 * iThink Logistics — Tracking operations
 */

import { shippingLogger } from '../../utils/logger.js';
import {
    resolveTrackingStatus as resolveTrackingStatusFromConfig,
} from '../../config/index.js';
import type {
    IThinkRawTrackingResponse,
    IThinkApiResponse,
} from '../../types/ithinkApi.js';
import { storeTrackingResponsesBatch } from '../trackingResponseStorage.js';
import { axiosWithRetry, axios, API_TIMEOUT_MS } from './axiosClient.js';
import type { ClientContext, TrackingData, TrackingStatus } from './types.js';

/**
 * Track shipments by AWB numbers
 * @param awbNumbers - Single AWB or array of AWBs (max 10)
 * @param storeResponse - Whether to store the raw response for debugging (default: false)
 * @returns Tracking data keyed by AWB number
 */
export async function trackShipments(
    ctx: ClientContext,
    awbNumbers: string | string[],
    storeResponse: boolean = false
): Promise<Record<string, IThinkRawTrackingResponse>> {
    if (!ctx.accessToken || !ctx.secretKey) {
        throw new Error('iThink Logistics credentials not configured');
    }

    // Normalize to array and limit to 10
    const awbList = Array.isArray(awbNumbers) ? awbNumbers : [awbNumbers];
    if (awbList.length > 10) {
        throw new Error('Maximum 10 AWB numbers per request');
    }

    const response = await axiosWithRetry(
        () => axios.post<IThinkApiResponse<Record<string, IThinkRawTrackingResponse>>>(
            `${ctx.trackingBaseUrl}/order/track.json`,
            {
                data: {
                    access_token: ctx.accessToken,
                    secret_key: ctx.secretKey,
                    awb_number_list: awbList.join(',')
                }
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: API_TIMEOUT_MS
            }
        ),
        `trackShipments:${awbList.join(',')}`
    );

    if (response.data.status_code !== 200) {
        throw new Error(`iThink API error: ${response.data.message || 'Unknown error'}`);
    }

    // Defensive check - ensure data exists
    if (!response.data.data) {
        shippingLogger.warn({ awbList, response: response.data }, 'iThink returned success but no data');
        return {};
    }

    const trackingData = response.data.data;

    // Store responses for debugging if requested
    if (storeResponse) {
        const responsesToStore = Object.entries(trackingData).map(([awb, data]) => ({
            awbNumber: awb,
            source: 'manual' as const,
            statusCode: data.message === 'success' ? 200 : 404,
            response: data,
        }));
        // Store in background - don't await
        storeTrackingResponsesBatch(responsesToStore).catch(() => {});
    }

    return trackingData;
}

/**
 * Get simplified tracking status for an AWB
 */
export async function getTrackingStatus(
    ctx: ClientContext,
    awbNumber: string
): Promise<TrackingData | null> {
    const data = await trackShipments(ctx, awbNumber);
    const tracking = data[awbNumber];

    if (!tracking || tracking.message !== 'success') {
        return null;
    }

    return {
        awbNumber: tracking.awb_no,
        courier: tracking.logistic,
        currentStatus: tracking.current_status,
        statusCode: tracking.current_status_code,
        expectedDeliveryDate: tracking.expected_delivery_date,
        promiseDeliveryDate: tracking.promise_delivery_date,
        ofdCount: parseInt(String(tracking.ofd_count)) || 0,
        isRto: tracking.return_tracking_no ? true : false,
        rtoAwb: tracking.return_tracking_no || null,
        orderType: tracking.order_type || null,
        cancelStatus: tracking.cancel_status || null,
        // Last scan details - different field names than scan_details!
        lastScan: tracking.last_scan_details ? {
            status: tracking.last_scan_details.status,
            statusCode: tracking.last_scan_details.status_code,
            location: tracking.last_scan_details.scan_location,      // last_scan uses scan_location
            datetime: tracking.last_scan_details.status_date_time,   // Correct
            remark: tracking.last_scan_details.remark,               // last_scan uses remark
            reason: tracking.last_scan_details.reason,               // last_scan uses reason
        } : null,
        // Order details with additional fields
        orderDetails: tracking.order_details ? {
            orderNumber: tracking.order_details.order_number,
            subOrderNumber: tracking.order_details.sub_order_number,
            orderType: tracking.order_details.order_type,
            weight: tracking.order_details.phy_weight,
            length: tracking.order_details.ship_length,
            breadth: tracking.order_details.ship_width,
            height: tracking.order_details.ship_height,
            netPayment: tracking.order_details.net_payment,
        } : null,
        // Customer details with phone and address
        customerDetails: tracking.customer_details ? {
            name: tracking.customer_details.customer_name,
            phone: tracking.customer_details.customer_mobile || tracking.customer_details.customer_phone || '',
            address1: tracking.customer_details.customer_address1,
            address2: tracking.customer_details.customer_address2,
            city: tracking.customer_details.customer_city,
            state: tracking.customer_details.customer_state,
            country: tracking.customer_details.customer_country,
            pincode: tracking.customer_details.customer_pincode,
        } : null,
        // Scan history - use correct field names from iThink API
        scanHistory: (tracking.scan_details || []).map((scan) => ({
            status: scan.status,
            statusCode: scan.status_code,
            location: scan.status_location,      // Fixed: was 'scan_location'
            datetime: scan.status_date_time,     // Correct
            remark: scan.status_remark,          // Fixed: was 'remark'
            reason: scan.status_reason,          // Correct
        })),
    };
}

/**
 * Map iThink status to our internal tracking status
 *
 * Rules are defined in: config/mappings/trackingStatus.ts
 */
export function mapToInternalStatus(statusCode: string, statusText: string = ''): TrackingStatus {
    return resolveTrackingStatusFromConfig(statusCode, statusText);
}

/**
 * Format a raw iThink tracking response into the UI-friendly TrackingData shape.
 *
 * This is the single source of truth for raw → formatted transformation.
 * Used by the cache service and Express routes.
 */
export function formatRawToTrackingData(tracking: IThinkRawTrackingResponse): TrackingData {
    return {
        awbNumber: tracking.awb_no,
        courier: tracking.logistic,
        currentStatus: tracking.current_status,
        statusCode: tracking.current_status_code,
        expectedDeliveryDate: tracking.expected_delivery_date,
        promiseDeliveryDate: tracking.promise_delivery_date,
        ofdCount: parseInt(String(tracking.ofd_count)) || 0,
        isRto: tracking.return_tracking_no ? true : false,
        rtoAwb: tracking.return_tracking_no || null,
        orderType: tracking.order_type || null,
        cancelStatus: tracking.cancel_status || null,
        lastScan: tracking.last_scan_details ? {
            status: tracking.last_scan_details.status,
            statusCode: tracking.last_scan_details.status_code,
            location: tracking.last_scan_details.scan_location,
            datetime: tracking.last_scan_details.status_date_time,
            remark: tracking.last_scan_details.remark,
            reason: tracking.last_scan_details.reason,
        } : null,
        orderDetails: tracking.order_details ? {
            orderNumber: tracking.order_details.order_number,
            subOrderNumber: tracking.order_details.sub_order_number,
            orderType: tracking.order_details.order_type,
            weight: tracking.order_details.phy_weight,
            length: tracking.order_details.ship_length,
            breadth: tracking.order_details.ship_width,
            height: tracking.order_details.ship_height,
            netPayment: tracking.order_details.net_payment,
        } : null,
        customerDetails: tracking.customer_details ? {
            name: tracking.customer_details.customer_name,
            phone: tracking.customer_details.customer_mobile || tracking.customer_details.customer_phone || '',
            address1: tracking.customer_details.customer_address1,
            address2: tracking.customer_details.customer_address2,
            city: tracking.customer_details.customer_city,
            state: tracking.customer_details.customer_state,
            country: tracking.customer_details.customer_country,
            pincode: tracking.customer_details.customer_pincode,
        } : null,
        scanHistory: (tracking.scan_details || []).map((scan) => ({
            status: scan.status,
            statusCode: scan.status_code,
            location: scan.status_location,
            datetime: scan.status_date_time,
            remark: scan.status_remark,
            reason: scan.status_reason,
        })),
    };
}
