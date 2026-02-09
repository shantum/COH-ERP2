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

/** Minimal order line shape for optimistic updates */
export interface OrderLineForOptimistic {
    id: string;
    lineStatus: string;
    productionBatchId?: string | null;
    awbNumber?: string | null;
    courier?: string | null;
    shippedAt?: string | null;
    trackingStatus?: string | null;
    deliveredAt?: string | null;
    [key: string]: unknown; // Allow extra fields to pass through
}

/** Minimal order shape for optimistic updates */
export interface OrderForOptimistic {
    id: string;
    status?: string;
    trackingStatus?: string;
    deliveredAt?: string | null;
    rtoStatus?: string | null;
    rtoInitiatedAt?: string | null;
    rtoReceivedAt?: string | null;
    orderLines?: OrderLineForOptimistic[];
    [key: string]: unknown; // Allow extra fields to pass through
}

// Type for the orders list response (must match tRPC orders.list return type)
export interface OrdersListData {
    orders: OrderForOptimistic[];
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
