/**
 * Row styling utilities for OrdersTable (Tailwind version)
 * Provides getRowClassName function for TanStack Table rows
 */

import type { FlattenedOrderRow } from '../../../utils/orderHelpers';

/**
 * Line status to Tailwind class mappings
 */
const LINE_STATUS_CLASSES = {
    shipped: 'bg-green-200 line-through border-l-4 border-l-green-500',
    packed: 'bg-blue-100 border-l-4 border-l-blue-500',
    picked: 'bg-teal-100 border-l-4 border-l-teal-500',
    allocated: 'bg-purple-100 border-l-4 border-l-purple-500',
    cancelled: 'bg-gray-100 text-gray-400 line-through opacity-60',
} as const;

/**
 * Pending substate to Tailwind class mappings
 */
const PENDING_SUBSTATE_CLASSES = {
    customized: 'bg-orange-50 border-l-4 border-l-orange-500',
    withStock: 'bg-green-50 border-l-4 border-l-green-300',
    inProduction: 'bg-amber-100 border-l-4 border-l-amber-500',
    blocked: 'bg-gray-50 text-gray-500 border-l-4 border-l-gray-300',
} as const;

/**
 * Get row className based on order line data
 * Used with TanStack Table to apply styling to rows
 */
export function getRowClassName(row: FlattenedOrderRow): string {
    const lineStatus = row.lineStatus || '';

    // Build class string directly - avoid array operations for performance
    let baseClass = row.isFirstLine ? 'border-t border-gray-200 ' : '';

    // Terminal states - return immediately
    if (lineStatus === 'cancelled') {
        return baseClass + LINE_STATUS_CLASSES.cancelled;
    }

    if (lineStatus === 'shipped') {
        return baseClass + LINE_STATUS_CLASSES.shipped;
    }

    // Active fulfillment states
    if (lineStatus === 'packed') {
        return baseClass + LINE_STATUS_CLASSES.packed;
    }

    if (lineStatus === 'picked') {
        return baseClass + LINE_STATUS_CLASSES.picked;
    }

    if (lineStatus === 'allocated') {
        return baseClass + LINE_STATUS_CLASSES.allocated;
    }

    // Pending state - check substates
    if (lineStatus === 'pending') {
        if (row.isCustomized) {
            return baseClass + PENDING_SUBSTATE_CLASSES.customized;
        }

        if (row.skuStock >= row.qty) {
            return baseClass + PENDING_SUBSTATE_CLASSES.withStock;
        }

        if (row.productionBatchId) {
            return baseClass + PENDING_SUBSTATE_CLASSES.inProduction;
        }

        return baseClass + PENDING_SUBSTATE_CLASSES.blocked;
    }

    // Default - no special styling
    return baseClass.trim();
}

/**
 * Get cell className based on status for specific columns
 * Used for cells that need status-based styling
 */
export function getCellClassName(status: string | null | undefined): string {
    switch (status) {
        case 'shipped':
            return 'text-green-700';
        case 'packed':
            return 'text-blue-700';
        case 'picked':
            return 'text-teal-700';
        case 'allocated':
            return 'text-purple-700';
        case 'cancelled':
            return 'text-gray-400 line-through';
        default:
            return '';
    }
}

/**
 * Status legend items for display
 */
export const STATUS_LEGEND_ITEMS = [
    { color: 'bg-gray-50', border: 'border-gray-300', label: 'Pending (no stock)', desc: 'Waiting for inventory' },
    { color: 'bg-amber-100', border: 'border-amber-500', label: 'In Production', desc: 'Has production date set' },
    { color: 'bg-green-50', border: 'border-green-300', label: 'Ready to Allocate', desc: 'Has stock available' },
    { color: 'bg-purple-100', border: 'border-purple-500', label: 'Allocated', desc: 'Stock reserved' },
    { color: 'bg-teal-100', border: 'border-teal-500', label: 'Picked', desc: 'Ready to pack' },
    { color: 'bg-blue-100', border: 'border-blue-500', label: 'Packed', desc: 'Ready to ship - enter AWB' },
    { color: 'bg-green-200', border: 'border-green-500', label: 'Marked Shipped', desc: 'Pending batch process' },
] as const;

/**
 * Tracking status styles (for badges)
 */
export const TRACKING_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
    in_transit: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Transit' },
    manifested: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Manifested' },
    picked_up: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Picked Up' },
    reached_destination: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'At Hub' },
    out_for_delivery: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Out for Delivery' },
    undelivered: { bg: 'bg-red-100', text: 'text-red-700', label: 'NDR' },
    delivered: { bg: 'bg-green-100', text: 'text-green-700', label: 'Delivered' },
    delivery_delayed: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Delayed' },
    rto_pending: { bg: 'bg-red-100', text: 'text-red-700', label: 'RTO Pending' },
    rto_initiated: { bg: 'bg-red-100', text: 'text-red-700', label: 'RTO' },
    rto_in_transit: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'RTO In Transit' },
    rto_delivered: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'RTO Received' },
    rto_received: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'RTO Received' },
    cancelled: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Cancelled' },
};

/**
 * Payment method styles (for badges)
 */
export const PAYMENT_STYLES = {
    cod: { bg: 'bg-orange-100', text: 'text-orange-700' },
    prepaid: { bg: 'bg-green-100', text: 'text-green-700' },
} as const;
