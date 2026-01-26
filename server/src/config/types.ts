/**
 * Shared types for the configuration system
 *
 * This file contains common types used across all configuration modules.
 */

// ============================================
// MAPPING RULE TYPES
// ============================================

/**
 * Base interface for all mapping rules
 */
export interface BaseMappingRule {
    /** Rule priority - higher values are checked first */
    priority: number;
    /** Human-readable description of why this rule exists */
    description: string;
}

// ============================================
// TRACKING STATUS TYPES
// ============================================

/**
 * All possible tracking statuses in the system
 */
export type TrackingStatus =
    | 'manifested'
    | 'not_picked'
    | 'picked_up'
    | 'in_transit'
    | 'reached_destination'
    | 'out_for_delivery'
    | 'delivery_delayed'
    | 'undelivered'
    | 'delivered'
    | 'cancelled'
    | 'rto_initiated'
    | 'rto_in_transit'
    | 'rto_delivered'
    | 'reverse_pickup'
    | 'reverse_in_transit'
    | 'reverse_delivered';

/**
 * Terminal tracking statuses - no further updates expected
 */
export const TERMINAL_TRACKING_STATUSES: readonly TrackingStatus[] = [
    'delivered',
    'rto_delivered',
    'cancelled',
    'reverse_delivered',
] as const;

/**
 * Check if a status is terminal
 */
export function isTerminalStatus(status: TrackingStatus): boolean {
    return TERMINAL_TRACKING_STATUSES.includes(status);
}

// ============================================
// PAYMENT METHOD TYPES
// ============================================

/**
 * Payment method types
 */
export type PaymentMethod = 'COD' | 'Prepaid';

// ============================================
// CUSTOMER TIER TYPES
// ============================================

/**
 * Customer tier levels based on LTV
 */
export type CustomerTier = 'platinum' | 'gold' | 'silver' | 'bronze';

/**
 * Tier thresholds configuration
 */
export interface TierThresholds {
    /** Minimum LTV for platinum tier */
    platinum: number;
    /** Minimum LTV for gold tier */
    gold: number;
    /** Minimum LTV for silver tier */
    silver: number;
    // bronze is implicit (below silver)
}
