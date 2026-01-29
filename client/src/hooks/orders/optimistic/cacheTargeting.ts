/**
 * Cache Targeting Helpers
 * Query input builders and row access utilities for optimistic updates
 *
 * IMPORTANT: Order queries can have different filter params (allocatedFilter, productionFilter)
 * which create different cache entries for the same view. The view-based utilities in this file
 * handle ALL cache entries for a view regardless of filters/pagination.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { FlattenedOrderRow } from '../../../utils/orderHelpers';
import type { OrdersQueryInput, OrdersListData } from './types';
import { PAGE_SIZE } from './types';

// ============================================================================
// VIEW-BASED CACHE UTILITIES
// These handle ALL cached queries for a view regardless of filters/pagination
// ============================================================================

/**
 * Create a predicate to match all order list queries for a specific view.
 * This matches regardless of filters (allocatedFilter, productionFilter) or pagination.
 * Query key format: ['orders', 'list', 'server-fn', { view, page, limit, ...filters }]
 */
export function createViewPredicate(view: string) {
    return (query: { queryKey: readonly unknown[] }) => {
        const key = query.queryKey;
        if (key[0] !== 'orders' || key[1] !== 'list' || key[2] !== 'server-fn') return false;
        const params = key[3] as { view?: string } | undefined;
        return params?.view === view;
    };
}

/**
 * Type for storing all previous query data for rollback.
 * Maps stringified query keys to their data.
 */
export type ViewCacheSnapshot = Map<string, OrdersListData | undefined>;

/**
 * Get a snapshot of ALL cached data for a view (for rollback on error).
 * Returns a Map of queryKey -> data for all matching queries.
 */
export function getViewCacheSnapshot(
    queryClient: QueryClient,
    view: string
): ViewCacheSnapshot {
    const predicate = createViewPredicate(view);
    const queries = queryClient.getQueriesData<OrdersListData>({ predicate });
    const snapshot = new Map<string, OrdersListData | undefined>();
    let totalRows = 0;
    for (const [queryKey, data] of queries) {
        snapshot.set(JSON.stringify(queryKey), data);
        totalRows += data?.rows?.length ?? 0;
    }
    console.log(`[cacheTargeting] getViewCacheSnapshot: view=${view}, queries=${queries.length}, totalRows=${totalRows}`);
    return snapshot;
}

/**
 * Restore ALL cached queries for a view from a snapshot (rollback on error).
 */
export function restoreViewCacheSnapshot(
    queryClient: QueryClient,
    snapshot: ViewCacheSnapshot
): void {
    for (const [keyStr, data] of snapshot) {
        const queryKey = JSON.parse(keyStr);
        queryClient.setQueryData(queryKey, data);
    }
}

/**
 * Update ALL cached queries for a view with an updater function.
 */
export function updateViewCache(
    queryClient: QueryClient,
    view: string,
    updater: (old: OrdersListData | undefined) => OrdersListData | undefined
): void {
    // Count how many queries will be updated
    const predicate = createViewPredicate(view);
    const queries = queryClient.getQueriesData<OrdersListData>({ predicate });
    console.log(`[cacheTargeting] updateViewCache: view=${view}, queriesAffected=${queries.length}`);

    queryClient.setQueriesData<OrdersListData>(
        { predicate },
        updater
    );
}

/**
 * Cancel all outgoing queries for a view.
 */
export async function cancelViewQueries(
    queryClient: QueryClient,
    view: string
): Promise<void> {
    await queryClient.cancelQueries({ predicate: createViewPredicate(view) });
}

/**
 * Search ALL cached queries for a view to find a row by lineId.
 * This is necessary because the target row may be in a different filter/page combination.
 *
 * Falls back to searching all order queries if not found in the specified view.
 */
export function findRowInViewCache(
    queryClient: QueryClient,
    view: string,
    lineId: string
): FlattenedOrderRow | undefined {
    // First, try the specific view
    const viewPredicate = createViewPredicate(view);
    const viewQueries = queryClient.getQueriesData<OrdersListData>({ predicate: viewPredicate });
    for (const [, data] of viewQueries) {
        const row = data?.rows?.find((r) => r.lineId === lineId);
        if (row) return row;
    }

    // Fallback: search ALL order queries (any view)
    // This handles edge cases where the row might be cached under a different view
    const allOrdersPredicate = (query: { queryKey: readonly unknown[] }) => {
        const key = query.queryKey;
        return key[0] === 'orders' && key[1] === 'list' && key[2] === 'server-fn';
    };
    const allQueries = queryClient.getQueriesData<OrdersListData>({ predicate: allOrdersPredicate });
    for (const [, data] of allQueries) {
        const row = data?.rows?.find((r) => r.lineId === lineId);
        if (row) return row;
    }

    return undefined;
}

/**
 * Search ALL cached queries for a view to find rows by lineIds.
 * Falls back to searching all order queries if not all rows found.
 */
export function findRowsInViewCache(
    queryClient: QueryClient,
    view: string,
    lineIds: string[]
): FlattenedOrderRow[] {
    const lineIdSet = new Set(lineIds);
    const found = new Map<string, FlattenedOrderRow>();
    let queriesScanned = 0;
    let rowsInspected = 0;

    // First, try the specific view
    const viewPredicate = createViewPredicate(view);
    const viewQueries = queryClient.getQueriesData<OrdersListData>({ predicate: viewPredicate });

    for (const [, data] of viewQueries) {
        queriesScanned++;
        if (!data?.rows) continue;
        for (const row of data.rows) {
            rowsInspected++;
            if (row.lineId && lineIdSet.has(row.lineId) && !found.has(row.lineId)) {
                found.set(row.lineId, row);
            }
        }
        if (found.size === lineIds.length) break;
    }

    // If not all found, search ALL order queries
    if (found.size < lineIds.length) {
        const allOrdersPredicate = (query: { queryKey: readonly unknown[] }) => {
            const key = query.queryKey;
            return key[0] === 'orders' && key[1] === 'list' && key[2] === 'server-fn';
        };
        const allQueries = queryClient.getQueriesData<OrdersListData>({ predicate: allOrdersPredicate });

        for (const [, data] of allQueries) {
            queriesScanned++;
            if (!data?.rows) continue;
            for (const row of data.rows) {
                rowsInspected++;
                if (row.lineId && lineIdSet.has(row.lineId) && !found.has(row.lineId)) {
                    found.set(row.lineId, row);
                }
            }
            if (found.size === lineIds.length) break;
        }
    }

    console.log(`[cacheTargeting] findRowsInViewCache: view=${view}, lookingFor=${lineIds.length}, queriesScanned=${queriesScanned}, rowsInspected=${rowsInspected}, found=${found.size}`);
    return Array.from(found.values());
}

/**
 * Search ALL cached queries for a view to find rows by orderId.
 * Falls back to searching all order queries if not found.
 */
export function findOrderRowsInViewCache(
    queryClient: QueryClient,
    view: string,
    orderId: string
): FlattenedOrderRow[] {
    const found = new Map<string, FlattenedOrderRow>();

    // First, try the specific view
    const viewPredicate = createViewPredicate(view);
    const viewQueries = queryClient.getQueriesData<OrdersListData>({ predicate: viewPredicate });

    for (const [, data] of viewQueries) {
        if (!data?.rows) continue;
        for (const row of data.rows) {
            if (row.orderId === orderId && row.lineId && !found.has(row.lineId)) {
                found.set(row.lineId, row);
            }
        }
    }

    // If nothing found, search ALL order queries
    if (found.size === 0) {
        const allOrdersPredicate = (query: { queryKey: readonly unknown[] }) => {
            const key = query.queryKey;
            return key[0] === 'orders' && key[1] === 'list' && key[2] === 'server-fn';
        };
        const allQueries = queryClient.getQueriesData<OrdersListData>({ predicate: allOrdersPredicate });

        for (const [, data] of allQueries) {
            if (!data?.rows) continue;
            for (const row of data.rows) {
                if (row.orderId === orderId && row.lineId && !found.has(row.lineId)) {
                    found.set(row.lineId, row);
                }
            }
        }
    }

    return Array.from(found.values());
}

// ============================================================================
// LEGACY HELPERS (for backward compatibility with single-data lookups)
// ============================================================================

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
