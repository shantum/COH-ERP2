/**
 * Order Line Mutations - Domain Layer
 *
 * Core business logic for line-level mutations.
 * Extracted from tRPC procedures to be shared between:
 * - Express tRPC router (existing)
 * - TanStack Start Server Functions (new)
 *
 * All functions:
 * - Accept a Kysely database instance
 * - Return a result (not throw on validation errors)
 * - Do NOT handle SSE broadcasts (that's the caller's job)
 */

import type { Kysely } from 'kysely';
import type { DB } from '../../database/types.js';

// ============================================
// TYPES
// ============================================

export interface MutationResult<T> {
    success: boolean;
    data?: T;
    error?: {
        code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT';
        message: string;
    };
}

export interface MarkLineDeliveredInput {
    lineId: string;
    deliveredAt?: string; // ISO string
}

export interface MarkLineDeliveredResult {
    lineId: string;
    orderId: string;
    deliveredAt: Date;
    orderTerminal: boolean;
}

export interface MarkLineRtoInput {
    lineId: string;
}

export interface MarkLineRtoResult {
    lineId: string;
    orderId: string;
    rtoInitiatedAt: Date;
}

export interface ReceiveLineRtoInput {
    lineId: string;
    condition?: 'good' | 'unopened' | 'damaged' | 'wrong_product';
}

export interface ReceiveLineRtoResult {
    lineId: string;
    orderId: string;
    rtoReceivedAt: Date;
    condition: string;
    orderTerminal: boolean;
    inventoryRestored: boolean;
}

export interface CancelLineInput {
    lineId: string;
    reason?: string;
}

export interface CancelLineResult {
    lineId: string;
    orderId: string;
    lineStatus: 'cancelled';
    inventoryReleased: boolean;
}

// ============================================
// MARK LINE DELIVERED
// ============================================

/**
 * Mark a shipped line as delivered
 *
 * Business rules:
 * - Line must be in 'shipped' status
 * - Idempotent: returns success if already delivered
 * - Updates order terminal status if all shipped lines delivered
 */
export async function markLineDeliveredKysely(
    db: Kysely<DB>,
    input: MarkLineDeliveredInput
): Promise<MutationResult<MarkLineDeliveredResult>> {
    const { lineId, deliveredAt } = input;
    const deliveryTime = deliveredAt ? new Date(deliveredAt) : new Date();

    // Fetch line with order context
    const line = await db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .select([
            'OrderLine.id',
            'OrderLine.lineStatus',
            'OrderLine.deliveredAt',
            'OrderLine.orderId',
            'Order.customerId',
        ])
        .where('OrderLine.id', '=', lineId)
        .executeTakeFirst();

    if (!line) {
        return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Order line not found' },
        };
    }

    // Validate line is shipped
    if (line.lineStatus !== 'shipped') {
        return {
            success: false,
            error: {
                code: 'BAD_REQUEST',
                message: `Cannot mark as delivered: line status is '${line.lineStatus}', must be 'shipped'`,
            },
        };
    }

    // Already delivered - idempotent
    if (line.deliveredAt) {
        return {
            success: true,
            data: {
                lineId,
                orderId: line.orderId,
                deliveredAt: line.deliveredAt as Date,
                orderTerminal: false,
            },
        };
    }

    // Update line-level deliveredAt and trackingStatus
    await db
        .updateTable('OrderLine')
        .set({
            deliveredAt: deliveryTime,
            trackingStatus: 'delivered',
        })
        .where('id', '=', lineId)
        .execute();

    // Check if ALL shipped lines are now delivered
    const undeliveredResult = await db
        .selectFrom('OrderLine')
        .select(db.fn.count<number>('id').as('count'))
        .where('orderId', '=', line.orderId)
        .where('lineStatus', '=', 'shipped')
        .where('deliveredAt', 'is', null)
        .where('id', '!=', lineId)
        .executeTakeFirst();

    const undeliveredShippedLines = Number(undeliveredResult?.count || 0);
    let orderTerminal = false;

    if (undeliveredShippedLines === 0) {
        // All shipped lines are delivered - set order terminal status
        await db
            .updateTable('Order')
            .set({
                terminalStatus: 'delivered',
                terminalAt: deliveryTime,
                deliveredAt: deliveryTime,
                status: 'delivered',
            })
            .where('id', '=', line.orderId)
            .execute();
        orderTerminal = true;
    }

    return {
        success: true,
        data: {
            lineId,
            orderId: line.orderId,
            deliveredAt: deliveryTime,
            orderTerminal,
        },
    };
}

// ============================================
// MARK LINE RTO
// ============================================

/**
 * Initiate RTO for a shipped line
 *
 * Business rules:
 * - Line must be in 'shipped' status
 * - Idempotent: returns success if already RTO initiated
 * - Increments customer RTO count
 */
export async function markLineRtoKysely(
    db: Kysely<DB>,
    input: MarkLineRtoInput
): Promise<MutationResult<MarkLineRtoResult>> {
    const { lineId } = input;
    const now = new Date();

    // Fetch line with order context
    const line = await db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .select([
            'OrderLine.id',
            'OrderLine.lineStatus',
            'OrderLine.rtoInitiatedAt',
            'OrderLine.orderId',
            'Order.customerId',
        ])
        .where('OrderLine.id', '=', lineId)
        .executeTakeFirst();

    if (!line) {
        return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Order line not found' },
        };
    }

    // Validate line is shipped
    if (line.lineStatus !== 'shipped') {
        return {
            success: false,
            error: {
                code: 'BAD_REQUEST',
                message: `Cannot initiate RTO: line status is '${line.lineStatus}', must be 'shipped'`,
            },
        };
    }

    // Already RTO initiated - idempotent
    if (line.rtoInitiatedAt) {
        return {
            success: true,
            data: {
                lineId,
                orderId: line.orderId,
                rtoInitiatedAt: line.rtoInitiatedAt as Date,
            },
        };
    }

    // Update line-level rtoInitiatedAt and trackingStatus
    await db
        .updateTable('OrderLine')
        .set({
            rtoInitiatedAt: now,
            trackingStatus: 'rto_initiated',
        })
        .where('id', '=', lineId)
        .execute();

    // Increment customer RTO count
    if (line.customerId) {
        await db
            .updateTable('Customer')
            .set((eb) => ({
                rtoCount: eb('rtoCount', '+', 1),
            }))
            .where('id', '=', line.customerId)
            .execute();
    }

    // Update order-level rtoInitiatedAt for backward compat
    await db
        .updateTable('Order')
        .set({ rtoInitiatedAt: now })
        .where('id', '=', line.orderId)
        .execute();

    return {
        success: true,
        data: {
            lineId,
            orderId: line.orderId,
            rtoInitiatedAt: now,
        },
    };
}

// ============================================
// RECEIVE LINE RTO
// ============================================

/**
 * Mark RTO as received (item returned to warehouse)
 *
 * Business rules:
 * - Line must have RTO initiated
 * - Idempotent: returns success if already received
 * - Restores inventory based on condition
 * - Updates order terminal status if all RTO lines received
 */
export async function receiveLineRtoKysely(
    db: Kysely<DB>,
    input: ReceiveLineRtoInput
): Promise<MutationResult<ReceiveLineRtoResult>> {
    const { lineId, condition = 'good' } = input;
    const now = new Date();

    // Fetch line with SKU context
    const line = await db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .select([
            'OrderLine.id',
            'OrderLine.lineStatus',
            'OrderLine.rtoInitiatedAt',
            'OrderLine.rtoReceivedAt',
            'OrderLine.orderId',
            'OrderLine.skuId',
            'OrderLine.qty',
            'Order.customerId',
        ])
        .where('OrderLine.id', '=', lineId)
        .executeTakeFirst();

    if (!line) {
        return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Order line not found' },
        };
    }

    // Validate RTO was initiated
    if (!line.rtoInitiatedAt) {
        return {
            success: false,
            error: {
                code: 'BAD_REQUEST',
                message: 'Cannot receive RTO: RTO was not initiated for this line',
            },
        };
    }

    // Already received - idempotent
    if (line.rtoReceivedAt) {
        return {
            success: true,
            data: {
                lineId,
                orderId: line.orderId,
                rtoReceivedAt: line.rtoReceivedAt as Date,
                condition,
                orderTerminal: false,
                inventoryRestored: false,
            },
        };
    }

    // Update line-level rtoReceivedAt and trackingStatus
    await db
        .updateTable('OrderLine')
        .set({
            rtoReceivedAt: now,
            trackingStatus: 'rto_delivered',
            rtoCondition: condition,
        })
        .where('id', '=', lineId)
        .execute();

    // Restore inventory if condition is good or unopened
    let inventoryRestored = false;
    if ((condition === 'good' || condition === 'unopened') && line.skuId) {
        // Create inward transaction to restore inventory
        await db
            .insertInto('InventoryTransaction')
            .values({
                id: crypto.randomUUID(),
                skuId: line.skuId,
                txnType: 'inward',
                qty: line.qty,
                reason: 'rto_receipt',
                notes: `RTO received (${condition}) - Line ${lineId}`,
                referenceId: lineId,
                createdById: 'system', // Server Function context
            })
            .execute();
        inventoryRestored = true;
    }

    // Check if ALL RTO lines are now received
    const unreceivedResult = await db
        .selectFrom('OrderLine')
        .select(db.fn.count<number>('id').as('count'))
        .where('orderId', '=', line.orderId)
        .where('rtoInitiatedAt', 'is not', null)
        .where('rtoReceivedAt', 'is', null)
        .where('id', '!=', lineId)
        .executeTakeFirst();

    const unreceivedRtoLines = Number(unreceivedResult?.count || 0);
    let orderTerminal = false;

    if (unreceivedRtoLines === 0) {
        // All RTO lines are received - set order terminal status
        await db
            .updateTable('Order')
            .set({
                terminalStatus: 'rto_delivered',
                terminalAt: now,
                rtoReceivedAt: now,
            })
            .where('id', '=', line.orderId)
            .execute();
        orderTerminal = true;
    }

    return {
        success: true,
        data: {
            lineId,
            orderId: line.orderId,
            rtoReceivedAt: now,
            condition,
            orderTerminal,
            inventoryRestored,
        },
    };
}

// ============================================
// CANCEL LINE
// ============================================

/**
 * Cancel an order line
 *
 * Business rules:
 * - Line must be in cancellable status (pending, allocated)
 * - Releases inventory if allocated
 * - Does NOT cancel whole order (caller decides)
 */
export async function cancelLineKysely(
    db: Kysely<DB>,
    input: CancelLineInput
): Promise<MutationResult<CancelLineResult>> {
    const { lineId, reason: _reason } = input;
    // _reason is captured but not stored in DB (OrderLine has no cancelReason field)

    // Fetch line
    const line = await db
        .selectFrom('OrderLine')
        .select([
            'OrderLine.id',
            'OrderLine.lineStatus',
            'OrderLine.orderId',
            'OrderLine.skuId',
            'OrderLine.qty',
        ])
        .where('OrderLine.id', '=', lineId)
        .executeTakeFirst();

    if (!line) {
        return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Order line not found' },
        };
    }

    // Validate line is cancellable
    const cancellableStatuses = ['pending', 'allocated', 'picked', 'packed'];
    if (!cancellableStatuses.includes(line.lineStatus || '')) {
        return {
            success: false,
            error: {
                code: 'BAD_REQUEST',
                message: `Cannot cancel line: status is '${line.lineStatus}', must be one of: ${cancellableStatuses.join(', ')}`,
            },
        };
    }

    // Already cancelled - idempotent
    if (line.lineStatus === 'cancelled') {
        return {
            success: true,
            data: {
                lineId,
                orderId: line.orderId,
                lineStatus: 'cancelled',
                inventoryReleased: false,
            },
        };
    }

    // Update line status to cancelled
    await db
        .updateTable('OrderLine')
        .set({
            lineStatus: 'cancelled',
            productionBatchId: null, // Clear production batch link
        })
        .where('id', '=', lineId)
        .execute();

    // Release inventory if line was allocated (pending, allocated, picked, packed all have inventory)
    let inventoryReleased = false;
    const hasInventory = ['allocated', 'picked', 'packed'].includes(line.lineStatus || '');
    if (hasInventory && line.skuId) {
        // Delete the outward transaction created during allocation
        await db
            .deleteFrom('InventoryTransaction')
            .where('referenceId', '=', lineId)
            .where('txnType', '=', 'outward')
            .where('reason', '=', 'order_allocation')
            .execute();
        inventoryReleased = true;
    }

    return {
        success: true,
        data: {
            lineId,
            orderId: line.orderId,
            lineStatus: 'cancelled',
            inventoryReleased,
        },
    };
}
