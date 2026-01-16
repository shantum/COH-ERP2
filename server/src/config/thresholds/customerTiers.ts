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
 */

import type { TierThresholds, CustomerTier } from '../types.js';

// ============================================
// TIER CONFIGURATION
// ============================================

/**
 * LTV thresholds for each tier
 *
 * A customer is assigned the highest tier where their LTV meets the threshold.
 * - LTV >= platinum threshold → platinum
 * - LTV >= gold threshold → gold
 * - LTV >= silver threshold → silver
 * - LTV < silver threshold → bronze (default)
 */
export const TIER_THRESHOLDS: TierThresholds = {
    /** Minimum LTV for platinum tier */
    platinum: 50000,
    /** Minimum LTV for gold tier */
    gold: 25000,
    /** Minimum LTV for silver tier */
    silver: 10000,
};

/**
 * Tier display names for UI
 */
export const TIER_LABELS: Record<CustomerTier, string> = {
    platinum: 'Platinum',
    gold: 'Gold',
    silver: 'Silver',
    bronze: 'Bronze',
};

/**
 * Tier colors for UI (Tailwind classes)
 */
export const TIER_COLORS: Record<CustomerTier, string> = {
    platinum: 'text-purple-600 bg-purple-50',
    gold: 'text-yellow-600 bg-yellow-50',
    silver: 'text-gray-600 bg-gray-100',
    bronze: 'text-orange-600 bg-orange-50',
};

// ============================================
// TIER CALCULATION
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
 */
export function calculateTier(
    ltv: number,
    thresholds: TierThresholds = TIER_THRESHOLDS
): CustomerTier {
    if (ltv >= thresholds.platinum) return 'platinum';
    if (ltv >= thresholds.gold) return 'gold';
    if (ltv >= thresholds.silver) return 'silver';
    return 'bronze';
}

/**
 * Get all tiers in order from highest to lowest
 */
export function getTierOrder(): CustomerTier[] {
    return ['platinum', 'gold', 'silver', 'bronze'];
}

/**
 * Compare two tiers (returns -1 if a < b, 0 if equal, 1 if a > b)
 */
export function compareTiers(a: CustomerTier, b: CustomerTier): number {
    const order = getTierOrder();
    return order.indexOf(b) - order.indexOf(a);
}

/**
 * Check if customer qualifies for a tier upgrade
 */
export function shouldUpgradeTier(
    currentTier: CustomerTier,
    newLtv: number,
    thresholds: TierThresholds = TIER_THRESHOLDS
): boolean {
    const newTier = calculateTier(newLtv, thresholds);
    return compareTiers(newTier, currentTier) > 0;
}
