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
export declare const GST_THRESHOLD = 2500;
export declare const GST_RATE_BELOW_THRESHOLD = 5;
export declare const GST_RATE_ABOVE_THRESHOLD = 18;
/**
 * Calculate GST rate based on MRP
 * @param mrp - Maximum Retail Price in INR
 * @returns GST rate percentage (5 or 18)
 */
export declare function getGstRate(mrp: number): number;
//# sourceMappingURL=constants.d.ts.map