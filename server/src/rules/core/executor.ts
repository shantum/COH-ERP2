/**
 * Rules Executor
 * Functions for executing and enforcing business rules
 */

import type {
    RuleDefinition,
    RuleContext,
    RuleOperation,
    RulesExecutionResult,
    SingleRuleResult,
} from './types.js';
import type { PrismaOrTransaction } from '../../utils/patterns/types.js';
import { ruleRegistry } from './registry.js';
import { BusinessLogicError } from '../../utils/errors.js';

// ============================================
// EXECUTION CONTEXT
// ============================================

/**
 * Input for executing rules
 */
export interface ExecuteRulesInput<TData = unknown> {
    /** Prisma client or transaction */
    prisma: PrismaOrTransaction;
    /** Current user ID */
    userId: string;
    /** Data to validate */
    data: TData;
    /** Execution phase */
    phase: 'pre' | 'transaction';
}

// ============================================
// CORE EXECUTION FUNCTIONS
// ============================================

/**
 * Execute all rules for a given operation
 * Returns results without throwing errors
 *
 * @example
 * ```typescript
 * const result = await executeRules('cancelOrder', {
 *     prisma,
 *     userId: ctx.user.id,
 *     data: { order },
 *     phase: 'pre',
 * });
 *
 * if (!result.success) {
 *     // Handle errors
 *     console.log(result.errors);
 * }
 * ```
 */
export async function executeRules<TData = unknown>(
    operation: RuleOperation,
    input: ExecuteRulesInput<TData>
): Promise<RulesExecutionResult> {
    const rules = ruleRegistry.getForOperation<TData>(operation);

    // Filter rules by phase
    const phaseRules = rules.filter(r => r.phase === input.phase);

    const results: SingleRuleResult[] = [];
    const errors: SingleRuleResult[] = [];
    const warnings: SingleRuleResult[] = [];

    // Build context
    const ctx: RuleContext<TData> = {
        prisma: input.prisma,
        userId: input.userId,
        data: input.data,
        phase: input.phase,
    };

    // Execute each rule
    for (const rule of phaseRules) {
        const result = await executeRule(rule, ctx);
        results.push(result);

        if (!result.passed) {
            if (result.severity === 'error') {
                errors.push(result);
            } else {
                warnings.push(result);
            }
        }
    }

    return {
        success: errors.length === 0,
        results,
        errors,
        warnings,
    };
}

/**
 * Execute a single rule and return the result
 */
async function executeRule<TData>(
    rule: RuleDefinition<TData>,
    ctx: RuleContext<TData>
): Promise<SingleRuleResult> {
    try {
        const evalResult = await rule.evaluate(ctx);

        // Handle boolean or object result
        const passed = typeof evalResult === 'boolean' ? evalResult : evalResult.passed;
        const customMessage = typeof evalResult === 'object' ? evalResult.message : undefined;

        return {
            ruleId: rule.id,
            ruleName: rule.name,
            passed,
            message: passed ? undefined : (customMessage ?? rule.description),
            errorCode: passed ? undefined : rule.errorCode,
            severity: rule.severity,
        };
    } catch (error) {
        // Rule threw an error - treat as failure
        const message = error instanceof Error ? error.message : 'Rule evaluation failed';
        return {
            ruleId: rule.id,
            ruleName: rule.name,
            passed: false,
            message: `${rule.description} (Error: ${message})`,
            errorCode: rule.errorCode,
            severity: rule.severity,
        };
    }
}

/**
 * Execute rules and throw BusinessLogicError if any error-severity rules fail
 * Use this when you want to block the operation on rule failure
 *
 * @throws BusinessLogicError with first failed rule's message and error code
 *
 * @example
 * ```typescript
 * // In a mutation handler
 * await enforceRules('cancelOrder', {
 *     prisma,
 *     userId: ctx.user.id,
 *     data: { order },
 *     phase: 'pre',
 * });
 *
 * // If we reach here, all rules passed
 * await cancelOrderLogic(order);
 * ```
 */
export async function enforceRules<TData = unknown>(
    operation: RuleOperation,
    input: ExecuteRulesInput<TData>
): Promise<RulesExecutionResult> {
    const result = await executeRules(operation, input);

    if (!result.success) {
        // Throw error with first failed rule
        const firstError = result.errors[0];
        throw new BusinessLogicError(firstError.message!, firstError.errorCode);
    }

    return result;
}

/**
 * Check rules without throwing - returns boolean and optional error message
 * Useful for UI validation before attempting operation
 *
 * @example
 * ```typescript
 * const canCancel = await checkRules('cancelOrder', { ... });
 * if (!canCancel.allowed) {
 *     showError(canCancel.message);
 * }
 * ```
 */
export async function checkRules<TData = unknown>(
    operation: RuleOperation,
    input: ExecuteRulesInput<TData>
): Promise<{
    allowed: boolean;
    message?: string;
    errorCode?: string;
    warnings?: string[];
}> {
    const result = await executeRules(operation, input);

    if (!result.success) {
        const firstError = result.errors[0];
        return {
            allowed: false,
            message: firstError.message,
            errorCode: firstError.errorCode,
            warnings: result.warnings.map(w => w.message!).filter(Boolean),
        };
    }

    return {
        allowed: true,
        warnings: result.warnings.map(w => w.message!).filter(Boolean),
    };
}

// ============================================
// BATCH EXECUTION
// ============================================

/**
 * Execute rules for multiple items in batch
 * Useful for bulk operations
 *
 * @example
 * ```typescript
 * const results = await executeRulesForMany('cancelLine', lines.map(line => ({
 *     prisma,
 *     userId: ctx.user.id,
 *     data: { line },
 *     phase: 'pre',
 * })));
 * ```
 */
export async function executeRulesForMany<TData = unknown>(
    operation: RuleOperation,
    inputs: ExecuteRulesInput<TData>[]
): Promise<RulesExecutionResult[]> {
    // Execute in parallel
    return Promise.all(inputs.map(input => executeRules(operation, input)));
}

/**
 * Enforce rules for multiple items - throws on first failure
 */
export async function enforceRulesForMany<TData = unknown>(
    operation: RuleOperation,
    inputs: ExecuteRulesInput<TData>[]
): Promise<RulesExecutionResult[]> {
    const results: RulesExecutionResult[] = [];

    for (const input of inputs) {
        // This will throw on first failure
        const result = await enforceRules(operation, input);
        results.push(result);
    }

    return results;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get all rules for an operation (useful for documentation)
 */
export function getRulesForOperation(operation: RuleOperation) {
    return ruleRegistry.getForOperation(operation);
}

/**
 * Check if any rules exist for an operation
 */
export function hasRulesForOperation(operation: RuleOperation): boolean {
    return ruleRegistry.getForOperation(operation).length > 0;
}
