/**
 * Shared grid formatting utilities
 * Used by OrdersTable, TrackingStatusBadge, StatusBadge, and other components
 */

/**
 * Style configuration for Tailwind-based styling (cells, badges)
 */
export interface TailwindStyle {
    bg: string;      // Tailwind background class (e.g., 'bg-green-100')
    text: string;    // Tailwind text class (e.g., 'text-green-700')
    border?: string; // Optional Tailwind border class
}

/**
 * Style configuration for CSS-based styling (rows)
 * Uses hex colors for AG-Grid's getRowStyle which needs CSSProperties
 */
export interface CSSStyle {
    background: string;  // Hex color (e.g., '#f0fdf4')
    border: string;      // Hex color for left border (e.g., '#86efac')
    text?: string;       // Optional hex text color
}

/**
 * Combined style with both Tailwind and CSS representations
 */
export interface GridColorStyle {
    tailwind: TailwindStyle;
    css: CSSStyle;
}

/**
 * Legend item for status indicators
 */
export interface StatusLegendItem {
    color: string;   // Background hex color
    border: string;  // Border hex color
    label: string;   // Display label
    desc: string;    // Description
}

/**
 * Core semantic colors used throughout the grid
 * Named by meaning, not by color (e.g., 'success' not 'green')
 */
export const GRID_COLORS = {
    // Status colors
    success: {
        tailwind: { bg: 'bg-green-100', text: 'text-green-700' },
        css: { background: '#dcfce7', border: '#10b981' },
    },
    successStrong: {
        tailwind: { bg: 'bg-green-200', text: 'text-green-800' },
        css: { background: '#bbf7d0', border: '#10b981' },
    },
    successSoft: {
        tailwind: { bg: 'bg-green-50', text: 'text-green-600' },
        css: { background: '#f0fdf4', border: '#86efac' },
    },

    warning: {
        tailwind: { bg: 'bg-amber-100', text: 'text-amber-700' },
        css: { background: '#fef3c7', border: '#f59e0b' },
    },
    warningSoft: {
        tailwind: { bg: 'bg-amber-50', text: 'text-amber-600' },
        css: { background: '#fffbeb', border: '#fcd34d' },
    },

    danger: {
        tailwind: { bg: 'bg-red-100', text: 'text-red-700' },
        css: { background: '#fee2e2', border: '#ef4444' },
    },
    dangerStrong: {
        tailwind: { bg: 'bg-red-200', text: 'text-red-800' },
        css: { background: '#fecaca', border: '#dc2626' },
    },

    info: {
        tailwind: { bg: 'bg-blue-100', text: 'text-blue-700' },
        css: { background: '#dbeafe', border: '#3b82f6' },
    },

    neutral: {
        tailwind: { bg: 'bg-gray-100', text: 'text-gray-700' },
        css: { background: '#f3f4f6', border: '#9ca3af' },
    },
    neutralSoft: {
        tailwind: { bg: 'bg-gray-50', text: 'text-gray-500' },
        css: { background: '#f9fafb', border: '#d1d5db' },
    },

    // Workflow-specific colors
    purple: {
        tailwind: { bg: 'bg-purple-100', text: 'text-purple-700' },
        css: { background: '#f3e8ff', border: '#a855f7' },
    },

    teal: {
        tailwind: { bg: 'bg-teal-100', text: 'text-teal-700' },
        css: { background: '#ccfbf1', border: '#14b8a6' },
    },

    orange: {
        tailwind: { bg: 'bg-orange-100', text: 'text-orange-700' },
        css: { background: '#ffedd5', border: '#f97316' },
    },
    orangeSoft: {
        tailwind: { bg: 'bg-orange-50', text: 'text-orange-600' },
        css: { background: '#fff7ed', border: '#f97316' },
    },

    indigo: {
        tailwind: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
        css: { background: '#e0e7ff', border: '#6366f1' },
    },

    sky: {
        tailwind: { bg: 'bg-sky-100', text: 'text-sky-700' },
        css: { background: '#e0f2fe', border: '#0ea5e9' },
    },

    slate: {
        tailwind: { bg: 'bg-slate-100', text: 'text-slate-700' },
        css: { background: '#f1f5f9', border: '#64748b' },
    },
    slateStrong: {
        tailwind: { bg: 'bg-slate-200', text: 'text-slate-700' },
        css: { background: '#e2e8f0', border: '#475569' },
    },
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
 * Get Tailwind classes for a tracking status
 */
export function getTrackingStatusClasses(status: string): string {
    const style = TRACKING_STATUS_STYLES[status];
    if (!style) return `${GRID_COLORS.neutral.tailwind.bg} ${GRID_COLORS.neutral.tailwind.text}`;
    return `${style.bg} ${style.text}`;
}

/**
 * Get tracking status label
 */
export function getTrackingStatusLabel(status: string): string {
    return TRACKING_STATUS_STYLES[status]?.label || status;
}

/**
 * Get Tailwind classes for a final status badge
 */
export function getFinalStatusClasses(status: string): string {
    const style = FINAL_STATUS_STYLES[status];
    if (!style) return `${GRID_COLORS.neutral.tailwind.bg} ${GRID_COLORS.neutral.tailwind.text}`;
    return `${style.bg} ${style.text}`;
}
