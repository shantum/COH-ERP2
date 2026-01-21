/**
 * Order Status Computation Utility
 *
 * Core principle: The line is the atomic unit. Order status is computed from lines.
 *
 * Line Status Flow:
 *   pending -> on_hold -> (release) -> pending
 *   pending -> allocated -> picked -> packed -> shipped -> delivered
 *   shipped -> rto_initiated -> rto_received
 *   Any state -> cancelled
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

import type { PrismaClient, Order, OrderLine as PrismaOrderLine } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { isValidTransition } from './orderStateMachine.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

/** Valid line statuses in order of progression */
export type LineStatus =
    | 'pending'
    | 'allocated'
    | 'picked'
    | 'packed'
    | 'shipped'
    | 'delivered'
    | 'rto_initiated'
    | 'rto_received'
    | 'cancelled';

/** Valid order statuses */
export type OrderStatus =
    | 'open'
    | 'on_hold'
    | 'partially_on_hold'
    | 'delivered'
    | 'shipped'
    | 'partially_shipped'
    | 'cancelled'
    | 'archived';

/** Action-oriented order state for UI display */
export type OrderState =
    | 'needs_fulfillment'
    | 'in_transit'
    | 'at_risk'
    | 'pending_payment'
    | 'completed'
    | 'archived';

/** Order line with minimal fields needed for status computation */
export interface OrderLineForStatus {
    lineStatus: string;
    isOnHold?: boolean;
}

/** Order with lines for status computation */
export interface OrderWithLinesForStatus {
    isOnHold?: boolean;
    isArchived?: boolean;
    orderLines: OrderLineForStatus[];
}

/** Order with fields needed for state computation */
export interface OrderForState {
    isArchived?: boolean;
    terminalStatus?: string | null;
    trackingStatus?: string | null;
    paymentMethod?: string | null;
    codRemittedAt?: Date | null;
    status?: string;
    shippedAt?: Date | null;
}

/** Order with fields needed for processing time calculation */
export interface OrderForProcessingTimes {
    orderDate?: Date | null;
    shippedAt?: Date | null;
    deliveredAt?: Date | null;
}

/** Result of recomputing order status */
export interface RecomputeResult {
    order: Order & { orderLines: Pick<PrismaOrderLine, 'id' | 'lineStatus'>[] };
    previousStatus: string;
    newStatus: OrderStatus;
    changed: boolean;
}

/** Result of batch recomputing order status */
export interface BatchRecomputeResult {
    updated: number;
    unchanged: number;
    errors: Array<{ orderId: string; error: string }>;
}

/** Summary of line statuses for an order */
export interface LineStatusSummary {
    total: number;
    pending: number;
    allocated: number;
    picked: number;
    packed: number;
    shipped: number;
    delivered: number;
    rto_initiated: number;
    rto_received: number;
    cancelled: number;
    onHold: number;
}

/** Processing time metrics in days */
export interface ProcessingTimes {
    orderToShipped: number | null;
    shippedToDelivered: number | null;
    totalOrderToDelivered: number | null;
}

/** Prisma transaction client type */
type TransactionClient = Omit<
    PrismaClient,
    '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ============================================
// CONSTANTS
// ============================================

/** Valid line statuses in order of progression */
export const LINE_STATUSES = [
    'pending',
    'allocated',
    'picked',
    'packed',
    'shipped',
    'delivered',
    'rto_initiated',
    'rto_received',
    'cancelled',
] as const;

/** Shipped or beyond states (for determining order-level shipped status) */
export const SHIPPED_OR_BEYOND = ['shipped', 'delivered', 'rto_initiated', 'rto_received'] as const;

// ============================================
// FUNCTIONS
// ============================================

/**
 * Compute the order status based on line states
 *
 * @param order - Order with orderLines included
 * @returns Computed status
 */
export function computeOrderStatus(order: OrderWithLinesForStatus): OrderStatus {
    if (!order || !order.orderLines) {
        throw new Error('Order with orderLines is required');
    }

    // Archived orders stay archived
    if (order.isArchived) {
        return 'archived';
    }

    // Filter out cancelled lines for status computation
    const activeLines = order.orderLines.filter((l) => l.lineStatus !== 'cancelled');

    // All lines cancelled = order cancelled
    if (activeLines.length === 0) {
        return 'cancelled';
    }

    // Order-level hold takes precedence
    if (order.isOnHold) {
        return 'on_hold';
    }

    // Check for line-level holds
    const heldLines = activeLines.filter((l) => l.isOnHold);
    if (heldLines.length === activeLines.length) {
        return 'on_hold'; // All lines on hold = order on hold
    }
    if (heldLines.length > 0) {
        return 'partially_on_hold';
    }

    // Check delivery status
    const deliveredLines = activeLines.filter((l) => l.lineStatus === 'delivered');
    if (deliveredLines.length === activeLines.length) {
        return 'delivered';
    }

    // Check shipped status (all active lines in shipped/delivered/rto states)
    const shippedOrBeyond = activeLines.filter((l) =>
        (SHIPPED_OR_BEYOND as readonly string[]).includes(l.lineStatus)
    );
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
 * @param orderId - The order ID to recompute
 * @param tx - Optional Prisma transaction client
 * @returns Result with order, previous/new status, and whether it changed
 */
export async function recomputeOrderStatus(
    orderId: string,
    tx: TransactionClient | null = null
): Promise<RecomputeResult> {
    const client = tx || prisma;

    // Fetch order with lines (isOnHold removed from OrderLine schema)
    const order = await client.order.findUnique({
        where: { id: orderId },
        include: {
            orderLines: {
                select: {
                    id: true,
                    lineStatus: true,
                },
            },
        },
    });

    if (!order) {
        throw new Error(`Order not found: ${orderId}`);
    }

    const previousStatus = order.status;
    // Map order lines to include isOnHold: false for compatibility
    const orderForCompute = {
        ...order,
        orderLines: order.orderLines.map(l => ({ ...l, isOnHold: false }))
    };
    const newStatus = computeOrderStatus(orderForCompute);
    const changed = previousStatus !== newStatus;

    // Only update if status changed
    if (changed) {
        await client.order.update({
            where: { id: orderId },
            data: { status: newStatus },
        });
    }

    return {
        order,
        previousStatus,
        newStatus,
        changed,
    };
}

/**
 * Batch recompute status for multiple orders
 * Useful for migrations or bulk operations
 *
 * @param orderIds - Array of order IDs to recompute
 * @returns Summary of updated, unchanged, and errored orders
 */
export async function batchRecomputeOrderStatus(orderIds: string[]): Promise<BatchRecomputeResult> {
    const results: BatchRecomputeResult = {
        updated: 0,
        unchanged: 0,
        errors: [],
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
            const message = error instanceof Error ? error.message : 'Unknown error';
            results.errors.push({ orderId, error: message });
        }
    }

    return results;
}

/**
 * Check if a line status transition is valid
 *
 * @deprecated Use isValidTransition from orderStateMachine.ts instead.
 * This function is kept for backwards compatibility but now delegates to the state machine.
 *
 * @param currentStatus - Current line status
 * @param newStatus - Proposed new status
 * @returns Whether the transition is valid
 */
export { isValidTransition as isValidLineStatusTransition } from './orderStateMachine.js';

/**
 * Get summary of order line states
 * Useful for UI display
 *
 * @param order - Order with orderLines
 * @returns Summary of line states
 */
export function getLineStatusSummary(order: { orderLines?: OrderLineForStatus[] }): LineStatusSummary {
    const lines = order.orderLines || [];
    const summary: LineStatusSummary = {
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
        onHold: 0,
    };

    for (const line of lines) {
        const status = line.lineStatus;
        // Increment count for valid line statuses
        if (status === 'pending') summary.pending++;
        else if (status === 'allocated') summary.allocated++;
        else if (status === 'picked') summary.picked++;
        else if (status === 'packed') summary.packed++;
        else if (status === 'shipped') summary.shipped++;
        else if (status === 'delivered') summary.delivered++;
        else if (status === 'rto_initiated') summary.rto_initiated++;
        else if (status === 'rto_received') summary.rto_received++;
        else if (status === 'cancelled') summary.cancelled++;

        if (line.isOnHold) {
            summary.onHold++;
        }
    }

    return summary;
}

// ============================================
// ACTION-ORIENTED ORDER STATE (Zen Philosophy)
// ============================================

/**
 * Compute the action-oriented order state
 * This is what users see - focused on "what do I need to do?"
 *
 * States:
 *   - needs_fulfillment: Not yet shipped
 *   - in_transit: Shipped, awaiting delivery
 *   - at_risk: COD >7 days OR RTO in progress
 *   - pending_payment: COD delivered, awaiting remittance
 *   - completed: Done (delivered/rto_received/cancelled)
 *   - archived: Historical (no longer active)
 *
 * @param order - Order with necessary fields
 * @returns Action-oriented order state
 */
export function computeOrderState(order: OrderForState): OrderState {
    // Archived is final
    if (order.isArchived) return 'archived';

    // Completed states (terminal status set)
    if (order.terminalStatus) return 'completed';

    // COD pending payment (delivered but not remitted)
    if (
        order.trackingStatus === 'delivered' &&
        order.paymentMethod === 'COD' &&
        !order.codRemittedAt
    ) {
        return 'pending_payment';
    }

    // At risk: RTO in progress OR COD in transit > 7 days
    if (order.status === 'shipped') {
        const isRto = order.trackingStatus?.startsWith('rto_');
        if (isRto) return 'at_risk';

        // COD orders in transit > 7 days are at risk
        if (order.paymentMethod === 'COD' && order.shippedAt) {
            const daysSinceShipped = Math.floor(
                (Date.now() - new Date(order.shippedAt).getTime()) / (1000 * 60 * 60 * 24)
            );
            if (daysSinceShipped > 7) return 'at_risk';
        }

        return 'in_transit';
    }

    // Default: needs fulfillment
    return 'needs_fulfillment';
}

/**
 * Calculate processing time metrics for an order
 *
 * @param order - Order with date fields
 * @returns Processing time metrics in days
 */
export function calculateProcessingTimes(order: OrderForProcessingTimes): ProcessingTimes {
    const times: ProcessingTimes = {
        orderToShipped: null,
        shippedToDelivered: null,
        totalOrderToDelivered: null,
    };

    if (order.shippedAt && order.orderDate) {
        times.orderToShipped = Math.floor(
            (new Date(order.shippedAt).getTime() - new Date(order.orderDate).getTime()) /
                (1000 * 60 * 60 * 24)
        );
    }

    if (order.deliveredAt && order.shippedAt) {
        times.shippedToDelivered = Math.floor(
            (new Date(order.deliveredAt).getTime() - new Date(order.shippedAt).getTime()) /
                (1000 * 60 * 60 * 24)
        );
    }

    if (order.deliveredAt && order.orderDate) {
        times.totalOrderToDelivered = Math.floor(
            (new Date(order.deliveredAt).getTime() - new Date(order.orderDate).getTime()) /
                (1000 * 60 * 60 * 24)
        );
    }

    return times;
}

// ============================================
// DEFAULT EXPORT
// ============================================

export default {
    computeOrderStatus,
    recomputeOrderStatus,
    batchRecomputeOrderStatus,
    isValidLineStatusTransition: isValidTransition,
    getLineStatusSummary,
    computeOrderState,
    calculateProcessingTimes,
    LINE_STATUSES,
    SHIPPED_OR_BEYOND,
};
