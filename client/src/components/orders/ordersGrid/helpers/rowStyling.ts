/**
 * Row styling utilities for OrdersGrid
 * Provides getRowStyle and getRowClass callbacks for AG-Grid
 */

import type { RowStyle } from 'ag-grid-community';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

/**
 * Get row style based on line status
 * Colors indicate workflow progress:
 * - Gray: Pending/blocked
 * - Amber: In production
 * - Green: Ready to allocate or shipped
 * - Purple: Allocated
 * - Teal: Picked
 * - Blue: Packed
 */
export function getRowStyle(params: { data: FlattenedOrderRow }): RowStyle | undefined {
    const row = params.data;
    if (!row) return undefined;

    // Cancelled - clearly struck through and grayed
    if (row.lineStatus === 'cancelled') {
        return {
            backgroundColor: '#f3f4f6',
            color: '#9ca3af',
            textDecoration: 'line-through',
            opacity: 0.6,
        };
    }

    // Shipped - DONE state, very distinct green with strikethrough
    if (row.lineStatus === 'shipped') {
        return {
            backgroundColor: '#bbf7d0',  // Green-200 - strong green
            textDecoration: 'line-through',
            borderLeft: '4px solid #10b981',  // Emerald-500
        };
    }

    // Packed - READY TO SHIP, bright distinct blue
    if (row.lineStatus === 'packed') {
        return {
            backgroundColor: '#dbeafe',  // Blue-100
            borderLeft: '4px solid #3b82f6',  // Blue-500
        };
    }

    // Picked - Ready to pack, teal tint
    if (row.lineStatus === 'picked') {
        return {
            backgroundColor: '#ccfbf1',  // Teal-100
            borderLeft: '4px solid #14b8a6',  // Teal-500
        };
    }

    // Allocated - Ready to pick, light purple
    if (row.lineStatus === 'allocated') {
        return {
            backgroundColor: '#f3e8ff',  // Purple-100
            borderLeft: '4px solid #a855f7',  // Purple-500
        };
    }

    // Customized lines in pending - special orange styling
    if (row.isCustomized && row.lineStatus === 'pending') {
        return {
            backgroundColor: '#fff7ed',  // Orange-50
            borderLeft: '4px solid #f97316',  // Orange-500
        };
    }

    // Pending with stock - actionable, subtle green tint
    const hasStock = row.skuStock >= row.qty;
    const isPending = row.lineStatus === 'pending';
    const hasProductionDate = !!row.productionBatchId;

    if (hasStock && isPending) {
        return {
            backgroundColor: '#f0fdf4',  // Green-50
            borderLeft: '4px solid #86efac',  // Green-300 (soft)
        };
    }

    // Pending without stock but has production date - amber
    if (hasProductionDate && isPending) {
        return {
            backgroundColor: '#fef3c7',  // Amber-100
            borderLeft: '4px solid #f59e0b',  // Amber-500
        };
    }

    // Pending without stock - blocked, dim/gray
    if (isPending && !hasStock) {
        return {
            backgroundColor: '#f9fafb',  // Gray-50
            color: '#6b7280',  // Gray-500
            borderLeft: '4px solid #d1d5db',  // Gray-300
        };
    }

    return undefined;
}

/**
 * Get row class for styling and order grouping
 * - Adds order-first-line or order-continuation-line class
 * - Adds urgency indicators (order-urgent, order-warning)
 */
export function getRowClass(params: { data: FlattenedOrderRow }): string {
    const row = params.data;
    if (!row) return '';

    const classes = [row.isFirstLine ? 'order-first-line' : 'order-continuation-line'];

    // Calculate order age for urgency indicator (only on first line to avoid repetition)
    if (row.isFirstLine && row.orderDate) {
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
`;
