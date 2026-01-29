/**
 * Types for Optimistic Updates
 */

import type { FlattenedOrderRow } from '../../../utils/orderHelpers';
import { ORDERS_PAGE_SIZE } from '../../../constants/queryKeys';

// Re-export for backwards compatibility
export const PAGE_SIZE = ORDERS_PAGE_SIZE;

// Types for tRPC query input
export interface OrdersQueryInput {
    view: string;
    page: number;
    limit: number;
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
 * Legacy type for optimistic update context (single query rollback)
 * @deprecated Use ViewOptimisticContext for proper multi-query rollback
 */
export interface OptimisticUpdateContext {
    previousData: OrdersListData | undefined;
    queryInput: OrdersQueryInput;
}

/**
 * Type for view cache snapshot (maps stringified query keys to data)
 */
export type ViewCacheSnapshot = Map<string, OrdersListData | undefined>;

/**
 * Optimistic update context that properly handles ALL cached queries for a view.
 * Stores snapshots of all matching queries for correct rollback on error.
 */
export interface ViewOptimisticContext {
    /** Snapshot of ALL cached queries for the view (for rollback) */
    viewSnapshot: ViewCacheSnapshot;
    /** The view being operated on */
    view: string;
}

/**
 * Ship data for optimistic shipping updates
 */
export interface ShipData {
    lineStatus: string;
    awbNumber: string;
    courier: string;
    shippedAt: string;
}
