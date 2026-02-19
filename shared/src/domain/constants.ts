/**
 * Domain Constants
 *
 * Business constants shared across client and server.
 * Centralizes magic numbers for maintainability.
 */

/**
 * GST Configuration
 *
 * All GST settings in one place. Change here → takes effect everywhere.
 * Rates are for apparel (Chapter 61/62) per Indian GST Council.
 */
export const GST_CONFIG = {
  /** Company's registered state (determines intra vs inter-state) */
  companyState: 'Maharashtra',
  /** MRP threshold for rate slab (₹) */
  threshold: 2500,
  /** GST rate (%) for MRP up to threshold */
  rateBelowThreshold: 5,
  /** GST rate (%) for MRP above threshold */
  rateAboveThreshold: 18,
  /** Default HSN code for knitted apparel (T-shirts, tops) */
  defaultHsn: '6109',
  /** Alternative HSN for knitted sweaters/pullovers */
  altHsnKnitted: '6110',
} as const;

// Legacy exports — keep for backward compatibility until fully migrated
export const GST_THRESHOLD = GST_CONFIG.threshold;
export const GST_RATE_BELOW_THRESHOLD = GST_CONFIG.rateBelowThreshold;
export const GST_RATE_ABOVE_THRESHOLD = GST_CONFIG.rateAboveThreshold;

/**
 * Calculate GST rate based on MRP
 * @param mrp - Maximum Retail Price in INR
 * @returns GST rate percentage (5 or 18)
 */
export function getGstRate(mrp: number): number {
    return mrp > GST_CONFIG.threshold ? GST_CONFIG.rateAboveThreshold : GST_CONFIG.rateBelowThreshold;
}
