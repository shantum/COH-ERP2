// Shopify configuration and status endpoints
import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ValidationError } from '../../utils/errors.js';
import shopifyClient from '../../services/shopify/index.js';
import { shopifyLogger } from '../../utils/logger.js';
import type { AxiosErrorLike } from './types.js';

const router = Router();

// GET /config - Get current Shopify configuration
router.get('/config', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  await shopifyClient.loadFromDatabase();
  const config = shopifyClient.getConfig();
  const hasAccessToken = !!(shopifyClient as unknown as { accessToken: string | undefined }).accessToken;
  const fromEnvVars = !!(process.env.SHOPIFY_ACCESS_TOKEN && process.env.SHOPIFY_SHOP_DOMAIN);

  res.json({
    shopDomain: config.shopDomain || '',
    apiVersion: config.apiVersion,
    hasAccessToken,
    fromEnvVars,
    ...(fromEnvVars && {
      info: 'Credentials loaded from environment variables. Changes made here will not persist after server restart.',
    }),
  });
}));

// PUT /config - Update Shopify configuration
router.put('/config', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { shopDomain, accessToken } = req.body as { shopDomain?: string; accessToken?: string };

  if (!shopDomain || !accessToken) {
    throw new ValidationError('Shop domain and access token are required');
  }

  const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  await shopifyClient.updateConfig(cleanDomain, accessToken);

  res.json({
    message: 'Shopify configuration updated',
    shopDomain: cleanDomain,
  });
}));

// POST /test-connection - Test Shopify API connection
router.post('/test-connection', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  await shopifyClient.loadFromDatabase();

  const client = shopifyClient as unknown as { shopDomain: string | undefined; accessToken: string | undefined };
  shopifyLogger.info({ shopDomain: client.shopDomain, hasToken: !!client.accessToken }, 'Testing connection');

  if (!shopifyClient.isConfigured()) {
    res.json({ success: false, message: 'Shopify credentials not configured' });
    return;
  }

  try {
    const orderCount = await shopifyClient.getOrderCount();
    const customerCount = await shopifyClient.getCustomerCount();

    res.json({
      success: true,
      message: 'Connection successful',
      stats: { totalOrders: orderCount, totalCustomers: customerCount },
    });
  } catch (error) {
    const axiosError = error as AxiosErrorLike;
    shopifyLogger.error({ error: axiosError.message, response: axiosError.response?.data, status: axiosError.response?.status }, 'Connection test failed');

    let errorMessage = axiosError.message;
    const status = axiosError.response?.status;

    if (status === 401) {
      errorMessage = 'Invalid access token. Please check your Admin API access token.';
    } else if (status === 403) {
      errorMessage = 'Access forbidden. Your access token may be missing required API scopes.';
    } else if (status === 404) {
      errorMessage = 'Shop not found. Please check the shop domain format (e.g., yourstore.myshopify.com)';
    } else if (axiosError.response?.data?.errors) {
      errorMessage = typeof axiosError.response.data.errors === 'string'
        ? axiosError.response.data.errors
        : JSON.stringify(axiosError.response.data.errors);
    }

    res.json({ success: false, message: errorMessage, statusCode: status });
  }
}));

// GET /status - Get Shopify connection status
router.get('/status', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  await shopifyClient.loadFromDatabase();
  const config = shopifyClient.getConfig();

  if (!config.configured) {
    res.json({
      connected: false,
      message: 'Shopify credentials not configured',
      config: { shopDomain: null, apiVersion: config.apiVersion },
    });
    return;
  }

  try {
    const orderCount = await shopifyClient.getOrderCount();
    const customerCount = await shopifyClient.getCustomerCount();

    res.json({
      connected: true,
      shopDomain: config.shopDomain,
      apiVersion: config.apiVersion,
      stats: { totalOrders: orderCount, totalCustomers: customerCount },
    });
  } catch (error) {
    const axiosError = error as AxiosErrorLike;
    shopifyLogger.error({ error: axiosError.message }, 'Status check failed');
    res.json({
      connected: false,
      message: axiosError.response?.data?.errors || axiosError.message,
      config: shopifyClient.getConfig(),
    });
  }
}));

export default router;
