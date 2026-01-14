// Shopify cache status and maintenance endpoints
import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { runAllCleanup, getCacheStats } from '../../utils/cacheCleanup.js';
import { shopifyLogger } from '../../utils/logger.js';
import type { CleanupOptions } from './types.js';

const router = Router();

// ============================================
// CACHE STATUS
// ============================================

router.get('/cache-status', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const totalCached = await req.prisma.shopifyOrderCache.count();
  const processed = await req.prisma.shopifyOrderCache.count({ where: { processedAt: { not: null } } });
  const failed = await req.prisma.shopifyOrderCache.count({ where: { processingError: { not: null } } });
  const pending = await req.prisma.shopifyOrderCache.count({ where: { processedAt: null, processingError: null } });

  const recentFailures = await req.prisma.shopifyOrderCache.findMany({
    where: { processingError: { not: null } },
    select: { id: true, orderNumber: true, processingError: true, lastWebhookAt: true },
    orderBy: { lastWebhookAt: 'desc' },
    take: 5
  });

  res.json({ totalCached, processed, failed, pending, recentFailures });
}));

router.get('/cache-stats', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const [total, unprocessed, failed, processed] = await Promise.all([
    req.prisma.shopifyOrderCache.count(),
    req.prisma.shopifyOrderCache.count({ where: { processedAt: null, processingError: null } }),
    req.prisma.shopifyOrderCache.count({ where: { processingError: { not: null } } }),
    req.prisma.shopifyOrderCache.count({ where: { processedAt: { not: null } } }),
  ]);

  const recentErrors = await req.prisma.shopifyOrderCache.findMany({
    where: { processingError: { not: null } },
    select: { id: true, orderNumber: true, processingError: true, lastWebhookAt: true },
    orderBy: { lastWebhookAt: 'desc' },
    take: 10
  });

  res.json({
    total, unprocessed, failed, processed,
    recentErrors: recentErrors.map(e => ({
      id: e.id, orderNumber: e.orderNumber, error: e.processingError, lastUpdate: e.lastWebhookAt
    }))
  });
}));

// ============================================
// PRODUCT CACHE STATUS
// ============================================

router.get('/product-cache-status', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const totalCached = await req.prisma.shopifyProductCache.count();
  const processed = await req.prisma.shopifyProductCache.count({ where: { processedAt: { not: null } } });
  const failed = await req.prisma.shopifyProductCache.count({ where: { processingError: { not: null } } });
  const pending = await req.prisma.shopifyProductCache.count({ where: { processedAt: null, processingError: null } });

  // Get status distribution from cached rawData
  const allCache = await req.prisma.shopifyProductCache.findMany({ select: { rawData: true } });
  const statusCounts: Record<string, number> = { active: 0, draft: 0, archived: 0, unknown: 0 };
  for (const cache of allCache) {
    try {
      const data = JSON.parse(cache.rawData) as { status?: string };
      const status = data.status || 'unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    } catch {
      statusCounts.unknown++;
    }
  }

  const totalProducts = await req.prisma.product.count();
  const linkedProducts = await req.prisma.product.count({ where: { shopifyProductId: { not: null } } });

  const lastSync = await req.prisma.shopifyProductCache.findFirst({
    where: { webhookTopic: 'manual_sync' },
    orderBy: { lastWebhookAt: 'desc' },
    select: { lastWebhookAt: true }
  });

  res.json({
    totalCached, processed, failed, pending,
    shopifyStatus: statusCounts,
    erpProducts: { total: totalProducts, linked: linkedProducts, notLinked: totalProducts - linkedProducts },
    lastSyncAt: lastSync?.lastWebhookAt || null
  });
}));

// ============================================
// CACHE MAINTENANCE
// ============================================

router.get('/full-stats', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getCacheStats());
}));

router.post('/cleanup', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const options = req.body as CleanupOptions;
  const results = await runAllCleanup(options);
  res.json({ message: 'Cache cleanup completed', ...results });
}));

// ============================================
// WEBHOOK ACTIVITY
// ============================================

router.get('/activity', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const hours = parseInt(req.query.hours as string) || 24;

  const since = new Date();
  since.setHours(since.getHours() - hours);

  const logs = await req.prisma.webhookLog.findMany({
    where: { receivedAt: { gte: since } },
    orderBy: { receivedAt: 'desc' },
    take: limit
  });

  const stats = await req.prisma.webhookLog.groupBy({
    by: ['status'],
    where: { receivedAt: { gte: since } },
    _count: true
  });

  const statsMap: Record<string, number> = {};
  for (const s of stats) {
    statsMap[s.status] = s._count;
  }

  const byTopic = await req.prisma.webhookLog.groupBy({
    by: ['topic'],
    where: { receivedAt: { gte: since } },
    _count: true
  });

  const topicMap: Record<string, number> = {};
  for (const t of byTopic) {
    topicMap[t.topic || 'unknown'] = t._count;
  }

  res.json({
    timeRange: { hours, since: since.toISOString() },
    summary: {
      total: logs.length,
      processed: statsMap.processed || 0,
      failed: statsMap.failed || 0,
      pending: statsMap.pending || 0,
      received: statsMap.received || 0
    },
    byTopic: topicMap,
    recentLogs: logs.map(l => ({
      id: l.id, webhookId: l.webhookId, topic: l.topic, resourceId: l.resourceId,
      status: l.status, error: l.error, processingTimeMs: l.processingTime,
      receivedAt: l.receivedAt, processedAt: l.processedAt
    }))
  });
}));

export default router;
