/**
 * @coh/shared - Shared types and schemas for COH ERP
 *
 * This package contains TypeScript types, Zod validation schemas,
 * validator functions, and database queries shared between server and client.
 *
 * NOTE: Types are exported from ./types, domain logic from ./domain.
 * Some types (LineStatus, OrderStatus, ReturnStatus, etc.) exist in both
 * locations - we explicitly choose which source to use to avoid conflicts.
 */

// Re-export all types (type-only export for pure interfaces)
// This is the PRIMARY source for entity types
export type * from './types/index.js';

// Re-export all schemas (Zod schemas + inferred types)
// NOTE: schemas/returns.ts exports ReturnCondition, ReturnResolution, etc.
// which conflict with domain/returns - we use schema versions as primary
export * from './schemas/index.js';
export * from './schemas/orders.js';
export * from './schemas/payments.js';
export * from './schemas/searchParams.js';
export * from './schemas/materials.js';

// Re-export all validators
export * from './validators/index.js';

// Re-export utils (pure functions, no DB dependencies)
export * from './utils/index.js';

// Re-export domain layer SELECTIVELY to avoid conflicts
// The following are EXCLUDED because they conflict with types/ or schemas/:
// - LineStatus (use from types/)
// - OrderStatus (use from types/)
// - ReturnStatus (use from types/)
// - ReturnCondition, ReturnResolution, ReturnPickupType, ReturnRefundMethod (use from schemas/)
// - InventoryBalance, InventoryBalanceWithSkuId (use from types/)
export {
    // constants
    GST_CONFIG,
    GST_THRESHOLD,
    GST_RATE_BELOW_THRESHOLD,
    GST_RATE_ABOVE_THRESHOLD,
    getGstRate,
    // gst calculator
    computeOrderGst,
    getGstRateForMrp,
    determineGstType,
    type GstLineInput,
    type GstLineResult,
    type GstType,
    type OrderGstResult,
    // customers
    calculateTierFromLtv,
    compareTiers,
    getAmountToNextTier,
    DEFAULT_TIER_THRESHOLDS,
    type CustomerTier,
    type TierThresholds,
    // formatting
    formatCurrency,
    formatNumber,
    formatPercent,
    calculateChange,
    // inventory - functions only, not types
    calculateBalance,
    calculateFabricBalance,
    hasEnoughStock,
    getShortfall,
    getAllocatableQuantity,
    createEmptyBalanceWithId,
    createEmptyFabricBalanceWithId,
    // orders - pricing
    calculateOrderTotal,
    getProductMrpForShipping,
    // orders - line mutations types
    type MutationResult,
    type MarkLineDeliveredInput,
    type MarkLineRtoInput,
    type ReceiveLineRtoInput,
    // orders - state machine (functions, not LineStatus/OrderStatus types)
    LINE_STATUS_TRANSITIONS,
    LINE_STATUSES,
    STATUSES_WITH_ALLOCATED_INVENTORY,
    SHIPPED_OR_BEYOND,
    isValidTransition,
    getTransitionDefinition,
    getValidTargetStatuses,
    isValidLineStatus,
    transitionAffectsInventory,
    releasesInventory,
    allocatesInventory,
    hasAllocatedInventory,
    buildTransitionError,
    calculateInventoryDelta,
    computeOrderStatus,
    type InventoryEffect,
    type TimestampField,
    type TimestampAction,
    type TransitionDefinition,
    type TransitionContext,
    type TransitionResult,
    type OrderLineForStatus,
    type OrderForStatusComputation,
    // returns - policy
    RETURN_POLICY,
    type ReturnPolicy,
    // returns - options (maps and functions, not types that conflict)
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
    type NonReturnableReason,
    // payroll - constants
    HRA_PERCENT,
    OTHER_ALLOWANCE_PERCENT,
    GROSS_MULTIPLIER,
    PF_EMPLOYEE_PERCENT,
    PF_EMPLOYER_PERCENT,
    PF_ADMIN_PERCENT,
    PF_WAGE_CAP,
    ESIC_EMPLOYEE_PERCENT,
    ESIC_EMPLOYER_PERCENT,
    ESIC_GROSS_THRESHOLD,
    PT_AMOUNT,
    PT_GROSS_THRESHOLD,
    DEPARTMENTS,
    PAYROLL_STATUSES,
    type Department,
    type PayrollStatus,
    // payroll - helpers
    round2,
    getDaysInMonth,
    proRate,
    calculatePF,
    getSundays,
    calculatePayableDays,
    // payroll - slip calculation
    calculateSlip,
    type SlipInput,
    type SlipResult,
    // returns - eligibility
    checkEligibility,
    getDaysRemaining,
    isExpiringSoon,
    isWithinWindow,
    type EligibilityInput,
    type EligibilityResult,
    type EligibilityReason,
    type EligibilitySettings,
} from './domain/index.js';

// Re-export inventory domain types that don't conflict (different names)
export type {
    InventoryTransactionSummary,
    CalculateBalanceOptions,
    FabricTransactionSummary,
    FabricBalance,
    FabricBalanceWithId,
} from './domain/inventory/balance.js';

// Re-export services
export * from './services/index.js';
