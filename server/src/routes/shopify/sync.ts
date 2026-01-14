// Shopify sync operations - product sync, customer sync, backfill, full-dump
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../../middleware/auth.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ValidationError, ExternalServiceError, NotFoundError } from '../../utils/errors.js';
import shopifyClient from '../../services/shopify.js';
import type { ShopifyOrder } from '../../services/shopify.js';
import { syncAllProducts } from '../../services/productSyncService.js';
import { syncCustomers, syncAllCustomers } from '../../services/customerSyncService.js';
import { processFromCache, markCacheProcessed, markCacheError, cacheShopifyOrders, processCacheBatch } from '../../services/shopifyOrderProcessor.js';
import { detectPaymentMethod } from '../../utils/shopifyHelpers.js';
import { shopifyLogger } from '../../utils/logger.js';
import { FULL_DUMP_CONFIG } from '../../constants.js';
import type { AxiosErrorLike, BackfillResult, BackfillPaymentMethodResult, BackfillOrderFieldsResult, OrderToBackfill } from './types.js';

const router = Router();

// ============================================
// BACKFILL HELPERS (private functions)
// ============================================

async function backfillPaymentMethod(prisma: PrismaClient, batchSize = 5000): Promise<BackfillPaymentMethodResult> {
  const ordersToBackfill = await prisma.order.findMany({
    where: {
      shopifyOrderId: { not: null },
      OR: [{ paymentMethod: null }, { paymentMethod: '' }],
    },
    select: { id: true, shopifyOrderId: true, orderNumber: true },
    take: batchSize
  });

  shopifyLogger.info({ count: ordersToBackfill.length }, 'Backfill PaymentMethod: starting');

  const results: BackfillPaymentMethodResult = {
    updated: 0, skipped: 0, errors: [], total: ordersToBackfill.length, noCache: 0,
  };

  for (const order of ordersToBackfill) {
    try {
      const cachedOrder = await prisma.shopifyOrderCache.findUnique({
        where: { id: order.shopifyOrderId! },
      });

      if (!cachedOrder?.rawData) {
        results.noCache++;
        continue;
      }

      const shopifyOrder = JSON.parse(cachedOrder.rawData) as ShopifyOrder;
      const paymentMethod = detectPaymentMethod(shopifyOrder);

      await prisma.order.update({
        where: { id: order.id },
        data: { paymentMethod },
      });
      results.updated++;
    } catch (orderError) {
      const err = orderError as Error;
      shopifyLogger.error({ orderNumber: order.orderNumber, error: err.message }, 'Error processing order backfill');
      results.errors.push(`Order ${order.orderNumber}: ${err.message}`);
    }
  }

  return results;
}

async function backfillCacheFields(prisma: PrismaClient, batchSize = 5000): Promise<BackfillResult> {
  const cacheEntries = await prisma.shopifyOrderCache.findMany({
    where: { discountCodes: null },
    orderBy: { createdAt: 'desc' },
    take: batchSize
  });

  shopifyLogger.info({ count: cacheEntries.length }, 'Backfill CacheFields: starting');

  if (cacheEntries.length === 0) {
    return { updated: 0, errors: [], total: 0, remaining: 0 };
  }

  const results: BackfillResult = { updated: 0, errors: [], total: cacheEntries.length };

  const parallelBatchSize = 10;
  for (let i = 0; i < cacheEntries.length; i += parallelBatchSize) {
    const batch = cacheEntries.slice(i, i + parallelBatchSize);

    await Promise.all(batch.map(async (entry) => {
      try {
        const shopifyOrder = JSON.parse(entry.rawData) as ShopifyOrder & {
          discount_codes?: Array<{ code: string }>;
          note?: string;
          tags?: string;
          shipping_address?: { city?: string; province?: string; country?: string };
        };

        const discountCodes = (shopifyOrder.discount_codes || []).map(d => d.code).join(', ') || '';
        const addr = shopifyOrder.shipping_address;

        await prisma.shopifyOrderCache.update({
          where: { id: entry.id },
          data: {
            discountCodes,
            customerNotes: shopifyOrder.note || null,
            tags: shopifyOrder.tags || null,
            shippingCity: addr?.city || null,
            shippingState: addr?.province || null,
            shippingCountry: addr?.country || null,
          },
        });
        results.updated++;
      } catch (entryError) {
        const err = entryError as Error;
        results.errors.push(`Cache ${entry.id}: ${err.message}`);
      }
    }));
  }

  results.remaining = await prisma.shopifyOrderCache.count({ where: { discountCodes: null } });
  return results;
}

async function backfillOrderFields(prisma: PrismaClient, batchSize = 5000): Promise<BackfillOrderFieldsResult> {
  const ordersToBackfill = await prisma.$queryRaw<OrderToBackfill[]>`
    SELECT o.id, o."shopifyOrderId", o."orderNumber"
    FROM "Order" o
    WHERE o."shopifyOrderId" IS NOT NULL
    AND (o."totalAmount" IS NULL OR o."totalAmount" = 0)
    LIMIT ${batchSize}
  `;

  if (ordersToBackfill.length === 0) {
    return { updated: 0, errors: [], total: 0, remaining: 0 };
  }

  shopifyLogger.info({ count: ordersToBackfill.length }, 'Backfill OrderFields: starting');

  const shopifyIds = ordersToBackfill.map((o) => String(o.shopifyOrderId));
  const cacheEntries = await prisma.shopifyOrderCache.findMany({
    where: { id: { in: shopifyIds } },
    select: { id: true, rawData: true },
  });

  const cacheMap = new Map(cacheEntries.map((c) => [c.id, c]));

  let updated = 0;
  const errors: Array<{ orderId: string; orderNumber: string | null; error: string }> = [];

  for (const order of ordersToBackfill) {
    const cache = cacheMap.get(String(order.shopifyOrderId));
    if (!cache?.rawData) continue;

    try {
      const rawData = typeof cache.rawData === 'string' ? JSON.parse(cache.rawData) as { total_price?: string } : cache.rawData as { total_price?: string };
      const totalAmount = parseFloat(rawData.total_price || '') || null;

      if (totalAmount === null) continue;

      await prisma.order.update({
        where: { id: order.id },
        data: { totalAmount },
      });
      updated++;
    } catch (error) {
      const err = error as Error;
      errors.push({ orderId: order.id, orderNumber: order.orderNumber, error: err.message });
    }
  }

  const [{ count: remaining }] = await prisma.$queryRaw<[{ count: number }]>`
    SELECT COUNT(*)::int as count FROM "Order"
    WHERE "shopifyOrderId" IS NOT NULL
    AND ("totalAmount" IS NULL OR "totalAmount" = 0)
  `;

  return { updated, errors, total: ordersToBackfill.length, remaining };
}

// ============================================
// PRODUCT SYNC
// ============================================

router.post('/products', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  await shopifyClient.loadFromDatabase();
  if (!shopifyClient.isConfigured()) {
    throw new ValidationError('Shopify is not configured');
  }

  const { limit = 50, syncAll = false } = req.body as { limit?: number; syncAll?: boolean };

  try {
    const { shopifyProducts, results } = await syncAllProducts(req.prisma, { limit, syncAll });

    res.json({
      message: 'Product sync completed',
      fetched: shopifyProducts.length,
      syncAll,
      results,
    });
  } catch (error) {
    const axiosError = error as AxiosErrorLike;
    shopifyLogger.error({ error: axiosError.message }, 'Product sync failed');
    throw new ExternalServiceError(axiosError.response?.data?.errors as string || axiosError.message, 'Shopify');
  }
}));

// ============================================
// CUSTOMER SYNC
// ============================================

router.post('/customers', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  await shopifyClient.loadFromDatabase();
  if (!shopifyClient.isConfigured()) {
    throw new ValidationError('Shopify is not configured');
  }

  const { since_id, created_at_min, limit = 50 } = req.body as {
    since_id?: string;
    created_at_min?: string;
    limit?: number;
  };

  try {
    const results = await syncCustomers(req.prisma, { since_id, created_at_min, limit, skipNoOrders: true });

    res.json({
      message: 'Customer sync completed',
      fetched: results.totalFetched,
      withOrders: results.totalFetched - results.skippedNoOrders,
      results: {
        created: results.created,
        updated: results.updated,
        skipped: results.skipped,
        skippedNoOrders: results.skippedNoOrders,
        errors: results.errors,
      },
      lastSyncedId: results.lastSyncedId,
    });
  } catch (error) {
    const axiosError = error as AxiosErrorLike;
    shopifyLogger.error({ error: axiosError.message }, 'Customer sync failed');
    throw new ExternalServiceError(axiosError.response?.data?.errors as string || axiosError.message, 'Shopify');
  }
}));

router.post('/customers/all', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  await shopifyClient.loadFromDatabase();
  if (!shopifyClient.isConfigured()) {
    throw new ValidationError('Shopify is not configured');
  }

  try {
    const { totalCount, results } = await syncAllCustomers(req.prisma);
    res.json({ message: 'Bulk customer sync completed', totalInShopify: totalCount, results });
  } catch (error) {
    const axiosError = error as AxiosErrorLike;
    shopifyLogger.error({ error: axiosError.message }, 'Bulk customer sync failed');
    throw new ExternalServiceError(axiosError.response?.data?.errors as string || axiosError.message, 'Shopify');
  }
}));

// ============================================
// UNIFIED BACKFILL
// ============================================

router.post('/backfill', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { fields = ['all'], batchSize = 5000 } = req.body as { fields?: string[]; batchSize?: number };

  shopifyLogger.info({ fields, batchSize }, 'Unified backfill starting');

  const results: Record<string, BackfillResult | BackfillPaymentMethodResult | BackfillOrderFieldsResult> = {};
  const shouldBackfillAll = fields.includes('all');

  if (shouldBackfillAll || fields.includes('paymentMethod')) {
    results.paymentMethod = await backfillPaymentMethod(req.prisma, batchSize);
  }

  if (shouldBackfillAll || fields.includes('cacheFields')) {
    results.cacheFields = await backfillCacheFields(req.prisma, batchSize);
  }

  if (shouldBackfillAll || fields.includes('orderFields')) {
    results.orderFields = await backfillOrderFields(req.prisma, batchSize);
  }

  const totalUpdated = Object.values(results).reduce((sum, r) => sum + (r.updated || 0), 0);

  res.json({
    success: true,
    message: `Backfilled ${totalUpdated} total records`,
    results,
  });
}));

// ============================================
// REPROCESS CACHE
// ============================================

router.post('/reprocess-cache', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const failedEntries = await req.prisma.shopifyOrderCache.findMany({
    where: {
      OR: [{ processedAt: null }, { processingError: { not: null } }]
    },
    orderBy: { lastWebhookAt: 'asc' },
    take: 100
  });

  if (failedEntries.length === 0) {
    res.json({ message: 'No failed cache entries to reprocess', processed: 0, succeeded: 0, failed: 0 });
    return;
  }

  shopifyLogger.info({ count: failedEntries.length }, 'Reprocessing cached orders');

  let succeeded = 0;
  let failed = 0;
  const errors: Array<{ orderId: string; orderNumber: string | null; error: string }> = [];

  for (const entry of failedEntries) {
    try {
      await processFromCache(req.prisma, entry);
      await markCacheProcessed(req.prisma, entry.id);
      succeeded++;
    } catch (error) {
      const err = error as Error;
      await markCacheError(req.prisma, entry.id, err.message);
      failed++;
      errors.push({ orderId: entry.id, orderNumber: entry.orderNumber, error: err.message });
    }
  }

  res.json({
    message: `Reprocessed ${failedEntries.length} cached orders`,
    processed: failedEntries.length,
    succeeded,
    failed,
    errors: errors.slice(0, 10)
  });
}));

// ============================================
// FULL DUMP
// ============================================

router.post('/full-dump', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { daysBack } = req.body as { daysBack?: number };

  await shopifyClient.loadFromDatabase();
  if (!shopifyClient.isConfigured()) {
    throw new ValidationError('Shopify is not configured');
  }

  const fetchOptions: { status: 'any'; created_at_min?: string; limit: number } = { status: 'any', limit: 250 };
  if (daysBack) {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    fetchOptions.created_at_min = d.toISOString();
  }

  shopifyLogger.info({ daysBack }, 'Full Dump: starting');
  let fetched = 0, cached = 0, skipped = 0;
  const startTime = Date.now();

  try {
    const totalCount = await shopifyClient.getOrderCount({ status: 'any', created_at_min: fetchOptions.created_at_min });
    shopifyLogger.info({ totalCount }, 'Full Dump: total orders to fetch');

    let sinceId: string | null = null;
    let consecutiveSmallBatches = 0;
    const { batchSize, batchDelay, maxConsecutiveSmallBatches } = FULL_DUMP_CONFIG;

    while (true) {
      const params: Record<string, string | number> = { status: 'any', limit: batchSize };
      if (sinceId) params.since_id = sinceId;
      if (fetchOptions.created_at_min) params.created_at_min = fetchOptions.created_at_min;

      const orders = await shopifyClient.getOrders(params);
      if (orders.length === 0) break;

      fetched += orders.length;
      sinceId = String(orders[orders.length - 1].id);

      try {
        const batchCached = await cacheShopifyOrders(req.prisma, orders, 'full_dump');
        cached += batchCached;
      } catch (err) {
        const error = err as Error;
        shopifyLogger.error({ error: error.message }, 'Full Dump: batch cache error');
        for (const order of orders) {
          try {
            await cacheShopifyOrders(req.prisma, order, 'full_dump');
            cached++;
          } catch { skipped++; }
        }
      }

      await new Promise(resolve => setTimeout(resolve, batchDelay));

      if (orders.length < batchSize) {
        consecutiveSmallBatches++;
        if (fetched >= totalCount || consecutiveSmallBatches >= maxConsecutiveSmallBatches) break;
      } else {
        consecutiveSmallBatches = 0;
      }

      if (fetched % 1000 === 0) {
        shopifyLogger.info({ fetched, cached, skipped, total: totalCount }, 'Full Dump: progress');
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    res.json({ message: 'Full dump complete', fetched, cached, skipped, durationSeconds: duration });
  } catch (error) {
    const err = error as Error;
    throw new ExternalServiceError(err.message, 'Shopify');
  }
}));

// ============================================
// PROCESS CACHE
// ============================================

router.post('/process-cache', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { limit = 500, retryFailed = false, concurrency = 10 } = req.body as {
    limit?: number;
    retryFailed?: boolean;
    concurrency?: number;
  };

  const whereClause = retryFailed
    ? { processingError: { not: null } }
    : { processedAt: null, processingError: null };

  const entries = await req.prisma.shopifyOrderCache.findMany({
    where: whereClause,
    orderBy: { lastWebhookAt: 'asc' },
    take: limit,
    select: { id: true, rawData: true, orderNumber: true }
  });

  if (entries.length === 0) {
    res.json({
      message: retryFailed ? 'No failed orders to retry' : 'No unprocessed orders in cache',
      processed: 0, succeeded: 0, failed: 0
    });
    return;
  }

  shopifyLogger.info({ count: entries.length, retryFailed, concurrency }, 'Process Cache: starting');
  const startTime = Date.now();

  const result = await processCacheBatch(req.prisma, entries, { concurrency });

  const durationMs = Date.now() - startTime;
  const ordersPerSecond = result.processed > 0 ? (result.processed / (durationMs / 1000)).toFixed(1) : '0';

  res.json({
    message: retryFailed ? 'Retry complete' : 'Processing complete',
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
    durationMs,
    ordersPerSecond: parseFloat(ordersPerSecond),
    errors: result.errors.length > 0 ? result.errors.slice(0, 20) : undefined
  });
}));

// ============================================
// ORDER LOOKUP & HISTORY
// ============================================

router.get('/orders/:orderNumber', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { orderNumber } = req.params as { orderNumber: string };
  const normalizedNumber = orderNumber.replace(/^#/, '');

  const cached = await req.prisma.shopifyOrderCache.findFirst({
    where: {
      OR: [
        { orderNumber: orderNumber },
        { orderNumber: `#${normalizedNumber}` },
        { orderNumber: normalizedNumber }
      ]
    }
  });

  if (!cached) {
    throw new NotFoundError('Order not found in cache', 'ShopifyOrder', orderNumber);
  }

  const rawData = typeof cached.rawData === 'string' ? JSON.parse(cached.rawData) as ShopifyOrder : cached.rawData as ShopifyOrder;

  res.json({
    cacheId: cached.id,
    orderNumber: cached.orderNumber,
    financialStatus: cached.financialStatus,
    fulfillmentStatus: cached.fulfillmentStatus,
    processedAt: cached.processedAt,
    processingError: cached.processingError,
    rawData
  });
}));

router.get('/history', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const lastSyncedOrder = await req.prisma.order.findFirst({
    where: { shopifyOrderId: { not: null } },
    orderBy: { syncedAt: 'desc' },
    select: { shopifyOrderId: true, orderNumber: true, syncedAt: true },
  });

  const syncedOrders = await req.prisma.order.count({ where: { shopifyOrderId: { not: null } } });
  const syncedCustomers = await req.prisma.customer.count({ where: { shopifyCustomerId: { not: null } } });

  res.json({
    lastSync: lastSyncedOrder?.syncedAt || null,
    lastOrderNumber: lastSyncedOrder?.orderNumber || null,
    counts: { syncedOrders, syncedCustomers },
  });
}));

export default router;
