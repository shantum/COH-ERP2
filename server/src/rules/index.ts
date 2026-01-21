/**
 * Rules Engine Public API
 *
 * Declarative business rules for order operations.
 * Rules are defined as data, making them discoverable, testable, and documentable.
 *
 * @example
 * ```typescript
 * // In Express route
 * import { enforceRulesInExpress } from '../rules/index.js';
 *
 * router.post('/:id/cancel', async (req, res) => {
 *     const order = await req.prisma.order.findUnique({ ... });
 *
 *     await enforceRulesInExpress('cancelOrder', req, {
 *         data: { order },
 *         phase: 'pre',
 *     });
 *
 *     // Proceed with cancellation...
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Generate documentation
 * import { ruleRegistry } from '../rules/index.js';
 *
 * const markdown = ruleRegistry.generateMarkdown();
 * console.log(markdown);
 * ```
 *
 * @module rules
 */

// ============================================
// CORE TYPES
// ============================================

export type {
    RuleCategory,
    RuleOperation,
    RuleDefinition,
    RuleContext,
    RuleEvaluation,
    RulesExecutionResult,
    SingleRuleResult,
    GetRulesOptions,
    RuleDocumentation,
} from './core/types.js';

// ============================================
// CORE FUNCTIONS
// ============================================

// Rule definition helpers
export { defineRule, simpleBooleanRule } from './core/defineRule.js';
export type { DefineRuleInput } from './core/defineRule.js';

// Registry
export { ruleRegistry } from './core/registry.js';

// Executor
export {
    executeRules,
    enforceRules,
    checkRules,
    executeRulesForMany,
    enforceRulesForMany,
    getRulesForOperation,
    hasRulesForOperation,
} from './core/executor.js';
export type { ExecuteRulesInput } from './core/executor.js';

// ============================================
// ADAPTERS
// ============================================

// Express adapter
export {
    enforceRulesInExpress,
    executeRulesInExpress,
    checkRulesInExpress,
    enforceRulesMiddleware,
    checkRulesMiddleware,
    sendRuleError,
} from './adapters/express.js';

// ============================================
// RULE DEFINITIONS
// ============================================

// All rules are auto-registered on import
export {
    // Aggregated collections
    allRules,
    registerAllRules,

    // Cancellation rules
    cancellationRules,
    orderNotAlreadyCancelled,
    orderNotShippedOrDelivered,
    lineNotShipped,
    lineNotAlreadyCancelled,
    orderMustBeCancelled,
    lineMustBeCancelled,

    // Shipping rules
    shippingRules,
    awbRequired,
    courierRequired,
    linesMustBePacked,
    lineMustBePacked,
    lineNotAlreadyShipped,
    lineNotCancelled,
    noDuplicateAwb,
    orderMustBeShippedForDelivery,
    orderMustBeShipped,
    lineMustBeShipped,
    orderNotDelivered,

    // Hold rules
    holdRules,
    VALID_ORDER_HOLD_REASONS,
    VALID_LINE_HOLD_REASONS,
    orderNotAlreadyOnHold,
    orderNotArchivedForHold,
    orderValidStatusForHold,
    orderValidHoldReason,
    lineNotAlreadyOnHold,
    lineValidStatusForHold,
    lineOrderNotArchived,
    lineValidHoldReason,
    orderMustBeOnHold,
    lineMustBeOnHold,

    // Archive rules
    archiveRules,
    TERMINAL_STATUSES,
    orderNotAlreadyArchived,
    orderTerminalStateRequired,
    orderMustBeArchived,

    // RTO rules
    rtoRules,
    orderMustBeShippedForRto,
    rtoNotAlreadyInitiated,
    rtoMustBeInitiated,
    rtoNotAlreadyReceived,

    // Inventory rules
    inventoryRules,
    lineStatusMustBePending,
    allLinesMustBePending,
    sufficientStockAvailable,
    lineMustBeAllocated,

    // Line edit rules
    lineEditRules,
    lineEditableStatus,
    lineNotShippedForEdit,
    orderOpenForAddLine,
} from './definitions/index.js';
