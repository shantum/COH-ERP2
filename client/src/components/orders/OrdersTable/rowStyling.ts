/**
 * Row & cell styling utilities for OrdersTable (Tailwind version)
 *
 * Provides:
 * - resolveLineState(): canonical state for a row (called once per row)
 * - getRowClassName(): TR-level borders + text effects (no backgrounds)
 *
 * All color tokens live in ./styleConfig.ts — edit there to change colors.
 */

import type { FlattenedOrderRow } from '../../../utils/orderHelpers';
import {
    FIRST_LINE_CLASS,
    ROW_TR_STYLES,
    type ResolvedLineState,
    // Re-export everything from styleConfig so existing imports keep working
    TRACKING_STATUS_STYLES,
    PAYMENT_STYLES,
    STATUS_LEGEND_ITEMS,
} from './styleConfig';

// Re-export for consumers that import from this file
export { TRACKING_STATUS_STYLES, PAYMENT_STYLES, STATUS_LEGEND_ITEMS };
export type { ResolvedLineState };

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
