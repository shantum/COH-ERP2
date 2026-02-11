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

// ============================================
// API RESPONSE SCHEMAS (for Dashboard)
// ============================================

/**
 * Money type used throughout Return Prime API responses
 */
export const MoneySchema = z.object({
    amount: z.number().nullable().optional(),
    currency_code: z.string().nullable(),
});

export type Money = z.infer<typeof MoneySchema>;

/**
 * Status flag (approved, received, inspected, etc.)
 */
export const StatusFlagSchema = z.object({
    status: z.boolean(),
    comment: z.string().nullable(),
    created_at: z.string().nullable(),
});

export type StatusFlag = z.infer<typeof StatusFlagSchema>;

/**
 * Customer address from API response
 */
export const CustomerAddressSchema = z.object({
    first_name: z.string().optional(),
    last_name: z.string().nullable().optional(),
    postal_code: z.string().optional(),
    city: z.string().optional(),
    province: z.string().optional(),
    country_code: z.string().optional(),
    province_code: z.string().optional(),
    address_line_1: z.string().optional(),
    address_line_2: z.string().nullable().optional(),
    country: z.string().optional(),
});

export type CustomerAddress = z.infer<typeof CustomerAddressSchema>;

/**
 * Customer bank details
 */
export const CustomerBankSchema = z.object({
    account_holder_name: z.string().optional(),
    account_number: z.string().optional(),
    ifsc_code: z.string().optional(),
});

export type CustomerBank = z.infer<typeof CustomerBankSchema>;

/**
 * Customer from API response (full details)
 */
export const ReturnPrimeApiCustomerSchema = z.object({
    id: z.number().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    address: CustomerAddressSchema.optional(),
    bank: CustomerBankSchema.optional(),
});

export type ReturnPrimeApiCustomer = z.infer<typeof ReturnPrimeApiCustomerSchema>;

/**
 * Order fulfillment details
 */
export const OrderFulfillmentSchema = z.object({
    id: z.number(),
    line_items: z.array(z.number()),
    delivery_status: z.string().nullable(),
    delivery_date: z.string().nullable(),
});

export type OrderFulfillment = z.infer<typeof OrderFulfillmentSchema>;

/**
 * Payment gateway info
 */
export const PaymentGatewaySchema = z.object({
    name: z.string(),
    id: z.string(),
});

export type PaymentGateway = z.infer<typeof PaymentGatewaySchema>;

/**
 * Order from API response (full details)
 */
export const ReturnPrimeApiOrderSchema = z.object({
    id: z.number(),
    name: z.string(),
    order_manual_payment: z.boolean().optional(),
    payment_gateways: z.array(PaymentGatewaySchema).optional(),
    fulfillments: z.array(OrderFulfillmentSchema).optional(),
    created_at: z.string().optional(),
});

export type ReturnPrimeApiOrder = z.infer<typeof ReturnPrimeApiOrderSchema>;

/**
 * Product info for line items
 */
export const ProductInfoSchema = z.object({
    title: z.string().nullable().optional(),
    variant_title: z.string().nullable().optional(),
    product_id: z.number().nullable().optional(),
    variant_id: z.number().nullable().optional(),
    image: z.object({ src: z.string() }).nullable().optional(),
    price: z.number().nullable().optional(),
    sku: z.string().nullable().optional(),
    variant_deleted: z.boolean().nullable().optional(),
    product_deleted: z.boolean().nullable().optional(),
});

export type ProductInfo = z.infer<typeof ProductInfoSchema>;

/**
 * Shop price breakdown
 */
export const ShopPriceSchema = z.object({
    actual_amount: z.number().nullable().optional(),
    total_tax: z.number().nullable().optional(),
    return_quantity: z.number().nullable().optional(),
    total_discount: z.number().nullable().optional(),
    shipping_amount: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
});

export type ShopPrice = z.infer<typeof ShopPriceSchema>;

/**
 * Line item refund details
 */
export const LineItemRefundSchema = z.object({
    requested_mode: z.string().nullable().optional(),
    actual_mode: z.string().nullable().optional(),
    refund_others_text: z.string().nullable().optional(),
    meta: z.unknown().nullable().optional(),
    status: z.string().nullable().optional(),
    refunded_amount: z
        .object({
            shop_money: MoneySchema.nullable().optional(),
            presentment_money: MoneySchema.nullable().optional(),
        })
        .nullable()
        .optional(),
    refunded_at: z.string().nullable().optional(),
    comment: z.string().nullable().optional(),
});

export type LineItemRefund = z.infer<typeof LineItemRefundSchema>;

/**
 * Fee schema (return fee, exchange fee)
 */
export const FeeSchema = z.object({
    price_set: z
        .object({
            shop_money: MoneySchema.nullable().optional(),
            presentment_money: MoneySchema.nullable().optional(),
        })
        .nullable()
        .optional(),
});

export type Fee = z.infer<typeof FeeSchema>;

/**
 * Shipping info for line items
 */
export const ShippingInfoSchema = z.object({
    awb: z.string().nullable().optional(),
    shipping_company: z.string().nullable().optional(),
    tracking_url: z.string().nullable().optional(),
    tracking_available: z.boolean().nullable().optional(),
    labels: z.array(z.string()).nullable().optional(),
});

export type ShippingInfo = z.infer<typeof ShippingInfoSchema>;

/**
 * Line item from API response (full details)
 */
export const ReturnPrimeApiLineItemSchema = z.object({
    id: z.number(),
    quantity: z.number(),
    reason: z.string().nullable().optional(),
    refund: LineItemRefundSchema.nullable().optional(),
    return_fee: FeeSchema.nullable().optional(),
    exchange_fee: FeeSchema.nullable().optional(),
    original_product: ProductInfoSchema.nullable().optional(),
    exchange_product: ProductInfoSchema.nullable().optional(),
    shipping: z.array(ShippingInfoSchema).nullable().optional(),
    shop_price: ShopPriceSchema.nullable().optional(),
});

export type ReturnPrimeApiLineItem = z.infer<typeof ReturnPrimeApiLineItemSchema>;

/**
 * Incentive offered for exchange
 */
export const IncentiveSchema = z.object({
    type: z.enum(['fixed', 'percentage']),
    value: z.number(),
    amount: z
        .object({
            shop_money: MoneySchema.optional(),
            presentment_money: MoneySchema.optional(),
        })
        .optional(),
});

export type Incentive = z.infer<typeof IncentiveSchema>;

/**
 * Main request schema from API response
 */
export const ReturnPrimeRequestSchema = z.object({
    id: z.string(),
    request_number: z.string(),
    request_type: z.enum(['return', 'exchange']),
    status: z.string().optional(),
    manual_request: z.boolean().optional(),
    channel: z.number().optional(),
    smart_exchange: z.boolean().optional(),
    created_at: z.string(),

    order: ReturnPrimeApiOrderSchema.optional(),
    customer: ReturnPrimeApiCustomerSchema.optional(),

    // Status flags
    approved: StatusFlagSchema.optional(),
    received: StatusFlagSchema.optional(),
    inspected: StatusFlagSchema.optional(),
    rejected: StatusFlagSchema.optional(),
    archived: StatusFlagSchema.optional(),
    unarchived: StatusFlagSchema.optional(),

    incentive: IncentiveSchema.nullable().optional(),
    line_items: z.array(ReturnPrimeApiLineItemSchema).optional(),
});

export type ReturnPrimeRequest = z.infer<typeof ReturnPrimeRequestSchema>;

/**
 * API list response schema
 */
export const ReturnPrimeListResponseSchema = z.object({
    status: z.boolean(),
    message: z.string().optional(),
    data: z.object({
        list: z.array(ReturnPrimeRequestSchema),
        hasNextPage: z.boolean(),
        hasPreviousPage: z.boolean(),
    }),
});

export type ReturnPrimeListResponse = z.infer<typeof ReturnPrimeListResponseSchema>;

/**
 * API detail response schema
 */
export const ReturnPrimeDetailResponseSchema = z.object({
    status: z.boolean(),
    message: z.string().optional(),
    data: z.object({
        request: ReturnPrimeRequestSchema,
    }),
});

export type ReturnPrimeDetailResponse = z.infer<typeof ReturnPrimeDetailResponseSchema>;

// ============================================
// DASHBOARD-SPECIFIC TYPES
// ============================================

/**
 * Aggregated stats for the Return Prime dashboard
 */
export interface ReturnPrimeStats {
    total: number;
    returns: number;
    exchanges: number;
    pending: number;
    approved: number;
    received: number;
    refunded: number;
    totalValue: number;
}

/**
 * Combined dashboard data structure
 */
export interface ReturnPrimeDashboardData {
    requests: ReturnPrimeRequest[];
    stats: ReturnPrimeStats;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
}

// ============================================
// SEARCH PARAMS SCHEMA (for Route)
// ============================================

/**
 * Search params for the Return Prime dashboard route
 */
export const ReturnPrimeSearchParamsSchema = z.object({
    tab: z.enum(['requests', 'analytics']).catch('requests'),
    requestType: z.enum(['all', 'return', 'exchange']).catch('all'),
    dateFrom: z.string().optional().catch(undefined),
    dateTo: z.string().optional().catch(undefined),
    search: z.string().optional().catch(undefined),
});

export type ReturnPrimeSearchParams = z.infer<typeof ReturnPrimeSearchParamsSchema>;
