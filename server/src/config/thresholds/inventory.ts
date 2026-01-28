/**
 * Inventory Thresholds Configuration
 *
 * Defines thresholds for inventory management:
 * - Stock alert levels
 * - Fabric consumption defaults
 * - Lead time settings
 *
 * TO CHANGE INVENTORY THRESHOLDS:
 * Simply update the values below. Changes take effect immediately.
 */

// ============================================
// STOCK ALERT THRESHOLDS
// ============================================

/**
 * Number of days of stock to maintain before triggering reorder alert
 *
 * When inventory drops below this many days of stock (based on
 * average daily sales), the SKU is flagged for reordering.
 */
export const STOCK_ALERT_THRESHOLD_DAYS = 30;

// ============================================
// FABRIC CONSUMPTION
// ============================================

/**
 * Default fabric consumption per unit when not specified
 *
 * This value is used when a SKU or product doesn't have a specific
 * fabric consumption value set. Measured in meters per unit.
 */
export const DEFAULT_FABRIC_CONSUMPTION = 1.5;

// ============================================
// LEAD TIME
// ============================================

/**
 * Default lead time for fabric orders (days)
 *
 * How long it takes from placing a fabric order to receiving it.
 * Used in reorder calculations.
 */
export const DEFAULT_FABRIC_LEAD_TIME_DAYS = 14;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate days of stock remaining
 *
 * @param currentStock - Current inventory quantity
 * @param avgDailySales - Average units sold per day
 * @returns Days of stock remaining (Infinity if no sales)
 */
export function calculateDaysOfStock(
    currentStock: number,
    avgDailySales: number
): number {
    if (avgDailySales <= 0) return Infinity;
    return Math.floor(currentStock / avgDailySales);
}

/**
 * Check if SKU needs reordering
 *
 * @param currentStock - Current inventory quantity
 * @param avgDailySales - Average units sold per day
 * @returns true if stock is below threshold
 */
export function needsReorder(
    currentStock: number,
    avgDailySales: number
): boolean {
    const daysOfStock = calculateDaysOfStock(currentStock, avgDailySales);
    return daysOfStock < STOCK_ALERT_THRESHOLD_DAYS;
}

/**
 * Calculate reorder quantity
 *
 * @param avgDailySales - Average units sold per day
 * @param targetDays - Target days of stock to maintain (default: threshold * 2)
 * @param currentStock - Current inventory
 * @returns Quantity to reorder
 */
export function calculateReorderQuantity(
    avgDailySales: number,
    targetDays: number = STOCK_ALERT_THRESHOLD_DAYS * 2,
    currentStock: number = 0
): number {
    const targetStock = Math.ceil(avgDailySales * targetDays);
    return Math.max(0, targetStock - currentStock);
}
