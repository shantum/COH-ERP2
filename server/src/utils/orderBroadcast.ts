/**
 * Order Broadcast Utilities
 *
 * DRY helpers for SSE broadcasting patterns used across order mutations.
 * These helpers reduce duplication of the deferredExecutor + broadcastOrderUpdate pattern.
 *
 * @module utils/orderBroadcast
 */

import type { PrismaClient } from '@prisma/client';
import { deferredExecutor } from '../services/deferredExecutor.js';
import { broadcastOrderUpdate } from '../routes/sse.js';
import { flattenLineForSSE, LINE_SSE_SELECT } from './orderViews.js';

// ============================================
// LINE STATUS BROADCASTS
// ============================================

/**
 * Broadcast a line status change with full row data
 * Fetches the updated line data and broadcasts it with complete information
 *
 * @param prisma - Prisma client
 * @param lineId - The line ID that was updated
 * @param newStatus - The new status of the line
 * @param orderId - The order ID (optional, for context)
 * @param view - The view to broadcast to (default: 'open')
 */
export function broadcastLineStatusChange(
    prisma: PrismaClient,
    lineId: string,
    newStatus: string,
    orderId?: string,
    view: string = 'open'
): void {
    deferredExecutor.enqueue(async () => {
        try {
            // Fetch full row data for SSE broadcast
            const updatedLine = await prisma.orderLine.findUnique({
                where: { id: lineId },
                select: LINE_SSE_SELECT,
            });

            if (updatedLine) {
                const rowData = flattenLineForSSE(updatedLine);
                broadcastOrderUpdate({
                    type: 'line_status',
                    view,
                    lineId,
                    orderId,
                    changes: { lineStatus: newStatus },
                    rowData: rowData ? (rowData as unknown as Record<string, unknown>) : undefined,
                });
            } else {
                // Fallback to minimal broadcast
                broadcastOrderUpdate({
                    type: 'line_status',
                    view,
                    lineId,
                    orderId,
                    changes: { lineStatus: newStatus },
                });
            }
        } catch {
            // Fallback to minimal broadcast if fetch fails
            broadcastOrderUpdate({
                type: 'line_status',
                view,
                lineId,
                orderId,
                changes: { lineStatus: newStatus },
            });
        }
    }, { lineId, orderId, action: `line_status_change:${newStatus}` });
}

/**
 * Broadcast multiple line status changes
 *
 * @param prisma - Prisma client
 * @param lineIds - The line IDs that were updated
 * @param newStatus - The new status of the lines
 * @param view - The view to broadcast to (default: 'open')
 */
export function broadcastBatchLineStatusChange(
    prisma: PrismaClient,
    lineIds: string[],
    newStatus: string,
    view: string = 'open'
): void {
    deferredExecutor.enqueue(async () => {
        try {
            // Fetch full row data for all updated lines
            const updatedLines = await prisma.orderLine.findMany({
                where: { id: { in: lineIds } },
                select: LINE_SSE_SELECT,
            });

            if (updatedLines.length > 0) {
                for (const line of updatedLines) {
                    const rowData = flattenLineForSSE(line);
                    broadcastOrderUpdate({
                        type: 'line_status',
                        view,
                        lineId: line.id,
                        orderId: line.orderId,
                        changes: { lineStatus: newStatus },
                        rowData: rowData ? (rowData as unknown as Record<string, unknown>) : undefined,
                    });
                }
            } else {
                // Fallback to minimal broadcast for each line
                for (const lineId of lineIds) {
                    broadcastOrderUpdate({
                        type: 'line_status',
                        view,
                        lineId,
                        changes: { lineStatus: newStatus },
                    });
                }
            }
        } catch {
            // Fallback to minimal broadcast if fetch fails
            for (const lineId of lineIds) {
                broadcastOrderUpdate({
                    type: 'line_status',
                    view,
                    lineId,
                    changes: { lineStatus: newStatus },
                });
            }
        }
    }, { action: `batch_line_status_change:${newStatus}`, lineId: lineIds.join(',') });
}

// ============================================
// ORDER-LEVEL BROADCASTS
// ============================================

/**
 * Broadcast an order shipped event
 *
 * @param orderId - The order ID
 * @param changes - Optional changes to include (awbNumber, courier, etc.)
 */
export function broadcastOrderShipped(
    orderId: string,
    changes?: Record<string, unknown>
): void {
    deferredExecutor.enqueue(async () => {
        broadcastOrderUpdate({
            type: 'order_shipped',
            orderId,
            changes,
        });
    }, { orderId, action: 'order_shipped' });
}

/**
 * Broadcast an order cancelled event
 *
 * @param orderId - The order ID
 * @param lineIds - The IDs of lines that were cancelled
 */
export function broadcastOrderCancelled(
    orderId: string,
    lineIds: string[]
): void {
    deferredExecutor.enqueue(async () => {
        broadcastOrderUpdate({
            type: 'order_cancelled',
            orderId,
            lineIds,
        });
    }, { orderId, action: 'order_cancelled' });
}

/**
 * Broadcast an order uncancelled event
 *
 * @param orderId - The order ID
 * @param lineIds - The IDs of lines that were uncancelled
 */
export function broadcastOrderUncancelled(
    orderId: string,
    lineIds: string[]
): void {
    deferredExecutor.enqueue(async () => {
        broadcastOrderUpdate({
            type: 'order_uncancelled',
            orderId,
            lineIds,
        });
    }, { orderId, action: 'order_uncancelled' });
}

// ============================================
// DELIVERY STATUS BROADCASTS
// ============================================

/**
 * Broadcast a line delivered event
 *
 * @param lineId - The line ID
 * @param orderId - The order ID
 */
export function broadcastLineDelivered(
    lineId: string,
    orderId: string
): void {
    broadcastOrderUpdate({
        type: 'line_delivered',
        lineId,
        orderId,
    });
}

/**
 * Broadcast a line RTO event
 *
 * @param lineId - The line ID
 * @param orderId - The order ID
 */
export function broadcastLineRto(
    lineId: string,
    orderId: string
): void {
    broadcastOrderUpdate({
        type: 'line_rto',
        lineId,
        orderId,
    });
}

/**
 * Broadcast a line RTO received event
 *
 * @param lineId - The line ID
 * @param orderId - The order ID
 */
export function broadcastLineRtoReceived(
    lineId: string,
    orderId: string
): void {
    broadcastOrderUpdate({
        type: 'line_rto_received',
        lineId,
        orderId,
    });
}

/**
 * Broadcast an order delivered event
 *
 * @param orderId - The order ID
 */
export function broadcastOrderDelivered(
    orderId: string
): void {
    broadcastOrderUpdate({
        type: 'order_delivered',
        orderId,
    });
}

/**
 * Broadcast an order RTO event
 *
 * @param orderId - The order ID
 */
export function broadcastOrderRto(
    orderId: string
): void {
    broadcastOrderUpdate({
        type: 'order_rto',
        orderId,
    });
}

/**
 * Broadcast an order RTO received event
 *
 * @param orderId - The order ID
 */
export function broadcastOrderRtoReceived(
    orderId: string
): void {
    broadcastOrderUpdate({
        type: 'order_rto_received',
        orderId,
    });
}

// ============================================
// COMBINED OPERATIONS
// ============================================

/**
 * Options for deferred SSE broadcast with cache invalidation
 */
export interface DeferredBroadcastOptions {
    invalidateInventory?: string[];
    invalidateCustomerStats?: string[];
}

/**
 * Execute deferred work: cache invalidation + SSE broadcast
 * Combines the common pattern of invalidating caches and broadcasting in a single deferred call
 *
 * @param options - Cache invalidation options
 * @param broadcast - The broadcast function to call
 * @param metadata - Optional metadata for error logging (orderId, lineId, skuId, action)
 */
export function deferCacheInvalidationAndBroadcast(
    options: DeferredBroadcastOptions,
    broadcast: () => void,
    metadata?: { orderId?: string; lineId?: string; skuId?: string; action?: string }
): void {
    deferredExecutor.enqueue(async () => {
        // Import dynamically to avoid circular dependencies
        if (options.invalidateInventory && options.invalidateInventory.length > 0) {
            const { inventoryBalanceCache } = await import('../services/inventoryBalanceCache.js');
            inventoryBalanceCache.invalidate(options.invalidateInventory);
        }

        if (options.invalidateCustomerStats && options.invalidateCustomerStats.length > 0) {
            const { customerStatsCache } = await import('../services/customerStatsCache.js');
            customerStatsCache.invalidate(options.invalidateCustomerStats);
        }

        // Execute the broadcast
        broadcast();
    }, metadata);
}
