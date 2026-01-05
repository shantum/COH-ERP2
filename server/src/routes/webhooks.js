import { Router } from 'express';
import crypto from 'crypto';
import { cacheAndProcessOrder } from '../services/shopifyOrderProcessor.js';
import { cacheAndProcessProduct, handleProductDeletion } from '../services/productSyncService.js';
import {
    shopifyOrderSchema,
    shopifyProductSchema,
    shopifyCustomerSchema,
    shopifyInventoryLevelSchema,
    validateWebhookPayload,
    checkWebhookDuplicate,
    logWebhookReceived,
    updateWebhookLog,
    addToFailedQueue,
} from '../utils/webhookUtils.js';
import { upsertCustomerFromWebhook } from '../utils/customerUtils.js';
import { webhookLogger as log } from '../utils/logger.js';

const router = Router();

// Store for webhook secret (loaded from database)
let webhookSecret = null;

// Load webhook secret from database
async function loadWebhookSecret(prisma) {
    try {
        const setting = await prisma.systemSetting.findUnique({ where: { key: 'shopify_webhook_secret' } });
        webhookSecret = setting?.value || null;
    } catch (e) {
        log.error({ err: e }, 'Failed to load webhook secret');
    }
}

// Verify Shopify webhook signature
function verifyShopifyWebhook(req, secret) {
    if (!secret) return false;

    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    if (!hmacHeader) return false;

    const body = req.rawBody || JSON.stringify(req.body);
    const hash = crypto
        .createHmac('sha256', secret)
        .update(body, 'utf8')
        .digest('base64');

    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
}

// Middleware to verify webhook (optional - can be disabled for testing)
const verifyWebhook = async (req, res, next) => {
    // Load secret if not loaded
    if (webhookSecret === null) {
        await loadWebhookSecret(req.prisma);
    }

    // Skip verification if no secret configured (development mode)
    if (!webhookSecret) {
        log.warn('Webhook secret not configured - accepting unverified webhook');
        return next();
    }

    if (!verifyShopifyWebhook(req, webhookSecret)) {
        log.error('Webhook verification failed');
        return res.status(401).json({ error: 'Webhook verification failed' });
    }

    next();
};

// ============================================
// SHOPIFY WEBHOOKS
// ============================================

/**
 * UNIFIED ORDER WEBHOOK (Recommended)
 * Single endpoint that handles all order events: create, update, cancel, fulfill
 * Configure this in Shopify: orders/updated topic
 */
router.post('/shopify/orders', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id');
    const webhookTopic = req.get('X-Shopify-Topic') || 'orders/updated';

    try {
        // Deduplication check
        const duplicate = await checkWebhookDuplicate(req.prisma, webhookId);
        if (duplicate) {
            log.debug({ webhookId }, 'Webhook already processed, skipping');
            return res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });
        }

        // Validate payload
        const validation = validateWebhookPayload(shopifyOrderSchema, req.body);
        if (!validation.success) {
            log.error({ error: validation.error }, 'Webhook validation failed');
            return res.status(200).json({ received: true, error: `Validation failed: ${validation.error}` });
        }

        const shopifyOrder = validation.data;
        const orderName = shopifyOrder.name || shopifyOrder.order_number || shopifyOrder.id;
        log.info({ orderName, topic: webhookTopic }, 'Processing order webhook');

        // Log webhook receipt
        await logWebhookReceived(req.prisma, webhookId, webhookTopic, shopifyOrder.id);

        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder, webhookTopic);

        // Log success
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);

        res.status(200).json({ received: true, ...result });
    } catch (error) {
        log.error({ err: error, webhookId }, 'Webhook orders error');
        await updateWebhookLog(req.prisma, webhookId, 'failed', error.message, Date.now() - startTime);
        // Add to dead letter queue for retry
        await addToFailedQueue(req.prisma, 'order', req.body?.id, req.body, error.message);
        res.status(200).json({ received: true, error: error.message }); // Always return 200 to prevent Shopify retries
    }
});

// ============================================
// LEGACY ENDPOINTS (for backward compatibility)
// All route to the same unified handler
// ============================================

// Orders - Create (legacy)
router.post('/shopify/orders/create', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id');
    try {
        const duplicate = await checkWebhookDuplicate(req.prisma, webhookId);
        if (duplicate) return res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });

        const validation = validateWebhookPayload(shopifyOrderSchema, req.body);
        if (!validation.success) return res.status(200).json({ received: true, error: `Validation: ${validation.error}` });

        const shopifyOrder = validation.data;
        console.log(`Webhook: orders/create (legacy) - Order #${shopifyOrder.order_number || shopifyOrder.name}`);
        await logWebhookReceived(req.prisma, webhookId, 'orders/create', shopifyOrder.id);
        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder, 'orders/create');
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook orders/create error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', error.message, Date.now() - startTime);
        await addToFailedQueue(req.prisma, 'order', req.body?.id, req.body, error.message);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Orders - Updated (legacy)
router.post('/shopify/orders/updated', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id');
    try {
        const duplicate = await checkWebhookDuplicate(req.prisma, webhookId);
        if (duplicate) return res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });

        const validation = validateWebhookPayload(shopifyOrderSchema, req.body);
        if (!validation.success) return res.status(200).json({ received: true, error: `Validation: ${validation.error}` });

        const shopifyOrder = validation.data;
        console.log(`Webhook: orders/updated (legacy) - Order #${shopifyOrder.order_number || shopifyOrder.name}`);
        await logWebhookReceived(req.prisma, webhookId, 'orders/updated', shopifyOrder.id);
        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder, 'orders/updated');
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook orders/updated error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', error.message, Date.now() - startTime);
        await addToFailedQueue(req.prisma, 'order', req.body?.id, req.body, error.message);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Orders - Cancelled (legacy)
router.post('/shopify/orders/cancelled', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id');
    try {
        const duplicate = await checkWebhookDuplicate(req.prisma, webhookId);
        if (duplicate) return res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });

        const validation = validateWebhookPayload(shopifyOrderSchema, req.body);
        if (!validation.success) return res.status(200).json({ received: true, error: `Validation: ${validation.error}` });

        const shopifyOrder = validation.data;
        console.log(`Webhook: orders/cancelled (legacy) - Order #${shopifyOrder.order_number || shopifyOrder.name}`);
        await logWebhookReceived(req.prisma, webhookId, 'orders/cancelled', shopifyOrder.id);
        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder, 'orders/cancelled');
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook orders/cancelled error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', error.message, Date.now() - startTime);
        await addToFailedQueue(req.prisma, 'order', req.body?.id, req.body, error.message);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Orders - Fulfilled (legacy)
router.post('/shopify/orders/fulfilled', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id');
    try {
        const duplicate = await checkWebhookDuplicate(req.prisma, webhookId);
        if (duplicate) return res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });

        const validation = validateWebhookPayload(shopifyOrderSchema, req.body);
        if (!validation.success) return res.status(200).json({ received: true, error: `Validation: ${validation.error}` });

        const shopifyOrder = validation.data;
        console.log(`Webhook: orders/fulfilled (legacy) - Order #${shopifyOrder.order_number || shopifyOrder.name}`);
        await logWebhookReceived(req.prisma, webhookId, 'orders/fulfilled', shopifyOrder.id);
        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder, 'orders/fulfilled');
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook orders/fulfilled error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', error.message, Date.now() - startTime);
        await addToFailedQueue(req.prisma, 'order', req.body?.id, req.body, error.message);
        res.status(200).json({ received: true, error: error.message });
    }
});

// ============================================
// PRODUCT WEBHOOKS
// ============================================

// Products - Create
router.post('/shopify/products/create', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id');
    try {
        const duplicate = await checkWebhookDuplicate(req.prisma, webhookId);
        if (duplicate) return res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });

        const validation = validateWebhookPayload(shopifyProductSchema, req.body);
        if (!validation.success) return res.status(200).json({ received: true, error: `Validation: ${validation.error}` });

        const shopifyProduct = validation.data;
        console.log(`Webhook: products/create - ${shopifyProduct.title}`);
        await logWebhookReceived(req.prisma, webhookId, 'products/create', shopifyProduct.id);
        const result = await cacheAndProcessProduct(req.prisma, shopifyProduct, 'products/create');
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook products/create error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', error.message, Date.now() - startTime);
        await addToFailedQueue(req.prisma, 'product', req.body?.id, req.body, error.message);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Products - Update
router.post('/shopify/products/update', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id');
    try {
        const duplicate = await checkWebhookDuplicate(req.prisma, webhookId);
        if (duplicate) return res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });

        const validation = validateWebhookPayload(shopifyProductSchema, req.body);
        if (!validation.success) return res.status(200).json({ received: true, error: `Validation: ${validation.error}` });

        const shopifyProduct = validation.data;
        console.log(`Webhook: products/update - ${shopifyProduct.title}`);
        await logWebhookReceived(req.prisma, webhookId, 'products/update', shopifyProduct.id);
        const result = await cacheAndProcessProduct(req.prisma, shopifyProduct, 'products/update');
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook products/update error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', error.message, Date.now() - startTime);
        await addToFailedQueue(req.prisma, 'product', req.body?.id, req.body, error.message);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Products - Delete
router.post('/shopify/products/delete', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id');
    try {
        const duplicate = await checkWebhookDuplicate(req.prisma, webhookId);
        if (duplicate) return res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });

        const shopifyProductId = String(req.body.id);
        console.log(`Webhook: products/delete - ID ${shopifyProductId}`);
        await logWebhookReceived(req.prisma, webhookId, 'products/delete', shopifyProductId);
        const result = await handleProductDeletion(req.prisma, shopifyProductId);
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook products/delete error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', error.message, Date.now() - startTime);
        res.status(200).json({ received: true, error: error.message });
    }
});

// ============================================
// CUSTOMER WEBHOOKS
// ============================================

// Customers - Create
router.post('/shopify/customers/create', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id');
    try {
        const duplicate = await checkWebhookDuplicate(req.prisma, webhookId);
        if (duplicate) return res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });

        const validation = validateWebhookPayload(shopifyCustomerSchema, req.body);
        if (!validation.success) return res.status(200).json({ received: true, error: `Validation: ${validation.error}` });

        const shopifyCustomer = validation.data;
        console.log(`Webhook: customers/create - ${shopifyCustomer.email}`);
        await logWebhookReceived(req.prisma, webhookId, 'customers/create', shopifyCustomer.id);
        const result = await processShopifyCustomer(req.prisma, shopifyCustomer, 'create');
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook customers/create error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', error.message, Date.now() - startTime);
        await addToFailedQueue(req.prisma, 'customer', req.body?.id, req.body, error.message);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Customers - Updated
router.post('/shopify/customers/update', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id');
    try {
        const duplicate = await checkWebhookDuplicate(req.prisma, webhookId);
        if (duplicate) return res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });

        const validation = validateWebhookPayload(shopifyCustomerSchema, req.body);
        if (!validation.success) return res.status(200).json({ received: true, error: `Validation: ${validation.error}` });

        const shopifyCustomer = validation.data;
        console.log(`Webhook: customers/update - ${shopifyCustomer.email}`);
        await logWebhookReceived(req.prisma, webhookId, 'customers/update', shopifyCustomer.id);
        const result = await processShopifyCustomer(req.prisma, shopifyCustomer, 'update');
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, Date.now() - startTime);
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook customers/update error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', error.message, Date.now() - startTime);
        await addToFailedQueue(req.prisma, 'customer', req.body?.id, req.body, error.message);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Inventory Levels - Updated
router.post('/shopify/inventory_levels/update', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.get('X-Shopify-Webhook-Id');
    try {
        const duplicate = await checkWebhookDuplicate(req.prisma, webhookId);
        if (duplicate) return res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });

        const validation = validateWebhookPayload(shopifyInventoryLevelSchema, req.body);
        if (!validation.success) return res.status(200).json({ received: true, error: `Validation: ${validation.error}` });

        const inventoryUpdate = validation.data;
        const inventoryItemId = String(inventoryUpdate.inventory_item_id);
        const available = inventoryUpdate.available;

        console.log(`Webhook: inventory_levels/update - Item ${inventoryItemId}, Available: ${available}`);
        await logWebhookReceived(req.prisma, webhookId, 'inventory_levels/update', inventoryItemId);

        // Find SKU by shopifyInventoryItemId
        const sku = await req.prisma.sku.findFirst({
            where: { shopifyInventoryItemId: inventoryItemId }
        });

        if (sku) {
            // Update the Shopify inventory cache
            await req.prisma.shopifyInventoryCache.upsert({
                where: { skuId: sku.id },
                update: {
                    availableQty: available,
                    lastSynced: new Date(),
                },
                create: {
                    skuId: sku.id,
                    shopifyInventoryItemId: inventoryItemId,
                    availableQty: available,
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
        console.error('Webhook inventory_levels/update error:', error);
        await updateWebhookLog(req.prisma, webhookId, 'failed', error.message, Date.now() - startTime);
        res.status(200).json({ received: true, error: error.message });
    }
});

// ============================================
// WEBHOOK MANAGEMENT
// ============================================

// Get webhook status
router.get('/status', async (req, res) => {
    try {
        await loadWebhookSecret(req.prisma);

        // Get recent webhook logs
        const logs = await req.prisma.webhookLog?.findMany?.({
            orderBy: { createdAt: 'desc' },
            take: 20
        }).catch(() => []);

        res.json({
            configured: !!webhookSecret,
            endpoints: {
                // Recommended: Single unified endpoint for all order events
                orders_unified: '/api/webhooks/shopify/orders',
                // Legacy order endpoints (still supported, all use same handler)
                orders_create: '/api/webhooks/shopify/orders/create',
                orders_updated: '/api/webhooks/shopify/orders/updated',
                orders_cancelled: '/api/webhooks/shopify/orders/cancelled',
                orders_fulfilled: '/api/webhooks/shopify/orders/fulfilled',
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
            recommendation: 'Use orders_unified endpoint with Shopify orders/updated topic for all order events',
            recentLogs: logs
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get webhook status' });
    }
});

// Update webhook secret
router.put('/secret', async (req, res) => {
    try {
        const { secret } = req.body;

        await req.prisma.systemSetting.upsert({
            where: { key: 'shopify_webhook_secret' },
            update: { value: secret },
            create: { key: 'shopify_webhook_secret', value: secret }
        });

        webhookSecret = secret;

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
async function processShopifyOrderWebhook(prisma, shopifyOrder, webhookTopic = 'orders/updated') {
    const orderName = shopifyOrder.name || shopifyOrder.order_number || shopifyOrder.id;
    console.log(`Processing webhook for Order #${orderName}`);

    // Use shared processor with cache-first approach
    // This caches raw data first, then processes to ERP
    const result = await cacheAndProcessOrder(prisma, shopifyOrder, webhookTopic, {
        skipNoSku: false // Webhooks should create orders even without SKU matches
    });

    console.log(`Order ${orderName}: ${result.action}`);
    return result;
}

// Legacy wrapper for backward compatibility
async function processShopifyOrder(prisma, shopifyOrder, action) {
    return processShopifyOrderWebhook(prisma, shopifyOrder);
}

async function processShopifyCustomer(prisma, shopifyCustomer, action) {
    // Use shared customer utility
    const { customer, action: resultAction } = await upsertCustomerFromWebhook(prisma, shopifyCustomer);
    return { action: resultAction, customerId: customer?.id };
}

export default router;
