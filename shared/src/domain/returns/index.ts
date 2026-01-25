/**
 * Returns Domain
 *
 * Single source of truth for all return-related configuration and logic.
 *
 * @example
 * import {
 *   RETURN_POLICY,
 *   RETURN_REASONS,
 *   checkEligibility,
 *   toOptions,
 * } from '@coh/shared/domain/returns';
 *
 * // Get policy settings
 * console.log(RETURN_POLICY.windowDays); // 14
 *
 * // Get dropdown options
 * const reasons = toOptions(RETURN_REASONS);
 * // → [{ value: 'fit_size', label: 'Size/Fit Issue' }, ...]
 *
 * // Check eligibility
 * const result = checkEligibility({ deliveredAt, returnStatus, ... });
 */

// Policy
export { RETURN_POLICY, WARNING_THRESHOLD_DAYS, type ReturnPolicy } from './policy.js';

// Options (labeled)
export {
    RETURN_REASONS,
    RETURN_CONDITIONS,
    RETURN_RESOLUTIONS,
    RETURN_STATUSES,
    RETURN_PICKUP_TYPES,
    RETURN_REFUND_METHODS,
    NON_RETURNABLE_REASONS,
    toOptions,
    getLabel,
    type ReturnReason,
    type ReturnCondition,
    type ReturnResolution,
    type ReturnStatus,
    type ReturnPickupType,
    type ReturnRefundMethod,
    type NonReturnableReason,
} from './options.js';

// Eligibility
export {
    checkEligibility,
    getDaysRemaining,
    isExpiringSoon,
    isWithinWindow,
    type EligibilityInput,
    type EligibilityResult,
    type EligibilityReason,
} from './eligibility.js';
