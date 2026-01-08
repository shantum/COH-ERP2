/**
 * Webhook Handler Tests
 * 
 * Tests for:
 * - Webhook signature verification
 * - Order webhook processing
 * - Product webhook processing
 * - Deduplication logic
 * - Error handling
 */

import crypto from 'crypto';

// ============================================
// SECTION 1: WEBHOOK SIGNATURE VERIFICATION
// ============================================

describe('Webhook Signature - HMAC Verification', () => {
    const createHmacSignature = (body, secret) => {
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(body, 'utf8');
        return 'sha256=' + hmac.digest('base64');
    };

    const verifySignature = (body, signature, secret) => {
        if (!secret || !signature) return false;
        const expected = createHmacSignature(body, secret);
        try {
            return crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expected)
            );
        } catch {
            return false;
        }
    };

    it('should verify valid signature', () => {
        const secret = 'test-webhook-secret';
        const body = JSON.stringify({ id: 123 });
        const signature = createHmacSignature(body, secret);

        expect(verifySignature(body, signature, secret)).toBe(true);
    });

    it('should reject invalid signature', () => {
        const secret = 'test-webhook-secret';
        const body = JSON.stringify({ id: 123 });
        const wrongSignature = 'sha256=invalid';

        expect(verifySignature(body, wrongSignature, secret)).toBe(false);
    });

    it('should reject when secret is missing', () => {
        const body = JSON.stringify({ id: 123 });
        expect(verifySignature(body, 'sha256=abc', null)).toBe(false);
    });

    it('should reject when signature is missing', () => {
        const body = JSON.stringify({ id: 123 });
        expect(verifySignature(body, null, 'secret')).toBe(false);
    });

    it('should handle modified body', () => {
        const secret = 'test-webhook-secret';
        const originalBody = JSON.stringify({ id: 123 });
        const modifiedBody = JSON.stringify({ id: 124 });
        const signature = createHmacSignature(originalBody, secret);

        expect(verifySignature(modifiedBody, signature, secret)).toBe(false);
    });
});

// ============================================
// SECTION 2: WEBHOOK DEDUPLICATION
// ============================================

describe('Webhook Deduplication - Logic', () => {
    const checkDuplicate = (webhookId, processedIds) => {
        if (!webhookId) return { duplicate: false, isRetry: false };
        if (processedIds.has(webhookId)) {
            return { duplicate: true, isRetry: true };
        }
        return { duplicate: false, isRetry: false };
    };

    it('should detect duplicate webhook', () => {
        const processedIds = new Set(['webhook-1', 'webhook-2']);
        const result = checkDuplicate('webhook-1', processedIds);
        expect(result.duplicate).toBe(true);
        expect(result.isRetry).toBe(true);
    });

    it('should allow new webhook', () => {
        const processedIds = new Set(['webhook-1']);
        const result = checkDuplicate('webhook-3', processedIds);
        expect(result.duplicate).toBe(false);
    });

    it('should handle missing webhook ID', () => {
        const processedIds = new Set(['webhook-1']);
        const result = checkDuplicate(null, processedIds);
        expect(result.duplicate).toBe(false);
    });
});

describe('Webhook Deduplication - Database Check', () => {
    const isDuplicateInDb = async (webhookId, existingLogs) => {
        if (!webhookId) return false;
        return existingLogs.some(log => log.webhookId === webhookId);
    };

    it('should detect existing webhook in database', async () => {
        const existingLogs = [
            { webhookId: 'wh-1', status: 'processed' },
            { webhookId: 'wh-2', status: 'processed' }
        ];
        expect(await isDuplicateInDb('wh-1', existingLogs)).toBe(true);
    });

    it('should allow new webhook', async () => {
        const existingLogs = [{ webhookId: 'wh-1', status: 'processed' }];
        expect(await isDuplicateInDb('wh-3', existingLogs)).toBe(false);
    });
});

// ============================================
// SECTION 3: ORDER WEBHOOK PROCESSING
// ============================================

describe('Order Webhook - Topic Detection', () => {
    const getOrderAction = (topic) => {
        const actions = {
            'orders/create': 'create',
            'orders/updated': 'update',
            'orders/cancelled': 'cancel',
            'orders/fulfilled': 'fulfill',
            'orders/paid': 'payment'
        };
        return actions[topic] || 'update';
    };

    it('should detect create action', () => {
        expect(getOrderAction('orders/create')).toBe('create');
    });

    it('should detect cancel action', () => {
        expect(getOrderAction('orders/cancelled')).toBe('cancel');
    });

    it('should detect fulfill action', () => {
        expect(getOrderAction('orders/fulfilled')).toBe('fulfill');
    });

    it('should default to update for unknown topic', () => {
        expect(getOrderAction('orders/unknown')).toBe('update');
    });
});

describe('Order Webhook - Status Extraction', () => {
    const extractOrderStatus = (shopifyOrder) => {
        if (shopifyOrder.cancelled_at) return 'cancelled';
        if (shopifyOrder.fulfillment_status === 'fulfilled') return 'shipped';
        return 'open';
    };

    it('should detect cancelled order', () => {
        const order = { cancelled_at: '2026-01-08T10:00:00Z' };
        expect(extractOrderStatus(order)).toBe('cancelled');
    });

    it('should detect fulfilled/shipped order', () => {
        const order = { fulfillment_status: 'fulfilled' };
        expect(extractOrderStatus(order)).toBe('shipped');
    });

    it('should default to open', () => {
        const order = { fulfillment_status: null };
        expect(extractOrderStatus(order)).toBe('open');
    });
});

describe('Order Webhook - Financial Status', () => {
    const isOrderPaid = (financialStatus) => {
        const paidStatuses = ['paid', 'partially_refunded', 'refunded'];
        return paidStatuses.includes(financialStatus);
    };

    it('should detect paid order', () => {
        expect(isOrderPaid('paid')).toBe(true);
    });

    it('should detect partially refunded as paid', () => {
        expect(isOrderPaid('partially_refunded')).toBe(true);
    });

    it('should detect pending as unpaid', () => {
        expect(isOrderPaid('pending')).toBe(false);
    });

    it('should detect authorized as unpaid', () => {
        expect(isOrderPaid('authorized')).toBe(false);
    });
});

// ============================================
// SECTION 4: PRODUCT WEBHOOK PROCESSING
// ============================================

describe('Product Webhook - Topic Detection', () => {
    const getProductAction = (topic) => {
        const actions = {
            'products/create': 'create',
            'products/update': 'update',
            'products/delete': 'delete'
        };
        return actions[topic] || 'update';
    };

    it('should detect create action', () => {
        expect(getProductAction('products/create')).toBe('create');
    });

    it('should detect delete action', () => {
        expect(getProductAction('products/delete')).toBe('delete');
    });
});

describe('Product Webhook - Variant Extraction', () => {
    const extractVariants = (product) => {
        if (!product.variants || !Array.isArray(product.variants)) {
            return [];
        }
        return product.variants.map(v => ({
            id: v.id,
            sku: v.sku,
            price: parseFloat(v.price),
            inventoryQty: v.inventory_quantity || 0
        }));
    };

    it('should extract variants from product', () => {
        const product = {
            variants: [
                { id: 1, sku: 'SKU-1', price: '100.00', inventory_quantity: 10 },
                { id: 2, sku: 'SKU-2', price: '150.00', inventory_quantity: 5 }
            ]
        };
        const variants = extractVariants(product);
        expect(variants.length).toBe(2);
        expect(variants[0].sku).toBe('SKU-1');
        expect(variants[0].price).toBe(100);
    });

    it('should handle product without variants', () => {
        const product = {};
        expect(extractVariants(product)).toEqual([]);
    });
});

// ============================================
// SECTION 5: CUSTOMER WEBHOOK PROCESSING
// ============================================

describe('Customer Webhook - Data Extraction', () => {
    const extractCustomerData = (shopifyCustomer) => ({
        shopifyCustomerId: String(shopifyCustomer.id),
        email: shopifyCustomer.email?.toLowerCase() || null,
        firstName: shopifyCustomer.first_name || null,
        lastName: shopifyCustomer.last_name || null,
        phone: shopifyCustomer.phone || null,
        totalOrders: shopifyCustomer.orders_count || 0,
        totalSpent: parseFloat(shopifyCustomer.total_spent) || 0
    });

    it('should extract customer data', () => {
        const customer = {
            id: 123456,
            email: 'Test@Example.com',
            first_name: 'John',
            last_name: 'Doe',
            phone: '+919876543210',
            orders_count: 5,
            total_spent: '5000.00'
        };
        const data = extractCustomerData(customer);
        expect(data.email).toBe('test@example.com');
        expect(data.totalSpent).toBe(5000);
    });

    it('should handle missing fields', () => {
        const customer = { id: 123 };
        const data = extractCustomerData(customer);
        expect(data.email).toBeNull();
        expect(data.totalOrders).toBe(0);
    });
});

// ============================================
// SECTION 6: ERROR HANDLING
// ============================================

describe('Webhook Error Handling - Response Strategy', () => {
    const handleWebhookError = (error, webhookType) => {
        const isRetryable = [
            'ECONNRESET',
            'ETIMEDOUT',
            'ECONNREFUSED'
        ].includes(error.code);

        return {
            statusCode: 200, // Always 200 to prevent Shopify retries
            logError: true,
            addToDeadLetter: !isRetryable,
            errorMessage: error.message
        };
    };

    it('should always return 200 status', () => {
        const error = new Error('Database error');
        const result = handleWebhookError(error, 'order');
        expect(result.statusCode).toBe(200);
    });

    it('should add non-retryable errors to dead letter', () => {
        const error = new Error('Validation failed');
        const result = handleWebhookError(error, 'order');
        expect(result.addToDeadLetter).toBe(true);
    });

    it('should NOT add connection errors to dead letter', () => {
        const error = new Error('Connection reset');
        error.code = 'ECONNRESET';
        const result = handleWebhookError(error, 'order');
        expect(result.addToDeadLetter).toBe(false);
    });
});

describe('Webhook Error Handling - Dead Letter Queue', () => {
    const createDeadLetterEntry = (webhookType, entityId, payload, error) => ({
        type: webhookType,
        entityId: String(entityId),
        payload: JSON.stringify(payload),
        errorMessage: error,
        retryCount: 0,
        status: 'pending',
        createdAt: new Date()
    });

    it('should create dead letter entry', () => {
        const entry = createDeadLetterEntry('order', 123, { id: 123 }, 'Processing failed');
        expect(entry.type).toBe('order');
        expect(entry.status).toBe('pending');
        expect(entry.retryCount).toBe(0);
    });
});

// ============================================
// SECTION 7: INVENTORY WEBHOOK
// ============================================

describe('Inventory Level Webhook - Processing', () => {
    const processInventoryUpdate = (payload) => {
        return {
            locationId: payload.location_id,
            inventoryItemId: payload.inventory_item_id,
            available: payload.available,
            updatedAt: payload.updated_at
        };
    };

    it('should extract inventory level data', () => {
        const payload = {
            location_id: 123,
            inventory_item_id: 456,
            available: 25,
            updated_at: '2026-01-08T10:00:00Z'
        };
        const result = processInventoryUpdate(payload);
        expect(result.available).toBe(25);
    });
});

// ============================================
// SECTION 8: WEBHOOK LOGGING
// ============================================

describe('Webhook Logging - Entry Creation', () => {
    const createWebhookLog = (webhookId, topic, entityId, isRetry) => ({
        webhookId,
        topic,
        entityId: String(entityId),
        status: 'received',
        isRetry,
        receivedAt: new Date()
    });

    it('should create webhook log entry', () => {
        const log = createWebhookLog('wh-123', 'orders/create', 12345, false);
        expect(log.status).toBe('received');
        expect(log.entityId).toBe('12345');
    });

    const updateWebhookLog = (log, status, error, processingTime) => ({
        ...log,
        status,
        errorMessage: error,
        processingTimeMs: processingTime,
        processedAt: new Date()
    });

    it('should update log on success', () => {
        const log = { webhookId: 'wh-123', status: 'received' };
        const updated = updateWebhookLog(log, 'processed', null, 150);
        expect(updated.status).toBe('processed');
        expect(updated.processingTimeMs).toBe(150);
    });

    it('should update log on failure', () => {
        const log = { webhookId: 'wh-123', status: 'received' };
        const updated = updateWebhookLog(log, 'failed', 'DB error', 50);
        expect(updated.status).toBe('failed');
        expect(updated.errorMessage).toBe('DB error');
    });
});

// ============================================
// SECTION 9: WEBHOOK HEADER PARSING
// ============================================

describe('Webhook Headers - Extraction', () => {
    const extractWebhookHeaders = (headers) => ({
        webhookId: headers['x-shopify-webhook-id'],
        topic: headers['x-shopify-topic'],
        shopDomain: headers['x-shopify-shop-domain'],
        apiVersion: headers['x-shopify-api-version'],
        hmacSha256: headers['x-shopify-hmac-sha256']
    });

    it('should extract all webhook headers', () => {
        const headers = {
            'x-shopify-webhook-id': 'abc-123',
            'x-shopify-topic': 'orders/create',
            'x-shopify-shop-domain': 'test.myshopify.com',
            'x-shopify-api-version': '2024-01',
            'x-shopify-hmac-sha256': 'base64signature=='
        };
        const extracted = extractWebhookHeaders(headers);
        expect(extracted.webhookId).toBe('abc-123');
        expect(extracted.topic).toBe('orders/create');
    });

    it('should handle missing headers', () => {
        const headers = {};
        const extracted = extractWebhookHeaders(headers);
        expect(extracted.webhookId).toBeUndefined();
    });
});
