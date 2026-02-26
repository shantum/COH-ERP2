/**
 * Return Prime Webhook Schemas
 *
 * Strict Zod validation for Return Prime webhook payloads.
 * No passthrough - we only accept known fields.
 */

import { z } from 'zod';

// ============================================
// NORMALIZED OUTPUT TYPES (what handlers consume)
// ============================================

/**
 * Normalized line item — handlers work with this shape
 */
export interface ReturnPrimeLineItem {
    id: string;
    shopify_line_id: string;
    sku: string | undefined;
    quantity: number;
    price: number | undefined;
    reason: string | undefined;
    reason_detail?: string | undefined;
    customer_comment?: string | undefined;
    inspection_notes?: string | undefined;
    /** Return fee applied to this line (in shop currency) */
    return_fee?: number | undefined;
    /** Exchange product info (for exchange requests) */
    exchange_product?: {
        title?: string;
        variant_title?: string;
        sku?: string;
        price?: number;
        product_id?: number;
        variant_id?: number;
    } | undefined;
}

/**
 * Normalized shipping info
 */
export interface ReturnPrimeShipping {
    awb_number: string | undefined;
    courier: string | undefined;
}

/**
 * Normalized order reference
 */
export interface ReturnPrimeOrder {
    shopify_order_id: string;
    order_name: string | undefined;
}

/**
 * Normalized webhook payload — handlers work with this shape
 */
export interface ReturnPrimeWebhookPayload {
    id: string;
    request_number: string | undefined;
    request_type: 'return' | 'exchange';
    status: string | undefined;
    reason: string | undefined;
    reason_details: string | undefined;
    rejection_reason: string | undefined;
    created_at: string | undefined;
    updated_at: string | undefined;
    order: ReturnPrimeOrder | undefined;
    customer: {
        email?: string;
        phone?: string;
        name?: string;
        bank?: {
            account_holder_name?: string;
            account_number?: string;
            ifsc_code?: string;
        };
    } | undefined;
    line_items: ReturnPrimeLineItem[];
    shipping: ReturnPrimeShipping | undefined;
    refund: {
        id?: string;
        amount?: number;
        transaction_id?: string;
        method?: string;
        /** Customer's requested refund mode (e.g., 'Original Payment Method', 'Store Credit') */
        requested_mode?: string;
        /** How merchant actually refunded */
        actual_mode?: string;
        /** Amount customer was eligible for (before adjustments) */
        eligible_amount?: number;
        /** Amount actually refunded */
        refunded_amount?: number;
    } | undefined;
    /** Exchange order created by RP on Shopify */
    exchange: {
        shopify_order_id?: string;
        order_name?: string;
        type?: string;
        total_price?: number;
    } | undefined;
    /** Payment details for price difference (exchange) */
    payment_details: {
        transaction_id?: string;
        amount?: number;
        currency?: string;
        gateway?: string;
        status?: string;
    } | undefined;
}

// ============================================
// RAW WEBHOOK SCHEMAS (what Return Prime actually sends)
// ============================================

/**
 * Raw line item shipping entry (per-line, array)
 */
const RawLineShippingSchema = z.object({
    awb: z.string().nullable().optional(),
    shipping_company: z.string().nullable().optional(),
    tracking_url: z.string().nullable().optional(),
    tracking_available: z.boolean().optional(),
}).passthrough();

/**
 * Raw line item from Return Prime webhook
 * id = Shopify line item ID (number), SKU nested in original_product
 */
/**
 * Raw exchange product info
 */
const RawExchangeProductSchema = z.object({
    title: z.string().nullable().optional(),
    variant_title: z.string().nullable().optional(),
    sku: z.string().nullable().optional(),
    price: z.number().nullable().optional(),
    product_id: z.number().nullable().optional(),
    variant_id: z.number().nullable().optional(),
}).passthrough();

/**
 * Raw return fee per line item
 */
const RawReturnFeeSchema = z.object({
    price_set: z.object({
        shop_money: z.object({
            amount: z.number().nullable().optional(),
        }).passthrough().nullable().optional(),
    }).passthrough().nullable().optional(),
}).passthrough();

const RawLineItemSchema = z.object({
    id: z.union([z.number(), z.string()]),
    quantity: z.number().int().positive().max(1000),
    reason: z.string().nullable().optional(),
    reason_detail: z.string().nullable().optional(),
    customer_comment: z.string().nullable().optional(),
    inspection_notes: z.string().nullable().optional(),
    original_product: z.object({
        sku: z.string().nullable().optional(),
        price: z.number().nullable().optional(),
    }).passthrough().nullable().optional(),
    exchange_product: RawExchangeProductSchema.nullable().optional(),
    return_fee: RawReturnFeeSchema.nullable().optional(),
    shipping: z.array(RawLineShippingSchema).nullable().optional(),
}).passthrough();

/**
 * Raw order reference — uses `id` (number) and `name`, not `shopify_order_id`
 */
const RawOrderSchema = z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string().optional(),
}).passthrough();

/**
 * Raw customer info
 */
const RawCustomerSchema = z.object({
    email: z.string().optional(),
    phone: z.string().optional(),
    name: z.string().optional(),
    bank: z.object({
        account_holder_name: z.string().nullable().optional(),
        account_number: z.string().nullable().optional(),
        confirm_account_number: z.string().nullable().optional(),
        ifsc_code: z.string().nullable().optional(),
    }).passthrough().nullable().optional(),
}).passthrough();

/**
 * Raw refund info nested in line items or at request level
 */
const RawRefundSchema = z.object({
    id: z.string().optional(),
    amount: z.number().nonnegative().optional(),
    transaction_id: z.string().optional(),
    method: z.string().optional(),
    requested_mode: z.string().nullable().optional(),
    actual_mode: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    eligible_refund_amount: z.object({
        shop_money: z.object({
            amount: z.number().nullable().optional(),
        }).passthrough().nullable().optional(),
    }).passthrough().nullable().optional(),
    refunded_amount: z.object({
        shop_money: z.object({
            amount: z.number().nullable().optional(),
        }).passthrough().nullable().optional(),
    }).passthrough().nullable().optional(),
}).passthrough();

/**
 * Inner request object — the actual data inside { request: { ... } }
 */
const RawRequestSchema = z.object({
    id: z.string().min(1),
    request_number: z.string().optional(),
    request_type: z.enum(['return', 'exchange']).default('return'),
    status: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    order: RawOrderSchema.optional(),
    customer: RawCustomerSchema.optional(),
    line_items: z.array(RawLineItemSchema).default([]),
    refund: RawRefundSchema.nullable().optional(),
    reject: z.object({
        status: z.boolean().optional(),
        comment: z.string().nullable().optional(),
        created_at: z.string().nullable().optional(),
    }).passthrough().nullable().optional(),
    exchange: z.object({
        order: z.object({
            id: z.number().or(z.string()).optional(),
            name: z.string().optional(),
            type: z.string().optional(),
            total_price: z.object({
                shop_money: z.object({ amount: z.number().optional() }).passthrough().optional(),
            }).passthrough().optional(),
        }).passthrough().optional(),
    }).passthrough().nullable().optional(),
    payment_details: z.object({
        transaction_id: z.string().nullable().optional(),
        amount: z.number().nullable().optional(),
        currency: z.string().nullable().optional(),
        gateway: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
    }).passthrough().nullable().optional(),
}).passthrough();

// ============================================
// MAIN WEBHOOK PAYLOAD SCHEMA
// ============================================

/**
 * Return Prime webhook payload schema.
 * Accepts the actual { request: { ... } } wrapper and normalizes
 * to the ReturnPrimeWebhookPayload shape that handlers expect.
 */
export const ReturnPrimeWebhookPayloadSchema = z.object({
    request: RawRequestSchema,
}).transform((raw): ReturnPrimeWebhookPayload => {
    const req = raw.request;

    // Extract first AWB from any line item's shipping array
    let shipping: ReturnPrimeShipping | undefined;
    for (const li of req.line_items) {
        const shipEntry = li.shipping?.find(s => s.awb);
        if (shipEntry) {
            shipping = {
                awb_number: shipEntry.awb ?? undefined,
                courier: shipEntry.shipping_company ?? undefined,
            };
            break;
        }
    }

    // Collect unique reasons from line items (RP puts reason per-line)
    const reasons = req.line_items
        .map(li => li.reason)
        .filter((r): r is string => !!r);
    const reason = reasons.length > 0 ? reasons[0] : undefined;

    // Extract reason_details from first line item that has one
    const reasonDetails = req.line_items
        .map(li => li.reason_detail)
        .find((r): r is string => !!r);

    // Extract rejection reason from reject object
    const rejectionReason = req.reject?.comment ?? undefined;

    return {
        id: req.id,
        request_number: req.request_number,
        request_type: req.request_type,
        status: req.status,
        reason,
        reason_details: reasonDetails,
        rejection_reason: rejectionReason,
        created_at: req.created_at,
        updated_at: req.updated_at,
        order: req.order ? {
            shopify_order_id: String(req.order.id),
            order_name: req.order.name,
        } : undefined,
        customer: req.customer ? {
            email: req.customer.email,
            phone: req.customer.phone,
            name: req.customer.name,
            ...(req.customer.bank?.account_number ? {
                bank: {
                    account_holder_name: req.customer.bank.account_holder_name ?? undefined,
                    account_number: req.customer.bank.account_number ?? undefined,
                    ifsc_code: req.customer.bank.ifsc_code ?? undefined,
                },
            } : {}),
        } : undefined,
        line_items: req.line_items.map(li => ({
            id: String(li.id),
            shopify_line_id: String(li.id),
            sku: li.original_product?.sku ?? undefined,
            quantity: li.quantity,
            price: li.original_product?.price ?? undefined,
            reason: li.reason ?? undefined,
            reason_detail: li.reason_detail ?? undefined,
            customer_comment: li.customer_comment ?? undefined,
            inspection_notes: li.inspection_notes ?? undefined,
            return_fee: li.return_fee?.price_set?.shop_money?.amount ?? undefined,
            exchange_product: li.exchange_product ? {
                title: li.exchange_product.title ?? undefined,
                variant_title: li.exchange_product.variant_title ?? undefined,
                sku: li.exchange_product.sku ?? undefined,
                price: li.exchange_product.price ?? undefined,
                product_id: li.exchange_product.product_id ?? undefined,
                variant_id: li.exchange_product.variant_id ?? undefined,
            } : undefined,
        })),
        shipping,
        refund: req.refund ? {
            id: req.refund.id,
            amount: req.refund.amount,
            transaction_id: req.refund.transaction_id,
            method: req.refund.method,
            requested_mode: req.refund.requested_mode ?? undefined,
            actual_mode: req.refund.actual_mode ?? undefined,
            eligible_amount: req.refund.eligible_refund_amount?.shop_money?.amount ?? undefined,
            refunded_amount: req.refund.refunded_amount?.shop_money?.amount ?? undefined,
        } : undefined,
        exchange: req.exchange?.order ? {
            shopify_order_id: req.exchange.order.id != null ? String(req.exchange.order.id) : undefined,
            order_name: req.exchange.order.name,
            type: req.exchange.order.type,
            total_price: req.exchange.order.total_price?.shop_money?.amount,
        } : undefined,
        payment_details: req.payment_details ? {
            transaction_id: req.payment_details.transaction_id ?? undefined,
            amount: req.payment_details.amount ?? undefined,
            currency: req.payment_details.currency ?? undefined,
            gateway: req.payment_details.gateway ?? undefined,
            status: req.payment_details.status ?? undefined,
        } : undefined,
    };
});

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
    reason_detail: z.string().nullable().optional(),
    customer_comment: z.string().nullable().optional(),
    inspection_notes: z.string().nullable().optional(),
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
    notes: z.string().nullable().optional(),
    customer_comment: z.string().nullable().optional(),
    inspection_notes: z.string().nullable().optional(),

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
