/**
 * Row styling utilities for OrdersGrid
 * Provides getRowStyle and getRowClass callbacks for AG-Grid
 *
 * PERFORMANCE: All style objects are pre-defined constants to avoid
 * creating new objects on every render. AG-Grid can cache these references.
 */

import type { RowStyle } from 'ag-grid-community';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

/**
 * Pre-defined style objects for each line status
 * Using constants prevents AG-Grid from seeing "new" objects on every render
 */
const STYLES = {
    cancelled: {
        backgroundColor: '#f3f4f6',
        color: '#9ca3af',
        textDecoration: 'line-through',
        opacity: 0.6,
    } as RowStyle,

    shipped: {
        backgroundColor: '#bbf7d0',  // Green-200 - strong green
        textDecoration: 'line-through',
        borderLeft: '4px solid #10b981',  // Emerald-500
    } as RowStyle,

    packed: {
        backgroundColor: '#dbeafe',  // Blue-100
        borderLeft: '4px solid #3b82f6',  // Blue-500
    } as RowStyle,

    picked: {
        backgroundColor: '#ccfbf1',  // Teal-100
        borderLeft: '4px solid #14b8a6',  // Teal-500
    } as RowStyle,

    allocated: {
        backgroundColor: '#f3e8ff',  // Purple-100
        borderLeft: '4px solid #a855f7',  // Purple-500
    } as RowStyle,

    customizedPending: {
        backgroundColor: '#fff7ed',  // Orange-50
        borderLeft: '4px solid #f97316',  // Orange-500
    } as RowStyle,

    pendingWithStock: {
        backgroundColor: '#f0fdf4',  // Green-50
        borderLeft: '4px solid #86efac',  // Green-300 (soft)
    } as RowStyle,

    pendingInProduction: {
        backgroundColor: '#fef3c7',  // Amber-100
        borderLeft: '4px solid #f59e0b',  // Amber-500
    } as RowStyle,

    pendingBlocked: {
        backgroundColor: '#f9fafb',  // Gray-50
        color: '#6b7280',  // Gray-500
        borderLeft: '4px solid #d1d5db',  // Gray-300
    } as RowStyle,
} as const;

/**
 * Get row style based on line status
 * Colors indicate workflow progress:
 * - Gray: Pending/blocked
 * - Amber: In production
 * - Green: Ready to allocate or shipped
 * - Purple: Allocated
 * - Teal: Picked
 * - Blue: Packed
 *
 * PERFORMANCE: Returns pre-defined constant objects, not new objects.
 */
export function getRowStyle(params: { data?: FlattenedOrderRow }): RowStyle | undefined {
    const row = params.data;
    if (!row) return undefined;

    // Cancelled - clearly struck through and grayed
    if (row.lineStatus === 'cancelled') {
        return STYLES.cancelled;
    }

    // Shipped - DONE state, very distinct green with strikethrough
    if (row.lineStatus === 'shipped') {
        return STYLES.shipped;
    }

    // Packed - READY TO SHIP, bright distinct blue
    if (row.lineStatus === 'packed') {
        return STYLES.packed;
    }

    // Picked - Ready to pack, teal tint
    if (row.lineStatus === 'picked') {
        return STYLES.picked;
    }

    // Allocated - Ready to pick, light purple
    if (row.lineStatus === 'allocated') {
        return STYLES.allocated;
    }

    // Customized lines in pending - special orange styling
    if (row.isCustomized && row.lineStatus === 'pending') {
        return STYLES.customizedPending;
    }

    // Pending with stock - actionable, subtle green tint
    const hasStock = row.skuStock >= row.qty;
    const isPending = row.lineStatus === 'pending';
    const hasProductionDate = !!row.productionBatchId;

    if (hasStock && isPending) {
        return STYLES.pendingWithStock;
    }

    // Pending without stock but has production date - amber
    if (hasProductionDate && isPending) {
        return STYLES.pendingInProduction;
    }

    // Pending without stock - blocked, dim/gray
    if (isPending && !hasStock) {
        return STYLES.pendingBlocked;
    }

    return undefined;
}

/**
 * Get row class for styling and order grouping
 * - Adds order-first-line or order-continuation-line class
 * - Adds line status classes (line-shipped, line-cancelled)
 * - Adds urgency indicators (order-urgent, order-warning)
 */
export function getRowClass(params: { data?: FlattenedOrderRow }): string {
    const row = params.data;
    if (!row) return '';

    const classes = [row.isFirstLine ? 'order-first-line' : 'order-continuation-line'];

    // Line status classes (shipped takes priority, then cancelled)
    if (row.lineStatus === 'shipped') {
        classes.push('line-shipped');
    } else if (row.lineStatus === 'cancelled') {
        classes.push('line-cancelled');
    }

    // Calculate order age for urgency indicator (only on first line to avoid repetition)
    // Don't show urgency on shipped/cancelled lines
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
}

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
    /* Order age urgency indicators - red left border for orders > 5 days */
    .ag-row.order-urgent {
        border-left: 4px solid #ef4444 !important;
    }
    /* Amber left border for orders 3-5 days */
    .ag-row.order-warning {
        border-left: 4px solid #f59e0b !important;
    }
    /* Line marked as shipped - dark green background, strikethrough text */
    .ag-row.line-shipped {
        background-color: #dcfce7 !important;
    }
    .ag-row.line-shipped .ag-cell {
        text-decoration: line-through;
        color: #166534 !important;
    }
    /* Line cancelled - red background, strikethrough text */
    .ag-row.line-cancelled {
        background-color: #fee2e2 !important;
    }
    .ag-row.line-cancelled .ag-cell {
        text-decoration: line-through;
        color: #991b1b !important;
    }
`;
