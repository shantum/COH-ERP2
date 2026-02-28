// Shopify debug endpoints - locks, sync progress, circuit breaker
import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';
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
router.post('/circuit-breaker/reset', authenticateToken, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
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

// GET /product-cache/:skuCode - Debug product cache for a specific SKU
router.get('/product-cache/:skuCode', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { skuCode } = req.params as { skuCode: string };

  // Find the SKU and its product
  const sku = await req.prisma.sku.findFirst({
    where: { skuCode },
    include: {
      variation: {
        include: {
          product: true
        }
      }
    }
  });

  if (!sku) {
    res.status(404).json({ error: 'SKU not found', skuCode });
    return;
  }

  const product = sku.variation.product;

  // Check the cache for the primary shopifyProductId
  let primaryCache = null;
  if (product.shopifyProductId) {
    const cache = await req.prisma.shopifyProductCache.findUnique({
      where: { id: product.shopifyProductId }
    });
    if (cache) {
      let rawData: Record<string, unknown> | null = null;
      try { rawData = JSON.parse(cache.rawData); } catch { /* malformed cache */ }
      primaryCache = {
        cacheId: cache.id,
        statusInCache: rawData?.status ?? null,
        titleInCache: rawData?.title ?? null,
        lastWebhookAt: cache.lastWebhookAt,
        processedAt: cache.processedAt
      };
    }
  }

  // Primary cache already fetched above — no need to iterate shopifyProductIds
  const linkedCaches = primaryCache ? [{
    cacheId: primaryCache.cacheId,
    statusInCache: primaryCache.statusInCache,
    titleInCache: primaryCache.titleInCache,
    isPrimary: true,
  }] : [];

  // Check variation's source product cache
  let variationSourceCache = null;
  const variation = sku.variation;
  if (variation.shopifySourceProductId) {
    const cache = await req.prisma.shopifyProductCache.findUnique({
      where: { id: variation.shopifySourceProductId }
    });
    if (cache) {
      let rawData: Record<string, unknown> | null = null;
      try { rawData = JSON.parse(cache.rawData); } catch { /* malformed cache */ }
      variationSourceCache = {
        cacheId: cache.id,
        statusInCache: rawData?.status ?? null,
        titleInCache: rawData?.title ?? null
      };
    }
  }

  res.json({
    sku: {
      skuCode: sku.skuCode,
      size: sku.size
    },
    variation: {
      id: variation.id,
      colorName: variation.colorName,
      shopifySourceProductId: variation.shopifySourceProductId,
      shopifySourceHandle: variation.shopifySourceHandle
    },
    product: {
      id: product.id,
      name: product.name,
      shopifyProductId: product.shopifyProductId,
      shopifyProductIds: product.shopifyProductIds
    },
    variationSourceCache,
    primaryCache,
    linkedCaches,
    issue: primaryCache && primaryCache.statusInCache !== 'active'
      ? `Primary cache shows '${primaryCache.statusInCache}' but may have active variants in other linked products`
      : null,
    fix: variationSourceCache
      ? `Query now uses variation.shopifySourceProductId (${variation.shopifySourceProductId}) which shows status: ${variationSourceCache.statusInCache}`
      : 'Variation has no shopifySourceProductId set - will fall back to product.shopifyProductId'
  });
}));

export default router;
