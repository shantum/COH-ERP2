/**
 * RTO Status Enrichment
 * Calculate RTO status and days in RTO
 */

import { calculateDaysSince } from './trackingStatus.js';

/**
 * RTO status result
 */
export interface RtoStatusResult {
    rtoStatus: 'received' | 'in_transit';
    daysInRto: number;
}

/**
 * Calculate RTO status for an order
 */
export function calculateRtoStatus(
    trackingStatus: string | null | undefined,
    rtoInitiatedAt: Date | string | null | undefined,
    rtoReceivedAt: Date | string | null | undefined
): RtoStatusResult {
    const isReceived = trackingStatus === 'rto_delivered' || !!rtoReceivedAt;
    return {
        rtoStatus: isReceived ? 'received' : 'in_transit',
        daysInRto: calculateDaysSince(rtoInitiatedAt),
    };
}
