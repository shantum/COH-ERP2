/**
 * Order Status Utilities (Server-Side)
 *
 * computeOrderStatus lives in @coh/shared — this file provides
 * server-only functions that need database access.
 */

import type { PrismaClient, Order, OrderLine as PrismaOrderLine } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { isValidTransition } from './orderStateMachine.js';
import { computeOrderStatus, type OrderStatus } from '@coh/shared/domain';

// Re-export shared types so existing consumers don't break
export { computeOrderStatus, type OrderStatus, type OrderLineForStatus } from '@coh/shared/domain';
export { SHIPPED_OR_BEYOND, LINE_STATUSES } from '@coh/shared/domain';

// ============================================
// TYPE DEFINITIONS (server-only)
// ============================================

/** Action-oriented order state for UI display */
export type OrderState =
    | 'needs_fulfillment'
    | 'in_transit'
    | 'at_risk'
    | 'pending_payment'
    | 'completed'
    | 'archived';

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
    order: Order & { orderLines: Pick<PrismaOrderLine, 'id' | 'lineStatus' | 'trackingStatus'>[] };
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
    cancelled: number;
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
// FUNCTIONS
// ============================================

/**
 * Recompute and update the order status in the database.
 * Uses computeOrderStatus from @coh/shared as the single source of truth.
 */
export async function recomputeOrderStatus(
    orderId: string,
    tx: TransactionClient | null = null
): Promise<RecomputeResult> {
    const client = tx || prisma;

    const order = await client.order.findUnique({
        where: { id: orderId },
        include: {
            orderLines: {
                select: {
                    id: true,
                    lineStatus: true,
                    trackingStatus: true,
                },
            },
        },
    });

    if (!order) {
        throw new Error(`Order not found: ${orderId}`);
    }

    const previousStatus = order.status;
    const newStatus = computeOrderStatus(order);
    const changed = previousStatus !== newStatus;

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
 * Batch recompute status for multiple orders.
 * Useful for migrations or bulk operations.
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
 * @deprecated Use isValidTransition from orderStateMachine.ts instead.
 */
export { isValidTransition as isValidLineStatusTransition } from './orderStateMachine.js';

/**
 * Get summary of order line states. Useful for UI display.
 */
export function getLineStatusSummary(order: { orderLines?: { lineStatus: string }[] }): LineStatusSummary {
    const lines = order.orderLines || [];
    const summary: LineStatusSummary = {
        total: lines.length,
        pending: 0,
        allocated: 0,
        picked: 0,
        packed: 0,
        shipped: 0,
        delivered: 0,
        cancelled: 0,
    };

    for (const line of lines) {
        const status = line.lineStatus;
        if (status === 'pending') summary.pending++;
        else if (status === 'allocated') summary.allocated++;
        else if (status === 'picked') summary.picked++;
        else if (status === 'packed') summary.packed++;
        else if (status === 'shipped') summary.shipped++;
        else if (status === 'delivered') summary.delivered++;
        else if (status === 'cancelled') summary.cancelled++;
    }

    return summary;
}

// ============================================
// ACTION-ORIENTED ORDER STATE
// ============================================

/**
 * Compute the action-oriented order state.
 * Focused on "what do I need to do?"
 */
export function computeOrderState(order: OrderForState): OrderState {
    if (order.isArchived) return 'archived';

    if (order.terminalStatus) return 'completed';

    if (
        order.trackingStatus === 'delivered' &&
        order.paymentMethod === 'COD' &&
        !order.codRemittedAt
    ) {
        return 'pending_payment';
    }

    if (order.status === 'shipped') {
        const isRto = order.trackingStatus?.startsWith('rto_');
        if (isRto) return 'at_risk';

        if (order.paymentMethod === 'COD' && order.shippedAt) {
            const daysSinceShipped = Math.floor(
                (Date.now() - new Date(order.shippedAt).getTime()) / (1000 * 60 * 60 * 24)
            );
            if (daysSinceShipped > 7) return 'at_risk';
        }

        return 'in_transit';
    }

    return 'needs_fulfillment';
}

/**
 * Calculate processing time metrics for an order.
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
};
