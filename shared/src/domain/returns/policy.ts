/**
 * Return Policy Settings
 *
 * Single source of truth for all return policy configuration.
 * To change: Update values here. Changes apply immediately on next deploy.
 */

export const RETURN_POLICY = {
    /** Days from delivery within which returns are accepted */
    windowDays: 14,

    /** Days before window expiry to show warning (e.g., 12 means warn when 2 days left) */
    windowWarningDays: 12,

    /** Auto-reject returns after this many days (null = allow with manual override) */
    autoRejectAfterDays: null as number | null,

    /** Allow returns after window expires with manual override */
    allowExpiredWithOverride: true,
} as const;

export type ReturnPolicy = typeof RETURN_POLICY;

/**
 * Warning threshold in days remaining
 * Derived from windowDays - windowWarningDays
 */
export const WARNING_THRESHOLD_DAYS = RETURN_POLICY.windowDays - RETURN_POLICY.windowWarningDays;
