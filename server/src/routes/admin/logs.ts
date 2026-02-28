import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import logBuffer from '../../utils/logBuffer.js';
import type { LogBufferWithPath } from './types.js';

const router = Router();

// NOTE: POST /logs/client moved to server/src/routes/clientErrors.ts (public, no auth)

/**
 * Fetch server logs (from server.jsonl, 24hr retention)
 * Auth handled by admin router-level guard in admin/index.ts
 * @route GET /api/admin/logs?level=error&limit=100&offset=0&search=term
 */
router.get('/logs', asyncHandler(async (req: Request, res: Response) => {
    const level = (req.query.level as string) || 'all';
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const offset = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string) || null;

    const result = logBuffer.getLogs({ level: level as 'error' | 'warn' | 'info' | 'all', limit, offset, search });
    res.json(result);
}));

// Get log statistics
router.get('/logs/stats', asyncHandler(async (req: Request, res: Response) => {
    const stats = logBuffer.getStats() as unknown as Record<string, unknown>;

    stats.isPersistent = true;
    stats.storageType = 'file';

    const logBufferWithPath = logBuffer as unknown as LogBufferWithPath;
    stats.logFilePath = logBufferWithPath.logFilePath;

    try {
        if (fs.existsSync(logBufferWithPath.logFilePath)) {
            const fileStats = fs.statSync(logBufferWithPath.logFilePath);
            stats.fileSizeBytes = fileStats.size;
            stats.fileSizeKB = Math.round(fileStats.size / 1024);
            stats.fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
        }
    } catch (fsError) {
        console.error('[admin] Failed to get log file stats:', fsError);
    }

    res.json(stats);
}));

// Clear logs
router.delete('/logs', asyncHandler(async (req: Request, res: Response) => {
    logBuffer.clearLogs();
    res.json({ message: 'Logs cleared successfully' });
}));

export default router;
