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
}
/**
 * Default tier thresholds (in currency units).
 *
 * TO CHANGE TIER THRESHOLDS:
 * 1. Update these values OR override via system settings
 * 2. Run the recalculateAllCustomerLtvs script to update existing customers
 */
export declare const DEFAULT_TIER_THRESHOLDS: TierThresholds;
/**
 * All tiers in order from highest to lowest value.
 * Used for comparison and iteration.
 */
export declare const TIER_ORDER: readonly CustomerTier[];
/**
 * Tier display labels for UI.
 */
export declare const TIER_LABELS: Record<CustomerTier, string>;
/**
 * Tier colors for UI (Tailwind classes).
 */
export declare const TIER_COLORS: Record<CustomerTier, string>;
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
export declare function calculateTierFromLtv(ltv: number, thresholds?: TierThresholds): CustomerTier;
/**
 * Get the numeric rank of a tier (higher = better).
 *
 * @param tier - The tier to get rank for
 * @returns Numeric rank (0 = bronze, 3 = platinum)
 */
export declare function getTierRank(tier: CustomerTier): number;
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
export declare function compareTiers(a: CustomerTier, b: CustomerTier): number;
/**
 * Check if tier A is higher than tier B.
 *
 * @param a - First tier
 * @param b - Second tier
 * @returns true if a > b
 */
export declare function isTierHigher(a: CustomerTier, b: CustomerTier): boolean;
/**
 * Check if tier A is lower than tier B.
 *
 * @param a - First tier
 * @param b - Second tier
 * @returns true if a < b
 */
export declare function isTierLower(a: CustomerTier, b: CustomerTier): boolean;
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
export declare function shouldUpgradeTier(currentTier: CustomerTier, newLtv: number, thresholds?: TierThresholds): boolean;
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
export declare function shouldDowngradeTier(currentTier: CustomerTier, newLtv: number, thresholds?: TierThresholds): boolean;
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
export declare function getTierChange(currentTier: CustomerTier, newLtv: number, thresholds?: TierThresholds): {
    newTier: CustomerTier;
    changed: boolean;
    direction: 'upgrade' | 'downgrade' | null;
};
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
export declare function getMinLtvForTier(tier: CustomerTier, thresholds?: TierThresholds): number;
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
export declare function getAmountToNextTier(currentLtv: number, thresholds?: TierThresholds): number;
/**
 * Get the next tier above the current tier.
 *
 * @param currentTier - The current tier
 * @returns Next tier or null if already platinum
 */
export declare function getNextTier(currentTier: CustomerTier): CustomerTier | null;
//# sourceMappingURL=tiers.d.ts.map