import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import logBuffer from '../../utils/logBuffer.js';
import type { LogBufferWithPath } from './types.js';

const router = Router();

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
