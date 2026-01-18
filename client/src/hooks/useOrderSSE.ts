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
import { trpc } from '../services/trpc';

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
    /** Enable/disable SSE connection */
    enabled?: boolean;
}

// Page size must match useUnifiedOrdersData.ts
const PAGE_SIZE = 500;

// Heartbeat monitoring interval
const HEARTBEAT_CHECK_INTERVAL = 15000; // 15 seconds
const HEARTBEAT_TIMEOUT = 45000; // 1.5x the 30s heartbeat interval

export function useOrderSSE({
    currentView,
    page = 1,
    enabled = true,
}: UseOrderSSEOptions) {
    const trpcUtils = trpc.useUtils();
    const eventSourceRef = useRef<EventSource | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttempts = useRef(0);
    const lastEventIdRef = useRef<string | null>(null);

    // Refs to avoid reconnection when view/page changes (Issue 3 fix)
    const currentViewRef = useRef(currentView);
    const pageRef = useRef(page);

    // Keep refs updated without triggering reconnection
    useEffect(() => {
        currentViewRef.current = currentView;
        pageRef.current = page;
    }, [currentView, page]);

    const [isConnected, setIsConnected] = useState(false);
    const [connectionHealth, setConnectionHealth] = useState<ConnectionHealth>({
        isConnected: false,
        lastHeartbeat: null,
        missedHeartbeats: 0,
        reconnectAttempts: 0,
        quality: 'unknown',
    });

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

            // Handle buffer overflow - server lost events, need full refetch
            if (data.type === 'buffer_overflow') {
                console.log('SSE: Buffer overflow detected, triggering full refetch');
                trpcUtils.orders.list.invalidate();
                return;
            }

            // Build query input for cache operations (using refs to avoid reconnection on view/page change)
            const queryInput = { view: currentViewRef.current, page: pageRef.current, limit: PAGE_SIZE };

            // Handle line status changes
            // Now supports full rowData for complete row replacement (no merge needed)
            if (data.type === 'line_status' && data.lineId) {
                trpcUtils.orders.list.setData(queryInput, (old) => {
                    if (!old) return old;

                    const newRows = old.rows.map((row: any) =>
                        row.lineId === data.lineId
                            ? data.rowData
                                ? { ...row, ...data.rowData }  // Full row from SSE
                                : { ...row, ...data.changes }  // Partial merge (legacy)
                            : row
                    );

                    const newOrders = old.orders.map((order: any) => {
                        const hasLine = order.orderLines?.some((line: any) => line.id === data.lineId);
                        if (!hasLine) return order;
                        return {
                            ...order,
                            orderLines: order.orderLines.map((line: any) =>
                                line.id === data.lineId ? { ...line, ...data.changes } : line
                            )
                        };
                    });

                    return { ...old, rows: newRows, orders: newOrders };
                });
            }

            // Handle batch line updates
            if (data.type === 'lines_batch_update' && data.lineIds && data.changes) {
                const lineIdSet = new Set(data.lineIds);
                trpcUtils.orders.list.setData(queryInput, (old) => {
                    if (!old) return old;

                    const newRows = old.rows.map((row: any) =>
                        lineIdSet.has(row.lineId)
                            ? { ...row, ...data.changes }
                            : row
                    );

                    const newOrders = old.orders.map((order: any) => ({
                        ...order,
                        orderLines: order.orderLines?.map((line: any) =>
                            lineIdSet.has(line.id)
                                ? { ...line, ...data.changes }
                                : line
                        )
                    }));

                    return { ...old, rows: newRows, orders: newOrders };
                });
            }

            // Handle new order created
            if (data.type === 'order_created') {
                // Just invalidate - new orders should trigger a refetch
                trpcUtils.orders.list.invalidate({ view: 'open' });
            }

            // Handle order deleted
            if (data.type === 'order_deleted' && data.orderId) {
                trpcUtils.orders.list.setData(queryInput, (old) => {
                    if (!old) return old;
                    return {
                        ...old,
                        rows: old.rows.filter((row: any) => row.orderId !== data.orderId),
                        orders: old.orders.filter((order: any) => order.id !== data.orderId),
                    };
                });
            }

            // Handle inventory updates
            if (data.type === 'inventory_updated' && data.skuId) {
                trpcUtils.orders.list.invalidate({ view: currentViewRef.current });
                console.log(`SSE: Invalidated orders cache for view '${currentViewRef.current}' after inventory update`);
            }

            // Handle order updates (cancel/uncancel/general updates)
            if (data.type === 'order_updated' && data.orderId && data.changes) {
                trpcUtils.orders.list.setData(queryInput, (old) => {
                    if (!old) return old;

                    const newRows = old.rows.map((row: any) => {
                        if (row.orderId !== data.orderId) return row;
                        const updates: any = {};
                        if (data.changes?.status) updates.orderStatus = data.changes.status;
                        if (data.changes?.lineStatus) updates.lineStatus = data.changes.lineStatus;
                        return { ...row, ...updates };
                    });

                    const newOrders = old.orders.map((order: any) => {
                        if (order.id !== data.orderId) return order;
                        const updates: any = {};
                        if (data.changes?.status) updates.status = data.changes.status;
                        if (data.changes?.lineStatus) {
                            updates.orderLines = order.orderLines?.map((line: any) => ({
                                ...line,
                                lineStatus: data.changes!.lineStatus,
                            }));
                        }
                        return { ...order, ...updates };
                    });

                    return { ...old, rows: newRows, orders: newOrders };
                });
            }

            // Handle order shipped
            if (data.type === 'order_shipped' && data.orderId) {
                // Invalidate affected views
                if (data.affectedViews?.includes('open')) {
                    trpcUtils.orders.list.invalidate({ view: 'open' });
                }
                if (data.affectedViews?.includes('shipped')) {
                    trpcUtils.orders.list.invalidate({ view: 'shipped' });
                }
            }

            // Handle lines shipped
            if (data.type === 'lines_shipped' && data.lineIds && data.changes) {
                const lineIdSet = new Set(data.lineIds);
                trpcUtils.orders.list.setData(queryInput, (old) => {
                    if (!old) return old;

                    const newRows = old.rows.map((row: any) =>
                        lineIdSet.has(row.lineId)
                            ? { ...row, ...data.changes }
                            : row
                    );

                    return { ...old, rows: newRows };
                });
            }

            // Handle order delivered
            if (data.type === 'order_delivered' && data.orderId) {
                trpcUtils.orders.list.invalidate({ view: 'shipped' });
                trpcUtils.orders.list.invalidate({ view: 'cod_pending' });
            }

            // Handle order RTO
            if (data.type === 'order_rto' && data.orderId) {
                trpcUtils.orders.list.invalidate({ view: 'shipped' });
                trpcUtils.orders.list.invalidate({ view: 'rto' });
            }

            // Handle order RTO received
            if (data.type === 'order_rto_received' && data.orderId) {
                trpcUtils.orders.list.invalidate({ view: 'rto' });
                trpcUtils.orders.list.invalidate({ view: 'open' });
            }

            // Handle order cancelled
            if (data.type === 'order_cancelled' && data.orderId) {
                trpcUtils.orders.list.invalidate({ view: 'open' });
                trpcUtils.orders.list.invalidate({ view: 'cancelled' });
            }

            // Handle order uncancelled
            if (data.type === 'order_uncancelled' && data.orderId) {
                trpcUtils.orders.list.invalidate({ view: 'open' });
                trpcUtils.orders.list.invalidate({ view: 'cancelled' });
            }

            // Handle production batch created/updated/deleted
            if (
                (data.type === 'production_batch_created' ||
                 data.type === 'production_batch_updated' ||
                 data.type === 'production_batch_deleted') &&
                data.lineId &&
                data.changes
            ) {
                trpcUtils.orders.list.setData(queryInput, (old) => {
                    if (!old) return old;

                    const newRows = old.rows.map((row: any) =>
                        row.lineId === data.lineId
                            ? { ...row, ...data.changes }
                            : row
                    );

                    const newOrders = old.orders.map((order: any) => ({
                        ...order,
                        orderLines: order.orderLines?.map((line: any) =>
                            line.id === data.lineId
                                ? { ...line, ...data.changes }
                                : line
                        ),
                    }));

                    return { ...old, rows: newRows, orders: newOrders };
                });
            }

        } catch (err) {
            console.error('SSE: Failed to parse event', err);
        }
    // Using refs for currentView/page to avoid reconnection on navigation (Issue 3 fix)
    }, [trpcUtils]);

    const connect = useCallback(() => {
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
