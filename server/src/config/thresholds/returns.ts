/**
 * Returns Configuration
 *
 * Defines thresholds and options for the returns system:
 * - Return window (days from delivery)
 * - Reason categories
 * - Item conditions
 * - Resolution options
 *
 * TO CHANGE RETURN SETTINGS:
 * Simply update the values below. Changes take effect immediately.
 */

// ============================================
// RETURN WINDOW
// ============================================

/**
 * Number of days from delivery within which returns are accepted
 */
export const RETURN_WINDOW_DAYS = 14;

/**
 * Days before window expiry to show warning
 */
export const RETURN_WINDOW_WARNING_DAYS = 12;

/**
 * Auto-reject returns after window expires (null = allow with override)
 */
export const RETURN_AUTO_REJECT_AFTER_DAYS: number | null = null;

// ============================================
// REASON CATEGORIES
// ============================================

export const RETURN_REASON_CATEGORIES = [
    { value: 'fit_size', label: 'Size/Fit Issue' },
    { value: 'product_quality', label: 'Quality Issue' },
    { value: 'product_different', label: 'Different from Listing' },
    { value: 'wrong_item_sent', label: 'Wrong Item Sent' },
    { value: 'damaged_in_transit', label: 'Damaged in Transit' },
    { value: 'changed_mind', label: 'Changed Mind' },
    { value: 'other', label: 'Other' },
] as const;

export type ReturnReasonCategoryValue = (typeof RETURN_REASON_CATEGORIES)[number]['value'];

// ============================================
// ITEM CONDITIONS
// ============================================

export const RETURN_CONDITIONS = [
    { value: 'good', label: 'Good - Restockable' },
    { value: 'damaged', label: 'Damaged' },
    { value: 'defective', label: 'Defective' },
    { value: 'wrong_item', label: 'Wrong Item Received' },
    { value: 'used', label: 'Used/Worn' },
] as const;

export type ReturnConditionValue = (typeof RETURN_CONDITIONS)[number]['value'];

// ============================================
// RESOLUTIONS
// ============================================

export const RETURN_RESOLUTIONS = [
    { value: 'refund', label: 'Refund' },
    { value: 'exchange', label: 'Exchange' },
    { value: 'rejected', label: 'Rejected' },
] as const;

export type ReturnResolutionValue = (typeof RETURN_RESOLUTIONS)[number]['value'];

// ============================================
// RETURN STATUSES
// ============================================

export const RETURN_STATUSES = [
    { value: 'requested', label: 'Requested' },
    { value: 'pickup_scheduled', label: 'Pickup Scheduled' },
    { value: 'in_transit', label: 'In Transit' },
    { value: 'received', label: 'Received' },
    { value: 'complete', label: 'Complete' },
    { value: 'cancelled', label: 'Cancelled' },
] as const;

export type ReturnStatusValue = (typeof RETURN_STATUSES)[number]['value'];

// ============================================
// PICKUP TYPES
// ============================================

export const RETURN_PICKUP_TYPES = [
    { value: 'arranged_by_us', label: 'Arranged by Us' },
    { value: 'customer_shipped', label: 'Customer Shipped' },
] as const;

export type ReturnPickupTypeValue = (typeof RETURN_PICKUP_TYPES)[number]['value'];

// ============================================
// REFUND METHODS
// ============================================

export const RETURN_REFUND_METHODS = [
    { value: 'payment_link', label: 'Payment Link (Razorpay)' },
    { value: 'bank_transfer', label: 'Bank Transfer' },
    { value: 'store_credit', label: 'Store Credit' },
] as const;

export type ReturnRefundMethodValue = (typeof RETURN_REFUND_METHODS)[number]['value'];

// ============================================
// NON-RETURNABLE REASONS (for Product.nonReturnableReason)
// ============================================

export const NON_RETURNABLE_REASONS = [
    { value: 'sale_item', label: 'Sale Item' },
    { value: 'hygiene', label: 'Hygiene Product' },
    { value: 'custom_made', label: 'Custom Made' },
    { value: 'clearance', label: 'Clearance Item' },
    { value: 'final_sale', label: 'Final Sale' },
] as const;

export type NonReturnableReasonValue = (typeof NON_RETURNABLE_REASONS)[number]['value'];

// ============================================
// CONSOLIDATED EXPORT
// ============================================

export const RETURN_CONFIG = {
    /** Days from delivery within which returns are accepted */
    windowDays: RETURN_WINDOW_DAYS,
    /** Days before window expiry to show warning */
    windowWarningDays: RETURN_WINDOW_WARNING_DAYS,
    /** Auto-reject after this many days (null = allow with override) */
    autoRejectAfterDays: RETURN_AUTO_REJECT_AFTER_DAYS,
} as const;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if a line is within the return window
 *
 * @param deliveredAt - Date the item was delivered
 * @param now - Current date (defaults to now)
 * @returns true if within return window
 */
export function isWithinReturnWindow(
    deliveredAt: Date | null | undefined,
    now: Date = new Date()
): boolean {
    if (!deliveredAt) return false;
    const daysSinceDelivery = Math.floor(
        (now.getTime() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSinceDelivery <= RETURN_WINDOW_DAYS;
}

/**
 * Get days remaining in return window
 *
 * @param deliveredAt - Date the item was delivered
 * @param now - Current date (defaults to now)
 * @returns Days remaining (negative if expired)
 */
export function getReturnWindowDaysRemaining(
    deliveredAt: Date | null | undefined,
    now: Date = new Date()
): number | null {
    if (!deliveredAt) return null;
    const daysSinceDelivery = Math.floor(
        (now.getTime() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    return RETURN_WINDOW_DAYS - daysSinceDelivery;
}

/**
 * Check if return window is expiring soon (within warning threshold)
 *
 * @param deliveredAt - Date the item was delivered
 * @param now - Current date (defaults to now)
 * @returns true if within warning window but not expired
 */
export function isReturnWindowExpiringSoon(
    deliveredAt: Date | null | undefined,
    now: Date = new Date()
): boolean {
    if (!deliveredAt) return false;
    const daysRemaining = getReturnWindowDaysRemaining(deliveredAt, now);
    if (daysRemaining === null) return false;
    return daysRemaining > 0 && daysRemaining <= (RETURN_WINDOW_DAYS - RETURN_WINDOW_WARNING_DAYS);
}

/**
 * Get return status label
 */
export function getReturnStatusLabel(status: string): string {
    const found = RETURN_STATUSES.find((s) => s.value === status);
    return found?.label ?? status;
}

/**
 * Get reason category label
 */
export function getReturnReasonLabel(category: string): string {
    const found = RETURN_REASON_CATEGORIES.find((c) => c.value === category);
    return found?.label ?? category;
}

/**
 * Get condition label
 */
export function getReturnConditionLabel(condition: string): string {
    const found = RETURN_CONDITIONS.find((c) => c.value === condition);
    return found?.label ?? condition;
}

/**
 * Get resolution label
 */
export function getReturnResolutionLabel(resolution: string): string {
    const found = RETURN_RESOLUTIONS.find((r) => r.value === resolution);
    return found?.label ?? resolution;
}
