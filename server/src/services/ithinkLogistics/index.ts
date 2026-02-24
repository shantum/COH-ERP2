/**
 * iThink Logistics — Public API
 *
 * Singleton instance + re-exports for backwards compatibility.
 */

import { IThinkLogisticsClient } from './client.js';

// Singleton instance
const ithinkLogistics = new IThinkLogisticsClient();

export default ithinkLogistics;

// Re-export all types
export type {
    IThinkConfig,
    ProductInfo,
    ShipmentDimensions,
    CustomerInfo,
    ShipmentRequest,
    ReversePickupRequest,
    RateCheckParams,
    LabelOptions,
    CreateOrderResult,
    ReversePickupResult,
    ReversePickupServiceability,
    TrackingData,
    ScanDetail,
    OrderDetails,
    CustomerDetails,
    ShippingLabelResult,
    PincodeProvider,
    PincodeCheckResult,
    RateInfo,
    RateCheckResult,
    CancellationResult,
    CancelShipmentResult,
    ConfigStatus,
    TrackingStatus,
} from './types.js';
