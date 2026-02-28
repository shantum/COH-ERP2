import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import logBuffer from '../../utils/logBuffer.js';
import type { LogLevel } from '../../utils/logBuffer.js';
import type { LogBufferWithPath } from './types.js';

const router = Router();

// Rate limit: track client error reports per IP
const clientErrorCounts = new Map<string, { count: number; resetAt: number }>();
const CLIENT_ERROR_MAX = 10;
const CLIENT_ERROR_WINDOW_MS = 60_000;

const clientErrorSchema = z.object({
    level: z.enum(['error', 'warn', 'info']).default('error'),
    message: z.string().max(2000),
    context: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Receive client-side error reports
 * No auth required — errors can happen before/during login
 * Rate-limited: 10 per IP per minute
 * @route POST /api/admin/logs/client
 */
router.post('/logs/client', asyncHandler(async (req: Request, res: Response) => {
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

/**
 * Fetch server logs (from server.jsonl, 24hr retention)
 * @route GET /api/admin/logs?level=error&limit=100&offset=0&search=term
 * @param {string} [query.level] - Filter by level ('error', 'warn', 'info', 'all')
 * @param {number} [query.limit=100] - Max logs to return (max 1000)
 * @param {number} [query.offset=0] - Skip N logs
 * @param {string} [query.search] - Search term
 * @returns {Object} { logs: [], total, level, limit, offset }
 */
router.get('/logs', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const level = (req.query.level as string) || 'all';
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const offset = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string) || null;

    const result = logBuffer.getLogs({ level: level as 'error' | 'warn' | 'info' | 'all', limit, offset, search });
    res.json(result);
}));

// Get log statistics
router.get('/logs/stats', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const stats = logBuffer.getStats() as unknown as Record<string, unknown>;

    // Add storage metadata
    stats.isPersistent = true;
    stats.storageType = 'file';

    // Access logFilePath via type assertion (it's private but accessed in original code)
    const logBufferWithPath = logBuffer as unknown as LogBufferWithPath;
    stats.logFilePath = logBufferWithPath.logFilePath;

    // Get file size if available
    try {
        if (fs.existsSync(logBufferWithPath.logFilePath)) {
            const fileStats = fs.statSync(logBufferWithPath.logFilePath);
            stats.fileSizeBytes = fileStats.size;
            stats.fileSizeKB = Math.round(fileStats.size / 1024);
            stats.fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
        }
    } catch (fsError) {
        console.error('[admin] Failed to get log file stats:', fsError);
        // File size not critical, continue without it
    }

    res.json(stats);
}));

// Clear logs (Admin only)
router.delete('/logs', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    logBuffer.clearLogs();
    res.json({ message: 'Logs cleared successfully' });
}));

export default router;
