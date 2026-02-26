/**
 * Return Options
 *
 * Labeled options for all return-related enums.
 * Values are constrained by Zod schemas, labels are for UI display.
 */

import { z } from 'zod';
import {
    ReturnReasonCategorySchema,
    ReturnConditionSchema,
    ReturnResolutionSchema,
    LineReturnStatusSchema,
    ReturnPickupTypeSchema,
    ReturnRefundMethodSchema,
} from '../../schemas/returns.js';

// ============================================
// REASON CATEGORIES
// ============================================

export const RETURN_REASONS = {
    fit_size: 'Size/Fit Issue',
    product_quality: 'Quality Issue',
    product_different: 'Different from Listing',
    wrong_item_sent: 'Wrong Item Sent',
    damaged_in_transit: 'Damaged in Transit',
    changed_mind: 'Changed Mind',
    other: 'Other',
} as const satisfies Record<z.infer<typeof ReturnReasonCategorySchema>, string>;

export type ReturnReason = keyof typeof RETURN_REASONS;

// ============================================
// ITEM CONDITIONS
// ============================================

export const RETURN_CONDITIONS = {
    good: 'Good - Restockable',
    damaged: 'Damaged',
    defective: 'Defective',
    wrong_item: 'Wrong Item Received',
    used: 'Used/Worn',
} as const satisfies Record<z.infer<typeof ReturnConditionSchema>, string>;

export type ReturnCondition = keyof typeof RETURN_CONDITIONS;

// ============================================
// RESOLUTIONS
// ============================================

export const RETURN_RESOLUTIONS = {
    refund: 'Refund',
    exchange: 'Exchange',
    rejected: 'Rejected',
} as const satisfies Record<z.infer<typeof ReturnResolutionSchema>, string>;

export type ReturnResolution = keyof typeof RETURN_RESOLUTIONS;

// ============================================
// STATUSES
// ============================================

export const RETURN_STATUSES = {
    requested: 'Requested',
    approved: 'Approved',
    inspected: 'Inspected',
    refunded: 'Refunded',
    archived: 'Archived',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
} as const satisfies Record<z.infer<typeof LineReturnStatusSchema>, string>;

export type ReturnStatus = keyof typeof RETURN_STATUSES;

// ============================================
// PICKUP TYPES
// ============================================

export const RETURN_PICKUP_TYPES = {
    arranged_by_us: 'Arranged by Us',
    customer_shipped: 'Customer Shipped',
} as const satisfies Record<z.infer<typeof ReturnPickupTypeSchema>, string>;

export type ReturnPickupType = keyof typeof RETURN_PICKUP_TYPES;

// ============================================
// REFUND METHODS
// ============================================

export const RETURN_REFUND_METHODS = {
    payment_link: 'Payment Link (Razorpay)',
    bank_transfer: 'Bank Transfer',
    store_credit: 'Store Credit',
} as const satisfies Record<z.infer<typeof ReturnRefundMethodSchema>, string>;

export type ReturnRefundMethod = keyof typeof RETURN_REFUND_METHODS;

// ============================================
// NON-RETURNABLE REASONS
// ============================================

export const NON_RETURNABLE_REASONS = {
    sale_item: 'Sale Item',
    hygiene: 'Hygiene Product',
    custom_made: 'Custom Made',
    clearance: 'Clearance Item',
    final_sale: 'Final Sale',
} as const;

export type NonReturnableReason = keyof typeof NON_RETURNABLE_REASONS;

// ============================================
// HELPERS
// ============================================

/**
 * Convert a label map to dropdown options format
 *
 * @example
 * toOptions(RETURN_REASONS)
 * // → [{ value: 'fit_size', label: 'Size/Fit Issue' }, ...]
 */
export function toOptions<T extends Record<string, string>>(
    map: T
): Array<{ value: keyof T; label: string }> {
    return Object.entries(map).map(([value, label]) => ({
        value: value as keyof T,
        label,
    }));
}

/**
 * Get label for a value from any options map
 *
 * @example
 * getLabel(RETURN_REASONS, 'fit_size') // → 'Size/Fit Issue'
 * getLabel(RETURN_REASONS, 'unknown')  // → 'unknown'
 */
export function getLabel<T extends Record<string, string>>(
    map: T,
    value: string | null | undefined
): string {
    if (!value) return '';
    return (map as Record<string, string>)[value] ?? value;
}
