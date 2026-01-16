/**
 * useOrderSSE - Real-time order updates via Server-Sent Events
 *
 * Subscribes to the SSE endpoint and updates the TanStack Query cache
 * when other users modify orders. This enables multi-user real-time updates.
 *
 * Note: Own actions use optimistic updates for instant feedback.
 * SSE is for updates made by OTHER users or external systems (Shopify webhooks).
 */

import { useEffect, useRef, useCallback } from 'react';
import { trpc } from '../services/trpc';

// Event types from server
interface SSEEvent {
    type: 'connected' | 'line_status' | 'order_created' | 'order_updated' | 'order_deleted';
    view?: string;
    orderId?: string;
    lineId?: string;
    changes?: Record<string, unknown>;
    userId?: string;
}

interface UseOrderSSEOptions {
    /** The current view being displayed (to know which cache to update) */
    currentView: string;
    /** Enable/disable SSE connection */
    enabled?: boolean;
}

export function useOrderSSE({ currentView, enabled = true }: UseOrderSSEOptions) {
    const trpcUtils = trpc.useUtils();
    const eventSourceRef = useRef<EventSource | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttempts = useRef(0);

    const handleEvent = useCallback((event: MessageEvent) => {
        try {
            const data: SSEEvent = JSON.parse(event.data);

            // Skip connection confirmation events
            if (data.type === 'connected') {
                console.log('SSE: Connected to real-time updates');
                reconnectAttempts.current = 0; // Reset on successful connect
                return;
            }

            // Handle line status changes
            if (data.type === 'line_status' && data.lineId && data.changes) {
                // Update the current view's cache
                trpcUtils.orders.list.setData(
                    { view: currentView, limit: 2000 },
                    (old) => {
                        if (!old) return old;

                        // Update rows
                        const newRows = old.rows.map((row: any) =>
                            row.lineId === data.lineId
                                ? { ...row, ...data.changes }
                                : row
                        );

                        // Update orders for backwards compatibility
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
                    }
                );
            }

            // Handle new order created
            if (data.type === 'order_created') {
                // Just invalidate - new orders should trigger a refetch
                trpcUtils.orders.list.invalidate({ view: 'open' });
            }

            // Handle order deleted
            if (data.type === 'order_deleted' && data.orderId) {
                // Remove from cache
                trpcUtils.orders.list.setData(
                    { view: currentView, limit: 2000 },
                    (old) => {
                        if (!old) return old;
                        return {
                            ...old,
                            rows: old.rows.filter((row: any) => row.orderId !== data.orderId),
                            orders: old.orders.filter((order: any) => order.id !== data.orderId),
                        };
                    }
                );
            }

        } catch (err) {
            console.error('SSE: Failed to parse event', err);
        }
    }, [currentView, trpcUtils]);

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

        // Create new EventSource connection
        // Note: EventSource doesn't support custom headers, so we use query param
        const url = `/api/events?token=${encodeURIComponent(token)}`;
        const es = new EventSource(url);

        es.onmessage = handleEvent;

        es.onerror = () => {
            console.log('SSE: Connection error, will reconnect...');
            es.close();

            // Exponential backoff for reconnection
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
            reconnectAttempts.current++;

            reconnectTimeoutRef.current = setTimeout(() => {
                connect();
            }, delay);
        };

        es.onopen = () => {
            console.log('SSE: Connection opened');
        };

        eventSourceRef.current = es;
    }, [enabled, handleEvent]);

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

    // Reconnect when view changes (to ensure we have correct cache key)
    useEffect(() => {
        // Just update the handler - no need to reconnect
    }, [currentView]);

    return {
        isConnected: eventSourceRef.current?.readyState === EventSource.OPEN,
    };
}

export default useOrderSSE;
