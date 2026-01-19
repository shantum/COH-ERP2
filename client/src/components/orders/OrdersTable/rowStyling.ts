/**
 * Row styling utilities for OrdersTable (Tailwind version)
 * Provides getRowClassName function for TanStack Table rows
 *
 * Uses green gradient to match workflow progression:
 * Allocated (light) → Picked → Packed → Shipped (dark)
 */

import type { FlattenedOrderRow } from '../../../utils/orderHelpers';

/**
 * Line status to Tailwind class mappings
 * Muted green gradient: light → medium as workflow progresses
 */
const LINE_STATUS_CLASSES = {
    allocated: 'bg-emerald-50/50 border-l-4 border-l-emerald-200',
    picked: 'bg-emerald-50 border-l-4 border-l-emerald-300',
    packed: 'bg-emerald-100/70 border-l-4 border-l-emerald-400',
    shipped: 'bg-emerald-100 line-through border-l-4 border-l-emerald-500',
    cancelled: 'bg-gray-50 text-gray-400 line-through opacity-60',
} as const;

/**
 * Pending substate to Tailwind class mappings
 */
const PENDING_SUBSTATE_CLASSES = {
    customized: 'bg-orange-50/50 border-l-4 border-l-orange-300',
    withStock: 'bg-teal-50/50 border-l-4 border-l-teal-200',
    inProduction: 'bg-amber-50/50 border-l-4 border-l-amber-300',
    blocked: 'bg-white text-slate-500 border-l-4 border-l-slate-200',
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
            return 'text-green-600';
        case 'picked':
            return 'text-green-500';
        case 'allocated':
            return 'text-green-500';
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
    { color: 'bg-white', border: 'border-slate-200', label: 'Pending (no stock)', desc: 'Waiting for inventory' },
    { color: 'bg-amber-50/50', border: 'border-amber-300', label: 'In Production', desc: 'Has production date set' },
    { color: 'bg-teal-50/50', border: 'border-teal-200', label: 'Ready to Allocate', desc: 'Has stock available' },
    { color: 'bg-emerald-50/50', border: 'border-emerald-200', label: 'Allocated', desc: 'Stock reserved' },
    { color: 'bg-emerald-50', border: 'border-emerald-300', label: 'Picked', desc: 'Ready to pack' },
    { color: 'bg-emerald-100/70', border: 'border-emerald-400', label: 'Packed', desc: 'Ready to ship' },
    { color: 'bg-emerald-100', border: 'border-emerald-500', label: 'Shipped', desc: 'Awaiting tracking' },
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
