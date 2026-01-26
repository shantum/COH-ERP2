/**
 * Cache Targeting Helpers
 * Query input builders and row access utilities for optimistic updates
 */

import type { FlattenedOrderRow } from '../../../utils/orderHelpers';
import type { OrdersQueryInput, OrdersListData } from './types';
import { PAGE_SIZE } from './types';

/**
 * Build tRPC query input for cache targeting
 * Matches the exact input shape used by useUnifiedOrdersData
 */
export function getOrdersQueryInput(
    currentView: string,
    page: number
): OrdersQueryInput {
    return {
        view: currentView,
        page,
        limit: PAGE_SIZE,
    };
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
 * Get row data by productionBatchId from cached data
 */
export function getRowByBatchId(
    data: OrdersListData | undefined,
    batchId: string
): FlattenedOrderRow | undefined {
    return data?.rows.find((row) => row.productionBatchId === batchId);
}
