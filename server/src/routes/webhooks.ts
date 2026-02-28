import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { cacheAndProcessOrder, type ProcessResult } from '../services/shopifyOrderProcessor/index.js';
import { cacheAndProcessProduct, handleProductDeletion } from '../services/productSync/index.js';
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
    isRetry?: boolean,
    payload?: unknown
) => Promise<unknown>;

const updateWebhookLog = _updateWebhookLog as (
    prisma: PrismaClient,
    webhookId: string | undefined,
    status: string,
    error?: string | null,
    processingTime?: number | null,
    resultData?: unknown
) => Promise<void>;
import { upsertCustomerFromWebhook} from '../utils/customerUtils.js';
import { webhookLogger as log } from '../utils/logger.js';
import { deferredExecutor } from '../services/deferredExecutor.js';
import { pushNewOrderToSheet, syncSingleOrderToSheet } from '../services/sheetOrderPush.js';

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

// Load webhook secret from database (always fresh — supports rotation without restart)
async function loadWebhookSecret(prisma: PrismaClient): Promise<string | null> {
    try {
        const setting = await prisma.systemSetting.findUnique({ where: { key: 'shopify_webhook_secret' } });
        return setting?.value || null;
    } catch (e) {
        log.error({ err: e }, 'Failed to load webhook secret');
        return null;
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
    const secret = await loadWebhookSecret(req.prisma);

    // Skip verification if no secret configured (development mode)
    if (!secret) {
        log.warn('Webhook secret not configured - accepting unverified webhook');
        next();
        return;
    }

    if (!verifyShopifyWebhook(req, secret)) {
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
router.post('/shopify/orders', verifyWebhook, asyncHandler(async (req: WebhookRequest, res: Response): Promise<void> => {
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

        // Log webhook receipt with payload (updates existing log if retry, creates new if not)
        await logWebhookReceived(req.prisma, webhookId, webhookTopic, String(shopifyOrder.id), dedupeResult.isRetry, shopifyOrder);

        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder, webhookTopic);

        // Push new orders to "Orders from COH" sheet (fire-and-forget)
        // Note: Shopify sometimes sends new orders as orders/updated, so check result.action
        if (result.action === 'created') {
            deferredExecutor.enqueue(async () => {
                await pushNewOrderToSheet(shopifyOrder as unknown as Parameters<typeof pushNewOrderToSheet>[0], result.orderId);
            }, { orderId: result.orderId, action: 'push_order_to_sheet' });
        }

        // Immediately sync AWB/courier/status to sheet when fulfillment data arrives
        if (result.fulfillmentSync?.synced && orderName) {
            deferredExecutor.enqueue(async () => {
                await syncSingleOrderToSheet(String(orderName));
            }, { orderId: result.orderId, action: 'sync_order_status_to_sheet' });
        }

        // Log success with result data
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime, result);

        // Log domain event for webhook-created orders
        if (result.action === 'created' && result.orderId) {
            import('@coh/shared/services/eventLog').then(({ logEvent }) =>
                logEvent({ domain: 'orders', event: 'order.received_webhook', entityType: 'Order', entityId: result.orderId!, summary: `Shopify order ${orderName} received via webhook`, meta: { topic: webhookTopic, shopifyOrderId: String(shopifyOrder.id), action: result.action } })
            ).catch(() => {});
        }

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
}));

// ============================================
// PRODUCT WEBHOOKS
// ============================================

/**
 * UNIFIED PRODUCT WEBHOOK
 * Single endpoint that handles all product events: create, update, delete
 * The X-Shopify-Topic header determines the event type automatically.
 *
 * Shopify Configuration:
 * - Configure this endpoint for ALL product webhook topics in Shopify Admin
 * - Endpoint: POST /api/webhooks/shopify/products
 * - Supported topics: products/create, products/update, products/delete
 */
router.post('/shopify/products', verifyWebhook, asyncHandler(async (req: WebhookRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id') || undefined;
    const webhookTopic = req.get('X-Shopify-Topic') || 'products/update';

    try {
        // Idempotency check
        const dedupeResult: DedupeResult = await checkWebhookDuplicate(req.prisma, webhookId);
        if (dedupeResult.duplicate) {
            log.debug({ webhookId, status: dedupeResult.status }, 'Product webhook already processed, skipping');
            res.status(200).json({ received: true, skipped: true, reason: 'duplicate', status: dedupeResult.status });
            return;
        }

        const body = req.body as { id?: unknown };
        const shopifyProductId = String(body.id);

        // Handle deletion separately (minimal payload)
        if (webhookTopic === 'products/delete') {
            log.info({ shopifyProductId, topic: webhookTopic }, 'Processing product delete webhook');
            await logWebhookReceived(req.prisma, webhookId, webhookTopic, shopifyProductId, dedupeResult.isRetry, req.body);
            const result = await handleProductDeletion(req.prisma, shopifyProductId);
            await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime, result);
            res.status(200).json({ received: true, ...result });
            return;
        }

        // Validate payload for create/update
        const validation: ValidationResult<ShopifyProductPayload> = validateWebhookPayload(shopifyProductSchema, req.body);
        if (!validation.success) {
            log.error({ error: validation.error }, 'Product webhook validation failed');
            res.status(200).json({ received: true, error: `Validation failed: ${validation.error}` });
            return;
        }

        const shopifyProduct = validation.data!;
        log.info({ productTitle: shopifyProduct.title, topic: webhookTopic, isRetry: dedupeResult.isRetry }, 'Processing product webhook');

        await logWebhookReceived(req.prisma, webhookId, webhookTopic, String(shopifyProduct.id), dedupeResult.isRetry, shopifyProduct);
        const result = await cacheAndProcessProduct(req.prisma, shopifyProduct as unknown as Parameters<typeof cacheAndProcessProduct>[1], webhookTopic);
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime, result);

        res.status(200).json({ received: true, ...result });
    } catch (error) {
        const err = error as Error;
        log.error({ err, webhookId, topic: webhookTopic }, 'Product webhook error');

        await updateWebhookLog(req.prisma, webhookId, 'failed', err.message, Date.now() - startTime);
        const body = req.body as { id?: unknown };
        await addToFailedQueue(req.prisma, 'product', body?.id, req.body, err.message);
        res.status(200).json({ received: true, error: err.message });
    }
}));

// ============================================
// CUSTOMER WEBHOOKS
// ============================================

/**
 * UNIFIED CUSTOMER WEBHOOK
 * Single endpoint that handles all customer events: create, update
 * The X-Shopify-Topic header determines the event type automatically.
 *
 * Shopify Configuration:
 * - Configure this endpoint for ALL customer webhook topics in Shopify Admin
 * - Endpoint: POST /api/webhooks/shopify/customers
 * - Supported topics: customers/create, customers/update
 */
router.post('/shopify/customers', verifyWebhook, asyncHandler(async (req: WebhookRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id') || undefined;
    const webhookTopic = req.get('X-Shopify-Topic') || 'customers/update';

    try {
        const dedupeResult: DedupeResult = await checkWebhookDuplicate(req.prisma, webhookId);
        if (dedupeResult.duplicate) {
            log.debug({ webhookId, status: dedupeResult.status }, 'Customer webhook already processed, skipping');
            res.status(200).json({ received: true, skipped: true, reason: 'duplicate', status: dedupeResult.status });
            return;
        }

        const validation: ValidationResult<ShopifyCustomerPayload> = validateWebhookPayload(shopifyCustomerSchema, req.body);
        if (!validation.success) {
            log.error({ error: validation.error }, 'Customer webhook validation failed');
            res.status(200).json({ received: true, error: `Validation failed: ${validation.error}` });
            return;
        }

        const shopifyCustomer = validation.data!;
        log.info({ customerEmail: shopifyCustomer.email, topic: webhookTopic, isRetry: dedupeResult.isRetry }, 'Processing customer webhook');

        await logWebhookReceived(req.prisma, webhookId, webhookTopic, String(shopifyCustomer.id), dedupeResult.isRetry, shopifyCustomer);
        const result = await processShopifyCustomer(req.prisma, shopifyCustomer, webhookTopic);
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime, result);

        res.status(200).json({ received: true, ...result });
    } catch (error) {
        const err = error as Error;
        log.error({ err, webhookId, topic: webhookTopic }, 'Customer webhook error');

        await updateWebhookLog(req.prisma, webhookId, 'failed', err.message, Date.now() - startTime);
        const body = req.body as { id?: unknown };
        await addToFailedQueue(req.prisma, 'customer', body?.id, req.body, err.message);
        res.status(200).json({ received: true, error: err.message });
    }
}));

// Inventory Levels - Updated
router.post('/shopify/inventory_levels/update', verifyWebhook, asyncHandler(async (req: WebhookRequest, res: Response): Promise<void> => {
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

        log.info({ inventoryItemId, available }, 'inventory_levels/update webhook received');
        await logWebhookReceived(req.prisma, webhookId, 'inventory_levels/update', inventoryItemId, dedupeResult.isRetry, inventoryUpdate);

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

            const result = { action: 'updated', skuId: sku.id, skuCode: sku.skuCode, available };
            await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime, result);
            log.debug({ skuCode: sku.skuCode, available }, 'Updated Shopify inventory cache');
            res.status(200).json({ received: true, updated: true, skuCode: sku.skuCode });
        } else {
            const result = { action: 'skipped', reason: 'SKU not found', inventoryItemId };
            await updateWebhookLog(req.prisma, webhookId, 'processed', 'SKU not found', Date.now() - startTime, result);
            log.debug({ inventoryItemId }, 'No SKU found for inventory item');
            res.status(200).json({ received: true, updated: false, reason: 'SKU not found' });
        }
    } catch (error) {
        const err = error as Error;
        log.error({ err, webhookId }, 'inventory_levels/update webhook error');

        await updateWebhookLog(req.prisma, webhookId, 'failed', err.message, Date.now() - startTime);
        res.status(200).json({ received: true, error: err.message });
    }
}));

// ============================================
// WEBHOOK MANAGEMENT
// ============================================

// Get webhook status
router.get('/status', requireAdmin, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const secret = await loadWebhookSecret(req.prisma);

        // Get recent webhook logs
        const logs = await req.prisma.webhookLog.findMany({
            orderBy: { receivedAt: 'desc' },
            take: 20
        }).catch(() => []);

        res.json({
            configured: !!secret,
            endpoints: {
                // Unified endpoints - use X-Shopify-Topic header to determine action
                orders: '/api/webhooks/shopify/orders',
                products: '/api/webhooks/shopify/products',
                customers: '/api/webhooks/shopify/customers',
                inventory_levels: '/api/webhooks/shopify/inventory_levels/update',
            },
            supportedTopics: {
                orders: ['orders/create', 'orders/updated', 'orders/cancelled', 'orders/fulfilled'],
                products: ['products/create', 'products/update', 'products/delete'],
                customers: ['customers/create', 'customers/update'],
                inventory: ['inventory_levels/update'],
            },
            note: 'All endpoints are unified - configure one URL per resource type. The X-Shopify-Topic header determines the action automatically.',
            recentLogs: logs
        });
    } catch (error) {
        console.error('[webhooks] Failed to get webhook status:', error);
        res.status(500).json({ error: 'Failed to get webhook status' });
    }
}));

// Update webhook secret
router.put('/secret', requireAdmin, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const { secret } = req.body as { secret?: string };

        await req.prisma.systemSetting.upsert({
            where: { key: 'shopify_webhook_secret' },
            update: { value: secret ?? '' },
            create: { key: 'shopify_webhook_secret', value: secret ?? '' }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('[webhooks] Failed to update webhook secret:', error);
        res.status(500).json({ error: 'Failed to update webhook secret' });
    }
}));

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
    log.debug({ orderName }, 'Processing order webhook');

    // Use shared processor with cache-first approach
    // This caches raw data first, then processes to ERP
    // Cast to unknown first to satisfy TypeScript when the types don't fully overlap
    const result = await cacheAndProcessOrder(prisma, shopifyOrder as unknown as Parameters<typeof cacheAndProcessOrder>[1], webhookTopic, {
        skipNoSku: false // Webhooks should create orders even without SKU matches
    });

    log.debug({ orderName, action: result.action }, 'Order webhook processed');
    return result;
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
