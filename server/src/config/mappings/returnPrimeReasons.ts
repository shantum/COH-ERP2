/**
 * Return Prime Reason Mapping
 *
 * Maps Return Prime return reasons to COH-ERP ReturnReasonCategory values.
 * Used when creating returns from Return Prime webhooks.
 */

import type { ReturnReasonCategory } from '@coh/shared';

/**
 * Map of Return Prime reason strings to COH-ERP reason categories.
 * Keys are normalized (lowercase, underscores instead of spaces).
 */
export const RETURNPRIME_REASON_MAP: Record<string, ReturnReasonCategory> = {
    // Size/Fit
    'size_too_small': 'fit_size',
    'size_too_large': 'fit_size',
    'size_issue': 'fit_size',
    'fit_issue': 'fit_size',
    'doesnt_fit': 'fit_size',
    'does_not_fit': 'fit_size',
    'wrong_size': 'fit_size',
    'sizing_issue': 'fit_size',

    // Quality
    'quality_issue': 'product_quality',
    'defective': 'product_quality',
    'poor_quality': 'product_quality',
    'manufacturing_defect': 'product_quality',
    'defect': 'product_quality',
    'faulty': 'product_quality',

    // Different from listing
    'not_as_described': 'product_different',
    'color_different': 'product_different',
    'material_different': 'product_different',
    'looks_different': 'product_different',
    'different_from_image': 'product_different',
    'different_from_description': 'product_different',
    'color_mismatch': 'product_different',

    // Wrong item
    'wrong_item': 'wrong_item_sent',
    'wrong_item_received': 'wrong_item_sent',
    'incorrect_item': 'wrong_item_sent',
    'wrong_product': 'wrong_item_sent',

    // Damaged
    'damaged': 'damaged_in_transit',
    'damaged_in_shipping': 'damaged_in_transit',
    'broken': 'damaged_in_transit',
    'arrived_damaged': 'damaged_in_transit',
    'packaging_damaged': 'damaged_in_transit',

    // Changed mind
    'no_longer_needed': 'changed_mind',
    'changed_mind': 'changed_mind',
    'found_better_price': 'changed_mind',
    'ordered_by_mistake': 'changed_mind',
    'accidental_order': 'changed_mind',
    'dont_want_it': 'changed_mind',
    'do_not_want': 'changed_mind',
};

/**
 * Maps a Return Prime reason string to a COH-ERP ReturnReasonCategory.
 *
 * Normalizes the input by:
 * 1. Converting to lowercase
 * 2. Trimming whitespace
 * 3. Replacing spaces with underscores
 *
 * @param rpReason - The reason string from Return Prime
 * @returns The mapped ReturnReasonCategory, or 'other' if no match
 */
export function mapReturnPrimeReason(rpReason: string | undefined | null): ReturnReasonCategory {
    if (!rpReason) return 'other';

    // Normalize: lowercase, trim, underscores for spaces
    const normalized = rpReason.toLowerCase().trim().replace(/\s+/g, '_');

    return RETURNPRIME_REASON_MAP[normalized] ?? 'other';
}
