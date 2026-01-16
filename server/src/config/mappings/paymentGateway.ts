/**
 * Payment Gateway Mapping Configuration
 *
 * Maps Shopify payment gateway names to internal payment methods (COD/Prepaid).
 *
 * BUSINESS RULES:
 * 1. Once an order is marked COD, it STAYS COD (even if customer pays later)
 *    - This preserves fulfillment method semantics
 * 2. Gateway detection is pattern-based and priority-ordered
 * 3. Financial status is used as a fallback for ambiguous cases
 *
 * TO ADD A NEW GATEWAY:
 * 1. Add a new entry to PAYMENT_GATEWAY_RULES
 * 2. Set appropriate priority (100 = high confidence, lower = fallback)
 * 3. Add a description explaining the gateway
 */

import type { BaseMappingRule, PaymentMethod } from '../types.js';

// ============================================
// RULE DEFINITIONS
// ============================================

export interface PaymentGatewayRule extends BaseMappingRule {
    /** Pattern to match in gateway name (lowercase, uses includes()) */
    pattern: string;
    /** Payment method to assign when matched */
    method: PaymentMethod;
}

/**
 * Payment gateway mapping rules
 *
 * Rules are checked in priority order (highest first).
 * First matching rule wins.
 */
export const PAYMENT_GATEWAY_RULES: PaymentGatewayRule[] = [
    // ========== PREPAID GATEWAYS (priority 100) ==========
    {
        pattern: 'shopflo',
        method: 'Prepaid',
        priority: 100,
        description: 'Shopflo payment gateway - online payments',
    },
    {
        pattern: 'razorpay',
        method: 'Prepaid',
        priority: 100,
        description: 'Razorpay payment gateway - online payments',
    },
    {
        pattern: 'paytm',
        method: 'Prepaid',
        priority: 100,
        description: 'Paytm payment gateway - online payments',
    },
    {
        pattern: 'phonepe',
        method: 'Prepaid',
        priority: 100,
        description: 'PhonePe payment gateway - UPI payments',
    },
    {
        pattern: 'gpay',
        method: 'Prepaid',
        priority: 100,
        description: 'Google Pay - UPI payments',
    },
    {
        pattern: 'upi',
        method: 'Prepaid',
        priority: 100,
        description: 'Generic UPI payments',
    },
    {
        pattern: 'stripe',
        method: 'Prepaid',
        priority: 100,
        description: 'Stripe payment gateway',
    },
    {
        pattern: 'paypal',
        method: 'Prepaid',
        priority: 100,
        description: 'PayPal payments',
    },

    // ========== COD GATEWAYS (priority 90) ==========
    {
        pattern: 'cod',
        method: 'COD',
        priority: 90,
        description: 'Cash on delivery - explicit COD gateway',
    },
    {
        pattern: 'cash on delivery',
        method: 'COD',
        priority: 90,
        description: 'Cash on delivery - full name match',
    },
    {
        pattern: 'cash',
        method: 'COD',
        priority: 85,
        description: 'Cash payment - likely COD',
    },

    // ========== FALLBACK GATEWAYS (priority 80) ==========
    {
        pattern: 'manual',
        method: 'COD',
        priority: 80,
        description: 'Manual payment - typically offline/COD orders',
    },
];

/**
 * Default payment method when no gateway rules match
 */
export const DEFAULT_PAYMENT_METHOD: PaymentMethod = 'Prepaid';

/**
 * Financial statuses that suggest COD when no gateway is detected
 */
export const COD_FINANCIAL_STATUSES: readonly string[] = ['pending'] as const;

// ============================================
// RESOLVER FUNCTION
// ============================================

/**
 * Resolve payment method from Shopify gateway names
 *
 * @param gatewayNames - Array of payment gateway names from Shopify order
 * @param existingMethod - Current payment method (to preserve COD status)
 * @param financialStatus - Shopify financial_status for fallback detection
 * @returns 'COD' or 'Prepaid'
 *
 * @example
 * resolvePaymentMethod(['Razorpay']) // => 'Prepaid'
 * resolvePaymentMethod(['manual'], null, 'pending') // => 'COD'
 * resolvePaymentMethod(['Razorpay'], 'COD') // => 'COD' (preserved)
 */
export function resolvePaymentMethod(
    gatewayNames: string[],
    existingMethod?: string | null,
    financialStatus?: string | null
): PaymentMethod {
    // RULE 1: Once COD, always COD
    // Preserves fulfillment method even if customer pays later
    if (existingMethod === 'COD') {
        return 'COD';
    }

    // Normalize gateway names for matching
    const normalized = gatewayNames.join(',').toLowerCase();

    // Sort rules by priority (highest first)
    const sortedRules = [...PAYMENT_GATEWAY_RULES].sort((a, b) => b.priority - a.priority);

    // Check each rule
    for (const rule of sortedRules) {
        if (normalized.includes(rule.pattern)) {
            return rule.method;
        }
    }

    // RULE 2: Financial status fallback
    // Pending payment with no prepaid gateway detected = likely COD
    if (financialStatus && COD_FINANCIAL_STATUSES.includes(financialStatus)) {
        // Only apply if no prepaid gateway was detected
        const hasPrepaidGateway = sortedRules
            .filter(r => r.method === 'Prepaid')
            .some(r => normalized.includes(r.pattern));

        if (!hasPrepaidGateway) {
            return 'COD';
        }
    }

    // RULE 3: Default to Prepaid
    return DEFAULT_PAYMENT_METHOD;
}

/**
 * Check if a gateway name matches any prepaid gateway pattern
 */
export function isPrepaidGateway(gatewayName: string): boolean {
    const normalized = gatewayName.toLowerCase();
    return PAYMENT_GATEWAY_RULES
        .filter(r => r.method === 'Prepaid')
        .some(r => normalized.includes(r.pattern));
}

/**
 * Check if a gateway name matches any COD gateway pattern
 */
export function isCodGateway(gatewayName: string): boolean {
    const normalized = gatewayName.toLowerCase();
    return PAYMENT_GATEWAY_RULES
        .filter(r => r.method === 'COD')
        .some(r => normalized.includes(r.pattern));
}
