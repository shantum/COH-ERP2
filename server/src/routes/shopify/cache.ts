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
// Note: /cache-status moved to server function getCacheStatus (client/src/server/functions/shopify.ts)

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
  // Run counts and status distribution in parallel using SQL JSON extraction (avoids loading all rawData)
  const [totalCached, processed, failed, pending, statusRows, totalProducts, linkedProducts, lastSync] = await Promise.all([
    req.prisma.shopifyProductCache.count(),
    req.prisma.shopifyProductCache.count({ where: { processedAt: { not: null } } }),
    req.prisma.shopifyProductCache.count({ where: { processingError: { not: null } } }),
    req.prisma.shopifyProductCache.count({ where: { processedAt: null, processingError: null } }),
    req.prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
      SELECT COALESCE("rawData"::jsonb->>'status', 'unknown') AS status, COUNT(*) AS count
      FROM "ShopifyProductCache"
      GROUP BY 1
    `,
    req.prisma.product.count(),
    req.prisma.product.count({ where: { shopifyProductId: { not: null } } }),
    req.prisma.shopifyProductCache.findFirst({
      where: { webhookTopic: 'manual_sync' },
      orderBy: { lastWebhookAt: 'desc' },
      select: { lastWebhookAt: true }
    }),
  ]);

  const statusCounts: Record<string, number> = { active: 0, draft: 0, archived: 0, unknown: 0 };
  for (const row of statusRows) {
    statusCounts[row.status] = Number(row.count);
  }

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

// ============================================
// WEBHOOK DETAIL (with payload and result)
// ============================================

router.get('/webhook/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const webhookLog = await req.prisma.webhookLog.findUnique({
    where: { id }
  });

  if (!webhookLog) {
    res.status(404).json({ error: 'Webhook log not found' });
    return;
  }

  // Parse stored JSON fields
  let payload = null;
  let resultData = null;

  try {
    if (webhookLog.payload) {
      payload = JSON.parse(webhookLog.payload);
    }
  } catch (e) {
    payload = { _parseError: true, raw: webhookLog.payload };
  }

  try {
    if (webhookLog.resultData) {
      resultData = JSON.parse(webhookLog.resultData);
    }
  } catch (e) {
    resultData = { _parseError: true, raw: webhookLog.resultData };
  }

  // If this is an order webhook, also fetch the related order from DB
  let relatedOrder = null;
  if (webhookLog.topic?.startsWith('orders/') && webhookLog.resourceId) {
    const order = await req.prisma.order.findFirst({
      where: { shopifyOrderId: webhookLog.resourceId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        createdAt: true,
        orderLines: {
          select: {
            id: true,
            lineStatus: true,
            awbNumber: true,
            sku: { select: { skuCode: true } }
          }
        }
      }
    });
    if (order) {
      // Map lineStatus to status for client compatibility
      relatedOrder = {
        ...order,
        orderLines: order.orderLines.map((line: { id: string; lineStatus: string; awbNumber: string | null; sku: { skuCode: string } }, index: number) => ({
          ...line,
          lineNumber: index + 1,
          status: line.lineStatus
        }))
      };
    }
  }

  // If this is a product webhook, fetch related product
  let relatedProduct = null;
  if (webhookLog.topic?.startsWith('products/') && webhookLog.resourceId) {
    const product = await req.prisma.product.findFirst({
      where: { shopifyProductId: webhookLog.resourceId },
      select: {
        id: true,
        name: true,
        shopifyProductId: true,
        createdAt: true,
        updatedAt: true,
        variations: {
          select: {
            id: true,
            colorName: true,
            skus: { select: { id: true, skuCode: true } }
          }
        }
      }
    });
    if (product) {
      // Map colorName to name for client compatibility
      relatedProduct = {
        ...product,
        variations: product.variations.map((v: { id: string; colorName: string; skus: { id: string; skuCode: string }[] }) => ({
          ...v,
          name: v.colorName
        }))
      };
    }
  }

  // If this is a customer webhook, fetch related customer
  let relatedCustomer = null;
  if (webhookLog.topic?.startsWith('customers/') && webhookLog.resourceId) {
    const customer = await req.prisma.customer.findFirst({
      where: { shopifyCustomerId: webhookLog.resourceId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        createdAt: true,
        updatedAt: true
      }
    });
    if (customer) {
      // Combine firstName and lastName for client
      relatedCustomer = {
        ...customer,
        name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email
      };
    }
  }

  res.json({
    id: webhookLog.id,
    webhookId: webhookLog.webhookId,
    topic: webhookLog.topic,
    resourceId: webhookLog.resourceId,
    status: webhookLog.status,
    error: webhookLog.error,
    processingTimeMs: webhookLog.processingTime,
    receivedAt: webhookLog.receivedAt,
    processedAt: webhookLog.processedAt,
    payload,
    resultData,
    relatedData: {
      order: relatedOrder,
      product: relatedProduct,
      customer: relatedCustomer
    }
  });
}));

export default router;
