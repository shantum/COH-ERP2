/**
 * Server-Sent Events (SSE) endpoint for real-time order updates
 *
 * Enables push notifications when order data changes (status transitions, new orders, etc.)
 * Clients subscribe via EventSource and receive updates for all orders they have access to.
 *
 * Features:
 * - Event ID tracking for resumable connections
 * - Circular buffer for event replay on reconnect
 * - Connection health monitoring via heartbeat
 * - Multiple event types for different order state changes
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../types/express.js';

const router: Router = Router();

// Type for SSE event data with expanded event types
export interface OrderUpdateEvent {
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
        // Delivery events (order-level)
        | 'order_delivered'
        | 'order_rto'
        | 'order_rto_received'
        // Delivery events (line-level)
        | 'line_delivered'
        | 'line_rto'
        | 'line_rto_received'
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
    // Full row data for direct cache update (eliminates need for refetch)
    rowData?: Record<string, unknown>;
    rowsData?: Array<Record<string, unknown>>;
}

// Event ID generation
let globalEventId = 0;
function generateEventId(): string {
    return `${Date.now()}-${++globalEventId}`;
}

// Circular buffer for event replay (last 100 events)
interface StoredEvent {
    id: string;
    data: OrderUpdateEvent;
    timestamp: number;
}
const recentEvents: StoredEvent[] = [];
const MAX_EVENTS = 100;
const EVENT_TTL = 5 * 60 * 1000; // 5 minutes - events older than this are stale

function storeEvent(event: StoredEvent) {
    recentEvents.push(event);
    if (recentEvents.length > MAX_EVENTS) {
        recentEvents.shift();
    }
}

/**
 * Get events since a given event ID for replay
 * Returns gapDetected: true if the event ID was not found in buffer (events were lost)
 */
function getEventsSince(lastEventId: string): { events: StoredEvent[]; gapDetected: boolean } {
    const idx = recentEvents.findIndex(e => e.id === lastEventId);
    if (idx >= 0) {
        // Return all events after the last seen event
        return { events: recentEvents.slice(idx + 1), gapDetected: false };
    }
    // Event ID not found - buffer overflow or expired events
    // Client needs to do a full refetch
    return { events: [], gapDetected: true };
}

/**
 * Clean up old events from the buffer
 */
function cleanupOldEvents() {
    const now = Date.now();
    while (recentEvents.length > 0 && now - recentEvents[0].timestamp > EVENT_TTL) {
        recentEvents.shift();
    }
}

// Run cleanup every minute
setInterval(cleanupOldEvents, 60000);

/**
 * Map of connected clients: userId -> Set<Response>
 * Using Set allows multiple tabs/windows per user
 */
const clients = new Map<string, Set<Response>>();

/**
 * Auth middleware for SSE - cookie-first, with query param fallback for legacy clients
 */
const sseAuth = (req: Request, res: Response, next: NextFunction): void => {
    const token = req.cookies?.auth_token || (req.query.token as string) || req.headers['authorization']?.split(' ')[1];

    if (!token) {
        res.status(401).json({ error: 'Access token required' });
        return;
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
        req.user = decoded;
        next();
    } catch (err) {
        res.status(403).json({ error: 'Invalid or expired token' });
    }
};

/**
 * SSE subscription endpoint
 * GET /api/events
 *
 * Client connects and keeps connection open to receive real-time updates
 * Supports Last-Event-ID header for resumable connections
 */
router.get('/', sseAuth, (req: Request, res: Response): void => {
    const userId = req.user!.id;

    // Get Last-Event-ID from header or query param (for initial connection with replay)
    const lastEventId = (req.headers['last-event-id'] as string) || (req.query.lastEventId as string);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Prevent response timeout
    req.socket.setTimeout(0);

    // Send initial connection confirmation with event ID
    const connectEventId = generateEventId();
    res.write(`id: ${connectEventId}\ndata: ${JSON.stringify({ type: 'connected', userId })}\n\n`);

    // Replay missed events if Last-Event-ID provided
    if (lastEventId) {
        const { events: missedEvents, gapDetected } = getEventsSince(lastEventId);

        if (gapDetected) {
            // Buffer overflow - client missed events and needs to refetch
            console.log(`SSE: Buffer overflow detected for user ${userId}, sending refetch signal`);
            const overflowEventId = generateEventId();
            res.write(`id: ${overflowEventId}\ndata: ${JSON.stringify({ type: 'buffer_overflow' })}\n\n`);
        } else if (missedEvents.length > 0) {
            console.log(`SSE: Replaying ${missedEvents.length} missed events for user ${userId}`);
            missedEvents.forEach(evt => {
                res.write(`id: ${evt.id}\ndata: ${JSON.stringify(evt.data)}\n\n`);
            });
        }
    }

    // Add this client to the set
    if (!clients.has(userId)) {
        clients.set(userId, new Set());
    }
    clients.get(userId)!.add(res);

    // Heartbeat to keep connection alive (every 30s)
    // Include event ID so client can track last seen event
    const heartbeatInterval = setInterval(() => {
        const heartbeatId = generateEventId();
        res.write(`id: ${heartbeatId}\n: heartbeat\n\n`);
    }, 30000);

    // Cleanup on disconnect
    req.on('close', () => {
        clearInterval(heartbeatInterval);
        const userClients = clients.get(userId);
        if (userClients) {
            userClients.delete(res);
            if (userClients.size === 0) {
                clients.delete(userId);
            }
        }
    });
});

/**
 * Broadcast an order update to all connected clients
 *
 * @param data - The event data to broadcast
 * @param excludeUserId - User ID to exclude from broadcast (typically the mutation initiator).
 *                        The initiating user already has optimistic updates applied,
 *                        so sending SSE to them causes duplicate/flickering updates.
 */
export function broadcastOrderUpdate(data: OrderUpdateEvent, excludeUserId: string | null = null): void {
    const eventId = generateEventId();
    const storedEvent: StoredEvent = { id: eventId, data, timestamp: Date.now() };
    storeEvent(storedEvent);

    const message = `id: ${eventId}\ndata: ${JSON.stringify(data)}\n\n`;

    let broadcastCount = 0;
    clients.forEach((clientSet, userId) => {
        // Skip initiating user - they already have optimistic updates applied
        // Sending to them causes double updates and UI flickering
        if (userId === excludeUserId) {
            return;
        }

        clientSet.forEach(client => {
            try {
                client.write(message);
                broadcastCount++;
            } catch (err: unknown) {
                // Client disconnected - clean up immediately to avoid repeated failures
                console.error(`SSE broadcast error for user ${userId}:`, err instanceof Error ? err.message : String(err));
                clientSet.delete(client);
                if (clientSet.size === 0) {
                    clients.delete(userId);
                }
            }
        });
    });

    if (broadcastCount > 0) {
        console.log(`SSE: Broadcast ${data.type} (id: ${eventId}) to ${broadcastCount} clients${excludeUserId ? ` (excluded user ${excludeUserId})` : ''}`);
    }
}

/**
 * Get count of connected clients (for monitoring)
 */
export function getConnectedClientCount(): { totalConnections: number; uniqueUsers: number } {
    let total = 0;
    clients.forEach(clientSet => {
        total += clientSet.size;
    });
    return { totalConnections: total, uniqueUsers: clients.size };
}

/**
 * Get recent events count (for debugging/monitoring)
 */
export function getRecentEventsCount(): number {
    return recentEvents.length;
}

export default router;
