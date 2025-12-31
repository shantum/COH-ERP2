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

// Orders - Create
router.post('/shopify/orders/create', verifyWebhook, async (req, res) => {
    try {
        const shopifyOrder = req.body;
        console.log(`Webhook: orders/create - Order #${shopifyOrder.order_number || shopifyOrder.name}`);

        const result = await processShopifyOrder(req.prisma, shopifyOrder, 'create');

        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook orders/create error:', error);
        res.status(200).json({ received: true, error: error.message }); // Always return 200 to prevent retries
    }
});

// Orders - Updated
router.post('/shopify/orders/updated', verifyWebhook, async (req, res) => {
    try {
        const shopifyOrder = req.body;
        console.log(`Webhook: orders/updated - Order #${shopifyOrder.order_number || shopifyOrder.name}`);

        const result = await processShopifyOrder(req.prisma, shopifyOrder, 'update');

        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Webhook orders/updated error:', error);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Orders - Cancelled
router.post('/shopify/orders/cancelled', verifyWebhook, async (req, res) => {
    try {
        const shopifyOrder = req.body;
        console.log(`Webhook: orders/cancelled - Order #${shopifyOrder.order_number || shopifyOrder.name}`);

        const shopifyOrderId = String(shopifyOrder.id);

        // Find and cancel the order
        const order = await req.prisma.order.findFirst({
            where: { shopifyOrderId }
        });

        if (order) {
            await req.prisma.order.update({
                where: { id: order.id },
                data: {
                    status: 'cancelled',
                    internalNotes: `Cancelled via Shopify at ${new Date().toISOString()}`
                }
            });
        }

        res.status(200).json({ received: true, cancelled: !!order });
    } catch (error) {
        console.error('Webhook orders/cancelled error:', error);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Orders - Fulfilled (when fulfilled in Shopify)
router.post('/shopify/orders/fulfilled', verifyWebhook, async (req, res) => {
    try {
        const shopifyOrder = req.body;
        console.log(`Webhook: orders/fulfilled - Order #${shopifyOrder.order_number || shopifyOrder.name}`);

        const shopifyOrderId = String(shopifyOrder.id);

        // Update fulfillment status
        const order = await req.prisma.order.findFirst({
            where: { shopifyOrderId }
        });

        if (order) {
            await req.prisma.order.update({
                where: { id: order.id },
                data: {
                    shopifyFulfillmentStatus: 'fulfilled'
                }
            });
        }

        res.status(200).json({ received: true, updated: !!order });
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
                orders_create: '/api/webhooks/shopify/orders/create',
                orders_updated: '/api/webhooks/shopify/orders/updated',
                orders_cancelled: '/api/webhooks/shopify/orders/cancelled',
                orders_fulfilled: '/api/webhooks/shopify/orders/fulfilled',
                customers_create: '/api/webhooks/shopify/customers/create',
                customers_update: '/api/webhooks/shopify/customers/update',
            },
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

async function processShopifyOrder(prisma, shopifyOrder, action) {
    const shopifyOrderId = String(shopifyOrder.id);

    // Check if order exists
    let order = await prisma.order.findFirst({
        where: { shopifyOrderId }
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

    // Build order data
    const orderData = {
        shopifyOrderId,
        shopifyOrderNumber: shopifyOrder.order_number ? String(shopifyOrder.order_number) : null,
        orderNumber: shopifyOrder.name || `SHOP-${shopifyOrderId.slice(-8)}`,
        channel: 'shopify',
        status: shopifyOrder.cancelled_at ? 'cancelled' : 'open',
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
    };

    if (order) {
        // Update existing order
        await prisma.order.update({
            where: { id: order.id },
            data: orderData
        });
        return { action: 'updated', orderId: order.id };
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

        return { action: 'created', orderId: newOrder.id, linesCreated: orderLines.length };
    }
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
