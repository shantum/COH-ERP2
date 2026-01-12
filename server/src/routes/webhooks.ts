import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { cacheAndProcessOrder, type ProcessResult } from '../services/shopifyOrderProcessor.js';
import { cacheAndProcessProduct, handleProductDeletion } from '../services/productSyncService.js';
import {
    shopifyOrderSchema,
    shopifyProductSchema,
    shopifyCustomerSchema,
    shopifyInventoryLevelSchema,
    validateWebhookPayload,
    checkWebhookDuplicate,
    logWebhookReceived as _logWebhookReceived,
    updateWebhookLog as _updateWebhookLog,
    addToFailedQueue,
} from '../utils/webhookUtils.js';

// Type-safe wrappers for webhook utility functions
// These functions are defined in JS and accept loose types
const logWebhookReceived = _logWebhookReceived as (
    prisma: PrismaClient,
    webhookId: string | undefined,
    topic: string,
    resourceId: string | number,
    isRetry?: boolean
) => Promise<unknown>;

const updateWebhookLog = _updateWebhookLog as (
    prisma: PrismaClient,
    webhookId: string | undefined,
    status: string,
    error?: string | null,
    processingTime?: number | null
) => Promise<void>;
import { upsertCustomerFromWebhook } from '../utils/customerUtils.js';
import { webhookLogger as log } from '../utils/logger.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Request with raw body for HMAC signature verification
 * The rawBody is set by express middleware and used for webhook verification
 * Note: Overrides the string type from express.d.ts to also allow Buffer
 */
interface RequestWithRawBody extends Omit<Request, 'rawBody'> {
    rawBody?: string | Buffer;
    prisma: PrismaClient;
}

/**
 * Webhook verification middleware request type
 */
type WebhookRequest = RequestWithRawBody;

/**
 * Result of webhook deduplication check
 */
interface DedupeResult {
    duplicate: boolean;
    status?: string;
    isRetry?: boolean;
    existing?: unknown;
}

/**
 * Result of webhook validation
 */
interface ValidationResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * Shopify order from webhook payload
 */
interface ShopifyOrderPayload {
    id: number | string;
    name?: string | null;
    order_number?: number | string | null;
    email?: string | null;
    [key: string]: unknown;
}

/**
 * Shopify product from webhook payload
 */
interface ShopifyProductPayload {
    id: number | string;
    title: string;
    [key: string]: unknown;
}

/**
 * Shopify customer from webhook payload
 */
interface ShopifyCustomerPayload {
    id: number | string;
    email?: string | null;
    [key: string]: unknown;
}

/**
 * Shopify inventory level from webhook payload
 */
interface ShopifyInventoryLevelPayload {
    inventory_item_id: number | string;
    location_id?: number | string | null;
    available?: number | null;
    [key: string]: unknown;
}

/**
 * Result of customer webhook processing
 */
interface CustomerProcessResult {
    action: string;
    customerId?: string;
}

const router = Router();

// Store for webhook secret (loaded from database)
let webhookSecret: string | null = null;

// Load webhook secret from database
async function loadWebhookSecret(prisma: PrismaClient): Promise<void> {
    try {
        const setting = await prisma.systemSetting.findUnique({ where: { key: 'shopify_webhook_secret' } });
        webhookSecret = setting?.value || null;
    } catch (e) {
        log.error({ err: e }, 'Failed to load webhook secret');
    }
}

// Verify Shopify webhook signature
function verifyShopifyWebhook(req: WebhookRequest, secret: string): boolean {
    if (!secret) return false;

    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    if (!hmacHeader) return false;

    // Validate that rawBody exists
    if (!req.rawBody) {
        log.error('Webhook rawBody not captured - signature verification will fail');
        return false;
    }

    const body = req.rawBody;
    // Handle both string and Buffer rawBody
    const bodyStr = Buffer.isBuffer(body) ? body.toString('utf8') : body;
    const hash = crypto
        .createHmac('sha256', secret)
        .update(bodyStr, 'utf8')
        .digest('base64');

    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
}

// Middleware to verify webhook (optional - can be disabled for testing)
const verifyWebhook = async (req: WebhookRequest, res: Response, next: NextFunction): Promise<void> => {
    // Load secret if not loaded
    if (webhookSecret === null) {
        await loadWebhookSecret(req.prisma);
    }

    // Skip verification if no secret configured (development mode)
    if (!webhookSecret) {
        log.warn('Webhook secret not configured - accepting unverified webhook');
        next();
        return;
    }

    if (!verifyShopifyWebhook(req, webhookSecret)) {
        log.error('Webhook verification failed');
        res.status(401).json({ error: 'Webhook verification failed' });
        return;
    }

    next();
};

// ============================================
// SHOPIFY WEBHOOKS
// ============================================

/**
 * UNIFIED ORDER WEBHOOK
 * Single endpoint that handles all order events: create, update, cancel, fulfill
 * The X-Shopify-Topic header determines the event type automatically.
 *
 * Shopify Configuration:
 * - Configure this endpoint for ALL order webhook topics in Shopify Admin
 * - Endpoint: POST /api/webhooks/shopify/orders
 * - Supported topics: orders/create, orders/updated, orders/cancelled, orders/fulfilled
 *
 * Legacy endpoints (orders/create, orders/updated, orders/cancelled, orders/fulfilled)
 * have been consolidated into this single unified endpoint for simpler maintenance.
 */
router.post('/shopify/orders', verifyWebhook, async (req: WebhookRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id') || undefined;
    const webhookTopic = req.get('X-Shopify-Topic') || 'orders/updated';

    try {
        // CRITICAL: Idempotency check - prevents duplicate processing on Shopify retries
        const dedupeResult: DedupeResult = await checkWebhookDuplicate(req.prisma, webhookId);
        if (dedupeResult.duplicate) {
            log.debug({ webhookId, status: dedupeResult.status }, 'Webhook already processed or in-flight, skipping');
            res.status(200).json({ received: true, skipped: true, reason: 'duplicate', status: dedupeResult.status });
            return;
        }

        // Validate payload
        const validation: ValidationResult<ShopifyOrderPayload> = validateWebhookPayload(shopifyOrderSchema, req.body);
        if (!validation.success) {
            log.error({ error: validation.error }, 'Webhook validation failed');
            res.status(200).json({ received: true, error: `Validation failed: ${validation.error}` });
            return;
        }

        const shopifyOrder = validation.data!;
        const orderName = shopifyOrder.name || shopifyOrder.order_number || shopifyOrder.id;
        log.info({ orderName, topic: webhookTopic, isRetry: dedupeResult.isRetry }, 'Processing order webhook');

        // Log webhook receipt (updates existing log if retry, creates new if not)
        await logWebhookReceived(req.prisma, webhookId, webhookTopic, String(shopifyOrder.id), dedupeResult.isRetry);

        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder, webhookTopic);

        // Log success
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);

        res.status(200).json({ received: true, ...result });
    } catch (error) {
        const err = error as Error;
        log.error({ err: error, webhookId }, 'Webhook orders error');
        await updateWebhookLog(req.prisma, webhookId, 'failed', err.message, Date.now() - startTime);
        // Add to dead letter queue for retry
        const body = req.body as { id?: unknown };
        await addToFailedQueue(req.prisma, 'order', body?.id, req.body, err.message);
        res.status(200).json({ received: true, error: err.message }); // Always return 200 to prevent Shopify retries
    }
});

// ============================================
// PRODUCT WEBHOOKS
// ============================================

// Products - Create
router.post('/shopify/products/create', verifyWebhook, async (req: WebhookRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id') || undefined;
    try {
        const dedupeResult: DedupeResult = await checkWebhookDuplicate(req.prisma, webhookId);
        if (dedupeResult.duplicate) {
            res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });
            return;
        }

        const validation: ValidationResult<ShopifyProductPayload> = validateWebhookPayload(shopifyProductSchema, req.body);
        if (!validation.success) {
            res.status(200).json({ received: true, error: `Validation: ${validation.error}` });
            return;
        }

        const shopifyProduct = validation.data!;
        console.log(`Webhook: products/create - ${shopifyProduct.title}`);
        await logWebhookReceived(req.prisma, webhookId, 'products/create', String(shopifyProduct.id), dedupeResult.isRetry);
        // Cast to unknown first to satisfy TypeScript when the types don't fully overlap
        const result = await cacheAndProcessProduct(req.prisma, shopifyProduct as unknown as Parameters<typeof cacheAndProcessProduct>[1], 'products/create');
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        const err = error as Error;
        console.error('Webhook products/create error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', err.message, Date.now() - startTime);
        const body = req.body as { id?: unknown };
        await addToFailedQueue(req.prisma, 'product', body?.id, req.body, err.message);
        res.status(200).json({ received: true, error: err.message });
    }
});

// Products - Update
router.post('/shopify/products/update', verifyWebhook, async (req: WebhookRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id') || undefined;
    try {
        const dedupeResult: DedupeResult = await checkWebhookDuplicate(req.prisma, webhookId);
        if (dedupeResult.duplicate) {
            res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });
            return;
        }

        const validation: ValidationResult<ShopifyProductPayload> = validateWebhookPayload(shopifyProductSchema, req.body);
        if (!validation.success) {
            res.status(200).json({ received: true, error: `Validation: ${validation.error}` });
            return;
        }

        const shopifyProduct = validation.data!;
        console.log(`Webhook: products/update - ${shopifyProduct.title}`);
        await logWebhookReceived(req.prisma, webhookId, 'products/update', String(shopifyProduct.id), dedupeResult.isRetry);
        // Cast to unknown first to satisfy TypeScript when the types don't fully overlap
        const result = await cacheAndProcessProduct(req.prisma, shopifyProduct as unknown as Parameters<typeof cacheAndProcessProduct>[1], 'products/update');
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        const err = error as Error;
        console.error('Webhook products/update error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', err.message, Date.now() - startTime);
        const body = req.body as { id?: unknown };
        await addToFailedQueue(req.prisma, 'product', body?.id, req.body, err.message);
        res.status(200).json({ received: true, error: err.message });
    }
});

// Products - Delete
router.post('/shopify/products/delete', verifyWebhook, async (req: WebhookRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id') || undefined;
    try {
        const dedupeResult: DedupeResult = await checkWebhookDuplicate(req.prisma, webhookId);
        if (dedupeResult.duplicate) {
            res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });
            return;
        }

        const body = req.body as { id?: unknown };
        const shopifyProductId = String(body.id);
        console.log(`Webhook: products/delete - ID ${shopifyProductId}`);
        await logWebhookReceived(req.prisma, webhookId, 'products/delete', shopifyProductId, dedupeResult.isRetry);
        const result = await handleProductDeletion(req.prisma, shopifyProductId);
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        const err = error as Error;
        console.error('Webhook products/delete error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', err.message, Date.now() - startTime);
        res.status(200).json({ received: true, error: err.message });
    }
});

// ============================================
// CUSTOMER WEBHOOKS
// ============================================

// Customers - Create
router.post('/shopify/customers/create', verifyWebhook, async (req: WebhookRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id') || undefined;
    try {
        const dedupeResult: DedupeResult = await checkWebhookDuplicate(req.prisma, webhookId);
        if (dedupeResult.duplicate) {
            res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });
            return;
        }

        const validation: ValidationResult<ShopifyCustomerPayload> = validateWebhookPayload(shopifyCustomerSchema, req.body);
        if (!validation.success) {
            res.status(200).json({ received: true, error: `Validation: ${validation.error}` });
            return;
        }

        const shopifyCustomer = validation.data!;
        console.log(`Webhook: customers/create - ${shopifyCustomer.email}`);
        await logWebhookReceived(req.prisma, webhookId, 'customers/create', String(shopifyCustomer.id), dedupeResult.isRetry);
        const result = await processShopifyCustomer(req.prisma, shopifyCustomer, 'create');
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        const err = error as Error;
        console.error('Webhook customers/create error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', err.message, Date.now() - startTime);
        const body = req.body as { id?: unknown };
        await addToFailedQueue(req.prisma, 'customer', body?.id, req.body, err.message);
        res.status(200).json({ received: true, error: err.message });
    }
});

// Customers - Updated
router.post('/shopify/customers/update', verifyWebhook, async (req: WebhookRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id') || undefined;
    try {
        const dedupeResult: DedupeResult = await checkWebhookDuplicate(req.prisma, webhookId);
        if (dedupeResult.duplicate) {
            res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });
            return;
        }

        const validation: ValidationResult<ShopifyCustomerPayload> = validateWebhookPayload(shopifyCustomerSchema, req.body);
        if (!validation.success) {
            res.status(200).json({ received: true, error: `Validation: ${validation.error}` });
            return;
        }

        const shopifyCustomer = validation.data!;
        console.log(`Webhook: customers/update - ${shopifyCustomer.email}`);
        await logWebhookReceived(req.prisma, webhookId, 'customers/update', String(shopifyCustomer.id), dedupeResult.isRetry);
        const result = await processShopifyCustomer(req.prisma, shopifyCustomer, 'update');
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        const err = error as Error;
        console.error('Webhook customers/update error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', err.message, Date.now() - startTime);
        const body = req.body as { id?: unknown };
        await addToFailedQueue(req.prisma, 'customer', body?.id, req.body, err.message);
        res.status(200).json({ received: true, error: err.message });
    }
});

// Inventory Levels - Updated
router.post('/shopify/inventory_levels/update', verifyWebhook, async (req: WebhookRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id') || undefined;
    try {
        const dedupeResult: DedupeResult = await checkWebhookDuplicate(req.prisma, webhookId);
        if (dedupeResult.duplicate) {
            res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });
            return;
        }

        const validation: ValidationResult<ShopifyInventoryLevelPayload> = validateWebhookPayload(shopifyInventoryLevelSchema, req.body);
        if (!validation.success) {
            res.status(200).json({ received: true, error: `Validation: ${validation.error}` });
            return;
        }

        const inventoryUpdate = validation.data!;
        const inventoryItemId = String(inventoryUpdate.inventory_item_id);
        const available = inventoryUpdate.available;

        console.log(`Webhook: inventory_levels/update - Item ${inventoryItemId}, Available: ${available}`);
        await logWebhookReceived(req.prisma, webhookId, 'inventory_levels/update', inventoryItemId, dedupeResult.isRetry);

        // Find SKU by shopifyInventoryItemId
        const sku = await req.prisma.sku.findFirst({
            where: { shopifyInventoryItemId: inventoryItemId }
        });

        if (sku) {
            // Update the Shopify inventory cache
            await req.prisma.shopifyInventoryCache.upsert({
                where: { skuId: sku.id },
                update: {
                    availableQty: available ?? 0,
                    lastSynced: new Date(),
                },
                create: {
                    skuId: sku.id,
                    shopifyInventoryItemId: inventoryItemId,
                    availableQty: available ?? 0,
                }
            });

            await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
            console.log(`Updated Shopify inventory cache for SKU ${sku.skuCode}: ${available}`);
            res.status(200).json({ received: true, updated: true, skuCode: sku.skuCode });
        } else {
            await updateWebhookLog(req.prisma, webhookId, 'processed', 'SKU not found', Date.now() - startTime);
            console.log(`No SKU found for inventory item ${inventoryItemId}`);
            res.status(200).json({ received: true, updated: false, reason: 'SKU not found' });
        }
    } catch (error) {
        const err = error as Error;
        console.error('Webhook inventory_levels/update error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', err.message, Date.now() - startTime);
        res.status(200).json({ received: true, error: err.message });
    }
});

// ============================================
// WEBHOOK MANAGEMENT
// ============================================

// Get webhook status
router.get('/status', async (req: Request, res: Response): Promise<void> => {
    try {
        await loadWebhookSecret(req.prisma);

        // Get recent webhook logs
        const logs = await req.prisma.webhookLog.findMany({
            orderBy: { receivedAt: 'desc' },
            take: 20
        }).catch(() => []);

        res.json({
            configured: !!webhookSecret,
            endpoints: {
                // Order endpoint - handles all order topics via X-Shopify-Topic header
                orders: '/api/webhooks/shopify/orders',
                // Product endpoints
                products_create: '/api/webhooks/shopify/products/create',
                products_update: '/api/webhooks/shopify/products/update',
                products_delete: '/api/webhooks/shopify/products/delete',
                // Customer endpoints
                customers_create: '/api/webhooks/shopify/customers/create',
                customers_update: '/api/webhooks/shopify/customers/update',
                // Inventory endpoints
                inventory_levels_update: '/api/webhooks/shopify/inventory_levels/update',
            },
            note: 'The unified /shopify/orders endpoint handles all order topics (create, updated, cancelled, fulfilled). Configure it for any order-related webhook topic in Shopify.',
            recentLogs: logs
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get webhook status' });
    }
});

// Update webhook secret
router.put('/secret', async (req: Request, res: Response): Promise<void> => {
    try {
        const { secret } = req.body as { secret?: string };

        await req.prisma.systemSetting.upsert({
            where: { key: 'shopify_webhook_secret' },
            update: { value: secret ?? '' },
            create: { key: 'shopify_webhook_secret', value: secret ?? '' }
        });

        webhookSecret = secret ?? null;

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update webhook secret' });
    }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Unified order webhook handler - handles create, update, cancel, and fulfill
 * Uses shared shopifyOrderProcessor module for cache-first processing
 */
async function processShopifyOrderWebhook(
    prisma: PrismaClient,
    shopifyOrder: ShopifyOrderPayload,
    webhookTopic = 'orders/updated'
): Promise<ProcessResult> {
    const orderName = shopifyOrder.name || shopifyOrder.order_number || shopifyOrder.id;
    console.log(`Processing webhook for Order #${orderName}`);

    // Use shared processor with cache-first approach
    // This caches raw data first, then processes to ERP
    // Cast to unknown first to satisfy TypeScript when the types don't fully overlap
    const result = await cacheAndProcessOrder(prisma, shopifyOrder as unknown as Parameters<typeof cacheAndProcessOrder>[1], webhookTopic, {
        skipNoSku: false // Webhooks should create orders even without SKU matches
    });

    console.log(`Order ${orderName}: ${result.action}`);
    return result;
}

// Legacy wrapper for backward compatibility
async function processShopifyOrder(
    prisma: PrismaClient,
    shopifyOrder: ShopifyOrderPayload,
    _action: string
): Promise<ProcessResult> {
    return processShopifyOrderWebhook(prisma, shopifyOrder);
}

async function processShopifyCustomer(
    prisma: PrismaClient,
    shopifyCustomer: ShopifyCustomerPayload,
    _action: string
): Promise<CustomerProcessResult> {
    // Use shared customer utility
    const { customer, action: resultAction } = await upsertCustomerFromWebhook(prisma, shopifyCustomer) as {
        customer: { id: string } | null;
        action: string;
    };
    return { action: resultAction, customerId: customer?.id };
}

export default router;
