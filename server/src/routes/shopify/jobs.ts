// Shopify background jobs - sync jobs, scheduler, cache processor, dump worker
import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ValidationError, NotFoundError } from '../../utils/errors.js';
import syncWorker from '../../services/syncWorker.js';
import scheduledSync from '../../services/scheduledSync.js';
import cacheProcessor from '../../services/cacheProcessor.js';
import cacheDumpWorker from '../../services/cacheDumpWorker.js';

const router = Router();

// ============================================
// SYNC JOBS
// ============================================

router.post('/start', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { jobType, days, syncMode, staleAfterMins } = req.body as {
    jobType: string;
    days?: number;
    syncMode?: string;
    staleAfterMins?: number;
  };

  if (!['orders', 'customers', 'products'].includes(jobType)) {
    throw new ValidationError('Invalid job type. Must be: orders, customers, or products');
  }

  if (syncMode && !['deep', 'incremental', 'quick', 'update'].includes(syncMode)) {
    throw new ValidationError(`Invalid syncMode: ${syncMode}. Must be 'deep' or 'incremental'.`);
  }

  const job = await syncWorker.startJob(jobType as 'orders' | 'customers' | 'products', {
    days: days || undefined,
    syncMode: syncMode as 'deep' | 'incremental' | 'quick' | 'update' | undefined,
    staleAfterMins
  });

  const effectiveMode = syncMode === 'deep' ? 'deep' : 'incremental';
  res.json({ message: `Sync job started (${effectiveMode} mode)`, job });
}));

router.get('/', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const jobs = await syncWorker.listJobs(limit);
  res.json(jobs);
}));

router.get('/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const job = await syncWorker.getJobStatus(id);
  if (!job) {
    throw new NotFoundError('Job not found', 'SyncJob', id);
  }
  res.json(job);
}));

router.post('/:id/resume', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const job = await syncWorker.resumeJob(req.params.id as string);
  res.json({ message: 'Job resumed', job });
}));

router.post('/:id/cancel', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const job = await syncWorker.cancelJob(req.params.id as string);
  res.json({ message: 'Job cancelled', job });
}));

// ============================================
// SCHEDULER
// ============================================

router.get('/scheduler/status', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(scheduledSync.getStatus());
}));

router.post('/scheduler/trigger', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const result = await scheduledSync.triggerSync();
  res.json({ message: 'Sync triggered', result });
}));

router.post('/scheduler/start', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  scheduledSync.start();
  res.json({ message: 'Scheduler started', status: scheduledSync.getStatus() });
}));

router.post('/scheduler/stop', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  scheduledSync.stop();
  res.json({ message: 'Scheduler stopped', status: scheduledSync.getStatus() });
}));

// ============================================
// CACHE PROCESSOR
// ============================================

router.get('/processor/status', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await cacheProcessor.getStatusWithPending());
}));

router.post('/processor/start', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  cacheProcessor.start();
  res.json({ message: 'Cache processor started', ...(await cacheProcessor.getStatusWithPending()) });
}));

router.post('/processor/stop', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  cacheProcessor.stop();
  res.json({ message: 'Cache processor stopped', ...cacheProcessor.getStatus() });
}));

router.post('/processor/pause', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  cacheProcessor.pause();
  res.json({ message: 'Cache processor paused', ...cacheProcessor.getStatus() });
}));

router.post('/processor/resume', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  cacheProcessor.resume();
  res.json({ message: 'Cache processor resumed', ...cacheProcessor.getStatus() });
}));

router.post('/processor/trigger', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await cacheProcessor.triggerBatch();
    res.json({ message: 'Batch triggered', batch: result, ...(await cacheProcessor.getStatusWithPending()) });
  } catch (error) {
    const err = error as Error;
    res.status(400).json({ error: err.message });
  }
}));

// ============================================
// CACHE DUMP WORKER
// ============================================

router.get('/dump/status', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await cacheDumpWorker.getStatus());
}));

router.post('/dump/stop', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  cacheDumpWorker.stop();
  res.json({ message: 'Cache dump worker stopped', ...(await cacheDumpWorker.getStatus()) });
}));

router.post('/dump/start', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { daysBack } = req.body as { daysBack?: number };

  try {
    const job = await cacheDumpWorker.startJob({ daysBack });
    res.json({
      message: daysBack ? `Cache dump started (last ${daysBack} days)` : 'Cache dump started (all time)',
      job,
      ...(await cacheDumpWorker.getStatus())
    });
  } catch (error) {
    const err = error as Error;
    res.status(400).json({ error: err.message });
  }
}));

router.post('/dump/:id/cancel', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const job = await cacheDumpWorker.cancelJob(req.params.id as string);
    res.json({ message: 'Cache dump cancelled', job });
  } catch (error) {
    const err = error as Error;
    res.status(400).json({ error: err.message });
  }
}));

router.post('/dump/:id/resume', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const job = await cacheDumpWorker.resumeJob(req.params.id as string);
    res.json({ message: 'Cache dump resumed', job });
  } catch (error) {
    const err = error as Error;
    res.status(400).json({ error: err.message });
  }
}));

export default router;
