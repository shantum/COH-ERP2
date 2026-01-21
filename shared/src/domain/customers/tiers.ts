/**
 * Customer Tier Calculation - Shared Domain Layer
 *
 * Pure functions for customer tier calculation based on LTV (Lifetime Value).
 * This is the single source of truth for tier logic.
 *
 * Tiers are used for:
 * - Prioritizing support requests
 * - Offering tier-specific discounts
 * - Analytics and reporting
 *
 * @module domain/customers/tiers
 */

// ============================================
// TYPES
// ============================================

/**
 * Customer tier levels based on LTV.
 * Order from highest to lowest: platinum > gold > silver > bronze
 */
export type CustomerTier = 'bronze' | 'silver' | 'gold' | 'platinum';

/**
 * Tier thresholds configuration.
 * A customer is assigned the highest tier where their LTV meets the threshold.
 */
export interface TierThresholds {
    /** Minimum LTV for platinum tier */
    platinum: number;
    /** Minimum LTV for gold tier */
    gold: number;
    /** Minimum LTV for silver tier */
    silver: number;
    // bronze is implicit (below silver)
}

// ============================================
// CONSTANTS
// ============================================

/**
 * Default tier thresholds (in currency units).
 *
 * TO CHANGE TIER THRESHOLDS:
 * 1. Update these values OR override via system settings
 * 2. Run the recalculateAllCustomerLtvs script to update existing customers
 */
export const DEFAULT_TIER_THRESHOLDS: TierThresholds = {
    platinum: 50000,
    gold: 25000,
    silver: 10000,
};

/**
 * All tiers in order from highest to lowest value.
 * Used for comparison and iteration.
 */
export const TIER_ORDER: readonly CustomerTier[] = [
    'platinum',
    'gold',
    'silver',
    'bronze',
] as const;

/**
 * Tier display labels for UI.
 */
export const TIER_LABELS: Record<CustomerTier, string> = {
    platinum: 'Platinum',
    gold: 'Gold',
    silver: 'Silver',
    bronze: 'Bronze',
};

/**
 * Tier colors for UI (Tailwind classes).
 */
export const TIER_COLORS: Record<CustomerTier, string> = {
    platinum: 'text-purple-600 bg-purple-50',
    gold: 'text-yellow-600 bg-yellow-50',
    silver: 'text-gray-600 bg-gray-100',
    bronze: 'text-orange-600 bg-orange-50',
};

// ============================================
// CORE CALCULATION FUNCTIONS
// ============================================

/**
 * Calculate customer tier from LTV.
 *
 * A customer is assigned the highest tier where their LTV meets the threshold:
 * - LTV >= platinum threshold -> platinum
 * - LTV >= gold threshold -> gold
 * - LTV >= silver threshold -> silver
 * - LTV < silver threshold -> bronze (default)
 *
 * @param ltv - Customer's lifetime value (total spend)
 * @param thresholds - Optional custom thresholds (uses defaults if not provided)
 * @returns Customer tier
 *
 * @example
 * calculateTierFromLtv(60000) // => 'platinum'
 * calculateTierFromLtv(30000) // => 'gold'
 * calculateTierFromLtv(15000) // => 'silver'
 * calculateTierFromLtv(5000)  // => 'bronze'
 */
export function calculateTierFromLtv(
    ltv: number,
    thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS
): CustomerTier {
    if (ltv >= thresholds.platinum) return 'platinum';
    if (ltv >= thresholds.gold) return 'gold';
    if (ltv >= thresholds.silver) return 'silver';
    return 'bronze';
}

// ============================================
// TIER COMPARISON FUNCTIONS
// ============================================

/**
 * Get the numeric rank of a tier (higher = better).
 *
 * @param tier - The tier to get rank for
 * @returns Numeric rank (0 = bronze, 3 = platinum)
 */
export function getTierRank(tier: CustomerTier): number {
    const ranks: Record<CustomerTier, number> = {
        bronze: 0,
        silver: 1,
        gold: 2,
        platinum: 3,
    };
    return ranks[tier];
}

/**
 * Compare two tiers.
 *
 * @param a - First tier
 * @param b - Second tier
 * @returns Negative if a < b, 0 if equal, positive if a > b
 *
 * @example
 * compareTiers('gold', 'silver')   // => 1 (gold > silver)
 * compareTiers('bronze', 'gold')   // => -2 (bronze < gold)
 * compareTiers('silver', 'silver') // => 0 (equal)
 */
export function compareTiers(a: CustomerTier, b: CustomerTier): number {
    return getTierRank(a) - getTierRank(b);
}

/**
 * Check if tier A is higher than tier B.
 *
 * @param a - First tier
 * @param b - Second tier
 * @returns true if a > b
 */
export function isTierHigher(a: CustomerTier, b: CustomerTier): boolean {
    return compareTiers(a, b) > 0;
}

/**
 * Check if tier A is lower than tier B.
 *
 * @param a - First tier
 * @param b - Second tier
 * @returns true if a < b
 */
export function isTierLower(a: CustomerTier, b: CustomerTier): boolean {
    return compareTiers(a, b) < 0;
}

// ============================================
// TIER CHANGE DETECTION
// ============================================

/**
 * Check if customer qualifies for a tier upgrade.
 *
 * @param currentTier - Customer's current tier
 * @param newLtv - Customer's new LTV value
 * @param thresholds - Optional custom thresholds
 * @returns true if new LTV qualifies for a higher tier
 *
 * @example
 * shouldUpgradeTier('silver', 30000) // => true (qualifies for gold)
 * shouldUpgradeTier('gold', 30000)   // => false (already gold)
 * shouldUpgradeTier('gold', 55000)   // => true (qualifies for platinum)
 */
export function shouldUpgradeTier(
    currentTier: CustomerTier,
    newLtv: number,
    thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS
): boolean {
    const newTier = calculateTierFromLtv(newLtv, thresholds);
    return compareTiers(newTier, currentTier) > 0;
}

/**
 * Check if customer would be downgraded with new LTV.
 *
 * @param currentTier - Customer's current tier
 * @param newLtv - Customer's new LTV value
 * @param thresholds - Optional custom thresholds
 * @returns true if new LTV qualifies for a lower tier
 *
 * @example
 * shouldDowngradeTier('gold', 15000) // => true (would become silver)
 * shouldDowngradeTier('gold', 30000) // => false (still gold)
 */
export function shouldDowngradeTier(
    currentTier: CustomerTier,
    newLtv: number,
    thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS
): boolean {
    const newTier = calculateTierFromLtv(newLtv, thresholds);
    return compareTiers(newTier, currentTier) < 0;
}

/**
 * Get the tier change if LTV is updated.
 *
 * @param currentTier - Customer's current tier
 * @param newLtv - Customer's new LTV value
 * @param thresholds - Optional custom thresholds
 * @returns Object with new tier and whether it changed
 *
 * @example
 * getTierChange('silver', 30000)
 * // => { newTier: 'gold', changed: true, direction: 'upgrade' }
 *
 * getTierChange('gold', 30000)
 * // => { newTier: 'gold', changed: false, direction: null }
 */
export function getTierChange(
    currentTier: CustomerTier,
    newLtv: number,
    thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS
): {
    newTier: CustomerTier;
    changed: boolean;
    direction: 'upgrade' | 'downgrade' | null;
} {
    const newTier = calculateTierFromLtv(newLtv, thresholds);
    const comparison = compareTiers(newTier, currentTier);

    if (comparison > 0) {
        return { newTier, changed: true, direction: 'upgrade' };
    }
    if (comparison < 0) {
        return { newTier, changed: true, direction: 'downgrade' };
    }
    return { newTier, changed: false, direction: null };
}

// ============================================
// THRESHOLD HELPERS
// ============================================

/**
 * Get the minimum LTV required for a specific tier.
 *
 * @param tier - The target tier
 * @param thresholds - Optional custom thresholds
 * @returns Minimum LTV required, or 0 for bronze
 *
 * @example
 * getMinLtvForTier('gold') // => 25000
 * getMinLtvForTier('bronze') // => 0
 */
export function getMinLtvForTier(
    tier: CustomerTier,
    thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS
): number {
    switch (tier) {
        case 'platinum':
            return thresholds.platinum;
        case 'gold':
            return thresholds.gold;
        case 'silver':
            return thresholds.silver;
        case 'bronze':
            return 0;
    }
}

/**
 * Get the amount needed to reach the next tier.
 *
 * @param currentLtv - Customer's current LTV
 * @param thresholds - Optional custom thresholds
 * @returns Amount needed for next tier, or 0 if already platinum
 *
 * @example
 * getAmountToNextTier(22000) // => 3000 (needs 25000 for gold)
 * getAmountToNextTier(55000) // => 0 (already platinum)
 */
export function getAmountToNextTier(
    currentLtv: number,
    thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS
): number {
    const currentTier = calculateTierFromLtv(currentLtv, thresholds);

    switch (currentTier) {
        case 'platinum':
            return 0; // Already at top
        case 'gold':
            return Math.max(0, thresholds.platinum - currentLtv);
        case 'silver':
            return Math.max(0, thresholds.gold - currentLtv);
        case 'bronze':
            return Math.max(0, thresholds.silver - currentLtv);
    }
}

/**
 * Get the next tier above the current tier.
 *
 * @param currentTier - The current tier
 * @returns Next tier or null if already platinum
 */
export function getNextTier(currentTier: CustomerTier): CustomerTier | null {
    switch (currentTier) {
        case 'bronze':
            return 'silver';
        case 'silver':
            return 'gold';
        case 'gold':
            return 'platinum';
        case 'platinum':
            return null;
    }
}
