/**
 * Order Status Computation Utility
 *
 * Core principle: The line is the atomic unit. Order status is computed from lines.
 *
 * Line Status Flow:
 *   pending → on_hold → (release) → pending
 *   pending → allocated → picked → packed → shipped → delivered
 *   shipped → rto_initiated → rto_received
 *   Any state → cancelled
 *
 * Order Status = f(lines):
 *   - cancelled: All lines cancelled
 *   - on_hold: Order-level hold active
 *   - partially_on_hold: Some lines on hold
 *   - delivered: All lines delivered
 *   - shipped: All lines in shipped/delivered/rto states
 *   - partially_shipped: Some lines shipped
 *   - open: Default (fulfillment in progress)
 */

import prisma from '../lib/prisma.js';

// Valid line statuses in order of progression
const LINE_STATUSES = [
    'pending',
    'allocated',
    'picked',
    'packed',
    'shipped',
    'delivered',
    'rto_initiated',
    'rto_received',
    'cancelled'
];

// Shipped or beyond states (for determining order-level shipped status)
const SHIPPED_OR_BEYOND = ['shipped', 'delivered', 'rto_initiated', 'rto_received'];

/**
 * Compute the order status based on line states
 *
 * @param {Object} order - Order with orderLines included
 * @param {Array} order.orderLines - Array of order lines
 * @param {boolean} order.isOnHold - Order-level hold flag
 * @param {boolean} order.isArchived - Archive flag
 * @returns {string} Computed status
 */
export function computeOrderStatus(order) {
    if (!order || !order.orderLines) {
        throw new Error('Order with orderLines is required');
    }

    // Archived orders stay archived
    if (order.isArchived) {
        return 'archived';
    }

    // Filter out cancelled lines for status computation
    const activeLines = order.orderLines.filter(l => l.lineStatus !== 'cancelled');

    // All lines cancelled = order cancelled
    if (activeLines.length === 0) {
        return 'cancelled';
    }

    // Order-level hold takes precedence
    if (order.isOnHold) {
        return 'on_hold';
    }

    // Check for line-level holds
    const heldLines = activeLines.filter(l => l.isOnHold);
    if (heldLines.length === activeLines.length) {
        return 'on_hold'; // All lines on hold = order on hold
    }
    if (heldLines.length > 0) {
        return 'partially_on_hold';
    }

    // Check delivery status
    const deliveredLines = activeLines.filter(l => l.lineStatus === 'delivered');
    if (deliveredLines.length === activeLines.length) {
        return 'delivered';
    }

    // Check shipped status (all active lines in shipped/delivered/rto states)
    const shippedOrBeyond = activeLines.filter(l => SHIPPED_OR_BEYOND.includes(l.lineStatus));
    if (shippedOrBeyond.length === activeLines.length) {
        return 'shipped';
    }

    // Partial shipping
    if (shippedOrBeyond.length > 0) {
        return 'partially_shipped';
    }

    // Default: still in fulfillment
    return 'open';
}

/**
 * Recompute and update the order status in the database
 *
 * @param {string} orderId - The order ID to recompute
 * @param {Object} [tx] - Optional Prisma transaction client
 * @returns {Promise<{order: Object, previousStatus: string, newStatus: string, changed: boolean}>}
 */
export async function recomputeOrderStatus(orderId, tx = null) {
    const client = tx || prisma;

    // Fetch order with lines
    const order = await client.order.findUnique({
        where: { id: orderId },
        include: {
            orderLines: {
                select: {
                    id: true,
                    lineStatus: true,
                    isOnHold: true
                }
            }
        }
    });

    if (!order) {
        throw new Error(`Order not found: ${orderId}`);
    }

    const previousStatus = order.status;
    const newStatus = computeOrderStatus(order);
    const changed = previousStatus !== newStatus;

    // Only update if status changed
    if (changed) {
        await client.order.update({
            where: { id: orderId },
            data: { status: newStatus }
        });
    }

    return {
        order,
        previousStatus,
        newStatus,
        changed
    };
}

/**
 * Batch recompute status for multiple orders
 * Useful for migrations or bulk operations
 *
 * @param {string[]} orderIds - Array of order IDs to recompute
 * @returns {Promise<{updated: number, unchanged: number, errors: Array}>}
 */
export async function batchRecomputeOrderStatus(orderIds) {
    const results = {
        updated: 0,
        unchanged: 0,
        errors: []
    };

    for (const orderId of orderIds) {
        try {
            const { changed } = await recomputeOrderStatus(orderId);
            if (changed) {
                results.updated++;
            } else {
                results.unchanged++;
            }
        } catch (error) {
            results.errors.push({ orderId, error: error.message });
        }
    }

    return results;
}

/**
 * Check if a line status transition is valid
 *
 * @param {string} currentStatus - Current line status
 * @param {string} newStatus - Proposed new status
 * @returns {boolean} Whether the transition is valid
 */
export function isValidLineStatusTransition(currentStatus, newStatus) {
    // Can always cancel
    if (newStatus === 'cancelled') return true;

    // Can always go to/from on_hold states via hold/release
    // These are handled separately via hold/release endpoints

    const currentIndex = LINE_STATUSES.indexOf(currentStatus);
    const newIndex = LINE_STATUSES.indexOf(newStatus);

    if (currentIndex === -1 || newIndex === -1) return false;

    // Normal progression: can only move forward
    return newIndex > currentIndex;
}

/**
 * Get summary of order line states
 * Useful for UI display
 *
 * @param {Object} order - Order with orderLines
 * @returns {Object} Summary of line states
 */
export function getLineStatusSummary(order) {
    const lines = order.orderLines || [];
    const summary = {
        total: lines.length,
        pending: 0,
        allocated: 0,
        picked: 0,
        packed: 0,
        shipped: 0,
        delivered: 0,
        rto_initiated: 0,
        rto_received: 0,
        cancelled: 0,
        onHold: 0
    };

    for (const line of lines) {
        if (summary[line.lineStatus] !== undefined) {
            summary[line.lineStatus]++;
        }
        if (line.isOnHold) {
            summary.onHold++;
        }
    }

    return summary;
}

export default {
    computeOrderStatus,
    recomputeOrderStatus,
    batchRecomputeOrderStatus,
    isValidLineStatusTransition,
    getLineStatusSummary,
    LINE_STATUSES,
    SHIPPED_OR_BEYOND
};
