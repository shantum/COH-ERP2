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
    shippedFilter?: 'shipped' | 'not_shipped';
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
    shippedFilter?: 'shipped' | 'not_shipped'
): OrdersQueryInput {
    const input: OrdersQueryInput = {
        view: currentView,
        page,
        limit: PAGE_SIZE,
    };

    // Only include shippedFilter for archived view when it has a value
    if (currentView === 'archived' && shippedFilter) {
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
