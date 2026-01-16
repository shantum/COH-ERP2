/**
 * Optimistic Update Helpers for Orders
 *
 * Provides utilities for optimistic UI updates that instantly reflect changes
 * while background revalidation ensures data consistency.
 *
 * Key concepts:
 * - Optimistic updates show changes immediately without waiting for server
 * - On error, we rollback to previous state
 * - onSettled always revalidates in background for consistency
 */

import type { FlattenedOrderRow } from '../../utils/orderHelpers';

// Constants
export const PAGE_SIZE = 500;

// Types for tRPC query input
export interface OrdersQueryInput {
    view: string;
    page: number;
    limit: number;
    shippedFilter?: 'rto' | 'cod_pending';
}

// Type for the orders list response (must match tRPC orders.list return type)
export interface OrdersListData {
    orders: any[];
    rows: FlattenedOrderRow[];
    view: string;
    viewName: string;
    hasInventory?: boolean;
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

/**
 * Build tRPC query input for cache targeting
 * Matches the exact input shape used by useUnifiedOrdersData
 */
export function getOrdersQueryInput(
    currentView: string,
    page: number,
    shippedFilter?: 'rto' | 'cod_pending'
): OrdersQueryInput {
    const input: OrdersQueryInput = {
        view: currentView,
        page,
        limit: PAGE_SIZE,
    };

    // Only include shippedFilter for shipped view when it has a value
    if (currentView === 'shipped' && shippedFilter) {
        input.shippedFilter = shippedFilter;
    }

    return input;
}

/**
 * Determines if a status transition affects inventory
 * Returns:
 *  - positive number: inventory is restored (freed up)
 *  - negative number: inventory is consumed (reserved)
 *  - 0: no inventory change
 */
export function calculateInventoryDelta(
    fromStatus: string,
    toStatus: string,
    qty: number
): number {
    const hasInventory = (status: string) =>
        ['allocated', 'picked', 'packed', 'shipped'].includes(status);

    const hadInventory = hasInventory(fromStatus);
    const willHaveInventory = hasInventory(toStatus);

    if (!hadInventory && willHaveInventory) {
        // Allocating: inventory consumed (reserved)
        return -qty;
    }

    if (hadInventory && !willHaveInventory) {
        // Unallocating or cancelling: inventory restored
        return qty;
    }

    // No change (e.g., picked -> packed, or pending -> pending)
    return 0;
}

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
        orders: data.orders.map((order) => ({
            ...order,
            orderLines: order.orderLines?.map((line: any) =>
                line.id === lineId
                    ? { ...line, lineStatus: newStatus }
                    : line
            ),
        })),
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
        orders: data.orders.map((order) => ({
            ...order,
            orderLines: order.orderLines?.map((line: any) =>
                lineIdSet.has(line.id)
                    ? { ...line, lineStatus: newStatus }
                    : line
            ),
        })),
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
        orders: data.orders.map((order) => ({
            ...order,
            orderLines: order.orderLines?.map((line: any) =>
                line.id === lineId
                    ? { ...line, lineStatus: 'cancelled' }
                    : line
            ),
        })),
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
        orders: data.orders.map((order) => ({
            ...order,
            orderLines: order.orderLines?.map((line: any) =>
                line.id === lineId
                    ? { ...line, lineStatus: 'pending' }
                    : line
            ),
        })),
    };
}

/**
 * Helper type for optimistic update context
 * Stores data needed for rollback on error
 */
export interface OptimisticUpdateContext {
    previousData: OrdersListData | undefined;
    queryInput: OrdersQueryInput;
}

/**
 * Get row data by lineId from the cached data
 */
export function getRowByLineId(
    data: OrdersListData | undefined,
    lineId: string
): FlattenedOrderRow | undefined {
    return data?.rows.find((row) => row.lineId === lineId);
}

/**
 * Get multiple rows by lineIds
 */
export function getRowsByLineIds(
    data: OrdersListData | undefined,
    lineIds: string[]
): FlattenedOrderRow[] {
    if (!data) return [];
    const lineIdSet = new Set(lineIds);
    return data.rows.filter((row) => row.lineId && lineIdSet.has(row.lineId));
}

/**
 * Get all rows for a specific order
 */
export function getRowsByOrderId(
    data: OrdersListData | undefined,
    orderId: string
): FlattenedOrderRow[] {
    if (!data) return [];
    return data.rows.filter((row) => row.orderId === orderId);
}

/**
 * Check if a status has inventory allocated
 * Statuses with allocated inventory: allocated, picked, packed, shipped
 */
export function hasAllocatedInventory(status: string | undefined | null): boolean {
    if (!status) return false;
    return ['allocated', 'picked', 'packed', 'shipped'].includes(status);
}

// ============================================================================
// SHIPPING OPTIMISTIC UPDATES
// ============================================================================

interface ShipData {
    lineStatus: string;
    awbNumber: string;
    courier: string;
    shippedAt: string;
}

/**
 * Optimistically ship an entire order (all lines)
 * Updates all line statuses to shipped with tracking info
 */
export function optimisticShipOrder(
    data: OrdersListData | undefined,
    orderId: string,
    shipData: ShipData
): OrdersListData | undefined {
    if (!data) return data;

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (row.orderId !== orderId) return row;
            // Only ship non-cancelled lines
            if (row.lineStatus === 'cancelled') return row;

            return {
                ...row,
                lineStatus: shipData.lineStatus,
                awbNumber: shipData.awbNumber,
                courier: shipData.courier,
                lineShippedAt: shipData.shippedAt,
            };
        }),
        orders: data.orders.map((order) => {
            if (order.id !== orderId) return order;
            return {
                ...order,
                status: 'shipped',
                awbNumber: shipData.awbNumber,
                courier: shipData.courier,
                shippedAt: shipData.shippedAt,
                orderLines: order.orderLines?.map((line: any) =>
                    line.lineStatus === 'cancelled'
                        ? line
                        : {
                            ...line,
                            lineStatus: shipData.lineStatus,
                            awbNumber: shipData.awbNumber,
                            courier: shipData.courier,
                            shippedAt: shipData.shippedAt,
                        }
                ),
            };
        }),
    };
}

/**
 * Optimistically ship specific lines
 * Updates specified line statuses to shipped with tracking info
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

            return {
                ...row,
                lineStatus: shipData.lineStatus,
                awbNumber: shipData.awbNumber,
                courier: shipData.courier,
                lineShippedAt: shipData.shippedAt,
            };
        }),
        orders: data.orders.map((order) => ({
            ...order,
            orderLines: order.orderLines?.map((line: any) =>
                lineIdSet.has(line.id)
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
    };
}

/**
 * Optimistically unship an order
 * Reverts all shipped lines back to packed status
 */
export function optimisticUnshipOrder(
    data: OrdersListData | undefined,
    orderId: string
): OrdersListData | undefined {
    if (!data) return data;

    return {
        ...data,
        rows: data.rows.map((row) => {
            if (row.orderId !== orderId) return row;
            if (row.lineStatus !== 'shipped') return row;

            return {
                ...row,
                lineStatus: 'packed',
                awbNumber: null,
                courier: null,
                lineShippedAt: null,
            };
        }),
        orders: data.orders.map((order) => {
            if (order.id !== orderId) return order;
            return {
                ...order,
                status: 'open',
                awbNumber: null,
                courier: null,
                shippedAt: null,
                orderLines: order.orderLines?.map((line: any) =>
                    line.lineStatus === 'shipped'
                        ? {
                            ...line,
                            lineStatus: 'packed',
                            awbNumber: null,
                            courier: null,
                            shippedAt: null,
                        }
                        : line
                ),
            };
        }),
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
        orders: data.orders.map((order) => {
            if (order.id !== orderId) return order;
            return {
                ...order,
                trackingStatus: 'rto_in_transit',
                rtoStatus: 'initiated',
                rtoInitiatedAt,
            };
        }),
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

    // Get the order rows to calculate inventory restoration
    const orderRows = data.rows.filter((row) => row.orderId === orderId);
    const inventoryDeltas = new Map<string, number>();

    orderRows.forEach((row) => {
        if (row.skuId && row.qty) {
            const currentDelta = inventoryDeltas.get(row.skuId) || 0;
            inventoryDeltas.set(row.skuId, currentDelta + (row.qty || 0));
        }
    });

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
        orders: data.orders.map((order) => {
            if (order.id !== orderId) return order;
            return {
                ...order,
                trackingStatus: 'rto_delivered',
                rtoStatus: 'received',
                rtoReceivedAt: new Date().toISOString(),
            };
        }),
    };
}

// ============================================================================
// ORDER STATUS OPTIMISTIC UPDATES
// ============================================================================

/**
 * Optimistically cancel an entire order
 * Cancels all lines and restores inventory for allocated lines
 */
export function optimisticCancelOrder(
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
                lineStatus: 'cancelled',
            };

            // Restore inventory if the line was allocated
            if (hasAllocatedInventory(row.lineStatus) && row.skuStock !== undefined) {
                updatedRow.skuStock = row.skuStock + (row.qty || 0);
            }

            return updatedRow;
        }),
        orders: data.orders.map((order) => {
            if (order.id !== orderId) return order;
            return {
                ...order,
                status: 'cancelled',
                orderLines: order.orderLines?.map((line: any) => ({
                    ...line,
                    lineStatus: 'cancelled',
                })),
            };
        }),
    };
}

/**
 * Optimistically uncancel an entire order
 * Restores all lines to pending status
 */
export function optimisticUncancelOrder(
    data: OrdersListData | undefined,
    orderId: string
): OrdersListData | undefined {
    if (!data) return data;

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
        orders: data.orders.map((order) => {
            if (order.id !== orderId) return order;
            return {
                ...order,
                status: 'open',
                orderLines: order.orderLines?.map((line: any) =>
                    line.lineStatus === 'cancelled'
                        ? { ...line, lineStatus: 'pending' }
                        : line
                ),
            };
        }),
    };
}
