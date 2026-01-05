/**
 * Webhook utilities for validation, deduplication, and error handling
 */
import { z } from 'zod';

// ============================================
// ZOD SCHEMAS FOR SHOPIFY WEBHOOKS
// ============================================

// Common address schema
const addressSchema = z.object({
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    address1: z.string().nullish(),
    address2: z.string().nullish(),
    city: z.string().nullish(),
    province: z.string().nullish(),
    country: z.string().nullish(),
    zip: z.string().nullish(),
    phone: z.string().nullish(),
}).passthrough().nullish();

// Line item schema
const lineItemSchema = z.object({
    id: z.number().or(z.string()),
    variant_id: z.number().or(z.string()).nullish(),
    title: z.string().nullish(),
    quantity: z.number(),
    price: z.string().or(z.number()),
    sku: z.string().nullish(),
}).passthrough();

// Shopify order webhook payload
export const shopifyOrderSchema = z.object({
    id: z.number().or(z.string()),
    name: z.string().nullish(),
    order_number: z.number().or(z.string()).nullish(),
    email: z.string().email().nullish().or(z.literal('')),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
    financial_status: z.string().nullish(),
    fulfillment_status: z.string().nullish(),
    total_price: z.string().or(z.number()).nullish(),
    subtotal_price: z.string().or(z.number()).nullish(),
    total_discounts: z.string().or(z.number()).nullish(),
    currency: z.string().nullish(),
    note: z.string().nullish(),
    tags: z.string().nullish(),
    cancelled_at: z.string().nullish(),
    customer: z.object({
        id: z.number().or(z.string()),
        email: z.string().nullish(),
        first_name: z.string().nullish(),
        last_name: z.string().nullish(),
        phone: z.string().nullish(),
    }).passthrough().nullish(),
    shipping_address: addressSchema,
    billing_address: addressSchema,
    line_items: z.array(lineItemSchema).optional().default([]),
    discount_codes: z.array(z.object({
        code: z.string(),
        amount: z.string().or(z.number()).nullish(),
        type: z.string().nullish(),
    })).optional().default([]),
    payment_gateway_names: z.array(z.string()).optional().default([]),
    fulfillments: z.array(z.object({
        id: z.number().or(z.string()),
        status: z.string().nullish(),
        tracking_number: z.string().nullish(),
        tracking_company: z.string().nullish(),
        created_at: z.string().nullish(),
    }).passthrough()).optional().default([]),
}).passthrough();

// Shopify product webhook payload
export const shopifyProductSchema = z.object({
    id: z.number().or(z.string()),
    title: z.string(),
    handle: z.string().nullish(),
    body_html: z.string().nullish(),
    vendor: z.string().nullish(),
    product_type: z.string().nullish(),
    status: z.string().nullish(),
    tags: z.string().nullish(),
    variants: z.array(z.object({
        id: z.number().or(z.string()),
        title: z.string().nullish(),
        sku: z.string().nullish(),
        price: z.string().or(z.number()).nullish(),
        inventory_item_id: z.number().or(z.string()).nullish(),
    }).passthrough()).optional().default([]),
    images: z.array(z.object({
        id: z.number().or(z.string()),
        src: z.string(),
    }).passthrough()).optional().default([]),
}).passthrough();

// Shopify customer webhook payload
export const shopifyCustomerSchema = z.object({
    id: z.number().or(z.string()),
    email: z.string().nullish(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    phone: z.string().nullish(),
    orders_count: z.number().nullish(),
    total_spent: z.string().or(z.number()).nullish(),
    default_address: addressSchema,
}).passthrough();

// Inventory level webhook payload
export const shopifyInventoryLevelSchema = z.object({
    inventory_item_id: z.number().or(z.string()),
    location_id: z.number().or(z.string()).nullish(),
    available: z.number().nullish(),
    updated_at: z.string().nullish(),
}).passthrough();

// ============================================
// WEBHOOK DEDUPLICATION
// ============================================

/**
 * Check if webhook has already been processed (deduplication)
 * Returns existing log if found, null if new webhook
 */
export async function checkWebhookDuplicate(prisma, webhookId) {
    if (!webhookId) return null;

    try {
        const existing = await prisma.webhookLog.findUnique({
            where: { webhookId }
        });
        return existing;
    } catch (e) {
        // Table might not exist yet, continue processing
        console.warn('WebhookLog lookup failed:', e.message);
        return null;
    }
}

/**
 * Log webhook receipt for deduplication
 */
export async function logWebhookReceived(prisma, webhookId, topic, resourceId) {
    if (!webhookId) return null;

    try {
        return await prisma.webhookLog.create({
            data: {
                webhookId,
                topic,
                resourceId: resourceId ? String(resourceId) : null,
                status: 'processing',
            }
        });
    } catch (e) {
        // Unique constraint = duplicate
        if (e.code === 'P2002') {
            return null;
        }
        console.warn('WebhookLog create failed:', e.message);
        return null;
    }
}

/**
 * Update webhook log with result
 */
export async function updateWebhookLog(prisma, webhookId, status, error = null, processingTime = null) {
    if (!webhookId) return;

    try {
        await prisma.webhookLog.update({
            where: { webhookId },
            data: {
                status,
                error: error?.substring(0, 1000), // Truncate long errors
                processingTime,
                processedAt: new Date(),
            }
        });
    } catch (e) {
        console.warn('WebhookLog update failed:', e.message);
    }
}

// ============================================
// FAILED SYNC ITEM MANAGEMENT (Dead Letter Queue)
// ============================================

/**
 * Add item to dead letter queue for retry
 */
export async function addToFailedQueue(prisma, itemType, resourceId, rawData, error) {
    try {
        // Calculate next retry with exponential backoff
        const nextRetry = new Date(Date.now() + 60000); // First retry in 1 minute

        await prisma.failedSyncItem.upsert({
            where: {
                itemType_resourceId: { itemType, resourceId: String(resourceId) }
            },
            create: {
                itemType,
                resourceId: String(resourceId),
                rawData: typeof rawData === 'string' ? rawData : JSON.stringify(rawData),
                error: error?.substring(0, 2000) || 'Unknown error',
                nextRetryAt: nextRetry,
                status: 'pending',
            },
            update: {
                rawData: typeof rawData === 'string' ? rawData : JSON.stringify(rawData),
                error: error?.substring(0, 2000) || 'Unknown error',
                retryCount: { increment: 1 },
                status: 'pending',
                updatedAt: new Date(),
            }
        });
    } catch (e) {
        console.error('Failed to add to dead letter queue:', e.message);
    }
}

/**
 * Get items ready for retry
 */
export async function getItemsForRetry(prisma, limit = 10) {
    try {
        return await prisma.failedSyncItem.findMany({
            where: {
                status: { in: ['pending', 'retrying'] },
                nextRetryAt: { lte: new Date() },
                retryCount: { lt: prisma.failedSyncItem.fields?.maxRetries ?? 5 },
            },
            orderBy: { nextRetryAt: 'asc' },
            take: limit,
        });
    } catch (e) {
        console.warn('getItemsForRetry failed:', e.message);
        return [];
    }
}

/**
 * Mark retry attempt
 */
export async function markRetryAttempt(prisma, id, success, error = null) {
    try {
        if (success) {
            await prisma.failedSyncItem.update({
                where: { id },
                data: {
                    status: 'resolved',
                    resolvedAt: new Date(),
                    error: null,
                }
            });
        } else {
            // Get current item to calculate backoff
            const item = await prisma.failedSyncItem.findUnique({ where: { id } });
            if (!item) return;

            const newRetryCount = item.retryCount + 1;
            const status = newRetryCount >= item.maxRetries ? 'abandoned' : 'pending';

            // Exponential backoff: 1min, 2min, 4min, 8min, 16min
            const backoffMs = Math.min(60000 * Math.pow(2, newRetryCount), 3600000);

            await prisma.failedSyncItem.update({
                where: { id },
                data: {
                    status,
                    retryCount: newRetryCount,
                    error: error?.substring(0, 2000),
                    nextRetryAt: status === 'abandoned' ? null : new Date(Date.now() + backoffMs),
                }
            });
        }
    } catch (e) {
        console.warn('markRetryAttempt failed:', e.message);
    }
}

/**
 * Validate webhook payload with Zod schema
 * Returns { success: true, data } or { success: false, error }
 */
export function validateWebhookPayload(schema, payload) {
    const result = schema.safeParse(payload);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return {
        success: false,
        error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    };
}
