/**
 * Return Prime Reason Mapping
 *
 * Maps Return Prime return reasons to COH-ERP ReturnReasonCategory values.
 * Used when creating returns from Return Prime webhooks.
 *
 * Two strategies:
 * 1. Exact match on normalized RP reason strings (underscore-delimited)
 * 2. Keyword match on free-text customer comments (from CSV enrichment)
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
 * Keyword patterns for classifying free-text customer comments.
 * Checked in order — first match wins. More specific patterns first.
 */
const KEYWORD_RULES: Array<{ category: ReturnReasonCategory; patterns: RegExp }> = [
    // Damaged
    { category: 'damaged_in_transit', patterns: /\b(damaged|torn|ripped|broken|hole)\b/i },

    // Wrong item
    { category: 'wrong_item_sent', patterns: /\b(wrong item|wrong product|incorrect item|received wrong|sent wrong|received\s+\w+\.?\s*need\s+\w+)\b/i },

    // Quality — check before fit (some comments mention both)
    { category: 'product_quality', patterns: /\b(quality|defect|faded|thin fabric|pilling|stain|stitching|poor.*fabric|fabric.*thin|colour.*fad|color.*fad|washed out|not good fabric|fabric.*not good|pocket.*not proper|not proper|not comfortable|uncomfortable)\b/i },

    // Different from listing
    { category: 'product_different', patterns: /\b(different.*image|not as (shown|described|expected)|colou?r.*(different|problem|issue|mismatch)|looks different|doesn.t look|transparent|not.*shown|not.*catalogue|not.*catalog|not a fan of the colo|backside cut)\b/i },

    // Size/Fit — broadest category, lots of keywords
    { category: 'fit_size', patterns: /\b(fit|size|sizing|loose|tight|big|small|large|short|long|oversiz|doesn.t fit|does not fit|fitting|too (big|small|large|tight|loose|long|short|baggy|deep)|baggy|deep neck|neck.*deep)\b/i },
    // Size requests: "L Needed", "Need XL", "I need xl", "M Needed", "2XL needed"
    { category: 'fit_size', patterns: /\b(need\s*(xs|s|m|l|xl|xxl|2xl|3xl)\b|(xs|s|m|l|xl|xxl|2xl|3xl)\s*needed)\b/i },
    // Body fit comments
    { category: 'fit_size', patterns: /(doesn.t suit|doesn.t match.*body|not suit|suits? on me|my body type|fitnot|fi issue)/i },

    // Changed mind
    { category: 'changed_mind', patterns: /\b(changed? mind|don.t want|do not want|no longer|cancel|mistake|didn.t like|did not like|not happy|don.t like|do not like|not satisfied|not what i wanted|inadvertently ordered|ordered.*return|want to return)\b/i },
];

/**
 * Classify a free-text customer comment into a reason category.
 */
function classifyComment(comment: string): ReturnReasonCategory {
    for (const rule of KEYWORD_RULES) {
        if (rule.patterns.test(comment)) {
            return rule.category;
        }
    }
    return 'other';
}

/**
 * Maps a Return Prime reason string to a COH-ERP ReturnReasonCategory.
 *
 * Strategy:
 * 1. Try exact match on normalized reason string
 * 2. If "Others"/"NA"/empty, try keyword classification on the input
 *    (caller should pass customer comment as input when RP reason is generic)
 *
 * @param rpReason - The reason string from Return Prime, or customer comment as fallback
 * @returns The mapped ReturnReasonCategory, or 'other' if no match
 */
export function mapReturnPrimeReason(rpReason: string | undefined | null): ReturnReasonCategory {
    if (!rpReason) return 'other';

    const trimmed = rpReason.trim();
    if (!trimmed) return 'other';

    // 1. Try exact match on normalized key
    const normalized = trimmed.toLowerCase().replace(/\s+/g, '_');
    const exactMatch = RETURNPRIME_REASON_MAP[normalized];
    if (exactMatch) return exactMatch;

    // 2. Skip generic values
    if (normalized === 'others' || normalized === 'na') return 'other';

    // 3. Try keyword classification (for free-text customer comments)
    return classifyComment(trimmed);
}
