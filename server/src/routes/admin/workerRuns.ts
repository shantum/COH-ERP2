import { Router } from 'express';
import type { Request, Response } from 'express';
// Auth handled by admin router-level guard in admin/index.ts
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router = Router();

/**
 * Get worker run history with optional filters
 * @route GET /api/admin/worker-runs
 * @query {string} [workerName] - Filter by worker name
 * @query {string} [status] - Filter by status (running/completed/failed)
 * @query {number} [limit=50] - Max rows
 * @query {number} [offset=0] - Pagination offset
 */
router.get('/worker-runs', asyncHandler(async (req: Request, res: Response) => {
    const workerName = req.query.workerName as string | undefined;
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const where: Record<string, unknown> = {};
    if (workerName) where.workerName = workerName;
    if (status) where.status = status;

    const [runs, total] = await Promise.all([
        req.prisma.workerRun.findMany({
            where,
            orderBy: { startedAt: 'desc' },
            take: limit,
            skip: offset,
        }),
        req.prisma.workerRun.count({ where }),
    ]);

    res.json({ runs, total });
}));

/**
 * Get per-worker summary stats (last 24h counts, avg duration, last run)
 * @route GET /api/admin/worker-runs/summary
 */
router.get('/worker-runs/summary', asyncHandler(async (req: Request, res: Response) => {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get all runs from last 24h
    const recentRuns = await req.prisma.workerRun.findMany({
        where: { startedAt: { gte: since24h } },
        select: {
            workerName: true,
            status: true,
            durationMs: true,
            startedAt: true,
        },
        orderBy: { startedAt: 'desc' },
    });

    // Get last run per worker (regardless of time window)
    const lastRuns = await req.prisma.workerRun.findMany({
        orderBy: { startedAt: 'desc' },
        distinct: ['workerName'],
        select: {
            workerName: true,
            status: true,
            startedAt: true,
        },
    });

    // Build summary per worker
    const summary: Record<string, {
        last24h: { total: number; succeeded: number; failed: number };
        avgDurationMs: number | null;
        lastRunAt: string | null;
        lastStatus: string | null;
    }> = {};

    // Group recent runs by worker
    for (const run of recentRuns) {
        if (!summary[run.workerName]) {
            summary[run.workerName] = {
                last24h: { total: 0, succeeded: 0, failed: 0 },
                avgDurationMs: null,
                lastRunAt: null,
                lastStatus: null,
            };
        }
        const s = summary[run.workerName];
        s.last24h.total++;
        if (run.status === 'completed') s.last24h.succeeded++;
        if (run.status === 'failed') s.last24h.failed++;
    }

    // Compute avg duration per worker
    for (const workerName of Object.keys(summary)) {
        const durations = recentRuns
            .filter(r => r.workerName === workerName && r.durationMs != null)
            .map(r => r.durationMs!);
        if (durations.length > 0) {
            summary[workerName].avgDurationMs = Math.round(
                durations.reduce((a, b) => a + b, 0) / durations.length
            );
        }
    }

    // Fill in last run info
    for (const run of lastRuns) {
        if (!summary[run.workerName]) {
            summary[run.workerName] = {
                last24h: { total: 0, succeeded: 0, failed: 0 },
                avgDurationMs: null,
                lastRunAt: null,
                lastStatus: null,
            };
        }
        summary[run.workerName].lastRunAt = run.startedAt.toISOString();
        summary[run.workerName].lastStatus = run.status;
    }

    res.json(summary);
}));

export default router;
