/**
 * Status-to-style mappings for orders grid
 * Maps line statuses, tracking statuses, and other states to colors
 */

import { GRID_COLORS } from './colorPalette';
import type { GridColorStyle, StatusLegendItem, TailwindStyle } from './types';

/**
 * Line status styles (pending, allocated, picked, packed, shipped, cancelled)
 */
export const LINE_STATUS_STYLES = {
    pending: GRID_COLORS.neutralSoft,
    allocated: GRID_COLORS.purple,
    picked: GRID_COLORS.teal,
    packed: GRID_COLORS.info,
    shipped: GRID_COLORS.successStrong,
    cancelled: GRID_COLORS.neutral,
} as const satisfies Record<string, GridColorStyle>;

/**
 * Pending sub-states (based on inventory/production status)
 */
export const PENDING_SUBSTATUS_STYLES = {
    withStock: GRID_COLORS.successSoft,        // Has inventory, ready to allocate
    inProduction: GRID_COLORS.warning,          // Has production date
    blocked: GRID_COLORS.neutralSoft,           // No stock, no production date
    customized: GRID_COLORS.orangeSoft,         // Customized item pending
} as const satisfies Record<string, GridColorStyle>;

/**
 * Tracking status styles (in_transit, delivered, rto, etc.)
 */
export const TRACKING_STATUS_STYLES: Record<string, TailwindStyle & { label: string }> = {
    in_transit: { ...GRID_COLORS.info.tailwind, label: 'In Transit' },
    manifested: { ...GRID_COLORS.neutral.tailwind, label: 'Manifested' },
    picked_up: { ...GRID_COLORS.info.tailwind, label: 'Picked Up' },
    reached_destination: { ...GRID_COLORS.indigo.tailwind, label: 'At Hub' },
    out_for_delivery: { ...GRID_COLORS.warning.tailwind, label: 'Out for Delivery' },
    undelivered: { ...GRID_COLORS.danger.tailwind, label: 'NDR' },
    delivered: { ...GRID_COLORS.success.tailwind, label: 'Delivered' },
    delivery_delayed: { ...GRID_COLORS.warning.tailwind, label: 'Delayed' },
    rto_pending: { ...GRID_COLORS.danger.tailwind, label: 'RTO Pending' },
    rto_initiated: { ...GRID_COLORS.danger.tailwind, label: 'RTO' },
    rto_in_transit: { ...GRID_COLORS.orange.tailwind, label: 'RTO In Transit' },
    rto_delivered: { ...GRID_COLORS.purple.tailwind, label: 'RTO Received' },
    rto_received: { ...GRID_COLORS.purple.tailwind, label: 'RTO Received' },
    cancelled: { ...GRID_COLORS.neutral.tailwind, label: 'Cancelled' },
};

/**
 * Final order status styles (for archived/completed orders)
 */
export const FINAL_STATUS_STYLES: Record<string, TailwindStyle> = {
    delivered: GRID_COLORS.success.tailwind,
    rto_received: GRID_COLORS.purple.tailwind,
    cancelled: GRID_COLORS.danger.tailwind,
    returned: GRID_COLORS.orange.tailwind,
    shipped: GRID_COLORS.info.tailwind,
    in_transit: GRID_COLORS.sky.tailwind,
    out_for_delivery: GRID_COLORS.indigo.tailwind,
    rto_initiated: GRID_COLORS.orange.tailwind,
};

/**
 * Stock status styles
 */
export const STOCK_STATUS_STYLES: Record<string, TailwindStyle & { label: string }> = {
    'OK': { ...GRID_COLORS.success.tailwind, label: 'OK' },
    'ok': { ...GRID_COLORS.success.tailwind, label: 'OK' },
    'ORDER SOON': { ...GRID_COLORS.warning.tailwind, label: 'Soon' },
    'below_target': { ...GRID_COLORS.warning.tailwind, label: 'Low' },
    'ORDER NOW': { ...GRID_COLORS.danger.tailwind, label: 'Order Now' },
};

/**
 * Customer tier styles
 */
export const TIER_STYLES: Record<string, TailwindStyle & { label: string }> = {
    NEW: { ...GRID_COLORS.slate.tailwind, label: 'NEW' },
    bronze: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Bronze' },
    silver: { ...GRID_COLORS.slateStrong.tailwind, label: 'Silver' },
    gold: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Gold' },
    platinum: { ...GRID_COLORS.purple.tailwind, label: 'Platinum' },
};

/**
 * Payment method styles
 */
export const PAYMENT_STYLES = {
    cod: GRID_COLORS.orange.tailwind,
    prepaid: GRID_COLORS.success.tailwind,
} as const;

/**
 * Status legend items for the StatusLegend component
 */
export const STATUS_LEGEND_ITEMS: StatusLegendItem[] = [
    { color: '#f9fafb', border: '#d1d5db', label: 'Pending (no stock)', desc: 'Waiting for inventory' },
    { color: '#fef3c7', border: '#f59e0b', label: 'In Production', desc: 'Has production date set' },
    { color: '#f0fdf4', border: '#86efac', label: 'Ready to Allocate', desc: 'Has stock available' },
    { color: '#f3e8ff', border: '#a855f7', label: 'Allocated', desc: 'Stock reserved' },
    { color: '#ccfbf1', border: '#14b8a6', label: 'Picked', desc: 'Ready to pack' },
    { color: '#dbeafe', border: '#3b82f6', label: 'Packed', desc: 'Ready to ship - enter AWB' },
    { color: '#bbf7d0', border: '#10b981', label: 'Marked Shipped', desc: 'Pending batch process' },
];

/**
 * Get Tailwind classes for a line status
 */
export function getLineStatusClasses(status: string): string {
    const style = LINE_STATUS_STYLES[status as keyof typeof LINE_STATUS_STYLES];
    if (!style) return '';
    return `${style.tailwind.bg} ${style.tailwind.text}`;
}

/**
 * Get Tailwind classes for a tracking status
 */
export function getTrackingStatusClasses(status: string): string {
    const style = TRACKING_STATUS_STYLES[status];
    if (!style) return `${GRID_COLORS.neutral.tailwind.bg} ${GRID_COLORS.neutral.tailwind.text}`;
    return `${style.bg} ${style.text}`;
}

/**
 * Get Tailwind classes for a final status badge
 */
export function getFinalStatusClasses(status: string): string {
    const style = FINAL_STATUS_STYLES[status];
    if (!style) return `${GRID_COLORS.neutral.tailwind.bg} ${GRID_COLORS.neutral.tailwind.text}`;
    return `${style.bg} ${style.text}`;
}

/**
 * Get tracking status label
 */
export function getTrackingStatusLabel(status: string): string {
    return TRACKING_STATUS_STYLES[status]?.label || status;
}
