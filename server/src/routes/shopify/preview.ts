// Shopify preview endpoints - fetch data without importing
import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ValidationError, ExternalServiceError } from '../../utils/errors.js';
import shopifyClient from '../../services/shopify/index.js';
import type { ShopifyProduct } from '../../services/shopify/index.js';
import { shopifyLogger } from '../../utils/logger.js';
import type { AxiosErrorLike } from './types.js';

const router = Router();

// Generic preview handler to reduce duplication
async function previewResource<T>(
  resourceType: 'orders' | 'customers',
  limit: number,
  fetchFn: () => Promise<T[]>,
  countFn: () => Promise<number>
): Promise<{ totalAvailable: number; previewCount: number; items: T[] }> {
  const items = await fetchFn();

  let totalCount = 0;
  try {
    totalCount = await countFn();
  } catch (error: unknown) {
    shopifyLogger.debug({ error: error instanceof Error ? error.message : 'Unknown error' }, `${resourceType} count fetch failed`);
    totalCount = items.length;
  }

  return { totalAvailable: totalCount, previewCount: items.length, items };
}

// POST /preview/orders - Preview orders without importing
router.post('/preview/orders', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  await shopifyClient.loadFromDatabase();
  if (!shopifyClient.isConfigured()) {
    throw new ValidationError('Shopify is not configured');
  }

  const { limit = 10 } = req.body as { limit?: number };

  try {
    const result = await previewResource(
      'orders',
      limit,
      () => shopifyClient.getOrders({ limit: Math.min(limit, 50) }),
      () => shopifyClient.getOrderCount()
    );

    res.json({
      totalAvailable: result.totalAvailable,
      previewCount: result.previewCount,
      orders: result.items,
    });
  } catch (error) {
    const axiosError = error as AxiosErrorLike;
    shopifyLogger.error({ error: axiosError.message }, 'Order preview failed');
    throw new ExternalServiceError(axiosError.response?.data?.errors as string || axiosError.message, 'Shopify');
  }
}));

// POST /preview/customers - Preview customers without importing
router.post('/preview/customers', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  await shopifyClient.loadFromDatabase();
  if (!shopifyClient.isConfigured()) {
    throw new ValidationError('Shopify is not configured');
  }

  const { limit = 10 } = req.body as { limit?: number };

  try {
    const result = await previewResource(
      'customers',
      limit,
      () => shopifyClient.getCustomers({ limit: Math.min(limit, 50) }),
      () => shopifyClient.getCustomerCount()
    );

    res.json({
      totalAvailable: result.totalAvailable,
      previewCount: result.previewCount,
      customers: result.items,
    });
  } catch (error) {
    const axiosError = error as AxiosErrorLike;
    shopifyLogger.error({ error: axiosError.message }, 'Customer preview failed');
    throw new ExternalServiceError(axiosError.response?.data?.errors as string || axiosError.message, 'Shopify');
  }
}));

// POST /preview/products - Preview products (more complex, supports metafields)
router.post('/preview/products', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  await shopifyClient.loadFromDatabase();
  if (!shopifyClient.isConfigured()) {
    throw new ValidationError('Shopify is not configured');
  }

  const { limit = 10, includeMetafields = false, fetchAll = false, search = '' } = req.body as {
    limit?: number;
    includeMetafields?: boolean;
    fetchAll?: boolean;
    search?: string;
  };

  try {
    let shopifyProducts: ShopifyProduct[];
    if (fetchAll) {
      shopifyLogger.debug('Fetching all products for preview');
      shopifyProducts = await shopifyClient.getAllProducts();
    } else {
      shopifyProducts = await shopifyClient.getProducts({ limit: Math.min(limit, 250) });
    }

    // Filter by search term
    if (search) {
      const searchLower = search.toLowerCase();
      shopifyProducts = shopifyProducts.filter(p =>
        p.title?.toLowerCase().includes(searchLower) ||
        p.handle?.toLowerCase().includes(searchLower) ||
        p.product_type?.toLowerCase().includes(searchLower)
      );
    }

    // Get total count
    let totalCount = 0;
    try {
      totalCount = await shopifyClient.getProductCount();
    } catch (error: unknown) {
      shopifyLogger.debug({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Product count fetch failed');
      totalCount = shopifyProducts.length;
    }

    // Optionally fetch metafields (only for small sets)
    let productsWithMetafields: Array<ShopifyProduct & { metafields?: unknown[] }> = shopifyProducts;
    if (includeMetafields && shopifyProducts.length <= 20) {
      const CONCURRENCY_LIMIT = 5;
      productsWithMetafields = [];

      for (let i = 0; i < shopifyProducts.length; i += CONCURRENCY_LIMIT) {
        const batch = shopifyProducts.slice(i, i + CONCURRENCY_LIMIT);
        const batchResults = await Promise.all(
          batch.map(async (product) => {
            const metafields = await shopifyClient.getProductMetafields(product.id);
            return { ...product, metafields };
          })
        );
        productsWithMetafields.push(...batchResults);
      }
    }

    res.json({
      totalAvailable: totalCount,
      previewCount: productsWithMetafields.length,
      fetchedAll: fetchAll,
      searchTerm: search || null,
      products: productsWithMetafields,
    });
  } catch (error) {
    const axiosError = error as AxiosErrorLike;
    shopifyLogger.error({ error: axiosError.message }, 'Product preview failed');
    throw new ExternalServiceError(axiosError.response?.data?.errors as string || axiosError.message, 'Shopify');
  }
}));

// GET /products/:id/metafields - Fetch metafields for a single product
router.get('/products/:id/metafields', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  await shopifyClient.loadFromDatabase();
  if (!shopifyClient.isConfigured()) {
    throw new ValidationError('Shopify is not configured');
  }

  const productId = String(req.params.id);
  if (!productId) {
    throw new ValidationError('Product ID is required');
  }

  try {
    const metafields = await shopifyClient.getProductMetafields(Number(productId));
    res.json({ productId, metafields });
  } catch (error) {
    const axiosError = error as AxiosErrorLike;
    shopifyLogger.error({ productId, error: axiosError.message }, 'Metafield fetch failed');
    throw new ExternalServiceError(axiosError.response?.data?.errors as string || axiosError.message, 'Shopify');
  }
}));

// GET /products/:id/feed-data - Fetch full feed enrichment data (collections, channels, inventory by location, variant metafields)
router.get('/products/:id/feed-data', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  await shopifyClient.loadFromDatabase();
  if (!shopifyClient.isConfigured()) {
    throw new ValidationError('Shopify is not configured');
  }

  const productId = String(req.params.id);
  if (!productId) {
    throw new ValidationError('Product ID is required');
  }

  try {
    const feedData = await shopifyClient.getProductFeedData(productId);
    res.json({ productId, ...feedData });
  } catch (error) {
    const axiosError = error as AxiosErrorLike;
    shopifyLogger.error({ productId, error: axiosError.message }, 'Feed data fetch failed');
    throw new ExternalServiceError(axiosError.response?.data?.errors as string || axiosError.message, 'Shopify');
  }
}));

export default router;
