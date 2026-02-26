/**
 * Return Prime Line Matching Algorithm
 *
 * Matches Return Prime line items to COH-ERP OrderLines.
 * Priority:
 * 1. Match by shopify_line_id (exact match)
 * 2. Match by SKU code (only if single unambiguous match)
 */

import type { ReturnPrimeLineItem } from '@coh/shared/schemas';

/**
 * OrderLine shape required for matching
 */
export interface OrderLineForMatching {
    id: string;
    shopifyLineId: string | null;
    skuId: string;
    qty: number;
    returnStatus: string | null;
    sku: { skuCode: string };
}

/**
 * A successful match between RP line and COH-ERP OrderLine
 */
export interface MatchedLine {
    orderLine: OrderLineForMatching;
    rpLine: ReturnPrimeLineItem;
}

/**
 * Result of the matching algorithm
 */
export interface MatchResult {
    /** Successfully matched lines */
    matched: MatchedLine[];
    /** RP lines that couldn't be matched */
    unmatched: ReturnPrimeLineItem[];
    /** OrderLines that already have an active return */
    alreadyReturning: OrderLineForMatching[];
}

/**
 * Return statuses that indicate a line is already in the return process
 */
const ACTIVE_RETURN_STATUSES = [
    'requested',
    'approved',
    'inspected',
];

/**
 * Return statuses that indicate a return is complete/inactive
 */
const INACTIVE_RETURN_STATUSES = [
    'cancelled',
    'refunded',
    'archived',
    'rejected',
];

/**
 * Matches Return Prime line items to COH-ERP order lines.
 *
 * Matching priority:
 * 1. Match by shopify_line_id (exact match, most reliable)
 * 2. Match by SKU code (fallback, only if unambiguous)
 *
 * Lines with active returns are excluded from matching.
 *
 * @param rpLines - Line items from Return Prime webhook
 * @param orderLines - OrderLines from the order in COH-ERP
 * @returns MatchResult with matched, unmatched, and already-returning lines
 */
export function matchReturnPrimeLinesToOrderLines(
    rpLines: ReturnPrimeLineItem[],
    orderLines: OrderLineForMatching[]
): MatchResult {
    const matched: MatchedLine[] = [];
    const unmatched: ReturnPrimeLineItem[] = [];
    const alreadyReturning: OrderLineForMatching[] = [];
    const usedOrderLineIds = new Set<string>();

    // Filter out lines already in return process
    const availableLines = orderLines.filter(ol => {
        const hasActiveReturn = ol.returnStatus &&
            ACTIVE_RETURN_STATUSES.includes(ol.returnStatus) &&
            !INACTIVE_RETURN_STATUSES.includes(ol.returnStatus);

        if (hasActiveReturn) {
            alreadyReturning.push(ol);
            return false;
        }
        return true;
    });

    for (const rpLine of rpLines) {
        let match: OrderLineForMatching | undefined;

        // Priority 1: Match by Shopify Line ID (most reliable)
        if (rpLine.shopify_line_id) {
            match = availableLines.find(ol =>
                ol.shopifyLineId === rpLine.shopify_line_id &&
                !usedOrderLineIds.has(ol.id)
            );
        }

        // Priority 2: Match by SKU code (only if single unambiguous match)
        if (!match && rpLine.sku) {
            const skuMatches = availableLines.filter(ol =>
                ol.sku.skuCode === rpLine.sku &&
                !usedOrderLineIds.has(ol.id)
            );

            // Only use SKU match if unambiguous (single match)
            // Multiple matches = ambiguous, skip to avoid wrong line
            if (skuMatches.length === 1) {
                match = skuMatches[0];
            }
        }

        if (match) {
            // Validate quantity doesn't exceed line qty
            // If RP claims more than we have, cap at line qty
            const effectiveQty = Math.min(rpLine.quantity, match.qty);

            matched.push({
                orderLine: match,
                rpLine: { ...rpLine, quantity: effectiveQty },
            });
            usedOrderLineIds.add(match.id);
        } else {
            unmatched.push(rpLine);
        }
    }

    return { matched, unmatched, alreadyReturning };
}

/**
 * Validates that all required lines were matched.
 * Returns true if all RP lines were matched successfully.
 */
export function allLinesMatched(result: MatchResult): boolean {
    return result.unmatched.length === 0;
}

/**
 * Gets a summary string describing the match result.
 * Useful for logging.
 */
export function getMatchSummary(result: MatchResult): string {
    const parts: string[] = [];

    if (result.matched.length > 0) {
        parts.push(`${result.matched.length} matched`);
    }
    if (result.unmatched.length > 0) {
        parts.push(`${result.unmatched.length} unmatched`);
    }
    if (result.alreadyReturning.length > 0) {
        parts.push(`${result.alreadyReturning.length} already returning`);
    }

    return parts.join(', ') || 'no lines';
}
