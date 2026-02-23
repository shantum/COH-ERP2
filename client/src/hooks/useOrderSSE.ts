/**
 * useOrderSSE - Real-time order updates via Server-Sent Events
 *
 * Subscribes to the SSE endpoint and updates the TanStack Query cache
 * when other users modify orders. This enables multi-user real-time updates.
 *
 * Features:
 * - Last-Event-ID tracking for resumable connections
 * - Connection health monitoring
 * - Automatic reconnection with exponential backoff
 * - Support for expanded event types (shipping, delivery, cancel)
 *
 * Note: Own actions use optimistic updates for instant feedback.
 * SSE is for updates made by OTHER users or external systems (Shopify webhooks).
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ORDERS_PAGE_SIZE } from '../constants/queryKeys';
import { getOrdersListQueryKey, invalidateAllOrderViewsStale } from './orders/orderMutationUtils';
import type { FlattenedOrderRow } from '../server/functions/orders';

// Cache data structure for orders list queries
interface OrderListCacheData {
    rows: FlattenedOrderRow[];
    [key: string]: unknown; // Allow other properties from OrdersResponse
}

// Event types from server (expanded)
interface SSEEvent {
    type:
        | 'connected'
        | 'line_status'
        | 'order_created'
        | 'order_updated'
        | 'order_deleted'
        | 'inventory_updated'
        // Shipping events
        | 'order_shipped'
        | 'lines_shipped'
        // Delivery events
        | 'order_delivered'
        | 'order_rto'
        | 'order_rto_received'
        // Cancel events
        | 'order_cancelled'
        | 'order_uncancelled'
        // Batch update
        | 'lines_batch_update'
        // Production batch events
        | 'production_batch_created'
        | 'production_batch_updated'
        | 'production_batch_deleted'
        // Buffer overflow (client should refetch)
        | 'buffer_overflow';
    view?: string;
    orderId?: string;
    lineId?: string;
    lineIds?: string[];
    skuId?: string;
    changes?: Record<string, unknown>;
    affectedViews?: string[];
    rowData?: Record<string, unknown>;
    userId?: string;
}

// Connection health tracking
interface ConnectionHealth {
    isConnected: boolean;
    lastHeartbeat: Date | null;
    missedHeartbeats: number;
    reconnectAttempts: number;
    quality: 'good' | 'degraded' | 'poor' | 'unknown';
}

interface UseOrderSSEOptions {
    /** The current view being displayed (to know which cache to update) */
    currentView: string;
    /** Current page number (to match query key) */
    page?: number;
    /** Items per page (defaults to ORDERS_PAGE_SIZE) */
    limit?: number;
    /** Enable/disable SSE connection */
    enabled?: boolean;
}


// Heartbeat monitoring interval
const HEARTBEAT_CHECK_INTERVAL = 15000; // 15 seconds
const HEARTBEAT_TIMEOUT = 45000; // 1.5x the 30s heartbeat interval

// ============================================================================
// BATCHING STATE FOR LINE UPDATES (Module-level)
// Accumulates lineId -> changes during a single animation frame
// ============================================================================
let pendingLineUpdates: Map<string, Record<string, unknown>> | null = null;
let flushScheduled = false;

// ============================================================================
// REFERENTIAL STABILITY HELPERS
// Core invariant: If no rows actually change, return the SAME cache object reference
// ============================================================================

/**
 * Check if update would actually change the row
 * Compares each change value against current row value
 *
 * ASSUMPTION: Change values are primitives (string, number, boolean, null) or
 * stable object references. Deep object comparison is NOT performed.
 * SSE events from server should only contain primitives for row field updates.
 */
function wouldChange(row: FlattenedOrderRow, changes: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(changes)) {
        if (row[key as keyof FlattenedOrderRow] !== value) return true;
    }
    return false;
}

/**
 * Apply batched line updates with referential stability
 * Returns SAME reference if no rows actually changed
 */
function applyLineUpdates(
    old: OrderListCacheData,
    updates: Map<string, Record<string, unknown>>
): OrderListCacheData {
    // Pre-check: do ANY target rows exist and need changes?
    let hasChanges = false;
    for (const [lineId, changes] of updates) {
        const row = old.rows.find(r => r.lineId === lineId);
        if (row && wouldChange(row, changes)) {
            hasChanges = true;
            break;
        }
    }

    // NO-OP: Return same reference - this is the key optimization
    if (!hasChanges) return old;

    // Apply changes only to affected rows
    const newRows = old.rows.map(row => {
        if (!row.lineId) return row;
        const changes = updates.get(row.lineId);
        if (!changes || !wouldChange(row, changes)) return row; // Same row reference
        return { ...row, ...changes };
    });

    return { ...old, rows: newRows };
}

export function useOrderSSE({
    currentView,
    page = 1,
    limit = ORDERS_PAGE_SIZE,
    enabled = true,
}: UseOrderSSEOptions) {
    const queryClient = useQueryClient();
    const eventSourceRef = useRef<EventSource | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttempts = useRef(0);
    const lastEventIdRef = useRef<string | null>(null);

    // Refs to avoid reconnection when view/page/limit changes (Issue 3 fix)
    const currentViewRef = useRef(currentView);
    const pageRef = useRef(page);
    const limitRef = useRef(limit);

    // Keep refs updated without triggering reconnection
    useEffect(() => {
        currentViewRef.current = currentView;
        pageRef.current = page;
        limitRef.current = limit;
    }, [currentView, page, limit]);

    const [isConnected, setIsConnected] = useState(false);
    const [connectionHealth, setConnectionHealth] = useState<ConnectionHealth>({
        isConnected: false,
        lastHeartbeat: null,
        missedHeartbeats: 0,
        reconnectAttempts: 0,
        quality: 'unknown',
    });

    // Schedule flush of pending line updates to run once per animation frame
    const scheduleFlush = useCallback(() => {
        if (flushScheduled) return;
        flushScheduled = true;

        requestAnimationFrame(() => {
            flushScheduled = false;
            if (!pendingLineUpdates || pendingLineUpdates.size === 0) return;

            const updates = pendingLineUpdates;
            pendingLineUpdates = null;

            const queryKey = getOrdersListQueryKey({
                view: currentViewRef.current,
                page: pageRef.current,
                limit: limitRef.current
            });

            queryClient.setQueryData<OrderListCacheData>(queryKey, (old) => {
                if (!old) return old;
                return applyLineUpdates(old, updates);
            });
        });
    }, [queryClient]);

    const handleEvent = useCallback((event: MessageEvent) => {
        try {
            // Track event ID for resumption (from the event itself or lastEventId)
            if (event.lastEventId) {
                lastEventIdRef.current = event.lastEventId;
            }

            const data: SSEEvent = JSON.parse(event.data);

            // Update connection health on any event
            setConnectionHealth(prev => ({
                ...prev,
                isConnected: true,
                lastHeartbeat: new Date(),
                missedHeartbeats: 0,
                quality: 'good',
            }));

            // Skip connection confirmation events
            if (data.type === 'connected') {
                console.log('SSE: Connected to real-time updates');
                reconnectAttempts.current = 0;
                return;
            }

            // Handle buffer overflow - server lost events, need refresh
            // IMPORTANT: Use smart invalidation to prevent 10K+ re-renders
            // This marks all views as stale but only refetches the active view
            if (data.type === 'buffer_overflow') {
                console.log('SSE: Buffer overflow detected, marking views stale (active view will refetch)');
                invalidateAllOrderViewsStale(queryClient);
                return;
            }

            // Build query key for cache operations (using refs to avoid reconnection on view/page/limit change)
            // IMPORTANT: Must match the Server Function query key format
            const queryKey = getOrdersListQueryKey({ view: currentViewRef.current, page: pageRef.current, limit: limitRef.current });

            // ================================================================
            // BATCHED LINE STATUS UPDATES WITH REFERENTIAL STABILITY
            // Accumulates updates within a frame, applies once per rAF
            // Returns same cache reference if no rows actually changed
            // ================================================================
            if (data.type === 'line_status' && data.lineId) {
                if (!pendingLineUpdates) pendingLineUpdates = new Map();

                // Merge with any pending update for same lineId
                const existing = pendingLineUpdates.get(data.lineId) || {};
                const changes = data.rowData || data.changes || {};
                pendingLineUpdates.set(data.lineId, { ...existing, ...changes });

                scheduleFlush();
                return; // Don't fall through to other handlers
            }

            // Handle batch line updates
            if (data.type === 'lines_batch_update' && data.lineIds && data.changes) {
                const lineIdSet = new Set(data.lineIds);
                queryClient.setQueryData<OrderListCacheData>(queryKey, (old) => {
                    if (!old) return old;

                    const newRows = old.rows.map((row) =>
                        row.lineId && lineIdSet.has(row.lineId)
                            ? { ...row, ...data.changes }
                            : row
                    );

                    return { ...old, rows: newRows };
                });
            }

            // Handle new order created
            if (data.type === 'order_created') {
                // Invalidate all views - new orders affect counts across views
                invalidateAllOrderViewsStale(queryClient);
            }

            // Handle order deleted
            if (data.type === 'order_deleted' && data.orderId) {
                queryClient.setQueryData<OrderListCacheData>(queryKey, (old) => {
                    if (!old) return old;
                    return {
                        ...old,
                        rows: old.rows.filter((row) => row.orderId !== data.orderId),
                    };
                });
            }

            // Handle inventory updates - update skuStock in-place instead of full refetch
            if (data.type === 'inventory_updated' && data.skuId && data.changes) {
                queryClient.setQueryData<OrderListCacheData>(queryKey, (old) => {
                    if (!old) return old;
                    const balance = (data.changes as { balance?: number }).balance;
                    const newRows = old.rows.map((row) =>
                        row.skuId === data.skuId
                            ? { ...row, skuStock: balance ?? row.skuStock }
                            : row
                    );
                    return { ...old, rows: newRows };
                });
            }

            // Handle order updates (cancel/uncancel/general updates)
            if (data.type === 'order_updated' && data.orderId && data.changes) {
                queryClient.setQueryData<OrderListCacheData>(queryKey, (old) => {
                    if (!old) return old;

                    const newRows = old.rows.map((row) => {
                        if (row.orderId !== data.orderId) return row;
                        const updates: Partial<FlattenedOrderRow> = {};
                        if (data.changes?.status) updates.orderStatus = data.changes.status as string;
                        if (data.changes?.lineStatus) updates.lineStatus = data.changes.lineStatus as string;
                        return { ...row, ...updates };
                    });

                    return { ...old, rows: newRows };
                });
            }

            // Handle order shipped - remove from current view if it's 'all'
            if (data.type === 'order_shipped' && data.orderId) {
                if (currentViewRef.current === 'all') {
                    queryClient.setQueryData<OrderListCacheData>(queryKey, (old) => {
                        if (!old) return old;
                        return {
                            ...old,
                            rows: old.rows.filter((row) => row.orderId !== data.orderId),
                        };
                    });
                }
                queryClient.invalidateQueries({ queryKey: ['orders', 'viewCounts'] });
            }

            // Handle lines shipped
            if (data.type === 'lines_shipped' && data.lineIds && data.changes) {
                const lineIdSet = new Set(data.lineIds);
                queryClient.setQueryData<OrderListCacheData>(queryKey, (old) => {
                    if (!old) return old;

                    const newRows = old.rows.map((row) =>
                        row.lineId && lineIdSet.has(row.lineId)
                            ? { ...row, ...data.changes }
                            : row
                    );

                    return { ...old, rows: newRows };
                });
            }

            // Handle order delivered - update tracking status in current view
            if (data.type === 'order_delivered' && data.orderId && data.changes) {
                queryClient.setQueryData<OrderListCacheData>(queryKey, (old) => {
                    if (!old) return old;
                    const newRows = old.rows.map((row) =>
                        row.orderId === data.orderId ? { ...row, ...data.changes } : row
                    );
                    return { ...old, rows: newRows };
                });
            }

            // Handle order RTO - update tracking status in current view
            if (data.type === 'order_rto' && data.orderId && data.changes) {
                queryClient.setQueryData<OrderListCacheData>(queryKey, (old) => {
                    if (!old) return old;
                    const newRows = old.rows.map((row) =>
                        row.orderId === data.orderId ? { ...row, ...data.changes } : row
                    );
                    return { ...old, rows: newRows };
                });
            }

            // Handle order RTO received - remove from in_transit view
            if (data.type === 'order_rto_received' && data.orderId) {
                if (currentViewRef.current === 'in_transit') {
                    queryClient.setQueryData<OrderListCacheData>(queryKey, (old) => {
                        if (!old) return old;
                        return {
                            ...old,
                            rows: old.rows.filter((row) => row.orderId !== data.orderId),
                        };
                    });
                }
                queryClient.invalidateQueries({ queryKey: ['orders', 'viewCounts'] });
            }

            // Handle order cancelled - remove from all view
            if (data.type === 'order_cancelled' && data.orderId) {
                if (currentViewRef.current === 'all') {
                    queryClient.setQueryData<OrderListCacheData>(queryKey, (old) => {
                        if (!old) return old;
                        return {
                            ...old,
                            rows: old.rows.filter((row) => row.orderId !== data.orderId),
                        };
                    });
                }
                queryClient.invalidateQueries({ queryKey: ['orders', 'viewCounts'] });
            }

            // Handle order uncancelled - remove from cancelled view
            if (data.type === 'order_uncancelled' && data.orderId) {
                if (currentViewRef.current === 'cancelled') {
                    queryClient.setQueryData<OrderListCacheData>(queryKey, (old) => {
                        if (!old) return old;
                        return {
                            ...old,
                            rows: old.rows.filter((row) => row.orderId !== data.orderId),
                        };
                    });
                }
                queryClient.invalidateQueries({ queryKey: ['orders', 'viewCounts'] });
            }

            // Handle production batch created/updated/deleted
            if (
                (data.type === 'production_batch_created' ||
                 data.type === 'production_batch_updated' ||
                 data.type === 'production_batch_deleted') &&
                data.lineId &&
                data.changes
            ) {
                queryClient.setQueryData<OrderListCacheData>(queryKey, (old) => {
                    if (!old) return old;

                    const newRows = old.rows.map((row) =>
                        row.lineId === data.lineId
                            ? { ...row, ...data.changes }
                            : row
                    );

                    return { ...old, rows: newRows };
                });
            }

        } catch (err) {
            console.error('SSE: Failed to parse event', err);
        }
    // Using refs for currentView/page to avoid reconnection on navigation (Issue 3 fix)
    }, [queryClient, scheduleFlush]);

    const connect = useCallback(() => {
        // Skip during SSR (no window/EventSource available)
        if (typeof window === 'undefined') return;

        // Don't connect if disabled
        if (!enabled) return;

        // Get auth token from localStorage
        const token = localStorage.getItem('token');
        if (!token) {
            console.log('SSE: No auth token, skipping connection');
            return;
        }

        // Close existing connection
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        // Build URL with token and optional lastEventId
        const url = new URL('/api/events', window.location.origin);
        url.searchParams.set('token', token);

        // Include last event ID for replay on reconnect
        if (lastEventIdRef.current) {
            url.searchParams.set('lastEventId', lastEventIdRef.current);
        }

        const es = new EventSource(url.toString());

        es.onmessage = handleEvent;

        es.onerror = () => {
            console.log('SSE: Connection error, will reconnect...');
            setIsConnected(false);
            setConnectionHealth(prev => ({
                ...prev,
                isConnected: false,
                quality: 'poor',
                reconnectAttempts: reconnectAttempts.current,
            }));
            es.close();

            // Exponential backoff for reconnection (max 30 seconds)
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
            reconnectAttempts.current++;

            reconnectTimeoutRef.current = setTimeout(() => {
                connect();
            }, delay);
        };

        es.onopen = () => {
            console.log('SSE: Connection opened');
            setIsConnected(true);
            setConnectionHealth(prev => ({
                ...prev,
                isConnected: true,
                reconnectAttempts: 0,
                quality: 'good',
            }));
        };

        eventSourceRef.current = es;
    }, [enabled, handleEvent]);

    // Initial connection
    useEffect(() => {
        connect();

        // Cleanup on unmount
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, [connect]);

    // Health monitoring - check for missed heartbeats
    useEffect(() => {
        const checker = setInterval(() => {
            if (connectionHealth.isConnected && connectionHealth.lastHeartbeat) {
                const elapsed = Date.now() - connectionHealth.lastHeartbeat.getTime();
                if (elapsed > HEARTBEAT_TIMEOUT) {
                    setConnectionHealth(prev => {
                        const newMissed = prev.missedHeartbeats + 1;
                        return {
                            ...prev,
                            missedHeartbeats: newMissed,
                            quality: newMissed > 2 ? 'poor' : 'degraded',
                        };
                    });
                }
            }
        }, HEARTBEAT_CHECK_INTERVAL);

        return () => clearInterval(checker);
    }, [connectionHealth.isConnected, connectionHealth.lastHeartbeat]);

    return {
        isConnected,
        connectionHealth,
        lastEventId: lastEventIdRef.current,
    };
}

export default useOrderSSE;
