/**
 * iThink Logistics API Type Definitions
 *
 * Strongly-typed interfaces for iThink API responses.
 * Used to replace `any` types throughout the tracking domain.
 */

// ============================================================================
// Raw API Response Types (exact shape from iThink API)
// ============================================================================

/**
 * Last scan details from iThink tracking API
 */
export interface IThinkRawLastScan {
    status: string;
    status_code: string;
    scan_location: string;
    status_date_time: string;
    remark: string;
    reason: string;
}

/**
 * Scan history item from iThink tracking API
 */
export interface IThinkRawScanDetail {
    status: string;
    status_code: string;
    status_location: string;
    status_date_time: string;
    status_remark: string;
    status_reason: string;
}

/**
 * Order details from iThink tracking API
 */
export interface IThinkRawOrderDetails {
    order_number: string;
    sub_order_number: string;
    order_type: string;
    phy_weight: string;
    ship_length: string;
    ship_width: string;
    ship_height: string;
    net_payment: string;
}

/**
 * Customer details from iThink tracking API
 */
export interface IThinkRawCustomerDetails {
    customer_name: string;
    customer_mobile?: string;
    customer_phone?: string;
    customer_address1: string;
    customer_address2: string;
    customer_city: string;
    customer_state: string;
    customer_country: string;
    customer_pincode: string;
}

/**
 * Raw tracking response for a single AWB from iThink API
 */
export interface IThinkRawTrackingResponse {
    message: string;
    awb_no: string;
    logistic: string;
    current_status: string;
    current_status_code: string;
    expected_delivery_date: string | null;
    promise_delivery_date: string | null;
    ofd_count: string | number;
    return_tracking_no: string | null;
    order_type: string | null;
    cancel_status: string | null;
    last_scan_details?: IThinkRawLastScan;
    scan_details?: IThinkRawScanDetail[];
    order_details?: IThinkRawOrderDetails;
    customer_details?: IThinkRawCustomerDetails;
}

/**
 * Generic iThink API response wrapper
 */
export interface IThinkApiResponse<T = unknown> {
    status: string;
    status_code: number;
    message?: string;
    html_message?: string;
    data?: T;
    zone?: string;
    expected_delivery_date?: string;
    file_name?: string;
}

// ============================================================================
// Order Creation Response Types
// ============================================================================

/**
 * Single shipment result from order creation
 */
export interface IThinkOrderResult {
    waybill: string;
    order_id?: string;
    status: string;
    remark?: string;
    reason?: string;
}

/**
 * Order creation response data structure
 * Data is keyed by numeric strings ("1", "2", etc.)
 */
export type IThinkOrderResponseData = Record<string, IThinkOrderResult>;

// ============================================================================
// Rate Check Response Types
// ============================================================================

/**
 * Rate information from iThink API
 */
export interface IThinkRawRateInfo {
    logistic_name: string;
    service_type?: string;
    logistic_id?: string;
    logistic_service_type?: string;
    rate: string | number;
    freight_charges: string | number;
    cod_charges: string | number;
    gst_charges: string | number;
    rto_charges: string | number;
    logistics_zone: string;
    delivery_tat: string;
    weight_slab?: string;
    cod: string; // 'Y' or 'N'
    prepaid: string; // 'Y' or 'N'
    pickup: string; // 'Y' or 'N'
    rev_pickup: string; // 'Y' or 'N'
}

// ============================================================================
// Pincode Check Response Types
// ============================================================================

/**
 * Provider info from pincode check
 */
export interface IThinkRawProviderInfo {
    cod: string; // 'Y' or 'N'
    prepaid: string; // 'Y' or 'N'
    pickup: string; // 'Y' or 'N'
    district?: string;
    state_code?: string;
    sort_code?: string;
}

/**
 * Pincode data structure (includes both providers and metadata)
 */
export interface IThinkRawPincodeData {
    remark?: string;
    state_name?: string;
    city_name?: string;
    city_id?: string;
    state_id?: string;
    [providerName: string]: string | IThinkRawProviderInfo | undefined;
}

// ============================================================================
// Cancellation Response Types
// ============================================================================

/**
 * Cancellation result for a single AWB
 */
export interface IThinkCancellationItem {
    status: string;
    remark?: string;
    refnum: string;
}

/**
 * Cancellation response data structure
 */
export type IThinkCancellationResponseData = Record<string, IThinkCancellationItem>;

// ============================================================================
// Label Request Types
// ============================================================================

/**
 * Label request data structure
 */
export interface IThinkLabelRequestData {
    awb_numbers: string;
    page_size: string;
    access_token: string | null;
    secret_key: string | null;
    display_cod_prepaid?: string;
    display_shipper_mobile?: string;
    display_shipper_address?: string;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a provider info object (not metadata)
 */
export function isProviderInfo(value: unknown): value is IThinkRawProviderInfo {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return 'cod' in obj || 'prepaid' in obj || 'pickup' in obj;
}

/**
 * Check if tracking response indicates success
 */
export function isSuccessfulTrackingResponse(
    response: IThinkRawTrackingResponse
): boolean {
    return response.message === 'success';
}
