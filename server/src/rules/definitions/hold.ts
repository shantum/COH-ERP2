/**
 * Hold Rules
 * Rules for placing orders/lines on hold and releasing them
 */

import { defineRule, simpleBooleanRule } from '../core/defineRule.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface OrderHoldData {
    order: {
        id: string;
        status: string;
        isOnHold: boolean;
        isArchived: boolean;
    };
    reason?: string;
}

interface LineHoldData {
    line: {
        id: string;
        lineStatus: string;
        isOnHold: boolean;
    };
    order: {
        id: string;
        isArchived: boolean;
    };
    reason?: string;
}

interface ReleaseOrderData {
    order: {
        id: string;
        isOnHold: boolean;
    };
}

interface ReleaseLineData {
    line: {
        id: string;
        isOnHold: boolean;
    };
}

// ============================================
// VALID HOLD REASONS
// ============================================

/**
 * Valid hold reasons for orders
 */
export const VALID_ORDER_HOLD_REASONS = [
    'fraud_review',
    'address_issue',
    'payment_issue',
    'customer_request',
    'other',
] as const;

/**
 * Valid hold reasons for lines
 */
export const VALID_LINE_HOLD_REASONS = [
    'size_confirmation',
    'stock_issue',
    'customization',
    'customer_request',
    'other',
] as const;

// ============================================
// HOLD ORDER RULES
// ============================================

/**
 * Order must not already be on hold
 */
export const orderNotAlreadyOnHold = simpleBooleanRule<OrderHoldData>({
    id: 'hold.order.not_already_on_hold',
    name: 'Order Not Already On Hold',
    description: 'Order is already on hold',
    category: 'hold',
    errorCode: 'ALREADY_ON_HOLD',
    operations: ['holdOrder'],
    condition: ({ data }) => !data.order.isOnHold,
});

/**
 * Cannot hold archived orders
 */
export const orderNotArchivedForHold = simpleBooleanRule<OrderHoldData>({
    id: 'hold.order.not_archived',
    name: 'Cannot Hold Archived Order',
    description: 'Cannot hold archived orders',
    category: 'hold',
    errorCode: 'CANNOT_HOLD_ARCHIVED',
    operations: ['holdOrder'],
    condition: ({ data }) => !data.order.isArchived,
});

/**
 * Cannot hold orders in terminal status (shipped/delivered/cancelled)
 */
export const orderValidStatusForHold = defineRule<OrderHoldData>({
    id: 'hold.order.valid_status',
    name: 'Valid Order Status For Hold',
    description: 'Cannot hold orders in terminal status',
    category: 'hold',
    errorCode: 'INVALID_STATUS_FOR_HOLD',
    operations: ['holdOrder'],
    evaluate: async ({ data }) => {
        const invalidStatuses = ['shipped', 'delivered', 'cancelled'];
        if (invalidStatuses.includes(data.order.status)) {
            return {
                passed: false,
                message: `Cannot hold order in ${data.order.status} status`,
            };
        }
        return true;
    },
});

/**
 * Valid hold reason is required for orders
 */
export const orderValidHoldReason = defineRule<OrderHoldData>({
    id: 'hold.order.valid_reason',
    name: 'Valid Hold Reason Required',
    description: 'A valid hold reason is required',
    category: 'hold',
    errorCode: 'INVALID_HOLD_REASON',
    operations: ['holdOrder'],
    evaluate: async ({ data }) => {
        if (!data.reason) {
            return {
                passed: false,
                message: 'Hold reason is required',
            };
        }
        if (!VALID_ORDER_HOLD_REASONS.includes(data.reason as typeof VALID_ORDER_HOLD_REASONS[number])) {
            return {
                passed: false,
                message: `Invalid hold reason. Valid options: ${VALID_ORDER_HOLD_REASONS.join(', ')}`,
            };
        }
        return true;
    },
});

// ============================================
// HOLD LINE RULES
// ============================================

/**
 * Line must not already be on hold
 */
export const lineNotAlreadyOnHold = simpleBooleanRule<LineHoldData>({
    id: 'hold.line.not_already_on_hold',
    name: 'Line Not Already On Hold',
    description: 'Line is already on hold',
    category: 'hold',
    errorCode: 'ALREADY_ON_HOLD',
    operations: ['holdLine'],
    condition: ({ data }) => !data.line.isOnHold,
});

/**
 * Cannot hold lines in shipped/cancelled status
 */
export const lineValidStatusForHold = defineRule<LineHoldData>({
    id: 'hold.line.valid_status',
    name: 'Valid Line Status For Hold',
    description: 'Cannot hold lines in terminal status',
    category: 'hold',
    errorCode: 'INVALID_STATUS_FOR_HOLD',
    operations: ['holdLine'],
    evaluate: async ({ data }) => {
        const invalidStatuses = ['shipped', 'cancelled'];
        if (invalidStatuses.includes(data.line.lineStatus)) {
            return {
                passed: false,
                message: `Cannot hold line in ${data.line.lineStatus} status`,
            };
        }
        return true;
    },
});

/**
 * Cannot hold lines in archived orders
 */
export const lineOrderNotArchived = simpleBooleanRule<LineHoldData>({
    id: 'hold.line.order_not_archived',
    name: 'Order Not Archived',
    description: 'Cannot hold lines in archived orders',
    category: 'hold',
    errorCode: 'CANNOT_HOLD_ARCHIVED',
    operations: ['holdLine'],
    condition: ({ data }) => !data.order.isArchived,
});

/**
 * Valid hold reason is required for lines
 */
export const lineValidHoldReason = defineRule<LineHoldData>({
    id: 'hold.line.valid_reason',
    name: 'Valid Line Hold Reason Required',
    description: 'A valid hold reason is required',
    category: 'hold',
    errorCode: 'INVALID_HOLD_REASON',
    operations: ['holdLine'],
    evaluate: async ({ data }) => {
        if (!data.reason) {
            return {
                passed: false,
                message: 'Hold reason is required',
            };
        }
        if (!VALID_LINE_HOLD_REASONS.includes(data.reason as typeof VALID_LINE_HOLD_REASONS[number])) {
            return {
                passed: false,
                message: `Invalid hold reason. Valid options: ${VALID_LINE_HOLD_REASONS.join(', ')}`,
            };
        }
        return true;
    },
});

// ============================================
// RELEASE HOLD RULES
// ============================================

/**
 * Order must be on hold to release
 */
export const orderMustBeOnHold = simpleBooleanRule<ReleaseOrderData>({
    id: 'release.order.must_be_on_hold',
    name: 'Order Must Be On Hold',
    description: 'Order is not on hold',
    category: 'hold',
    errorCode: 'NOT_ON_HOLD',
    operations: ['releaseOrderHold'],
    condition: ({ data }) => data.order.isOnHold,
});

/**
 * Line must be on hold to release
 */
export const lineMustBeOnHold = simpleBooleanRule<ReleaseLineData>({
    id: 'release.line.must_be_on_hold',
    name: 'Line Must Be On Hold',
    description: 'Line is not on hold',
    category: 'hold',
    errorCode: 'NOT_ON_HOLD',
    operations: ['releaseLineHold'],
    condition: ({ data }) => data.line.isOnHold,
});

// ============================================
// EXPORTS
// ============================================

/**
 * All hold rules
 */
export const holdRules = [
    // Hold order rules
    orderNotAlreadyOnHold,
    orderNotArchivedForHold,
    orderValidStatusForHold,
    orderValidHoldReason,
    // Hold line rules
    lineNotAlreadyOnHold,
    lineValidStatusForHold,
    lineOrderNotArchived,
    lineValidHoldReason,
    // Release rules
    orderMustBeOnHold,
    lineMustBeOnHold,
];
