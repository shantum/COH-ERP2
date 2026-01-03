import { Router } from 'express';
import crypto from 'crypto';

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
        console.log(`Webhook: orders (unified) - Order #${orderName}`);

        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder);

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
        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder);
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
        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder);
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
        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder);
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
        const result = await processShopifyOrderWebhook(req.prisma, shopifyOrder);
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
 * This single function processes any order webhook from Shopify
 */
async function processShopifyOrderWebhook(prisma, shopifyOrder) {
    const shopifyOrderId = String(shopifyOrder.id);
    const orderName = shopifyOrder.name || shopifyOrder.order_number || shopifyOrderId;

    // Check if order exists
    let existingOrder = await prisma.order.findFirst({
        where: { shopifyOrderId },
        include: { orderLines: true }
    });

    // Extract customer info
    const customer = shopifyOrder.customer;
    const shippingAddress = shopifyOrder.shipping_address;

    // Find or create customer
    let customerId = null;
    if (customer) {
        const shopifyCustomerId = String(customer.id);
        let dbCustomer = await prisma.customer.findFirst({
            where: {
                OR: [
                    { shopifyCustomerId },
                    { email: customer.email }
                ].filter(Boolean)
            }
        });

        if (!dbCustomer && customer.email) {
            dbCustomer = await prisma.customer.create({
                data: {
                    email: customer.email,
                    firstName: customer.first_name,
                    lastName: customer.last_name,
                    phone: customer.phone,
                    shopifyCustomerId,
                    defaultAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
                }
            });
        }
        customerId = dbCustomer?.id;
    }

    // Determine order status based on Shopify fields
    let status = 'open';
    if (shopifyOrder.cancelled_at) {
        status = 'cancelled';
    } else if (shopifyOrder.fulfillment_status === 'fulfilled') {
        // If fulfilled in Shopify and we have it as shipped locally, keep it shipped
        if (existingOrder?.status === 'shipped') {
            status = 'shipped';
        }
    }

    // Determine payment method (COD vs Prepaid)
    const paymentMethod = shopifyOrder.financial_status === 'pending' ? 'COD' :
        (shopifyOrder.payment_gateway_names?.join(', ') || 'Prepaid');

    // Build order data
    const orderData = {
        shopifyOrderId,
        shopifyOrderNumber: shopifyOrder.order_number ? String(shopifyOrder.order_number) : null,
        orderNumber: shopifyOrder.name || `SHOP-${shopifyOrderId.slice(-8)}`,
        channel: 'shopify',
        status,
        customerId,
        customerName: shippingAddress
            ? `${shippingAddress.first_name || ''} ${shippingAddress.last_name || ''}`.trim()
            : customer?.first_name ? `${customer.first_name} ${customer.last_name || ''}`.trim() : 'Unknown',
        customerEmail: customer?.email || shopifyOrder.email,
        customerPhone: shippingAddress?.phone || customer?.phone,
        shippingAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
        totalAmount: parseFloat(shopifyOrder.total_price) || 0,
        shopifyFulfillmentStatus: shopifyOrder.fulfillment_status || 'unfulfilled',
        orderDate: shopifyOrder.created_at ? new Date(shopifyOrder.created_at) : new Date(),
        customerNotes: shopifyOrder.note || null,
        paymentMethod,
    };

    // Add cancellation note if cancelled
    if (shopifyOrder.cancelled_at && !existingOrder?.internalNotes?.includes('Cancelled via Shopify')) {
        orderData.internalNotes = existingOrder?.internalNotes
            ? `${existingOrder.internalNotes}\nCancelled via Shopify at ${shopifyOrder.cancelled_at}`
            : `Cancelled via Shopify at ${shopifyOrder.cancelled_at}`;
    }

    if (existingOrder) {
        // Update existing order
        await prisma.order.update({
            where: { id: existingOrder.id },
            data: orderData
        });

        // Determine what changed for logging
        let changeType = 'updated';
        if (shopifyOrder.cancelled_at && existingOrder.status !== 'cancelled') {
            changeType = 'cancelled';
        } else if (shopifyOrder.fulfillment_status === 'fulfilled' && existingOrder.shopifyFulfillmentStatus !== 'fulfilled') {
            changeType = 'fulfilled';
        }

        console.log(`Order ${orderName}: ${changeType}`);
        return { action: changeType, orderId: existingOrder.id };
    } else {
        // Create new order with lines
        const lineItems = shopifyOrder.line_items || [];
        const orderLines = [];

        for (const item of lineItems) {
            const shopifyVariantId = item.variant_id ? String(item.variant_id) : null;

            // Try to find matching SKU
            let sku = null;
            if (shopifyVariantId) {
                sku = await prisma.sku.findFirst({ where: { shopifyVariantId } });
            }
            if (!sku && item.sku) {
                sku = await prisma.sku.findFirst({ where: { skuCode: item.sku } });
            }

            if (sku) {
                orderLines.push({
                    skuId: sku.id,
                    qty: item.quantity,
                    unitPrice: parseFloat(item.price) || 0,
                    lineStatus: 'pending',
                });
            }
        }

        const newOrder = await prisma.order.create({
            data: {
                ...orderData,
                orderLines: {
                    create: orderLines
                }
            }
        });

        console.log(`Order ${orderName}: created with ${orderLines.length} lines`);
        return { action: 'created', orderId: newOrder.id, linesCreated: orderLines.length };
    }
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
