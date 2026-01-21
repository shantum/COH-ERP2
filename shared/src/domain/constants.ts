/**
 * Domain Constants
 *
 * Business constants shared across client and server.
 * Centralizes magic numbers for maintainability.
 */

/**
 * Tax Constants
 * GST rates for apparel in India based on MRP threshold
 */
export const GST_THRESHOLD = 2500;
export const GST_RATE_BELOW_THRESHOLD = 5;  // 5% for MRP < 2500
export const GST_RATE_ABOVE_THRESHOLD = 18; // 18% for MRP >= 2500

/**
 * Calculate GST rate based on MRP
 * @param mrp - Maximum Retail Price in INR
 * @returns GST rate percentage (5 or 18)
 */
export function getGstRate(mrp: number): number {
    return mrp >= GST_THRESHOLD ? GST_RATE_ABOVE_THRESHOLD : GST_RATE_BELOW_THRESHOLD;
}
