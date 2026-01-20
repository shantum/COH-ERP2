/**
 * usePulse - SSE receiver with debounced TanStack Query invalidation
 *
 * Connects to /api/pulse and maps database signals to query invalidations.
 * Debounces rapid-fire signals during bulk operations (1.5s window).
 *
 * Usage:
 *   const { isConnected } = usePulse();
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TABLE_INVALIDATION_MAP, DEBOUNCE_MS } from '../constants/pulseConfig';

interface PulseSignal {
    type: 'connected' | 'disconnected' | 'signal';
    table?: string;
    op?: string;
    id?: string;
}

export function usePulse(enabled = true) {
    const queryClient = useQueryClient();
    const eventSourceRef = useRef<EventSource | null>(null);
    const debounceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const pendingInvalidationsRef = useRef<Map<string, Set<string>>>(new Map());

    const [isConnected, setIsConnected] = useState(false);
    const reconnectAttempts = useRef(0);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Debounced invalidation - collects signals then fires once after debounce window
    const scheduleInvalidation = useCallback((table: string, id: string) => {
        // Add to pending set (tracks IDs during debounce window)
        if (!pendingInvalidationsRef.current.has(table)) {
            pendingInvalidationsRef.current.set(table, new Set());
        }
        pendingInvalidationsRef.current.get(table)!.add(id);

        // Clear existing timer for this table
        const existingTimer = debounceTimersRef.current.get(table);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Schedule invalidation after debounce window
        const timer = setTimeout(() => {
            const queryKeys = TABLE_INVALIDATION_MAP[table] || [];
            const pendingIds = pendingInvalidationsRef.current.get(table);

            if (queryKeys.length > 0 && pendingIds && pendingIds.size > 0) {
                console.log(`[Pulse] Invalidating ${queryKeys.length} query key(s) for ${table} (${pendingIds.size} changes)`);
                queryKeys.forEach((queryKey) => {
                    queryClient.invalidateQueries({ queryKey });
                });
            }

            pendingInvalidationsRef.current.delete(table);
            debounceTimersRef.current.delete(table);
        }, DEBOUNCE_MS);

        debounceTimersRef.current.set(table, timer);
    }, [queryClient]);

    const connect = useCallback(() => {
        if (!enabled) return;

        const token = localStorage.getItem('token');
        if (!token) {
            console.log('[Pulse] No token available, skipping connection');
            return;
        }

        const url = new URL('/api/pulse', window.location.origin);
        url.searchParams.set('token', token);

        const es = new EventSource(url.toString());

        es.onmessage = (event) => {
            try {
                const data: PulseSignal = JSON.parse(event.data);

                if (data.type === 'connected') {
                    setIsConnected(true);
                    reconnectAttempts.current = 0;
                    console.log('[Pulse] Connected to real-time updates');
                } else if (data.type === 'disconnected') {
                    setIsConnected(false);
                    console.log('[Pulse] Server disconnected from database');
                } else if (data.type === 'signal' && data.table && data.id) {
                    scheduleInvalidation(data.table, data.id);
                }
            } catch (err) {
                console.error('[Pulse] Parse error:', err);
            }
        };

        es.onerror = () => {
            setIsConnected(false);
            es.close();

            // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
            reconnectAttempts.current++;

            console.log(`[Pulse] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);
            reconnectTimeoutRef.current = setTimeout(connect, delay);
        };

        eventSourceRef.current = es;
    }, [enabled, scheduleInvalidation]);

    useEffect(() => {
        connect();

        return () => {
            // Cleanup EventSource
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }

            // Cleanup reconnect timeout
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }

            // Clear pending debounce timers
            debounceTimersRef.current.forEach((timer) => clearTimeout(timer));
            debounceTimersRef.current.clear();
            pendingInvalidationsRef.current.clear();
        };
    }, [connect]);

    return { isConnected };
}
