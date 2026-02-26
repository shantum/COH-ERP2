/**
 * Return Eligibility
 *
 * Pure functions for checking if an order line is eligible for return.
 * No side effects, no database calls - just logic.
 */

import { RETURN_POLICY } from './policy.js';

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

/** Settings that can be passed to eligibility check (from DB or defaults) */
export interface EligibilitySettings {
    windowDays: number;
    windowWarningDays: number;
}

// ============================================
// MAIN FUNCTION
// ============================================

/** Default settings from policy.ts */
const DEFAULT_SETTINGS: EligibilitySettings = {
    windowDays: RETURN_POLICY.windowDays,
    windowWarningDays: RETURN_POLICY.windowWarningDays,
};

/**
 * Check if an order line is eligible for return
 *
 * @param input - Line and product information
 * @param settings - Optional settings from DB (defaults to policy.ts values)
 * @param now - Current date (for testing)
 * @returns Eligibility result with reason and warnings
 *
 * @example
 * // With defaults
 * const result = checkEligibility({ deliveredAt, returnStatus, ... });
 *
 * // With DB settings
 * const dbSettings = await getReturnSettings();
 * const result = checkEligibility({ deliveredAt, ... }, dbSettings);
 */
export function checkEligibility(
    input: EligibilityInput,
    settings: EligibilitySettings = DEFAULT_SETTINGS,
    now: Date = new Date()
): EligibilityResult {
    const { windowDays, windowWarningDays } = settings;
    const warningThreshold = windowDays - windowWarningDays;

    // Hard block: already has active return
    if (input.returnStatus && !['cancelled', 'refunded', 'archived', 'rejected'].includes(input.returnStatus)) {
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
    const daysRemaining = windowDays - daysSinceDelivery;
    const windowExpiringSoon = daysRemaining > 0 && daysRemaining <= warningThreshold;

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
export function getDaysRemaining(
    deliveredAt: Date | null,
    windowDays: number = RETURN_POLICY.windowDays,
    now: Date = new Date()
): number | null {
    if (!deliveredAt) return null;
    const daysSinceDelivery = Math.floor(
        (now.getTime() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    return windowDays - daysSinceDelivery;
}

/**
 * Check if return window is about to expire
 */
export function isExpiringSoon(
    deliveredAt: Date | null,
    settings: EligibilitySettings = DEFAULT_SETTINGS,
    now: Date = new Date()
): boolean {
    const daysRemaining = getDaysRemaining(deliveredAt, settings.windowDays, now);
    if (daysRemaining === null) return false;
    const warningThreshold = settings.windowDays - settings.windowWarningDays;
    return daysRemaining > 0 && daysRemaining <= warningThreshold;
}

/**
 * Check if delivery is within return window
 */
export function isWithinWindow(
    deliveredAt: Date | null,
    windowDays: number = RETURN_POLICY.windowDays,
    now: Date = new Date()
): boolean {
    const daysRemaining = getDaysRemaining(deliveredAt, windowDays, now);
    if (daysRemaining === null) return false;
    return daysRemaining >= 0;
}
