/**
 * Shopify helper utilities
 *
 * Shared utilities for working with Shopify data across services and routes.
 */

/**
 * Detect payment method from Shopify order data.
 *
 * BUSINESS RULES (priority order):
 * 1. Preserve COD status: Once an order is marked COD, it STAYS COD even after payment
 *    - This prevents confusion between payment status and fulfillment method
 * 2. Gateway detection:
 *    - Shopflo/Razorpay gateways = Prepaid
 *    - COD/Cash/Manual gateways = COD
 * 3. Financial status fallback:
 *    - Pending financial status + no prepaid gateway = likely COD (common for new orders)
 * 4. Default: Prepaid
 *
 * @param {Object} shopifyOrder - The Shopify order object from API/cache
 * @param {Array<string>} [shopifyOrder.payment_gateway_names] - Payment gateway names
 * @param {string} [shopifyOrder.financial_status] - Financial status (pending, paid, etc.)
 * @param {string|null} [existingPaymentMethod=null] - Current payment method from DB (to preserve COD)
 * @returns {string} 'COD' or 'Prepaid'
 *
 * @example
 * // New order with Razorpay gateway
 * detectPaymentMethod({ payment_gateway_names: ['Razorpay'] }) // => 'Prepaid'
 *
 * @example
 * // Order already marked COD - preserve it even if paid later
 * detectPaymentMethod({ payment_gateway_names: ['Razorpay'], financial_status: 'paid' }, 'COD') // => 'COD'
 *
 * @example
 * // Pending order with no prepaid gateway (likely COD)
 * detectPaymentMethod({ payment_gateway_names: [], financial_status: 'pending' }) // => 'COD'
 */
export function detectPaymentMethod(shopifyOrder, existingPaymentMethod = null) {
    // RULE 1: Preserve COD status once set
    // Once COD, always COD - even if customer pays later
    if (existingPaymentMethod === 'COD') {
        return 'COD';
    }

    // Extract and normalize gateway names
    const gatewayNames = (shopifyOrder.payment_gateway_names || []).join(', ').toLowerCase();

    // RULE 2a: Check for prepaid gateways
    const isPrepaidGateway = gatewayNames.includes('shopflo') || gatewayNames.includes('razorpay');

    // RULE 2b: Check for COD gateways
    const isCodGateway = gatewayNames.includes('cod') ||
                         gatewayNames.includes('cash') ||
                         gatewayNames.includes('manual');

    // Apply detection rules
    if (isPrepaidGateway) {
        return 'Prepaid';
    }

    if (isCodGateway) {
        return 'COD';
    }

    // RULE 3: Financial status fallback
    // Pending payment + no prepaid gateway = likely COD (common for new orders)
    if (shopifyOrder.financial_status === 'pending' && !isPrepaidGateway) {
        return 'COD';
    }

    // RULE 4: Default to Prepaid
    return 'Prepaid';
}
