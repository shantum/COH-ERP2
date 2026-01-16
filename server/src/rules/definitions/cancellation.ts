/**
 * Cancellation Rules
 * Rules for order and line cancellation/uncancellation operations
 */

import { simpleBooleanRule } from '../core/defineRule.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface OrderData {
    order: {
        id: string;
        status: string;
        isArchived?: boolean;
    };
}

interface OrderLineData {
    line: {
        id: string;
        lineStatus: string;
    };
}

// ============================================
// CANCEL ORDER RULES
// ============================================

/**
 * Order must not already be cancelled
 */
export const orderNotAlreadyCancelled = simpleBooleanRule<OrderData>({
    id: 'cancel.order.not_already_cancelled',
    name: 'Order Not Already Cancelled',
    description: 'Order is already cancelled',
    category: 'cancellation',
    errorCode: 'ORDER_ALREADY_CANCELLED',
    operations: ['cancelOrder'],
    condition: ({ data }) => data.order.status !== 'cancelled',
});

/**
 * Cannot cancel shipped or delivered orders
 */
export const orderNotShippedOrDelivered = simpleBooleanRule<OrderData>({
    id: 'cancel.order.not_shipped',
    name: 'Cannot Cancel Shipped Orders',
    description: 'Cannot cancel shipped or delivered orders',
    category: 'cancellation',
    errorCode: 'CANNOT_CANCEL_SHIPPED',
    operations: ['cancelOrder'],
    condition: ({ data }) => !['shipped', 'delivered'].includes(data.order.status),
});

// ============================================
// CANCEL LINE RULES
// ============================================

/**
 * Cannot cancel a shipped line
 */
export const lineNotShipped = simpleBooleanRule<OrderLineData>({
    id: 'cancel.line.not_shipped',
    name: 'Cannot Cancel Shipped Line',
    description: 'Cannot cancel a shipped line',
    category: 'cancellation',
    errorCode: 'CANNOT_CANCEL_SHIPPED_LINE',
    operations: ['cancelLine'],
    condition: ({ data }) => data.line.lineStatus !== 'shipped',
});

/**
 * Line must not already be cancelled
 */
export const lineNotAlreadyCancelled = simpleBooleanRule<OrderLineData>({
    id: 'cancel.line.not_already_cancelled',
    name: 'Line Not Already Cancelled',
    description: 'Line is already cancelled',
    category: 'cancellation',
    errorCode: 'LINE_ALREADY_CANCELLED',
    operations: ['cancelLine'],
    condition: ({ data }) => data.line.lineStatus !== 'cancelled',
});

// ============================================
// UNCANCEL ORDER RULES
// ============================================

/**
 * Only cancelled orders can be uncancelled
 */
export const orderMustBeCancelled = simpleBooleanRule<OrderData>({
    id: 'uncancel.order.must_be_cancelled',
    name: 'Order Must Be Cancelled',
    description: 'Order is not cancelled',
    category: 'cancellation',
    errorCode: 'ORDER_NOT_CANCELLED',
    operations: ['uncancelOrder'],
    condition: ({ data }) => data.order.status === 'cancelled',
});

// ============================================
// UNCANCEL LINE RULES
// ============================================

/**
 * Only cancelled lines can be uncancelled
 */
export const lineMustBeCancelled = simpleBooleanRule<OrderLineData>({
    id: 'uncancel.line.must_be_cancelled',
    name: 'Line Must Be Cancelled',
    description: 'Line is not cancelled',
    category: 'cancellation',
    errorCode: 'LINE_NOT_CANCELLED',
    operations: ['uncancelLine'],
    condition: ({ data }) => data.line.lineStatus === 'cancelled',
});

// ============================================
// EXPORTS
// ============================================

/**
 * All cancellation rules
 */
export const cancellationRules = [
    orderNotAlreadyCancelled,
    orderNotShippedOrDelivered,
    lineNotShipped,
    lineNotAlreadyCancelled,
    orderMustBeCancelled,
    lineMustBeCancelled,
];
