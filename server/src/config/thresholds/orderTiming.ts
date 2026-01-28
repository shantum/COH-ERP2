/**
 * Order Timing Thresholds Configuration
 *
 * Defines time-based thresholds for order lifecycle events:
 * - Auto-archiving delivered orders
 * - RTO warning/urgent indicators
 * - Delivery delay detection
 *
 * TO CHANGE TIMING THRESHOLDS:
 * Simply update the values below. Changes take effect immediately.
 */

// ============================================
// ARCHIVE TIMING
// ============================================

/**
 * Legacy: Days after shipping to auto-archive orders without terminalStatus
 *
 * For backward compatibility with orders that don't have terminalStatus set.
 */
export const AUTO_ARCHIVE_DAYS = 90;

/**
 * Days after terminal status (delivered/rto_received) to auto-archive
 *
 * Orders that have reached a terminal state are archived after this many days.
 * This is shorter than AUTO_ARCHIVE_DAYS since we have definitive status.
 */
export const ARCHIVE_TERMINAL_DAYS = 15;

/**
 * Days after cancellation to auto-archive
 *
 * Cancelled orders are archived quickly since they need minimal review.
 */
export const ARCHIVE_CANCELLED_DAYS = 1;

/**
 * Days of customer inactivity before marking as "at-risk"
 *
 * Silver+ tier customers with no orders for this many days are flagged.
 */
export const AT_RISK_INACTIVE_DAYS = 90;

// ============================================
// RTO TIMING
// ============================================

/**
 * Days in RTO before showing warning status
 *
 * When an order has been in RTO for this many days, it gets a
 * visual warning indicator to prompt follow-up.
 */
export const RTO_WARNING_DAYS = 3;

/**
 * Days in RTO before showing urgent status
 *
 * When an order has been in RTO for this many days, it gets an
 * urgent indicator. These orders need immediate attention.
 */
export const RTO_URGENT_DAYS = 7;

// ============================================
// DELIVERY TIMING
// ============================================

/**
 * Days in transit before showing delivery delayed status
 *
 * Orders in transit longer than this without updates are flagged
 * as "delivery delayed" for follow-up with the courier.
 */
export const DELIVERY_DELAYED_DAYS = 7;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate days since a given date
 */
export function daysSince(date: Date): number {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Check if an order should be auto-archived
 */
export function shouldAutoArchive(deliveredAt: Date | null): boolean {
    if (!deliveredAt) return false;
    return daysSince(deliveredAt) >= AUTO_ARCHIVE_DAYS;
}

/**
 * Get RTO urgency level based on days in RTO
 */
export function getRtoUrgency(daysInRto: number): 'normal' | 'warning' | 'urgent' {
    if (daysInRto >= RTO_URGENT_DAYS) return 'urgent';
    if (daysInRto >= RTO_WARNING_DAYS) return 'warning';
    return 'normal';
}

/**
 * Check if delivery is delayed based on days in transit
 */
export function isDeliveryDelayed(daysInTransit: number): boolean {
    return daysInTransit >= DELIVERY_DELAYED_DAYS;
}
