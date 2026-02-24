/**
 * iThink Logistics — Type definitions
 */

// Re-export TrackingStatus from config for backwards compatibility
export type { TrackingStatus } from '../../config/index.js';

// ============================================================================
// Request Types
// ============================================================================

export interface IThinkConfig {
    accessToken?: string;
    secretKey?: string;
    pickupAddressId?: string;
    returnAddressId?: string;
    defaultLogistics?: string;
}

export interface ProductInfo {
    name: string;
    sku?: string;
    quantity: number;
    price: number;
}

export interface ShipmentDimensions {
    length?: number;
    width?: number;
    height?: number;
    weight?: number;
}

export interface CustomerInfo {
    name: string;
    phone: string;
    address: string;
    address2?: string;
    city?: string;
    state?: string;
    pincode: string;
    email?: string;
}

export interface ShipmentRequest {
    orderNumber: string;
    orderDate: Date | string;
    totalAmount: number;
    customer: CustomerInfo;
    products: ProductInfo[];
    dimensions: ShipmentDimensions;
    paymentMode?: 'COD' | 'Prepaid';
    codAmount?: number;
    logistics?: string;
}

export interface ReversePickupRequest {
    orderNumber: string;           // Original order number or return reference
    orderDate: Date | string;      // Original order date
    customer: CustomerInfo;        // Pickup FROM this address
    products: ProductInfo[];       // Items being returned
    dimensions: ShipmentDimensions;
    returnReason?: string;         // Optional reason for return
    originalAwbNumber?: string;    // Original forward shipment AWB
}

export interface RateCheckParams {
    fromPincode: string;
    toPincode: string;
    length?: number;
    width?: number;
    height?: number;
    weight?: number;
    orderType?: 'forward' | 'reverse';
    paymentMethod?: 'cod' | 'prepaid';
    productMrp?: number;
}

export interface LabelOptions {
    pageSize?: 'A4' | 'A6';
    displayCodPrepaid?: boolean;
    displayShipperMobile?: boolean;
    displayShipperAddress?: boolean;
}

// ============================================================================
// Response Types
// ============================================================================

export interface CreateOrderResult {
    success: boolean;
    awbNumber: string;
    orderId?: string;
    logistics: string;
    rawResponse: unknown;
}

export interface ReversePickupResult {
    success: boolean;
    awbNumber: string;
    logistics: 'delhivery';  // Only Delhivery supports reverse pickup
    estimatedPickupDate?: string;
    rawResponse: unknown;
}

export interface ReversePickupServiceability {
    serviceable: boolean;
    provider?: string;
    message?: string;
}

export interface TrackingData {
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
    lastScan: ScanDetail | null;
    orderDetails: OrderDetails | null;
    customerDetails: CustomerDetails | null;
    scanHistory: ScanDetail[];
}

export interface ScanDetail {
    status: string;
    statusCode: string;
    location: string;
    datetime: string;
    remark: string;
    reason: string;
}

export interface OrderDetails {
    orderNumber: string;
    subOrderNumber: string;
    orderType: string;
    weight: string;
    length: string;
    breadth: string;
    height: string;
    netPayment: string;
}

export interface CustomerDetails {
    name: string;
    phone: string;
    address1: string;
    address2: string;
    city: string;
    state: string;
    country: string;
    pincode: string;
}

export interface ShippingLabelResult {
    success: boolean;
    labelUrl: string;
    rawResponse: unknown;
}

export interface PincodeProvider {
    logistics: string;
    supportsCod: boolean;
    supportsPrepaid: boolean;
    supportsPickup: boolean;
    district: string;
    stateCode: string;
    sortCode: string;
}

export interface PincodeCheckResult {
    success: boolean;
    pincode: string;
    serviceable: boolean;
    city: string;
    state: string;
    providers: PincodeProvider[];
    rawResponse: unknown;
}

export interface RateInfo {
    logistics: string;
    serviceType: string;
    logisticId: string;
    rate: number;
    freightCharges: number;
    codCharges: number;
    gstCharges: number;
    rtoCharges: number;
    zone: string;
    deliveryTat: string;
    weightSlab: string;
    supportsCod: boolean;
    supportsPrepaid: boolean;
    supportsPickup: boolean;
    supportsReversePickup: boolean;
}

export interface RateCheckResult {
    success: boolean;
    zone: string;
    expectedDelivery: string;
    rates: RateInfo[];
    rawResponse: unknown;
}

export interface CancellationResult {
    success: boolean;
    status: string;
    remark: string;
    refnum: string;
}

export interface CancelShipmentResult {
    success: boolean;
    results: Record<string, CancellationResult>;
    rawResponse: unknown;
}

export interface ConfigStatus {
    hasCredentials: boolean;
    hasWarehouseConfig: boolean;
    pickupAddressId: string | null;
    returnAddressId: string | null;
    defaultLogistics: string;
}

// ============================================================================
// Internal context passed to module functions
// ============================================================================

export interface ClientContext {
    trackingBaseUrl: string;
    orderBaseUrl: string;
    accessToken: string | null;
    secretKey: string | null;
    pickupAddressId: string | null;
    returnAddressId: string | null;
    defaultLogistics: string;
}
