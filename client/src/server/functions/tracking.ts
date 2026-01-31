/**
 * Tracking Server Functions
 *
 * TanStack Start Server Functions for iThink Logistics integration.
 * Handles rate fetching, shipment booking, cancellation, and label generation.
 *
 * IMPORTANT: All external API calls are made server-side to keep API keys secure.
 */

import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// INPUT SCHEMAS
// ============================================

const getRatesInputSchema = z.object({
    fromPincode: z.string().length(6),
    toPincode: z.string().length(6),
    weight: z.number().positive().default(0.5),
    paymentMethod: z.enum(['prepaid', 'cod']).default('prepaid'),
    productMrp: z.number().nonnegative().default(0),
});

export type GetRatesInput = z.infer<typeof getRatesInputSchema>;

const createShipmentInputSchema = z.object({
    orderId: z.string().uuid(),
    logistics: z.string().optional(),
});

export type CreateShipmentInput = z.infer<typeof createShipmentInputSchema>;

const cancelShipmentInputSchema = z.object({
    orderId: z.string().uuid().optional(),
    awbNumber: z.string().optional(),
}).refine((data) => data.orderId || data.awbNumber, {
    message: 'Either orderId or awbNumber must be provided',
});

export type CancelShipmentInput = z.infer<typeof cancelShipmentInputSchema>;

const getLabelInputSchema = z.object({
    orderId: z.string().uuid().optional(),
    awbNumber: z.string().optional(),
    pageSize: z.enum(['A4', 'A6']).default('A4'),
}).refine((data) => data.orderId || data.awbNumber, {
    message: 'Either orderId or awbNumber must be provided',
});

export type GetLabelInput = z.infer<typeof getLabelInputSchema>;

// ============================================
// RESPONSE TYPES
// ============================================

export interface CourierRate {
    logistics: string;
    rate: number;
    zone: string;
    weightSlab: string;
    deliveryTat?: string;
    serviceType?: string;
    supportsCod: boolean;
    supportsPrepaid: boolean;
    supportsReversePickup?: boolean;
}

export interface GetRatesResponse {
    rates: CourierRate[];
    fromPincode: string;
    toPincode: string;
}

export interface CreateShipmentResponse {
    success: boolean;
    awbNumber: string;
    courier: string;
    orderId: string;
    labelUrl?: string;
}

export interface CancelShipmentResponse {
    success: boolean;
    awbNumber: string;
    message: string;
}

export interface GetLabelResponse {
    labelUrl: string;
    awbNumber: string;
}

// ============================================
// HELPER: Get API Base URL
// ============================================

function getApiBaseUrl(): string {
    return process.env.VITE_API_URL || 'http://localhost:3001/api';
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get shipping rates from iThink Logistics
 *
 * Returns available couriers with rates, delivery times, and payment support.
 * Called before booking a shipment to show rate comparison.
 */
export const getShippingRates = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getRatesInputSchema.parse(input))
    .handler(async ({ data }): Promise<GetRatesResponse> => {
        try {
            const baseUrl = getApiBaseUrl();
            const response = await fetch(`${baseUrl}/tracking/rates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: 'Failed to fetch rates' }));
                throw new Error(error.error || 'Failed to fetch shipping rates');
            }

            const result = await response.json();
            return {
                rates: result.rates || [],
                fromPincode: data.fromPincode,
                toPincode: data.toPincode,
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getShippingRates:', error);
            throw error;
        }
    });

/**
 * Create a shipment via iThink Logistics
 *
 * Books a shipment for the order with the selected courier.
 * Updates order with AWB number and marks as shipped.
 */
export const createShipment = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createShipmentInputSchema.parse(input))
    .handler(async ({ data }): Promise<CreateShipmentResponse> => {
        try {
            const baseUrl = getApiBaseUrl();
            const response = await fetch(`${baseUrl}/tracking/create-shipment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: 'Failed to create shipment' }));
                throw new Error(error.error || 'Failed to create shipment');
            }

            const result = await response.json();
            return {
                success: true,
                awbNumber: result.awbNumber,
                courier: result.courier,
                orderId: data.orderId,
                labelUrl: result.labelUrl,
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in createShipment:', error);
            throw error;
        }
    });

/**
 * Cancel a shipment via iThink Logistics
 *
 * Cancels a booked shipment before pickup.
 * Clears AWB from order and reverts status.
 */
export const cancelShipment = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => cancelShipmentInputSchema.parse(input))
    .handler(async ({ data }): Promise<CancelShipmentResponse> => {
        try {
            const baseUrl = getApiBaseUrl();
            const response = await fetch(`${baseUrl}/tracking/cancel-shipment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: 'Failed to cancel shipment' }));
                throw new Error(error.error || 'Failed to cancel shipment');
            }

            const result = await response.json();
            return {
                success: true,
                awbNumber: result.awbNumber || data.awbNumber || '',
                message: result.message || 'Shipment cancelled successfully',
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in cancelShipment:', error);
            throw error;
        }
    });

/**
 * Get shipping label for a shipment
 *
 * Returns the label URL for printing.
 */
export const getShippingLabel = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getLabelInputSchema.parse(input))
    .handler(async ({ data }): Promise<GetLabelResponse> => {
        try {
            const baseUrl = getApiBaseUrl();
            const response = await fetch(`${baseUrl}/tracking/label`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: 'Failed to get label' }));
                throw new Error(error.error || 'Failed to get shipping label');
            }

            const result = await response.json();
            return {
                labelUrl: result.labelUrl,
                awbNumber: result.awbNumber || data.awbNumber || '',
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getShippingLabel:', error);
            throw error;
        }
    });

// ============================================
// AWB TRACKING - For TrackingModal
// ============================================

const getAwbTrackingInputSchema = z.object({
    awbNumber: z.string().min(1, 'AWB number is required'),
});

export type GetAwbTrackingInput = z.infer<typeof getAwbTrackingInputSchema>;

/** Tracking scan event from iThink */
export interface TrackingScan {
    status: string;
    statusCode?: string;
    datetime: string;
    location: string;
    remark?: string;
    reason?: string;
}

/** Last scan information */
export interface TrackingLastScan {
    status: string;
    location?: string;
    datetime?: string;
    remark?: string;
    reason?: string;
}

/** Order details from tracking */
export interface TrackingOrderDetails {
    orderNumber?: string;
    orderType?: string;
    weight?: string;
    length?: string;
    breadth?: string;
    height?: string;
    netPayment?: string;
}

/** Customer details from tracking */
export interface TrackingCustomerDetails {
    name?: string;
    phone?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    country?: string;
    pincode?: string;
}

/** Full AWB tracking response from iThink - matches TrackingModal expectations */
export interface AwbTrackingResponse {
    awbNumber: string;
    courier: string;
    currentStatus: string;
    statusCode: string;
    expectedDeliveryDate?: string;
    promiseDeliveryDate?: string;
    ofdCount: number;
    isRto: boolean;
    rtoAwb?: string;
    orderType?: string;
    cancelStatus?: string;
    lastScan?: TrackingLastScan;
    scanHistory: TrackingScan[];
    orderDetails?: TrackingOrderDetails;
    customerDetails?: TrackingCustomerDetails;
}

/**
 * Get AWB tracking details from iThink Logistics
 *
 * Returns tracking status, scans, and delivery information for an AWB.
 * Used by TrackingModal for real-time tracking display.
 */
export const getAwbTracking = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getAwbTrackingInputSchema.parse(input))
    .handler(async ({ data }): Promise<AwbTrackingResponse> => {
        try {
            const baseUrl = getApiBaseUrl();
            const authToken = getCookie('auth_token');
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }

            const response = await fetch(`${baseUrl}/returns/tracking/${encodeURIComponent(data.awbNumber)}`, {
                method: 'GET',
                headers,
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: 'Failed to fetch tracking' }));
                throw new Error(error.error || 'Failed to fetch AWB tracking');
            }

            // Return the response as-is, the API already returns the correct shape
            return await response.json();
        } catch (error: unknown) {
            console.error('[Server Function] Error in getAwbTracking:', error);
            throw error;
        }
    });

// ============================================
// TRACK SHIPMENT LOOKUP - For Tracking Page
// ============================================

const trackShipmentInputSchema = z.object({
    query: z.string().min(1, 'Search query is required'),
    type: z.enum(['awb', 'order']).default('awb'),
});

export type TrackShipmentInput = z.infer<typeof trackShipmentInputSchema>;

/** Raw API response type - needs explicit typing for TanStack Server Functions */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawApiResponse = Record<string, any> | null;

/** Full tracking response with raw data for debugging */
export interface TrackShipmentResponse {
    success: boolean;
    awbNumber: string;
    orderNumber?: string;
    courier?: string;
    trackingData: AwbTrackingResponse | null;
    rawApiResponse: RawApiResponse;
    error?: string;
}

/**
 * Track shipment by AWB or Order Number
 *
 * Returns both formatted tracking data and raw API response.
 * Used by the tracking lookup page.
 */
export const trackShipment = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => trackShipmentInputSchema.parse(input))
    .handler(async ({ data }): Promise<TrackShipmentResponse> => {
        try {
            const baseUrl = getApiBaseUrl();
            const authToken = getCookie('auth_token');
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }

            let awbNumber = data.query.trim();
            let orderNumber: string | undefined;

            // If searching by order, first look up the AWB
            if (data.type === 'order') {
                orderNumber = awbNumber;
                const orderLookupResponse = await fetch(`${baseUrl}/tracking/order-awb/${encodeURIComponent(orderNumber)}`, {
                    method: 'GET',
                    headers,
                });

                if (!orderLookupResponse.ok) {
                    const error = await orderLookupResponse.json().catch(() => ({ error: 'Order not found' }));
                    return {
                        success: false,
                        awbNumber: '',
                        orderNumber,
                        trackingData: null,
                        rawApiResponse: null,
                        error: error.error || 'Order not found or has no AWB',
                    };
                }

                const orderData = await orderLookupResponse.json();
                if (!orderData.awbNumber) {
                    return {
                        success: false,
                        awbNumber: '',
                        orderNumber,
                        trackingData: null,
                        rawApiResponse: null,
                        error: 'Order has not been shipped yet (no AWB)',
                    };
                }
                awbNumber = orderData.awbNumber;
            }

            // Fetch tracking with raw data
            const response = await fetch(`${baseUrl}/tracking/lookup/${encodeURIComponent(awbNumber)}`, {
                method: 'GET',
                headers,
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: 'Tracking not found' }));
                return {
                    success: false,
                    awbNumber,
                    orderNumber,
                    trackingData: null,
                    rawApiResponse: null,
                    error: error.error || 'Failed to fetch tracking',
                };
            }

            const result = await response.json();

            return {
                success: true,
                awbNumber,
                orderNumber,
                courier: result.trackingData?.courier,
                trackingData: result.trackingData,
                rawApiResponse: result.rawApiResponse,
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in trackShipment:', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                awbNumber: data.query,
                trackingData: null,
                rawApiResponse: null,
                error: message,
            };
        }
    });
