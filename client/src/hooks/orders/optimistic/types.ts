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
 * Helper type for optimistic update context
 * Stores data needed for rollback on error
 */
export interface OptimisticUpdateContext {
    previousData: OrdersListData | undefined;
    queryInput: OrdersQueryInput;
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
