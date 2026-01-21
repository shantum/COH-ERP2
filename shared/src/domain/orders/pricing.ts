/**
 * Order Pricing Utilities - Shared Domain Layer
 *
 * Single source of truth for order pricing calculations.
 * Handles exchange orders, normal orders, and iThink Logistics API requirements.
 *
 * Priority order for total calculation:
 * 1. Calculate from order lines (most accurate, handles exchanges correctly)
 * 2. Use order.totalAmount (if > 0 and not an exchange)
 * 3. Use shopifyCache.totalPrice (if Shopify order)
 * 4. Return 0 for orders with no valid pricing data
 *
 * @module domain/orders/pricing
 */

// ============================================
// TYPES
// ============================================

/**
 * Minimal order line interface for pricing calculations.
 * Uses duck typing to work with both client and server Order/OrderLine types.
 */
export interface PricingOrderLine {
    lineStatus?: string | null;
    unitPrice?: number | null;
    qty?: number | null;
}

/**
 * Minimal shopify cache interface for pricing calculations.
 * Only needs totalPrice field for fallback pricing.
 */
export interface PricingShopifyCache {
    totalPrice?: number | null;
}

/**
 * Minimal order interface for pricing calculations.
 * Uses duck typing to work with both client and server Order types.
 */
export interface PricingOrder {
    orderNumber?: string;
    isExchange?: boolean | null;
    totalAmount?: number | null;
    orderLines?: PricingOrderLine[] | null;
    shopifyCache?: PricingShopifyCache | null;
}

/**
 * Result of order total calculation with source tracking.
 * Provides transparency about where the total came from.
 */
export interface OrderTotalResult {
    /** The calculated or stored total amount */
    total: number;
    /** Source of the total value */
    source: 'calculated' | 'stored' | 'shopify';
    /** Whether this is an exchange order */
    isExchange: boolean;
}

// ============================================
// LINE-LEVEL CALCULATIONS
// ============================================

/**
 * Calculate the total for a single order line.
 * Skips cancelled lines by returning 0.
 *
 * @param line - The order line to calculate
 * @returns The line total (unitPrice * qty) or 0 if cancelled
 *
 * @example
 * const lineTotal = calculateLineTotal(orderLine);
 * // Returns: 1500 (if unitPrice=500, qty=3)
 */
export function calculateLineTotal(line: PricingOrderLine): number {
    // Skip cancelled lines
    if (line.lineStatus === 'cancelled') {
        return 0;
    }

    const unitPrice = line.unitPrice ?? 0;
    const qty = line.qty ?? 0;

    return unitPrice * qty;
}

/**
 * Calculate the total from all order lines.
 * Skips cancelled lines automatically.
 *
 * @param orderLines - Array of order lines (may be undefined)
 * @returns Sum of all non-cancelled line totals
 */
function calculateTotalFromLines(
    orderLines: PricingOrderLine[] | null | undefined
): number {
    if (!orderLines || orderLines.length === 0) {
        return 0;
    }

    return orderLines.reduce((sum, line) => sum + calculateLineTotal(line), 0);
}

// ============================================
// ORDER-LEVEL CALCULATIONS
// ============================================

/**
 * Calculate the order total with proper source tracking.
 *
 * Logic:
 * - Exchange orders ALWAYS calculate from lines (their totalAmount is typically 0)
 * - Normal orders prefer stored totalAmount, then shopifyCache.totalPrice, then calculate
 * - Never returns 0 for non-exchange orders with valid lines
 *
 * @param order - The order to calculate total for
 * @returns OrderTotalResult with total, source, and isExchange flag
 *
 * @example
 * // Exchange order - always calculates from lines
 * const result = calculateOrderTotal(exchangeOrder);
 * // Returns: { total: 2000, source: 'calculated', isExchange: true }
 *
 * @example
 * // Normal Shopify order with stored total
 * const result = calculateOrderTotal(normalOrder);
 * // Returns: { total: 1500, source: 'stored', isExchange: false }
 */
export function calculateOrderTotal(order: PricingOrder): OrderTotalResult {
    const isExchange = order.isExchange === true;
    const orderLines = order.orderLines;
    const shopifyCache = order.shopifyCache;

    // Exchange orders: ALWAYS calculate from lines
    // Exchange orders typically have totalAmount=0 stored, so we must calculate
    if (isExchange) {
        const calculatedTotal = calculateTotalFromLines(orderLines);
        return {
            total: calculatedTotal,
            source: 'calculated',
            isExchange: true,
        };
    }

    // Normal orders: Try stored values first, then calculate

    // 1. Try order.totalAmount (stored value)
    if (order.totalAmount && order.totalAmount > 0) {
        return {
            total: order.totalAmount,
            source: 'stored',
            isExchange: false,
        };
    }

    // 2. Try shopifyCache.totalPrice (generated column from Shopify sync)
    if (shopifyCache?.totalPrice && shopifyCache.totalPrice > 0) {
        return {
            total: shopifyCache.totalPrice,
            source: 'shopify',
            isExchange: false,
        };
    }

    // 3. Calculate from order lines as fallback
    const calculatedTotal = calculateTotalFromLines(orderLines);

    if (calculatedTotal > 0) {
        return {
            total: calculatedTotal,
            source: 'calculated',
            isExchange: false,
        };
    }

    // 4. No valid total found - return 0
    // This should only happen for orders with no lines or all cancelled lines
    return {
        total: 0,
        source: 'calculated',
        isExchange: false,
    };
}

// ============================================
// SHIPPING API HELPERS
// ============================================

/**
 * Get the product MRP for shipping API calls (e.g., iThink Logistics).
 *
 * The iThink Logistics API requires productMrp > 0 for rate calculations.
 * This function ensures we never return 0, using a minimum fallback of 100.
 *
 * Priority:
 * 1. Calculate from order lines (most accurate for exchanges)
 * 2. Use order.totalAmount if valid
 * 3. Use shopifyCache.totalPrice if available
 * 4. Fallback to minimum 100 (never return 0)
 *
 * @param order - The order to get MRP for
 * @returns Product MRP value, guaranteed to be > 0 (minimum 100)
 *
 * @example
 * const mrp = getProductMrpForShipping(order);
 * // Always returns a positive value for API calls
 *
 * // Use in shipping API:
 * trackingApi.getRates({
 *   fromPincode: '400092',
 *   toPincode: customerPincode,
 *   weight: 0.5,
 *   paymentMethod: 'prepaid',
 *   productMrp: getProductMrpForShipping(order),
 * });
 */
export function getProductMrpForShipping(order: PricingOrder): number {
    const MINIMUM_MRP = 100; // Fallback to prevent API errors

    const result = calculateOrderTotal(order);

    // If we got a valid total, use it
    if (result.total > 0) {
        return result.total;
    }

    // Last resort fallback - never return 0 for shipping API
    return MINIMUM_MRP;
}

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Check if an order has sufficient pricing data.
 * Useful for validation before operations that require accurate pricing.
 *
 * @param order - The order to validate
 * @returns true if order has valid pricing data
 */
export function hasValidPricing(order: PricingOrder): boolean {
    const result = calculateOrderTotal(order);
    return result.total > 0;
}

// ============================================
// DISPLAY HELPERS
// ============================================

/**
 * Get a human-readable description of the pricing source.
 * Useful for debugging or displaying pricing info to users.
 *
 * @param result - The OrderTotalResult from calculateOrderTotal
 * @returns Human-readable source description
 */
export function getPricingSourceLabel(result: OrderTotalResult): string {
    if (result.isExchange) {
        return 'Calculated from exchange items';
    }

    switch (result.source) {
        case 'stored':
            return 'Order total';
        case 'shopify':
            return 'Shopify total';
        case 'calculated':
            return 'Calculated from items';
        default:
            return 'Unknown';
    }
}
