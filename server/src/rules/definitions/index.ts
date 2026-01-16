/**
 * Rule Definitions Index
 * Exports all rules and registers them with the registry
 */

import { ruleRegistry } from '../core/registry.js';
import type { RuleDefinition } from '../core/types.js';

// Import all rule modules
import { cancellationRules } from './cancellation.js';
import { shippingRules } from './shipping.js';
import { holdRules, VALID_ORDER_HOLD_REASONS, VALID_LINE_HOLD_REASONS } from './hold.js';
import { archiveRules, TERMINAL_STATUSES } from './archive.js';
import { rtoRules } from './rto.js';

// ============================================
// RE-EXPORT INDIVIDUAL RULES
// ============================================

export * from './cancellation.js';
export * from './shipping.js';
export * from './hold.js';
export * from './archive.js';
export * from './rto.js';

// ============================================
// AGGREGATED RULE COLLECTIONS
// ============================================

/**
 * All business rules in the system
 */
export const allRules: RuleDefinition<unknown>[] = [
    ...cancellationRules,
    ...shippingRules,
    ...holdRules,
    ...archiveRules,
    ...rtoRules,
] as RuleDefinition<unknown>[];

// ============================================
// CONSTANTS RE-EXPORTS
// ============================================

export {
    VALID_ORDER_HOLD_REASONS,
    VALID_LINE_HOLD_REASONS,
    TERMINAL_STATUSES,
};

// ============================================
// REGISTRATION
// ============================================

/**
 * Register all rules with the registry
 * This function is idempotent - calling multiple times is safe
 */
let registered = false;

export function registerAllRules(): void {
    if (registered) return;

    for (const rule of allRules) {
        if (!ruleRegistry.has(rule.id)) {
            ruleRegistry.register(rule);
        }
    }

    registered = true;
}

// Auto-register on import
registerAllRules();
