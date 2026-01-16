/**
 * Row styling utilities for AG-Grid
 * Provides getRowStyle and getRowClass callbacks
 *
 * PERFORMANCE: All style objects are pre-defined constants to avoid
 * creating new objects on every render. AG-Grid can cache these references.
 */

import type { RowStyle } from 'ag-grid-community';
import type { RowStyleFn, RowClassFn } from './types';
import {
    LINE_STATUS_STYLES,
    PENDING_SUBSTATUS_STYLES,
} from './statusStyles';
import { URGENCY_COLORS, ROW_EFFECT_COLORS } from './colorPalette';

/**
 * Pre-computed row style objects
 * Using constants prevents AG-Grid from seeing "new" objects on every render
 */
const ROW_STYLES = {
    cancelled: {
        backgroundColor: ROW_EFFECT_COLORS.cancelled.background,
        color: ROW_EFFECT_COLORS.cancelled.text,
        textDecoration: 'line-through',
        opacity: 0.6,
    } as RowStyle,

    shipped: {
        backgroundColor: LINE_STATUS_STYLES.shipped.css.background,
        textDecoration: 'line-through',
        borderLeft: `4px solid ${LINE_STATUS_STYLES.shipped.css.border}`,
    } as RowStyle,

    packed: {
        backgroundColor: LINE_STATUS_STYLES.packed.css.background,
        borderLeft: `4px solid ${LINE_STATUS_STYLES.packed.css.border}`,
    } as RowStyle,

    picked: {
        backgroundColor: LINE_STATUS_STYLES.picked.css.background,
        borderLeft: `4px solid ${LINE_STATUS_STYLES.picked.css.border}`,
    } as RowStyle,

    allocated: {
        backgroundColor: LINE_STATUS_STYLES.allocated.css.background,
        borderLeft: `4px solid ${LINE_STATUS_STYLES.allocated.css.border}`,
    } as RowStyle,

    customizedPending: {
        backgroundColor: PENDING_SUBSTATUS_STYLES.customized.css.background,
        borderLeft: `4px solid ${PENDING_SUBSTATUS_STYLES.customized.css.border}`,
    } as RowStyle,

    pendingWithStock: {
        backgroundColor: PENDING_SUBSTATUS_STYLES.withStock.css.background,
        borderLeft: `4px solid ${PENDING_SUBSTATUS_STYLES.withStock.css.border}`,
    } as RowStyle,

    pendingInProduction: {
        backgroundColor: PENDING_SUBSTATUS_STYLES.inProduction.css.background,
        borderLeft: `4px solid ${PENDING_SUBSTATUS_STYLES.inProduction.css.border}`,
    } as RowStyle,

    pendingBlocked: {
        backgroundColor: PENDING_SUBSTATUS_STYLES.blocked.css.background,
        color: '#6b7280',
        borderLeft: `4px solid ${PENDING_SUBSTATUS_STYLES.blocked.css.border}`,
    } as RowStyle,
} as const;

/**
 * Get row style based on line status
 * Returns pre-defined constant objects for AG-Grid caching.
 */
export const getRowStyle: RowStyleFn = (params) => {
    const row = params.data;
    if (!row) return undefined;

    // Cancelled - clearly struck through and grayed
    if (row.lineStatus === 'cancelled') {
        return ROW_STYLES.cancelled;
    }

    // Shipped - DONE state, very distinct green with strikethrough
    if (row.lineStatus === 'shipped') {
        return ROW_STYLES.shipped;
    }

    // Packed - READY TO SHIP, bright distinct blue
    if (row.lineStatus === 'packed') {
        return ROW_STYLES.packed;
    }

    // Picked - Ready to pack, teal tint
    if (row.lineStatus === 'picked') {
        return ROW_STYLES.picked;
    }

    // Allocated - Ready to pick, light purple
    if (row.lineStatus === 'allocated') {
        return ROW_STYLES.allocated;
    }

    // Customized lines in pending - special orange styling
    if (row.isCustomized && row.lineStatus === 'pending') {
        return ROW_STYLES.customizedPending;
    }

    // Pending substates
    const hasStock = row.skuStock >= row.qty;
    const isPending = row.lineStatus === 'pending';
    const hasProductionDate = !!row.productionBatchId;

    if (hasStock && isPending) {
        return ROW_STYLES.pendingWithStock;
    }

    if (hasProductionDate && isPending) {
        return ROW_STYLES.pendingInProduction;
    }

    if (isPending && !hasStock) {
        return ROW_STYLES.pendingBlocked;
    }

    return undefined;
};

/**
 * Get row class for styling and order grouping
 */
export const getRowClass: RowClassFn = (params) => {
    const row = params.data;
    if (!row) return '';

    const classes = [row.isFirstLine ? 'order-first-line' : 'order-continuation-line'];

    // Line status classes
    if (row.lineStatus === 'shipped') {
        classes.push('line-shipped');
    } else if (row.lineStatus === 'cancelled') {
        classes.push('line-cancelled');
    }

    // Urgency indicator (only on first line, not on shipped/cancelled)
    const lineStatus = row.lineStatus || '';
    if (row.isFirstLine && row.orderDate && !['shipped', 'cancelled'].includes(lineStatus)) {
        const orderDate = new Date(row.orderDate);
        const daysOld = Math.floor((Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysOld > 5) {
            classes.push('order-urgent');
        } else if (daysOld >= 3) {
            classes.push('order-warning');
        }
    }

    return classes.join(' ');
};

/**
 * CSS styles for grid rows
 * Include this in the grid component via a <style> tag
 */
export const gridRowStyles = `
    /* Hide all row bottom borders by default */
    .ag-row {
        border-bottom-color: transparent !important;
    }
    /* Show border only on first line of each order */
    .ag-row.order-first-line {
        border-top: 1px solid #e5e7eb !important;
    }
    /* First row in grid doesn't need top border */
    .ag-row.order-first-line[row-index="0"] {
        border-top-color: transparent !important;
    }
    /* Order age urgency indicators */
    .ag-row.order-urgent {
        border-left: 4px solid ${URGENCY_COLORS.urgent} !important;
    }
    .ag-row.order-warning {
        border-left: 4px solid ${URGENCY_COLORS.warning} !important;
    }
    /* Line shipped styling */
    .ag-row.line-shipped {
        background-color: ${ROW_EFFECT_COLORS.shipped.background} !important;
    }
    .ag-row.line-shipped .ag-cell {
        text-decoration: line-through;
        color: ${ROW_EFFECT_COLORS.shipped.cssText} !important;
    }
    /* Line cancelled styling */
    .ag-row.line-cancelled {
        background-color: ${ROW_EFFECT_COLORS.cancelled.background} !important;
    }
    .ag-row.line-cancelled .ag-cell {
        text-decoration: line-through;
        color: ${ROW_EFFECT_COLORS.cancelled.cssText} !important;
    }
`;

/**
 * Export pre-computed styles for external use if needed
 */
export { ROW_STYLES };
