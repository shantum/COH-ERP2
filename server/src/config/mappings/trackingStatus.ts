/**
 * Tracking Status Mapping Configuration
 *
 * Maps courier status codes and text to internal tracking statuses.
 * Currently optimized for iThink Logistics but designed to be extensible.
 *
 * IMPORTANT RULE ORDER:
 * RTO states MUST be checked BEFORE regular delivered!
 * "RTO Delivered" should map to rto_delivered, not delivered.
 *
 * STATUS CODE REFERENCE (iThink):
 * - M: Manifested (order created)
 * - NP: Not Picked (pickup failed)
 * - PP: Picked Up
 * - IT/OT: In Transit
 * - RAD: Reached At Destination
 * - OFD: Out For Delivery
 * - UD/NDR: Undelivered (delivery attempt failed)
 * - DL: Delivered
 * - CA: Cancelled
 * - RTO/RTP/RTI/RTD: Return to Origin states
 * - RTOUD/RTOOFD: RTO substates
 * - REVP/REVI/REVD: Reverse logistics (customer returns)
 *
 * TO ADD A NEW STATUS MAPPING:
 * 1. Add entry to TRACKING_STATUS_RULES
 * 2. Set priority (100 = RTO, 90 = delivered, etc.)
 * 3. Add both codes (exact match) and textPatterns (contains match)
 */

import type { BaseMappingRule, TrackingStatus } from '../types.js';

// ============================================
// RULE DEFINITIONS
// ============================================

export interface StatusMappingRule extends BaseMappingRule {
    /** Status codes to match (case-insensitive, exact match) */
    codes: string[];
    /** Text patterns to match (case-insensitive, contains match) */
    textPatterns: string[];
    /** Text patterns that EXCLUDE this rule (negative match) */
    excludePatterns?: string[];
    /** Target tracking status */
    status: TrackingStatus;
}

/**
 * Tracking status mapping rules
 *
 * Rules are checked in priority order (highest first).
 * A rule matches if text patterns match (preferred) OR code matches (fallback).
 * Exclude patterns prevent matching.
 *
 * IMPORTANT: Text matching is prioritized over code matching because
 * status codes like "UD" are used by couriers for many different states
 * (Reached At Destination, Cancelled, In Transit, etc.)
 */
export const TRACKING_STATUS_RULES: StatusMappingRule[] = [
    // ========== CANCELLED (priority 110) - HIGHEST PRIORITY ==========
    // Check cancelled FIRST - cancel_status is checked separately in trackingSync
    {
        codes: ['CA', 'CANCELLED'],
        textPatterns: ['cancelled', 'shipment cancelled', 'order cancelled', 'cancel'],
        status: 'cancelled',
        priority: 110,
        description: 'Shipment cancelled',
    },

    // ========== RTO STATES (priority 100-99) ==========
    // RTO Delivered - package returned to seller
    {
        codes: ['RTD', 'RTOD'],
        textPatterns: ['rto delivered', 'rto received', 'returned to origin', 'rtod'],
        status: 'rto_delivered',
        priority: 100,
        description: 'RTO completed - package returned to seller',
    },
    // RTO In Transit - all other RTO states
    {
        codes: ['RTO', 'RTI', 'RTP', 'RTOOFD', 'RTOUD', 'RTS', 'RT'],
        textPatterns: ['rto', 'return to origin', 'return to shipper', 'rts', 'rto processing', 'rto in transit', 'in rto', 'return process'],
        excludePatterns: ['delivered', 'received'], // Exclude if already delivered
        status: 'rto_in_transit',
        priority: 99,
        description: 'RTO in progress - package being returned',
    },

    // ========== DELIVERED (priority 90) ==========
    {
        codes: ['DL', 'DELIVERED'],
        textPatterns: ['delivered'],
        excludePatterns: ['undelivered', 'not delivered', 'rto'],
        status: 'delivered',
        priority: 90,
        description: 'Successfully delivered to customer',
    },

    // ========== UNDELIVERED/NDR (priority 85) ==========
    // NOTE: 'UD' code removed - it's unreliable. Text patterns are authoritative.
    {
        codes: ['NDR'],
        textPatterns: ['undelivered', 'not delivered', 'delivery failed', 'ndr', 'delivery attempt failed'],
        status: 'undelivered',
        priority: 85,
        description: 'Delivery attempt failed - NDR',
    },

    // ========== OUT FOR DELIVERY (priority 80) ==========
    {
        codes: ['OFD'],
        textPatterns: ['out for delivery', 'ofd'],
        excludePatterns: ['rto'],
        status: 'out_for_delivery',
        priority: 80,
        description: 'Package out for delivery',
    },

    // ========== REACHED DESTINATION (priority 76) ==========
    // Higher than in_transit to catch "Reached At Destination" with UD code
    {
        codes: ['RAD'],
        textPatterns: ['reached at destination', 'reached destination', 'at destination hub', 'received at facility', 'reached at', 'destination hub'],
        excludePatterns: ['rto'],
        status: 'reached_destination',
        priority: 76,
        description: 'Package at destination hub',
    },

    // ========== IN TRANSIT (priority 70) ==========
    {
        codes: ['IT', 'OT'],
        textPatterns: ['in transit', 'in-transit', 'transit'],
        excludePatterns: ['rto', 'reverse'],
        status: 'in_transit',
        priority: 70,
        description: 'Package in transit',
    },

    // ========== PICKED UP (priority 65) ==========
    {
        codes: ['PP'],
        textPatterns: ['picked', 'pickup', 'pick up', 'picked up'],
        excludePatterns: ['not picked', 'pickup failed'],
        status: 'picked_up',
        priority: 65,
        description: 'Package picked up from seller',
    },

    // ========== NOT PICKED (priority 60) ==========
    {
        codes: ['NP'],
        textPatterns: ['not picked', 'pickup failed'],
        status: 'not_picked',
        priority: 60,
        description: 'Pickup failed - package not collected',
    },

    // ========== MANIFESTED (priority 55) ==========
    {
        codes: ['M'],
        textPatterns: ['manifest', 'manifested'],
        status: 'manifested',
        priority: 55,
        description: 'Order manifested - AWB created',
    },

    // ========== REVERSE LOGISTICS (priority 45-43) ==========
    // Reverse Delivered
    {
        codes: ['REVD'],
        textPatterns: ['reverse delivered'],
        status: 'reverse_delivered',
        priority: 45,
        description: 'Reverse pickup completed - item returned',
    },
    // Reverse In Transit
    {
        codes: ['REVI'],
        textPatterns: ['reverse in transit', 'reverse transit'],
        status: 'reverse_in_transit',
        priority: 44,
        description: 'Reverse shipment in transit',
    },
    // Reverse Pickup
    {
        codes: ['REVP'],
        textPatterns: ['reverse pickup'],
        status: 'reverse_pickup',
        priority: 43,
        description: 'Reverse pickup initiated',
    },
];

/**
 * Default tracking status when no rules match
 */
export const DEFAULT_TRACKING_STATUS: TrackingStatus = 'in_transit';

// ============================================
// RESOLVER FUNCTION
// ============================================

/**
 * Unreliable status codes that should NOT be trusted for mapping.
 * These codes are used by couriers for many different states.
 *
 * Example: "UD" is used for "Reached At Destination", "Cancelled", "In Transit", etc.
 */
const UNRELIABLE_STATUS_CODES = new Set(['UD']);

/**
 * Resolve tracking status from courier status code and text
 *
 * IMPORTANT: Text patterns are prioritized over status codes because
 * codes like "UD" are used by couriers for many different states.
 *
 * Priority order:
 * 1. Text pattern match (most reliable - from current_status text)
 * 2. Status code match (only for reliable codes, not "UD")
 * 3. Default to in_transit
 *
 * @param statusCode - Status code from courier API (e.g., 'DL', 'IT')
 * @param statusText - Status text from courier API (e.g., 'Delivered to customer')
 * @returns Internal tracking status
 *
 * @example
 * resolveTrackingStatus('DL', 'Delivered') // => 'delivered'
 * resolveTrackingStatus('RTD', 'RTO Delivered') // => 'rto_delivered'
 * resolveTrackingStatus('UD', 'Reached At Destination') // => 'reached_destination' (text wins over UD code)
 * resolveTrackingStatus('UD', 'In Transit') // => 'in_transit' (text wins over UD code)
 */
export function resolveTrackingStatus(
    statusCode: string,
    statusText: string = ''
): TrackingStatus {
    const codeUpper = (statusCode || '').toUpperCase().trim();
    const textLower = (statusText || '').toLowerCase().trim();
    const isUnreliableCode = UNRELIABLE_STATUS_CODES.has(codeUpper);

    // Sort rules by priority (highest first)
    const sortedRules = [...TRACKING_STATUS_RULES].sort((a, b) => b.priority - a.priority);

    // PASS 1: Check TEXT patterns first (most reliable)
    for (const rule of sortedRules) {
        // Check exclude patterns first
        if (rule.excludePatterns?.some(p => textLower.includes(p.toLowerCase()))) {
            continue;
        }

        // Check for text pattern match (contains)
        const textMatch = rule.textPatterns.some(p => textLower.includes(p.toLowerCase()));
        if (textMatch) {
            return rule.status;
        }
    }

    // PASS 2: Check CODE matches (only for reliable codes)
    if (!isUnreliableCode) {
        for (const rule of sortedRules) {
            // Check exclude patterns first
            if (rule.excludePatterns?.some(p => textLower.includes(p.toLowerCase()))) {
                continue;
            }

            // Check for code match (exact)
            const codeMatch = rule.codes.some(c => codeUpper === c.toUpperCase());
            if (codeMatch) {
                return rule.status;
            }
        }
    }

    // FALLBACK: For unreliable codes like "UD" with no text match,
    // only map to undelivered if text explicitly suggests NDR
    if (isUnreliableCode) {
        const isNdrText = textLower.includes('undeliver') ||
            textLower.includes('ndr') ||
            textLower.includes('delivery failed') ||
            textLower.includes('delivery attempt');
        if (isNdrText) {
            return 'undelivered';
        }
    }

    return DEFAULT_TRACKING_STATUS;
}

/**
 * Check if a status indicates RTO
 */
export function isRtoStatus(status: TrackingStatus): boolean {
    return status === 'rto_in_transit' || status === 'rto_delivered';
}

/**
 * Check if a status indicates delivery (successful or RTO)
 */
export function isDeliveredStatus(status: TrackingStatus): boolean {
    return status === 'delivered' || status === 'rto_delivered' || status === 'reverse_delivered';
}

/**
 * Get human-readable label for a tracking status
 */
export function getStatusLabel(status: TrackingStatus): string {
    const labels: Record<TrackingStatus, string> = {
        manifested: 'Manifested',
        not_picked: 'Pickup Failed',
        picked_up: 'Picked Up',
        in_transit: 'In Transit',
        reached_destination: 'Reached Destination',
        out_for_delivery: 'Out for Delivery',
        undelivered: 'Undelivered',
        delivered: 'Delivered',
        cancelled: 'Cancelled',
        rto_in_transit: 'RTO In Transit',
        rto_delivered: 'RTO Delivered',
        reverse_pickup: 'Reverse Pickup',
        reverse_in_transit: 'Reverse In Transit',
        reverse_delivered: 'Reverse Delivered',
    };
    return labels[status] || status;
}
