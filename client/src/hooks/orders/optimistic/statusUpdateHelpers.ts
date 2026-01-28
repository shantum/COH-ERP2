/**
 * Status Update Helpers for Optimistic Updates
 * Functions that transform cached data for optimistic UI updates
 */

import type { OrdersListData, ShipData } from './types';
import { calculateInventoryDelta, hasAllocatedInventory, computeOrderStatus } from './inventoryHelpers';

// ============================================================================
// LINE STATUS UPDATES
// ============================================================================

/**
 * Optimistically update a row's line status in the cache
 * Returns a new data object with the row updated
 */
export function optimisticLineStatusUpdate(
    data: OrdersListData | undefined,
    lineId: string,
    newStatus: string,
    inventoryDelta?: number
): OrdersListData | undefined {
    if (!data) return data;

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (row.lineId !== lineId) return row;

            const updatedRow = { ...row, lineStatus: newStatus };

            // Update skuStock if inventory delta is provided
            if (inventoryDelta !== undefined && inventoryDelta !== 0 && row.skuStock !== undefined) {
                updatedRow.skuStock = row.skuStock + inventoryDelta;
            }

            return updatedRow;
        }),
        // Also update the nested order.orderLines for consistency
        ...(data.orders ? {
            orders: data.orders.map((order) => ({
                ...order,
                orderLines: order.orderLines?.map((line: any) =>
                    line.id === lineId
                        ? { ...line, lineStatus: newStatus }
                        : line
                ),
            })),
        } : {}),
    };
}

/**
 * Optimistically update multiple rows' line status in the cache
 * Used for batch operations like bulk allocate
 */
export function optimisticBatchLineStatusUpdate(
    data: OrdersListData | undefined,
    lineIds: string[],
    newStatus: string,
    /** Map of lineId -> inventory delta */
    inventoryDeltas?: Map<string, number>
): OrdersListData | undefined {
    if (!data) return data;

    const lineIdSet = new Set(lineIds);

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (!row.lineId || !lineIdSet.has(row.lineId)) return row;

            const updatedRow = { ...row, lineStatus: newStatus };

            // Update skuStock if inventory delta is provided
            const delta = inventoryDeltas?.get(row.lineId);
            if (delta !== undefined && delta !== 0 && row.skuStock !== undefined) {
                updatedRow.skuStock = row.skuStock + delta;
            }

            return updatedRow;
        }),
        ...(data.orders ? {
            orders: data.orders.map((order) => ({
                ...order,
                orderLines: order.orderLines?.map((line: any) =>
                    lineIdSet.has(line.id)
                        ? { ...line, lineStatus: newStatus }
                        : line
                ),
            })),
        } : {}),
    };
}

/**
 * Optimistically cancel a line
 * Marks line as cancelled and restores inventory if it was allocated
 */
export function optimisticCancelLine(
    data: OrdersListData | undefined,
    lineId: string
): OrdersListData | undefined {
    if (!data) return data;

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (row.lineId !== lineId) return row;

            const updatedRow = { ...row, lineStatus: 'cancelled' };

            // Restore inventory if was allocated
            const inventoryDelta = calculateInventoryDelta(
                row.lineStatus || 'pending',
                'cancelled',
                row.qty || 0
            );
            if (inventoryDelta !== 0 && row.skuStock !== undefined) {
                updatedRow.skuStock = row.skuStock + inventoryDelta;
            }

            return updatedRow;
        }),
        ...(data.orders ? {
            orders: data.orders.map((order) => ({
                ...order,
                orderLines: order.orderLines?.map((line: any) =>
                    line.id === lineId
                        ? { ...line, lineStatus: 'cancelled' }
                        : line
                ),
            })),
        } : {}),
    };
}

/**
 * Optimistically uncancel a line
 * Marks line as pending (does not re-allocate)
 */
export function optimisticUncancelLine(
    data: OrdersListData | undefined,
    lineId: string
): OrdersListData | undefined {
    if (!data) return data;

    return {
        ...data,
        rows: data.rows.map((row) =>
            row.lineId === lineId
                ? { ...row, lineStatus: 'pending' }
                : row
        ),
        ...(data.orders ? {
            orders: data.orders.map((order) => ({
                ...order,
                orderLines: order.orderLines?.map((line: any) =>
                    line.id === lineId
                        ? { ...line, lineStatus: 'pending' }
                        : line
                ),
            })),
        } : {}),
    };
}

// ============================================================================
// SHIPPING OPTIMISTIC UPDATES
// ============================================================================

/**
 * Optimistically ship specific lines
 * Updates specified line statuses to shipped with tracking info
 * IMPORTANT: Only updates lines that are in 'packed' status to match server logic
 */
export function optimisticShipLines(
    data: OrdersListData | undefined,
    lineIds: string[],
    shipData: ShipData
): OrdersListData | undefined {
    if (!data) return data;

    const lineIdSet = new Set(lineIds);

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (!row.lineId || !lineIdSet.has(row.lineId)) return row;
            // Only ship lines that are in 'packed' status (matching server validation)
            if (row.lineStatus !== 'packed') return row;

            return {
                ...row,
                lineStatus: shipData.lineStatus,
                awbNumber: shipData.awbNumber,
                courier: shipData.courier,
                lineShippedAt: shipData.shippedAt,
            };
        }),
        ...(data.orders ? {
            orders: data.orders.map((order) => ({
                ...order,
                orderLines: order.orderLines?.map((line: any) =>
                    lineIdSet.has(line.id) && line.lineStatus === 'packed'
                        ? {
                            ...line,
                            lineStatus: shipData.lineStatus,
                            awbNumber: shipData.awbNumber,
                            courier: shipData.courier,
                            shippedAt: shipData.shippedAt,
                        }
                        : line
                ),
            })),
        } : {}),
    };
}

/**
 * Optimistically unship specific lines
 * Reverts shipped lines back to packed status
 */
export function optimisticUnshipLines(
    data: OrdersListData | undefined,
    lineIds: string[]
): OrdersListData | undefined {
    if (!data) return data;

    const lineIdSet = new Set(lineIds);

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (!row.lineId || !lineIdSet.has(row.lineId)) return row;
            if (row.lineStatus !== 'shipped') return row;

            return {
                ...row,
                lineStatus: 'packed',
                awbNumber: null,
                courier: null,
                lineShippedAt: null,
            };
        }),
        ...(data.orders ? {
            orders: data.orders.map((order) => ({
                ...order,
                orderLines: order.orderLines?.map((line: any) =>
                    lineIdSet.has(line.id) && line.lineStatus === 'shipped'
                        ? {
                            ...line,
                            lineStatus: 'packed',
                            awbNumber: null,
                            courier: null,
                            shippedAt: null,
                        }
                        : line
                ),
            })),
        } : {}),
    };
}

/**
 * Optimistically update line tracking info
 */
export function optimisticUpdateLineTracking(
    data: OrdersListData | undefined,
    lineId: string,
    trackingData: { awbNumber?: string; courier?: string }
): OrdersListData | undefined {
    if (!data) return data;

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (row.lineId !== lineId) return row;
            return {
                ...row,
                ...(trackingData.awbNumber !== undefined && { awbNumber: trackingData.awbNumber }),
                ...(trackingData.courier !== undefined && { courier: trackingData.courier }),
            };
        }),
        ...(data.orders ? {
            orders: data.orders.map((order) => ({
                ...order,
                orderLines: order.orderLines?.map((line: any) =>
                    line.id === lineId
                        ? {
                            ...line,
                            ...(trackingData.awbNumber !== undefined && { awbNumber: trackingData.awbNumber }),
                            ...(trackingData.courier !== undefined && { courier: trackingData.courier }),
                        }
                        : line
                ),
            })),
        } : {}),
    };
}

// ============================================================================
// DELIVERY OPTIMISTIC UPDATES
// ============================================================================

/**
 * Optimistically mark an order as delivered
 */
export function optimisticMarkDelivered(
    data: OrdersListData | undefined,
    orderId: string,
    deliveredAt: string
): OrdersListData | undefined {
    if (!data) return data;

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (row.orderId !== orderId) return row;
            return {
                ...row,
                lineTrackingStatus: 'delivered',
                lineDeliveredAt: deliveredAt,
            };
        }),
        ...(data.orders ? {
            orders: data.orders.map((order) => {
                if (order.id !== orderId) return order;
                return {
                    ...order,
                    status: 'delivered',
                    trackingStatus: 'delivered',
                    deliveredAt,
                    orderLines: order.orderLines?.map((line: any) => ({
                        ...line,
                        trackingStatus: 'delivered',
                        deliveredAt,
                    })),
                };
            }),
        } : {}),
    };
}

/**
 * Optimistically mark an order as RTO (return to origin)
 */
export function optimisticMarkRto(
    data: OrdersListData | undefined,
    orderId: string,
    rtoInitiatedAt: string
): OrdersListData | undefined {
    if (!data) return data;

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (row.orderId !== orderId) return row;
            return {
                ...row,
                rtoStatus: 'initiated',
                lineTrackingStatus: 'rto_in_transit',
            };
        }),
        ...(data.orders ? {
            orders: data.orders.map((order) => {
                if (order.id !== orderId) return order;
                return {
                    ...order,
                    trackingStatus: 'rto_in_transit',
                    rtoStatus: 'initiated',
                    rtoInitiatedAt,
                };
            }),
        } : {}),
    };
}

/**
 * Optimistically receive RTO (restores inventory)
 */
export function optimisticReceiveRto(
    data: OrdersListData | undefined,
    orderId: string
): OrdersListData | undefined {
    if (!data) return data;

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (row.orderId !== orderId) return row;

            const updatedRow = {
                ...row,
                rtoStatus: 'received',
                lineTrackingStatus: 'rto_delivered',
            };

            // Restore inventory for this line's SKU
            if (row.skuId && row.skuStock !== undefined) {
                const delta = row.qty || 0;
                updatedRow.skuStock = row.skuStock + delta;
            }

            return updatedRow;
        }),
        ...(data.orders ? {
            orders: data.orders.map((order) => {
                if (order.id !== orderId) return order;
                return {
                    ...order,
                    trackingStatus: 'rto_delivered',
                    rtoStatus: 'received',
                    rtoReceivedAt: new Date().toISOString(),
                };
            }),
        } : {}),
    };
}

// ============================================================================
// ORDER STATUS OPTIMISTIC UPDATES
// ============================================================================

/**
 * Optimistically cancel an entire order
 * Cancels all non-shipped lines and restores inventory for allocated lines.
 * Order status is computed from resulting line states.
 */
export function optimisticCancelOrder(
    data: OrdersListData | undefined,
    orderId: string
): OrdersListData | undefined {
    if (!data) return data;

    // Build simulated line states after cancellation to compute order status
    const orderRows = data.rows.filter(row => row.orderId === orderId && row.lineStatus);
    const simulatedLines = orderRows.map(row => ({
        lineStatus: row.lineStatus === 'shipped' ? 'shipped' : 'cancelled',
    }));
    const newOrderStatus = computeOrderStatus({ orderLines: simulatedLines });

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (row.orderId !== orderId) return row;
            // Don't cancel shipped lines
            if (row.lineStatus === 'shipped') return row;

            const updatedRow = {
                ...row,
                lineStatus: 'cancelled',
            };

            // Restore inventory if the line was allocated
            if (hasAllocatedInventory(row.lineStatus) && row.skuStock !== undefined) {
                updatedRow.skuStock = row.skuStock + (row.qty || 0);
            }

            return updatedRow;
        }),
        ...(data.orders ? {
            orders: data.orders.map((order) => {
                if (order.id !== orderId) return order;
                return {
                    ...order,
                    status: newOrderStatus,
                    orderLines: order.orderLines?.map((line: any) =>
                        line.lineStatus === 'shipped'
                            ? line
                            : { ...line, lineStatus: 'cancelled' }
                    ),
                };
            }),
        } : {}),
    };
}

/**
 * Optimistically uncancel an entire order
 * Restores cancelled lines to pending status.
 * Order status is computed from resulting line states.
 */
export function optimisticUncancelOrder(
    data: OrdersListData | undefined,
    orderId: string
): OrdersListData | undefined {
    if (!data) return data;

    // Build simulated line states after uncancellation to compute order status
    const orderRows = data.rows.filter(row => row.orderId === orderId && row.lineStatus);
    const simulatedLines = orderRows.map(row => ({
        lineStatus: row.lineStatus === 'cancelled' ? 'pending' : row.lineStatus!,
    }));
    const newOrderStatus = computeOrderStatus({ orderLines: simulatedLines });

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (row.orderId !== orderId) return row;

            // Only uncancel lines that were cancelled
            if (row.lineStatus !== 'cancelled') return row;

            return {
                ...row,
                lineStatus: 'pending',
            };
        }),
        ...(data.orders ? {
            orders: data.orders.map((order) => {
                if (order.id !== orderId) return order;
                return {
                    ...order,
                    status: newOrderStatus,
                    orderLines: order.orderLines?.map((line: any) =>
                        line.lineStatus === 'cancelled'
                            ? { ...line, lineStatus: 'pending' }
                            : line
                    ),
                };
            }),
        } : {}),
    };
}

// ============================================================================
// PRODUCTION BATCH OPTIMISTIC UPDATES
// ============================================================================

/**
 * Optimistically create a production batch for a line
 * Updates productionBatchId and productionDate on the row
 */
export function optimisticCreateBatch(
    data: OrdersListData | undefined,
    sourceOrderLineId: string,
    batchId: string,
    batchDate: string
): OrdersListData | undefined {
    if (!data) return data;

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (row.lineId !== sourceOrderLineId) return row;
            return {
                ...row,
                productionBatchId: batchId,
                productionDate: batchDate,
            };
        }),
        // Only update orders array if it exists (Server Function may not return it)
        ...(data.orders ? {
            orders: data.orders.map((order) => ({
                ...order,
                orderLines: order.orderLines?.map((line: any) =>
                    line.id === sourceOrderLineId
                        ? { ...line, productionBatchId: batchId }
                        : line
                ),
            })),
        } : {}),
    };
}

/**
 * Optimistically update a production batch date
 * Updates productionDate on the row with the matching productionBatchId
 */
export function optimisticUpdateBatch(
    data: OrdersListData | undefined,
    batchId: string,
    newDate: string
): OrdersListData | undefined {
    if (!data) return data;

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (row.productionBatchId !== batchId) return row;
            return {
                ...row,
                productionDate: newDate,
            };
        }),
        // orders array doesn't need update since productionBatchId stays the same
    };
}

/**
 * Optimistically delete a production batch
 * Clears productionBatchId and productionDate on the row
 */
export function optimisticDeleteBatch(
    data: OrdersListData | undefined,
    batchId: string
): OrdersListData | undefined {
    if (!data) return data;

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (row.productionBatchId !== batchId) return row;
            return {
                ...row,
                productionBatchId: null,
                productionDate: null,
            };
        }),
        // Only update orders array if it exists (Server Function may not return it)
        ...(data.orders ? {
            orders: data.orders.map((order) => ({
                ...order,
                orderLines: order.orderLines?.map((line: any) =>
                    line.productionBatchId === batchId
                        ? { ...line, productionBatchId: null }
                        : line
                ),
            })),
        } : {}),
    };
}
