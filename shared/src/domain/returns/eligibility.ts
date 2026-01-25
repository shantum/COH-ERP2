/**
 * Return Eligibility
 *
 * Pure functions for checking if an order line is eligible for return.
 * No side effects, no database calls - just logic.
 */

import { RETURN_POLICY, WARNING_THRESHOLD_DAYS } from './policy.js';

// ============================================
// TYPES
// ============================================

export interface EligibilityInput {
    /** When the item was delivered (null if not yet delivered) */
    deliveredAt: Date | null;
    /** Current return status on the line (null if no return) */
    returnStatus: string | null;
    /** Line-level flag marking item as non-returnable */
    isNonReturnable: boolean;
    /** Product-level returnability flag */
    productIsReturnable: boolean;
    /** Why product is non-returnable (if applicable) */
    productNonReturnableReason: string | null;
}

export type EligibilityReason =
    | 'within_window'
    | 'expired_override'
    | 'already_active'
    | 'not_delivered'
    | 'line_blocked';

export interface EligibilityResult {
    /** Whether the line can be returned */
    eligible: boolean;
    /** Why it's eligible or not */
    reason: EligibilityReason;
    /** Days remaining in return window (negative if expired, null if not delivered) */
    daysRemaining: number | null;
    /** True if window is about to expire (within warning threshold) */
    windowExpiringSoon: boolean;
    /** Soft warning message (return allowed but with caution) */
    warning?: string;
}

// ============================================
// MAIN FUNCTION
// ============================================

/**
 * Check if an order line is eligible for return
 *
 * @param input - Line and product information
 * @param now - Current date (for testing)
 * @returns Eligibility result with reason and warnings
 *
 * @example
 * const result = checkEligibility({
 *   deliveredAt: new Date('2024-01-01'),
 *   returnStatus: null,
 *   isNonReturnable: false,
 *   productIsReturnable: true,
 *   productNonReturnableReason: null,
 * });
 *
 * if (result.eligible) {
 *   console.log(`${result.daysRemaining} days left to return`);
 * } else {
 *   console.log(`Cannot return: ${result.reason}`);
 * }
 */
export function checkEligibility(
    input: EligibilityInput,
    now: Date = new Date()
): EligibilityResult {
    // Hard block: already has active return
    if (input.returnStatus && !['cancelled', 'complete'].includes(input.returnStatus)) {
        return {
            eligible: false,
            reason: 'already_active',
            daysRemaining: null,
            windowExpiringSoon: false,
        };
    }

    // Hard block: line marked non-returnable
    if (input.isNonReturnable) {
        return {
            eligible: false,
            reason: 'line_blocked',
            daysRemaining: null,
            windowExpiringSoon: false,
        };
    }

    // Hard block: not delivered yet
    if (!input.deliveredAt) {
        return {
            eligible: false,
            reason: 'not_delivered',
            daysRemaining: null,
            windowExpiringSoon: false,
        };
    }

    // Calculate return window
    const daysSinceDelivery = Math.floor(
        (now.getTime() - input.deliveredAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    const daysRemaining = RETURN_POLICY.windowDays - daysSinceDelivery;
    const windowExpiringSoon = daysRemaining > 0 && daysRemaining <= WARNING_THRESHOLD_DAYS;

    // Soft warning: product marked non-returnable
    const warning = !input.productIsReturnable
        ? input.productNonReturnableReason || 'product_non_returnable'
        : undefined;

    return {
        eligible: true,
        reason: daysRemaining >= 0 ? 'within_window' : 'expired_override',
        daysRemaining,
        windowExpiringSoon,
        warning,
    };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate days remaining in return window
 *
 * @returns Days remaining (negative if expired), null if not delivered
 */
export function getDaysRemaining(deliveredAt: Date | null, now: Date = new Date()): number | null {
    if (!deliveredAt) return null;
    const daysSinceDelivery = Math.floor(
        (now.getTime() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    return RETURN_POLICY.windowDays - daysSinceDelivery;
}

/**
 * Check if return window is about to expire
 */
export function isExpiringSoon(deliveredAt: Date | null, now: Date = new Date()): boolean {
    const daysRemaining = getDaysRemaining(deliveredAt, now);
    if (daysRemaining === null) return false;
    return daysRemaining > 0 && daysRemaining <= WARNING_THRESHOLD_DAYS;
}

/**
 * Check if delivery is within return window
 */
export function isWithinWindow(deliveredAt: Date | null, now: Date = new Date()): boolean {
    const daysRemaining = getDaysRemaining(deliveredAt, now);
    if (daysRemaining === null) return false;
    return daysRemaining >= 0;
}
