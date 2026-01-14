// Shopify debug endpoints - locks, sync progress, circuit breaker
import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { getOrderLockStatus } from '../../utils/orderLock.js';
import { getAllCircuitBreakerStatus, resetAllCircuitBreakers, shopifyApiCircuit } from '../../utils/circuitBreaker.js';
import scheduledSync from '../../services/scheduledSync.js';
import shutdownCoordinator from '../../utils/shutdownCoordinator.js';

const router = Router();

// GET /locks - Get current lock status (in-memory and database)
router.get('/locks', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const inMemoryLocks = getOrderLockStatus();

  const now = new Date();
  const dbLocks = await req.prisma.shopifyOrderCache.findMany({
    where: { processingLock: { not: null } },
    select: { id: true, orderNumber: true, processingLock: true },
    take: 100,
  });

  const databaseLocks = dbLocks.map(lock => ({
    orderId: lock.id,
    orderNumber: lock.orderNumber,
    lockExpiry: lock.processingLock,
    expired: lock.processingLock ? new Date(lock.processingLock) < now : true,
    ageSeconds: lock.processingLock ? Math.round((now.getTime() - new Date(lock.processingLock).getTime()) / 1000) : null,
  }));

  res.json({
    inMemory: { count: inMemoryLocks.length, locks: inMemoryLocks },
    database: {
      count: databaseLocks.length,
      activeLocks: databaseLocks.filter(l => !l.expired).length,
      locks: databaseLocks,
    },
  });
}));

// GET /sync-progress - Get sync progress and status
router.get('/sync-progress', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const schedulerStatus = scheduledSync.getStatus();

  const activeJobs = await req.prisma.syncJob.findMany({
    where: { status: { in: ['pending', 'running'] } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const recentJobs = await req.prisma.syncJob.findMany({
    where: { status: { in: ['completed', 'failed', 'cancelled'] } },
    orderBy: { completedAt: 'desc' },
    take: 5,
  });

  const unprocessedCount = await req.prisma.shopifyOrderCache.count({ where: { processedAt: null } });
  const errorCount = await req.prisma.shopifyOrderCache.count({ where: { processingError: { not: null } } });

  res.json({
    scheduler: schedulerStatus,
    activeJobs: activeJobs.map(job => ({
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      syncMode: job.syncMode,
      progress: job.totalRecords ? Math.round((job.processed / job.totalRecords) * 100) : null,
      processed: job.processed,
      totalRecords: job.totalRecords,
      errors: job.errors,
      startedAt: job.startedAt,
      currentBatch: job.currentBatch,
    })),
    recentJobs: recentJobs.map(job => ({
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      created: job.created,
      updated: job.updated,
      errors: job.errors,
      completedAt: job.completedAt,
      durationSeconds: job.startedAt && job.completedAt
        ? Math.round((job.completedAt.getTime() - job.startedAt.getTime()) / 1000)
        : null,
    })),
    cache: { unprocessed: unprocessedCount, withErrors: errorCount },
    shutdownHandlers: shutdownCoordinator.getStatus(),
  });
}));

// GET /circuit-breaker - Get circuit breaker status
router.get('/circuit-breaker', authenticateToken, asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    circuitBreakers: getAllCircuitBreakerStatus(),
    shopifyApi: shopifyApiCircuit.getStatus(),
  });
}));

// POST /circuit-breaker/reset - Reset circuit breaker
router.post('/circuit-breaker/reset', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };

  if (name) {
    if (name === 'shopify_api') {
      shopifyApiCircuit.reset();
    }
    res.json({ message: `Circuit breaker '${name}' reset`, status: shopifyApiCircuit.getStatus() });
  } else {
    resetAllCircuitBreakers();
    res.json({ message: 'All circuit breakers reset', circuitBreakers: getAllCircuitBreakerStatus() });
  }
}));

export default router;
