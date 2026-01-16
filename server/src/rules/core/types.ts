/**
 * Rules Engine Core Types
 * Defines interfaces for the declarative rules engine
 */

import type { PrismaOrTransaction } from '../../utils/patterns/types.js';

// ============================================
// RULE CATEGORIES
// ============================================

/**
 * Rule categories for organization and filtering
 */
export type RuleCategory =
    | 'cancellation'
    | 'shipping'
    | 'hold'
    | 'archive'
    | 'lineEdit'
    | 'inventory'
    | 'rto';

/**
 * Operations that rules can apply to
 */
export type RuleOperation =
    // Cancellation
    | 'cancelOrder'
    | 'cancelLine'
    | 'uncancelOrder'
    | 'uncancelLine'
    // Shipping
    | 'shipOrder'
    | 'shipLine'
    | 'unshipOrder'
    | 'unshipLine'
    // Hold
    | 'holdOrder'
    | 'releaseOrderHold'
    | 'holdLine'
    | 'releaseLineHold'
    // Archive
    | 'archiveOrder'
    | 'unarchiveOrder'
    // Line Edit
    | 'editLine'
    | 'addLine'
    // Inventory
    | 'allocateLine'
    | 'unallocateLine'
    // RTO
    | 'initiateRto'
    | 'receiveRto'
    // Delivery
    | 'markDelivered';

// ============================================
// RULE DEFINITION
// ============================================

/**
 * Result of evaluating a single rule
 */
export interface RuleEvaluation {
    /** Whether the rule passed */
    passed: boolean;
    /** Optional custom message (overrides description if provided) */
    message?: string;
}

/**
 * Rule context passed to evaluate function
 */
export interface RuleContext<TData = unknown> {
    /** Prisma client or transaction */
    prisma: PrismaOrTransaction;
    /** Current user ID */
    userId: string;
    /** Data to validate (order, line, etc.) */
    data: TData;
    /** Execution phase */
    phase: 'pre' | 'transaction';
}

/**
 * Definition of a single business rule
 */
export interface RuleDefinition<TData = unknown> {
    /** Unique rule identifier (e.g., 'cancel.order.not_shipped') */
    id: string;
    /** Human-readable rule name */
    name: string;
    /** Error message when rule fails */
    description: string;
    /** Rule category for organization */
    category: RuleCategory;
    /** When to execute: 'pre' (before transaction) or 'transaction' (within transaction) */
    phase: 'pre' | 'transaction';
    /** Error severity: 'error' blocks operation, 'warning' allows with notice */
    severity: 'error' | 'warning';
    /** Error code for programmatic handling (maps to BusinessLogicError.rule) */
    errorCode: string;
    /** Operations this rule applies to */
    operations: RuleOperation[];
    /** Rule evaluation function */
    evaluate: (ctx: RuleContext<TData>) => Promise<boolean | RuleEvaluation>;
}

// ============================================
// RULE EXECUTION RESULTS
// ============================================

/**
 * Result of a single rule execution
 */
export interface SingleRuleResult {
    /** Rule ID */
    ruleId: string;
    /** Rule name */
    ruleName: string;
    /** Whether rule passed */
    passed: boolean;
    /** Error/warning message if failed */
    message?: string;
    /** Error code if failed */
    errorCode?: string;
    /** Rule severity */
    severity: 'error' | 'warning';
}

/**
 * Result of executing all rules for an operation
 */
export interface RulesExecutionResult {
    /** Whether all error-severity rules passed */
    success: boolean;
    /** All rule results */
    results: SingleRuleResult[];
    /** Failed error-severity rules */
    errors: SingleRuleResult[];
    /** Failed warning-severity rules */
    warnings: SingleRuleResult[];
}

// ============================================
// REGISTRY TYPES
// ============================================

/**
 * Options for retrieving rules
 */
export interface GetRulesOptions {
    /** Filter by category */
    category?: RuleCategory;
    /** Filter by phase */
    phase?: 'pre' | 'transaction';
    /** Filter by operation */
    operation?: RuleOperation;
}

/**
 * Generated documentation for a rule
 */
export interface RuleDocumentation {
    id: string;
    name: string;
    description: string;
    category: RuleCategory;
    phase: 'pre' | 'transaction';
    severity: 'error' | 'warning';
    errorCode: string;
    operations: RuleOperation[];
}
