/**
 * Shared AG-Grid helpers, theme configuration, and formatters
 * Consolidates common patterns across all grid components
 */

import { themeQuartz } from 'ag-grid-community';

// Standard compact theme for all AG-Grid instances
export const compactTheme = themeQuartz.withParams({
    spacing: 4,
    fontSize: 12,
    headerFontSize: 12,
    rowHeight: 32,
    headerHeight: 36,
});

// Slightly smaller theme for dense data tables
export const compactThemeSmall = themeQuartz.withParams({
    spacing: 4,
    fontSize: 12,
    headerFontSize: 12,
    rowHeight: 28,
    headerHeight: 32,
});

/**
 * Format date as "DD Mon" (e.g., "15 Jan")
 */
export function formatDate(date: string | Date | null | undefined): string {
    if (!date) return '-';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
    });
}

/**
 * Format date with year "DD Mon YYYY" (e.g., "15 Jan 2024")
 */
export function formatDateWithYear(date: string | Date | null | undefined): string {
    if (!date) return '-';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

/**
 * Format relative time (e.g., "5m ago", "2h ago", "3d ago")
 */
export function formatRelativeTime(date: string | Date | null | undefined): string {
    if (!date) return '-';
    const d = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
}

/**
 * Format currency in INR (e.g., "₹1,234")
 */
export function formatCurrency(amount: number | null | undefined): string {
    if (amount == null) return '-';
    return `₹${amount.toLocaleString('en-IN')}`;
}

/**
 * Generate tracking URL based on courier
 */
export function getTrackingUrl(awb: string, courier?: string): string | null {
    if (!awb) return null;
    const courierLower = (courier || '').toLowerCase();

    // Courier-specific tracking URLs
    if (courierLower.includes('delhivery')) {
        return `https://www.delhivery.com/track/package/${awb}`;
    }
    if (courierLower.includes('bluedart')) {
        return `https://www.bluedart.com/tracking/${awb}`;
    }
    if (courierLower.includes('ekart')) {
        return `https://ekartlogistics.com/track/${awb}`;
    }
    if (courierLower.includes('xpressbees')) {
        return `https://www.xpressbees.com/shipment/tracking?awb=${awb}`;
    }
    if (courierLower.includes('dtdc')) {
        return `https://www.dtdc.in/tracking.asp?strCnno=${awb}`;
    }
    if (courierLower.includes('ecom')) {
        return `https://www.ecomexpress.in/tracking/?awb=${awb}`;
    }
    // Default to iThink Logistics tracking
    return `https://www.ithinklogistics.com/tracking/${awb}`;
}

/**
 * Tracking status configurations for badges
 */
export const TRACKING_STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
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
 * Stock status configurations
 */
export const STOCK_STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
    'OK': { bg: 'bg-green-100', text: 'text-green-700', label: 'OK' },
    'ORDER SOON': { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Soon' },
    'ORDER NOW': { bg: 'bg-red-100', text: 'text-red-700', label: 'Order Now' },
    'ok': { bg: 'bg-green-100', text: 'text-green-700', label: 'OK' },
    'below_target': { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Low' },
};

/**
 * Default column definition for all grids
 */
export const defaultColDef = {
    sortable: true,
    resizable: true,
    suppressMovable: false,
};
