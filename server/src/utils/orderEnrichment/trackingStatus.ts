/**
 * Tracking Status Enrichment
 * Calculate days since dates and determine tracking status
 */

import type { OrderForTrackingStatus } from './types.js';

/**
 * Calculate days since a date
 */
export function calculateDaysSince(sinceDate: Date | string | null | undefined): number {
    if (!sinceDate) return 0;
    return Math.floor((Date.now() - new Date(sinceDate).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Determine tracking status for an order (fallback when not in DB)
 */
export function determineTrackingStatus(
    order: OrderForTrackingStatus,
    daysInTransit: number
): string {
    if (order.trackingStatus) return order.trackingStatus;

    if (order.rtoReceivedAt) return 'rto_received';
    if (order.rtoInitiatedAt) return 'rto_initiated';
    if (order.status === 'delivered' || order.deliveredAt) return 'delivered';
    if (daysInTransit > 7) return 'delivery_delayed';
    return 'in_transit';
}
