/**
 * Customer Tier Thresholds Configuration
 *
 * Defines LTV (Lifetime Value) breakpoints for customer tier classification.
 * Tiers are used for:
 * - Prioritizing support requests
 * - Offering tier-specific discounts
 * - Analytics and reporting
 *
 * TO CHANGE TIER THRESHOLDS:
 * 1. Update the TIER_THRESHOLDS values
 * 2. Run the recalculateAllCustomerLtvs script to update existing customers
 *
 * ARCHITECTURE:
 * - Pure tier calculation logic lives in @coh/shared/domain (shared layer)
 * - This file provides config-specific exports and backward compatibility
 */

// Import pure functions and constants from shared domain layer
import {
    calculateTierFromLtv,
    compareTiers as sharedCompareTiers,
    shouldUpgradeTier as sharedShouldUpgradeTier,
    DEFAULT_TIER_THRESHOLDS,
    TIER_ORDER,
    TIER_LABELS,
    TIER_COLORS,
    type CustomerTier,
    type TierThresholds,
} from '@coh/shared/domain';

// Re-export types for backward compatibility
export type { CustomerTier, TierThresholds };

// ============================================
// TIER CONFIGURATION
// ============================================

/**
 * LTV thresholds for each tier
 *
 * A customer is assigned the highest tier where their LTV meets the threshold.
 * - LTV >= platinum threshold -> platinum
 * - LTV >= gold threshold -> gold
 * - LTV >= silver threshold -> silver
 * - LTV < silver threshold -> bronze (default)
 *
 * @deprecated Use DEFAULT_TIER_THRESHOLDS from @coh/shared/domain
 */
export const TIER_THRESHOLDS: TierThresholds = DEFAULT_TIER_THRESHOLDS;

// Re-export shared constants
export { TIER_LABELS, TIER_COLORS, TIER_ORDER };

// ============================================
// TIER CALCULATION (re-exports for backward compatibility)
// ============================================

/**
 * Calculate customer tier from LTV
 *
 * @param ltv - Customer's lifetime value (total spend)
 * @param thresholds - Optional custom thresholds (uses defaults if not provided)
 * @returns Customer tier
 *
 * @example
 * calculateTier(60000) // => 'platinum'
 * calculateTier(15000) // => 'silver'
 * calculateTier(5000)  // => 'bronze'
 *
 * @deprecated Use calculateTierFromLtv from @coh/shared/domain directly
 */
export function calculateTier(
    ltv: number,
    thresholds: TierThresholds = TIER_THRESHOLDS
): CustomerTier {
    return calculateTierFromLtv(ltv, thresholds);
}

/**
 * Get all tiers in order from highest to lowest
 *
 * @deprecated Use TIER_ORDER from @coh/shared/domain directly
 */
export function getTierOrder(): CustomerTier[] {
    return [...TIER_ORDER];
}

/**
 * Compare two tiers (returns -1 if a < b, 0 if equal, 1 if a > b)
 *
 * @deprecated Use compareTiers from @coh/shared/domain directly
 */
export function compareTiers(a: CustomerTier, b: CustomerTier): number {
    return sharedCompareTiers(a, b);
}

/**
 * Check if customer qualifies for a tier upgrade
 *
 * @deprecated Use shouldUpgradeTier from @coh/shared/domain directly
 */
export function shouldUpgradeTier(
    currentTier: CustomerTier,
    newLtv: number,
    thresholds: TierThresholds = TIER_THRESHOLDS
): boolean {
    return sharedShouldUpgradeTier(currentTier, newLtv, thresholds);
}
