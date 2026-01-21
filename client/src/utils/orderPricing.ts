/**
 * Order Pricing Utilities - Client Re-exports
 *
 * This file re-exports pricing functions from the shared domain layer.
 * Maintained for backward compatibility with existing client imports.
 *
 * @module utils/orderPricing
 * @see @coh/shared/domain/orders/pricing for implementation
 */

export {
    calculateLineTotal,
    calculateOrderTotal,
    getProductMrpForShipping,
    hasValidPricing,
    getPricingSourceLabel,
    type OrderTotalResult,
    type PricingOrder,
    type PricingOrderLine,
    type PricingShopifyCache,
} from '@coh/shared/domain/orders/pricing';
