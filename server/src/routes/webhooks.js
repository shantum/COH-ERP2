import { Router } from 'express';
import crypto from 'crypto';
import { cacheAndProcessOrder } from '../services/shopifyOrderProcessor.js';

const router = Router();

// Store for webhook secret (loaded from database)
let webhookSecret = null;

// Load webhook secret from database
async function loadWebhookSecret(prisma) {
    try {
        const setting = await prisma.systemSetting.findUnique({ where: { key: 'shopify_webhook_secret' } });
        webhookSecret = setting?.value || null;
    } catch (e) {
        console.error('Failed to load webhook secret:', e);
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
        console.warn('Webhook secret not configured - accepting unverified webhook');
        return next();
    }

    if (!verifyShopifyWebhook(req, webhookSecret)) {
        console.error('Webhook verification failed');
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
    try {
        const shopifyOrder = req.body;
        const orderName = shopifyOrder.name || shopifyOrder.order_number || shopifyOrder.id;
        const webhookTopic = req.get('X-Shopify-Topic') || 'orders/updated';
        console.log(`Webhook: orders (unified) - Order #${orderName}`);

        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder, webhookTopic);

        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook orders error:', error);
        res.status(200).json({ received: true, error: error.message }); // Always return 200 to prevent retries
    }
});

// ============================================
// LEGACY ENDPOINTS (for backward compatibility)
// All route to the same unified handler
// ============================================

// Orders - Create (legacy)
router.post('/shopify/orders/create', verifyWebhook, async (req, res) => {
    try {
        const shopifyOrder = req.body;
        console.log(`Webhook: orders/create (legacy) - Order #${shopifyOrder.order_number || shopifyOrder.name}`);
        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder, 'orders/create');
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook orders/create error:', error);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Orders - Updated (legacy)
router.post('/shopify/orders/updated', verifyWebhook, async (req, res) => {
    try {
        const shopifyOrder = req.body;
        console.log(`Webhook: orders/updated (legacy) - Order #${shopifyOrder.order_number || shopifyOrder.name}`);
        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder, 'orders/updated');
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook orders/updated error:', error);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Orders - Cancelled (legacy)
router.post('/shopify/orders/cancelled', verifyWebhook, async (req, res) => {
    try {
        const shopifyOrder = req.body;
        console.log(`Webhook: orders/cancelled (legacy) - Order #${shopifyOrder.order_number || shopifyOrder.name}`);
        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder, 'orders/cancelled');
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook orders/cancelled error:', error);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Orders - Fulfilled (legacy)
router.post('/shopify/orders/fulfilled', verifyWebhook, async (req, res) => {
    try {
        const shopifyOrder = req.body;
        console.log(`Webhook: orders/fulfilled (legacy) - Order #${shopifyOrder.order_number || shopifyOrder.name}`);
        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder, 'orders/fulfilled');
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook orders/fulfilled error:', error);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Customers - Create
router.post('/shopify/customers/create', verifyWebhook, async (req, res) => {
    try {
        const shopifyCustomer = req.body;
        console.log(`Webhook: customers/create - ${shopifyCustomer.email}`);

        const result = await processShopifyCustomer(req.prisma, shopifyCustomer, 'create');

        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook customers/create error:', error);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Customers - Updated
router.post('/shopify/customers/update', verifyWebhook, async (req, res) => {
    try {
        const shopifyCustomer = req.body;
        console.log(`Webhook: customers/update - ${shopifyCustomer.email}`);

        const result = await processShopifyCustomer(req.prisma, shopifyCustomer, 'update');

        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook customers/update error:', error);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Inventory Levels - Updated
router.post('/shopify/inventory_levels/update', verifyWebhook, async (req, res) => {
    try {
        const inventoryUpdate = req.body;
        const inventoryItemId = String(inventoryUpdate.inventory_item_id);
        const available = inventoryUpdate.available;

        console.log(`Webhook: inventory_levels/update - Item ${inventoryItemId}, Available: ${available}`);

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

            console.log(`Updated Shopify inventory cache for SKU ${sku.skuCode}: ${available}`);
            res.status(200).json({ received: true, updated: true, skuCode: sku.skuCode });
        } else {
            console.log(`No SKU found for inventory item ${inventoryItemId}`);
            res.status(200).json({ received: true, updated: false, reason: 'SKU not found' });
        }
    } catch (error) {
        console.error('Webhook inventory_levels/update error:', error);
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
                // Legacy endpoints (still supported, all use same handler)
                orders_create: '/api/webhooks/shopify/orders/create',
                orders_updated: '/api/webhooks/shopify/orders/updated',
                orders_cancelled: '/api/webhooks/shopify/orders/cancelled',
                orders_fulfilled: '/api/webhooks/shopify/orders/fulfilled',
                // Customer and inventory endpoints
                customers_create: '/api/webhooks/shopify/customers/create',
                customers_update: '/api/webhooks/shopify/customers/update',
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
    const shopifyCustomerId = String(shopifyCustomer.id);

    // Check if customer exists
    let customer = await prisma.customer.findFirst({
        where: {
            OR: [
                { shopifyCustomerId },
                { email: shopifyCustomer.email }
            ].filter(c => c.shopifyCustomerId || c.email)
        }
    });

    const defaultAddress = shopifyCustomer.default_address;

    const customerData = {
        email: shopifyCustomer.email,
        firstName: shopifyCustomer.first_name,
        lastName: shopifyCustomer.last_name,
        phone: shopifyCustomer.phone,
        shopifyCustomerId,
        defaultAddress: defaultAddress ? JSON.stringify(defaultAddress) : null,
        totalOrders: shopifyCustomer.orders_count || 0,
        totalSpent: parseFloat(shopifyCustomer.total_spent) || 0,
    };

    if (customer) {
        await prisma.customer.update({
            where: { id: customer.id },
            data: customerData
        });
        return { action: 'updated', customerId: customer.id };
    } else {
        const newCustomer = await prisma.customer.create({
            data: customerData
        });
        return { action: 'created', customerId: newCustomer.id };
    }
}

export default router;
