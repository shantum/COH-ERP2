/**
 * Rule Definition Helper
 * Type-safe helper for defining business rules
 */

import type {
    RuleDefinition,
    RuleCategory,
    RuleOperation,
    RuleContext,
    RuleEvaluation,
} from './types.js';

/**
 * Input for defining a rule (allows shorthand for phase)
 */
export interface DefineRuleInput<TData = unknown> {
    /** Unique rule identifier */
    id: string;
    /** Human-readable rule name */
    name: string;
    /** Error message when rule fails */
    description: string;
    /** Rule category */
    category: RuleCategory;
    /** When to execute (defaults to 'pre') */
    phase?: 'pre' | 'transaction';
    /** Error severity (defaults to 'error') */
    severity?: 'error' | 'warning';
    /** Error code for programmatic handling */
    errorCode: string;
    /** Operations this rule applies to */
    operations: RuleOperation[];
    /** Rule evaluation function - return true if rule passes, false if fails */
    evaluate: (ctx: RuleContext<TData>) => Promise<boolean | RuleEvaluation>;
}

/**
 * Define a business rule with type safety and defaults
 *
 * @example
 * ```typescript
 * export const orderNotShipped = defineRule<{ order: Order }>({
 *     id: 'cancel.order.not_shipped',
 *     name: 'Cannot Cancel Shipped Orders',
 *     description: 'Cannot cancel shipped or delivered orders',
 *     category: 'cancellation',
 *     errorCode: 'CANNOT_CANCEL_SHIPPED',
 *     operations: ['cancelOrder'],
 *     evaluate: async ({ data }) => data.order.status !== 'shipped',
 * });
 * ```
 */
export function defineRule<TData = unknown>(
    input: DefineRuleInput<TData>
): RuleDefinition<TData> {
    return {
        id: input.id,
        name: input.name,
        description: input.description,
        category: input.category,
        phase: input.phase ?? 'pre',
        severity: input.severity ?? 'error',
        errorCode: input.errorCode,
        operations: input.operations,
        evaluate: input.evaluate,
    };
}

/**
 * Helper to create a simple boolean rule (most common case)
 * The condition should return true when the rule PASSES
 *
 * @example
 * ```typescript
 * export const orderNotCancelled = simpleBooleanRule<{ order: Order }>({
 *     id: 'cancel.order.not_cancelled',
 *     name: 'Order Not Already Cancelled',
 *     description: 'Order is already cancelled',
 *     category: 'cancellation',
 *     errorCode: 'ORDER_ALREADY_CANCELLED',
 *     operations: ['cancelOrder'],
 *     condition: ({ data }) => data.order.status !== 'cancelled',
 * });
 * ```
 */
export function simpleBooleanRule<TData = unknown>(
    input: Omit<DefineRuleInput<TData>, 'evaluate'> & {
        /** Condition that returns true when rule PASSES */
        condition: (ctx: RuleContext<TData>) => boolean | Promise<boolean>;
    }
): RuleDefinition<TData> {
    const { condition, ...rest } = input;
    return defineRule<TData>({
        ...rest,
        evaluate: async (ctx) => condition(ctx),
    });
}
