/**
 * Row & cell styling utilities for OrdersTable (Tailwind version)
 *
 * Provides:
 * - resolveLineState(): canonical state for a row (called once per row)
 * - getRowClassName(): TR-level borders + text effects (no backgrounds)
 * - getCellBackground(): per-cell waterfall highlight (O(1) per call)
 * - getCellClassName(): status-based text color for specific columns
 *
 * All color tokens live in ./styleConfig.ts — edit there to change colors.
 */

import type { FlattenedOrderRow } from '../../../utils/orderHelpers';
import {
    FIRST_LINE_CLASS,
    CELL_STATUS_TEXT,
    ROW_TR_STYLES,
    LINE_CELL_BG,
    LINE_HIGHLIGHT_CONFIG,
    ORDER_INFO_ZONE,
    type ResolvedLineState,
    // Re-export everything from styleConfig so existing imports keep working
    TRACKING_STATUS_STYLES,
    PAYMENT_STYLES,
    STATUS_LEGEND_ITEMS,
} from './styleConfig';

// Re-export for consumers that import from this file
export { TRACKING_STATUS_STYLES, PAYMENT_STYLES, STATUS_LEGEND_ITEMS };
export type { ResolvedLineState };

/** Line states eligible for order-info column highlighting */
const ORDER_INFO_ELIGIBLE: Set<ResolvedLineState> = new Set(['allocated', 'picked', 'packed']);

/** Resolve a row to its canonical line state (called once per row) */
export function resolveLineState(row: FlattenedOrderRow): ResolvedLineState {
    const lineStatus = row.lineStatus || '';

    // Terminal states
    if (lineStatus === 'cancelled') return 'cancelled';
    if (lineStatus === 'shipped') return 'shipped';

    // Active fulfillment states
    if (lineStatus === 'packed') return 'packed';
    if (lineStatus === 'picked') return 'picked';
    if (lineStatus === 'allocated') return 'allocated';

    // Pending substates
    if (row.isCustomized) return 'customized';
    if (row.skuStock >= row.qty) return 'withStock';
    if (row.productionBatchId) return 'inProduction';
    return 'blocked';
}

/** Get TR-level className (borders + text effects only, no backgrounds) */
export function getRowClassName(row: FlattenedOrderRow): string {
    const baseClass = row.isFirstLine ? FIRST_LINE_CLASS + ' ' : '';
    const state = resolveLineState(row);
    return baseClass + ROW_TR_STYLES[state];
}

/**
 * Get cell background class based on column index + row state (O(1) per call).
 *
 * The waterfall highlights progressively more columns as the line advances
 * through the fulfillment workflow, creating a visual "wave" effect.
 *
 * @param allAllocated - client-computed: are ALL lines in this order at least allocated?
 */
export function getCellBackground(
    columnIndex: number,
    resolvedState: ResolvedLineState,
    allAllocated: boolean,
): string {
    // Check if this column is in the line's highlight zone
    const zone = LINE_HIGHLIGHT_CONFIG[resolvedState];
    if (zone.has(columnIndex)) {
        return LINE_CELL_BG[resolvedState];
    }

    // Order-info columns highlight only when ALL lines in the order are at least allocated
    // (computed client-side, not trusting server fulfillmentStage)
    if (
        allAllocated &&
        ORDER_INFO_ELIGIBLE.has(resolvedState) &&
        ORDER_INFO_ZONE.has(columnIndex)
    ) {
        return LINE_CELL_BG[resolvedState];
    }

    return '';
}

/** Get cell className based on status for specific columns */
export function getCellClassName(status: string | null | undefined): string {
    if (!status) return '';
    return (CELL_STATUS_TEXT as Record<string, string>)[status] || '';
}
