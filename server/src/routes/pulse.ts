/**
 * Pulse SSE endpoint - lightweight real-time signals
 *
 * GET /api/pulse - SSE stream of database change signals
 * GET /api/pulse/status - Health check (connection status, client count)
 *
 * Unlike /api/events which sends full row data, this endpoint sends
 * minimal signals that trigger client-side TanStack Query invalidations.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../types/express.js';
import { pulseBroadcaster } from '../services/pulseBroadcaster.js';

const router: Router = Router();

/**
 * Auth middleware - cookie-first, with query param fallback for legacy clients
 */
const pulseAuth = (req: Request, res: Response, next: NextFunction): void => {
    const token = req.cookies?.auth_token || (req.query.token as string) || req.headers['authorization']?.split(' ')[1];

    if (!token) {
        res.status(401).json({ error: 'Access token required' });
        return;
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
        req.user = decoded;
        next();
    } catch {
        res.status(403).json({ error: 'Invalid or expired token' });
    }
};

/**
 * SSE subscription endpoint
 * GET /api/pulse
 *
 * Client connects and receives database change signals.
 * Simpler than /api/events - no event ID tracking or replay buffer.
 */
router.get('/', pulseAuth, (req: Request, res: Response): void => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Prevent response timeout
    req.socket.setTimeout(0);

    // Register client with broadcaster
    pulseBroadcaster.addClient(res);

    // Heartbeat every 30s to keep connection alive (prevents proxy timeouts)
    const heartbeatInterval = setInterval(() => {
        try {
            res.write(': heartbeat\n\n');
        } catch {
            // Connection dead, cleanup will happen in 'close' handler
        }
    }, 30000);

    // Cleanup on disconnect - CRITICAL for preventing memory leaks
    req.on('close', () => {
        clearInterval(heartbeatInterval);
        pulseBroadcaster.removeClient(res);
    });
});

/**
 * Health check endpoint
 * GET /api/pulse/status
 *
 * Returns connection status and client count.
 * Useful for monitoring dashboards.
 */
router.get('/status', (req: Request, res: Response): void => {
    res.json(pulseBroadcaster.getStatus());
});

export default router;
