/**
 * Mapping Configurations Index
 *
 * Central export for all input → output mapping rules.
 */

// Payment Gateway → Payment Method
export {
    PAYMENT_GATEWAY_RULES,
    DEFAULT_PAYMENT_METHOD,
    COD_FINANCIAL_STATUSES,
    resolvePaymentMethod,
    isPrepaidGateway,
    isCodGateway,
    type PaymentGatewayRule,
} from './paymentGateway.js';

// Tracking Status Code → Internal Status
export {
    TRACKING_STATUS_RULES,
    DEFAULT_TRACKING_STATUS,
    resolveTrackingStatus,
    isRtoStatus,
    isDeliveredStatus,
    getStatusLabel,
    type StatusMappingRule,
} from './trackingStatus.js';
