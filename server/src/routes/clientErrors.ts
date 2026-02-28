import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import logBuffer from '../utils/logBuffer.js';
import type { LogLevel } from '../utils/logBuffer.js';

const router = Router();

// Rate limit: track client error reports per IP
const clientErrorCounts = new Map<string, { count: number; resetAt: number }>();
const CLIENT_ERROR_MAX = 10;
const CLIENT_ERROR_WINDOW_MS = 60_000;

// Prune expired entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of clientErrorCounts) {
        if (now >= entry.resetAt) {
            clientErrorCounts.delete(ip);
        }
    }
}, 5 * 60_000);

const clientErrorSchema = z.object({
    level: z.enum(['error', 'warn', 'info']).default('error'),
    message: z.string().max(2000),
    context: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Receive client-side error reports
 * No auth required — errors can happen before/during login
 * Rate-limited: 10 per IP per minute
 * @route POST /api/logs/client
 */
router.post('/client', asyncHandler(async (req: Request, res: Response) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();

    // Rate limit check
    const entry = clientErrorCounts.get(ip);
    if (entry && now < entry.resetAt) {
        if (entry.count >= CLIENT_ERROR_MAX) {
            res.status(429).json({ error: 'Too many error reports' });
            return;
        }
        entry.count++;
    } else {
        clientErrorCounts.set(ip, { count: 1, resetAt: now + CLIENT_ERROR_WINDOW_MS });
    }

    // Validate payload
    const parsed = clientErrorSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payload' });
        return;
    }

    const { level, message, context } = parsed.data;
    logBuffer.addLog(level as LogLevel, message, { source: 'client', ...context });
    res.json({ ok: true });
}));

export default router;
