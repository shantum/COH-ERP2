/**
 * Return Prime Webhook Schemas
 *
 * Strict Zod validation for Return Prime webhook payloads.
 * No passthrough - we only accept known fields.
 */

import { z } from 'zod';

// ============================================
// NESTED SCHEMAS
// ============================================

/**
 * Line item from Return Prime
 * Contains info about the item being returned
 */
export const ReturnPrimeLineItemSchema = z.object({
    id: z.string().min(1),
    shopify_line_id: z.string().regex(/^\d+$/).optional(), // Shopify IDs are numeric strings
    sku: z.string().optional(),
    quantity: z.number().int().positive().max(1000), // Reasonable max
    price: z.number().nonnegative().optional(),
    reason: z.string().optional(),
});

export type ReturnPrimeLineItem = z.infer<typeof ReturnPrimeLineItemSchema>;

/**
 * Shipping/logistics info from Return Prime
 */
export const ReturnPrimeShippingSchema = z.object({
    awb_number: z.string().optional(),
    courier: z.string().optional(),
    status: z.string().optional(),
    tracking_url: z.string().url().optional().or(z.string().max(0)),
});

/**
 * Exchange info from Return Prime
 */
export const ReturnPrimeExchangeSchema = z.object({
    order_id: z.string().optional(),
    variant_id: z.string().optional(),
    sku: z.string().optional(),
});

/**
 * Refund info from Return Prime
 */
export const ReturnPrimeRefundSchema = z.object({
    id: z.string().optional(),
    amount: z.number().nonnegative().optional(),
    transaction_id: z.string().optional(),
    method: z.string().optional(),
});

/**
 * Order reference from Return Prime
 */
export const ReturnPrimeOrderSchema = z.object({
    shopify_order_id: z.union([z.string(), z.number()]).transform(String),
    order_name: z.string().optional(),
});

/**
 * Customer info from Return Prime
 */
export const ReturnPrimeCustomerSchema = z.object({
    email: z.string().email().optional().or(z.string().max(0)),
    phone: z.string().optional(),
    name: z.string().optional(),
});

// ============================================
// MAIN WEBHOOK PAYLOAD SCHEMA
// ============================================

/**
 * Main Return Prime webhook payload
 * Strict mode - no passthrough for security
 */
export const ReturnPrimeWebhookPayloadSchema = z.object({
    id: z.string().min(1),
    request_number: z.string().optional(),
    request_type: z.enum(['return', 'exchange']).default('return'),
    status: z.string().optional(),
    reason: z.string().optional(),
    reason_details: z.string().optional(),
    rejection_reason: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    order: ReturnPrimeOrderSchema.optional(),
    customer: ReturnPrimeCustomerSchema.optional(),
    line_items: z.array(ReturnPrimeLineItemSchema).default([]),
    shipping: ReturnPrimeShippingSchema.optional(),
    exchange: ReturnPrimeExchangeSchema.optional(),
    refund: ReturnPrimeRefundSchema.optional(),
});

export type ReturnPrimeWebhookPayload = z.infer<typeof ReturnPrimeWebhookPayloadSchema>;

// ============================================
// RETURN PRIME STATUS VALUES
// ============================================

/**
 * Known Return Prime request statuses
 */
export const ReturnPrimeStatusSchema = z.enum([
    'pending',
    'approved',
    'received',
    'inspected',
    'refunded',
    'rejected',
    'archived',
]);

export type ReturnPrimeStatus = z.infer<typeof ReturnPrimeStatusSchema>;

// ============================================
// WEBHOOK TOPIC ENUM
// ============================================

/**
 * Return Prime webhook topics
 */
export const ReturnPrimeWebhookTopicSchema = z.enum([
    'request/created',
    'request/approved',
    'request/received',
    'request/inspected',
    'request/refunded',
    'request/rejected',
    'request/archived',
    'request/updated',
]);

export type ReturnPrimeWebhookTopic = z.infer<typeof ReturnPrimeWebhookTopicSchema>;
