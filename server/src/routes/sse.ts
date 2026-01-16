/**
 * Server-Sent Events (SSE) endpoint for real-time order updates
 *
 * Enables push notifications when order data changes (status transitions, new orders, etc.)
 * Clients subscribe via EventSource and receive updates for all orders they have access to.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../types/express.js';

const router: Router = Router();

// Type for SSE event data
export interface OrderUpdateEvent {
    type: 'line_status' | 'order_created' | 'order_updated' | 'order_deleted' | 'inventory_updated';
    view?: string;
    orderId?: string;
    lineId?: string;
    skuId?: string;
    changes?: Record<string, unknown>;
}

/**
 * Map of connected clients: userId -> Set<Response>
 * Using Set allows multiple tabs/windows per user
 */
const clients = new Map<string, Set<Response>>();

/**
 * Custom auth for SSE since EventSource doesn't support custom headers
 * Accept token via query parameter
 */
const sseAuth = (req: Request, res: Response, next: NextFunction): void => {
    // Try query param first (for EventSource), then header
    const token = (req.query.token as string) || req.headers['authorization']?.split(' ')[1];

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
 */
router.get('/', sseAuth, (req: Request, res: Response): void => {
    const userId = req.user!.id;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Prevent response timeout
    req.socket.setTimeout(0);

    // Send initial connection confirmation
    res.write(`data: ${JSON.stringify({ type: 'connected', userId })}\n\n`);

    // Add this client to the set
    if (!clients.has(userId)) {
        clients.set(userId, new Set());
    }
    clients.get(userId)!.add(res);

    // Heartbeat to keep connection alive (every 30s)
    const heartbeatInterval = setInterval(() => {
        res.write(`: heartbeat\n\n`);
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
 * @param excludeUserId - Optional user ID to exclude from broadcast (the user who made the change)
 */
export function broadcastOrderUpdate(data: OrderUpdateEvent, excludeUserId: string | null = null): void {
    const event = `data: ${JSON.stringify(data)}\n\n`;

    let broadcastCount = 0;
    clients.forEach((clientSet, userId) => {
        // Skip the user who initiated the change (they have optimistic update)
        if (userId === excludeUserId) return;

        clientSet.forEach(client => {
            try {
                client.write(event);
                broadcastCount++;
            } catch (err: any) {
                // Client disconnected, will be cleaned up on next request
                console.error(`SSE broadcast error for user ${userId}:`, err.message);
            }
        });
    });

    if (broadcastCount > 0) {
        console.log(`SSE: Broadcast ${data.type} to ${broadcastCount} clients`);
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

export default router;
