/**
 * Internal API endpoints for Server Functions to call Express services
 *
 * These endpoints are NOT for external clients. They enable Server Functions
 * running in TanStack Start to communicate with Express-only features like SSE.
 *
 * Security: Uses a shared secret header to prevent external abuse.
 * In production, Server Functions and Express run on the same server,
 * so this is server-to-server communication.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { broadcastOrderUpdate } from './sse.js';
import type { OrderUpdateEvent } from './sse.js';

const router: Router = Router();

// Shared secret for internal API calls
// In production, this should be set via environment variable
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'coh-internal-api-secret-dev';

/**
 * Middleware to verify internal API calls
 * Checks for either:
 * 1. X-Internal-Secret header matching the secret
 * 2. Request from localhost (for dev/same-server calls)
 */
function verifyInternalRequest(req: Request, res: Response, next: NextFunction): void {
    const secret = req.headers['x-internal-secret'];
    const forwardedFor = req.headers['x-forwarded-for'];
    const remoteAddress = req.socket?.remoteAddress || req.ip;

    // Check 1: Valid secret header
    if (secret === INTERNAL_API_SECRET) {
        next();
        return;
    }

    // Check 2: Localhost request (same server)
    // In production with reverse proxy, check x-forwarded-for
    const isLocalhost =
        remoteAddress === '127.0.0.1' ||
        remoteAddress === '::1' ||
        remoteAddress === '::ffff:127.0.0.1' ||
        (forwardedFor === undefined && remoteAddress?.includes('127.0.0.1'));

    if (isLocalhost) {
        next();
        return;
    }

    // Reject external requests without valid secret
    console.warn(`[Internal API] Rejected request from ${remoteAddress} - missing or invalid secret`);
    res.status(403).json({ error: 'Forbidden - internal endpoint' });
}

/**
 * POST /api/internal/sse-broadcast
 *
 * Broadcasts an SSE event to all connected clients.
 * Called by Server Functions after mutations to notify other users.
 *
 * Body: { event: OrderUpdateEvent, excludeUserId?: string }
 */
router.post('/sse-broadcast', verifyInternalRequest, (req: Request, res: Response): void => {
    try {
        const { event, excludeUserId } = req.body as {
            event: OrderUpdateEvent;
            excludeUserId?: string;
        };

        if (!event || !event.type) {
            res.status(400).json({ error: 'Missing event or event.type' });
            return;
        }

        // Broadcast to all connected SSE clients
        broadcastOrderUpdate(event, excludeUserId || null);

        res.json({ success: true, eventType: event.type });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Internal API] SSE broadcast error:', message);
        res.status(500).json({ error: 'Failed to broadcast event' });
    }
});

export default router;
