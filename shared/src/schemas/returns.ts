/**
 * Returns Zod Schemas
 *
 * Defines strict output types for return queries.
 * These schemas validate query results at runtime to catch schema drift.
 */

import { z } from 'zod';

// ============================================
// RETURN LINE SCHEMAS
// ============================================

export const returnLineRowSchema = z.object({
    id: z.string(),
    requestId: z.string(),
    skuId: z.string(),
    skuCode: z.string(),
    skuSize: z.string(),
    qty: z.number(),
    reason: z.string().nullable(),
    itemCondition: z.string().nullable(),
    productId: z.string().nullable(),
    productName: z.string().nullable(),
    colorName: z.string().nullable(),
});

export type ReturnLineRow = z.infer<typeof returnLineRowSchema>;

// ============================================
// RETURN LIST SCHEMAS
// ============================================

export const returnListRowSchema = z.object({
    id: z.string(),
    requestNumber: z.string(),
    requestType: z.string(),
    status: z.string(),
    reason: z.string().nullable(),
    customerNotes: z.string().nullable(),
    createdAt: z.coerce.date(),
    orderId: z.string().nullable(),
    orderNumber: z.string().nullable(),
    orderDate: z.coerce.date().nullable(),
    customerId: z.string().nullable(),
    customerFirstName: z.string().nullable(),
    customerLastName: z.string().nullable(),
    customerEmail: z.string().nullable(),
});

export type ReturnListRow = z.infer<typeof returnListRowSchema>;

export const returnWithLinesSchema = returnListRowSchema.extend({
    lines: z.array(returnLineRowSchema),
});

export type ReturnWithLines = z.infer<typeof returnWithLinesSchema>;

export const returnsListResultSchema = z.object({
    items: z.array(returnWithLinesSchema),
    pagination: z.object({
        page: z.number(),
        limit: z.number(),
        total: z.number(),
        totalPages: z.number(),
    }),
});

export type ReturnsListResult = z.infer<typeof returnsListResultSchema>;

// ============================================
// RETURN DETAIL SCHEMAS
// ============================================

export const returnDetailLineSchema = z.object({
    id: z.string(),
    skuId: z.string(),
    skuCode: z.string(),
    size: z.string(),
    qty: z.number(),
    reason: z.string().nullable(),
    itemCondition: z.string().nullable(),
    processingAction: z.string().nullable(),
    sku: z.object({
        id: z.string(),
        skuCode: z.string(),
        size: z.string(),
        variation: z.object({
            colorName: z.string().nullable(),
            product: z.object({
                id: z.string().nullable(),
                name: z.string().nullable(),
                imageUrl: z.string().nullable(),
            }),
        }),
    }),
    exchangeSku: z.object({
        id: z.string(),
        skuCode: z.string(),
        size: z.string(),
    }).nullable(),
});

export const returnStatusHistorySchema = z.object({
    id: z.string(),
    fromStatus: z.string().nullable(),
    toStatus: z.string(),
    notes: z.string().nullable(),
    createdAt: z.coerce.date(),
    changedBy: z.object({
        name: z.string(),
    }).nullable(),
});

export const returnDetailResultSchema = z.object({
    id: z.string(),
    requestNumber: z.string(),
    requestType: z.string(),
    status: z.string(),
    reason: z.string().nullable(),
    customerNotes: z.string().nullable(),
    resolutionNotes: z.string().nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    originalOrder: z.object({
        id: z.string(),
        orderNumber: z.string(),
        orderDate: z.coerce.date(),
        totalAmount: z.number().nullable(),
        shippingAddress: z.any().nullable(),
    }).nullable(),
    exchangeOrder: z.object({
        id: z.string(),
        orderNumber: z.string(),
        orderDate: z.coerce.date(),
    }).nullable(),
    customer: z.object({
        id: z.string(),
        firstName: z.string().nullable(),
        lastName: z.string().nullable(),
        email: z.string().nullable(),
        phone: z.string().nullable(),
    }).nullable(),
    shipping: z.object({
        id: z.string(),
        awbNumber: z.string().nullable(),
        courier: z.string().nullable(),
        status: z.string().nullable(),
    }).nullable(),
    lines: z.array(returnDetailLineSchema),
    statusHistory: z.array(returnStatusHistorySchema),
});

export type ReturnDetailResult = z.infer<typeof returnDetailResultSchema>;

// ============================================
// LINE-LEVEL RETURN SCHEMAS (NEW)
// ============================================

/**
 * Return status values for line-level returns
 */
export const LineReturnStatusSchema = z.enum([
    'requested',
    'pickup_scheduled',
    'in_transit',
    'received',
    'complete',
    'cancelled',
]);
export type LineReturnStatus = z.infer<typeof LineReturnStatusSchema>;

/**
 * Return reason categories
 */
export const ReturnReasonCategorySchema = z.enum([
    'fit_size',
    'product_quality',
    'product_different',
    'wrong_item_sent',
    'damaged_in_transit',
    'changed_mind',
    'other',
]);
export type ReturnReasonCategory = z.infer<typeof ReturnReasonCategorySchema>;

/**
 * Item condition on return receipt
 */
export const ReturnConditionSchema = z.enum([
    'good',
    'damaged',
    'defective',
    'wrong_item',
    'used',
]);
export type ReturnCondition = z.infer<typeof ReturnConditionSchema>;

/**
 * Return resolution types
 */
export const ReturnResolutionSchema = z.enum([
    'refund',
    'exchange',
    'rejected',
]);
export type ReturnResolution = z.infer<typeof ReturnResolutionSchema>;

/**
 * Pickup type for returns
 */
export const ReturnPickupTypeSchema = z.enum([
    'arranged_by_us',
    'customer_shipped',
]);
export type ReturnPickupType = z.infer<typeof ReturnPickupTypeSchema>;

/**
 * Refund method for returns
 */
export const ReturnRefundMethodSchema = z.enum([
    'payment_link',
    'bank_transfer',
    'store_credit',
]);
export type ReturnRefundMethod = z.infer<typeof ReturnRefundMethodSchema>;

// ============================================
// MUTATION INPUT SCHEMAS
// ============================================

/**
 * Input for initiating a return on an order line
 */
export const InitiateReturnInputSchema = z.object({
    orderLineId: z.string().uuid(),
    returnQty: z.number().int().positive(),
    returnReasonCategory: ReturnReasonCategorySchema,
    returnReasonDetail: z.string().optional(),
    returnResolution: ReturnResolutionSchema,
    returnNotes: z.string().optional(),
    // For exchange resolution
    exchangeSkuId: z.string().uuid().optional(),
});
export type InitiateReturnInput = z.infer<typeof InitiateReturnInputSchema>;

/**
 * Input for scheduling return pickup
 */
export const ScheduleReturnPickupInputSchema = z.object({
    orderLineId: z.string().uuid(),
    pickupType: ReturnPickupTypeSchema,
    courier: z.string().optional(),
    awbNumber: z.string().optional(),
    scheduledAt: z.coerce.date().optional(),
});
export type ScheduleReturnPickupInput = z.infer<typeof ScheduleReturnPickupInputSchema>;

/**
 * Input for marking return in transit
 */
export const MarkReturnInTransitInputSchema = z.object({
    orderLineId: z.string().uuid(),
    awbNumber: z.string().optional(),
    courier: z.string().optional(),
});
export type MarkReturnInTransitInput = z.infer<typeof MarkReturnInTransitInputSchema>;

/**
 * Input for receiving a return at warehouse
 */
export const ReceiveReturnInputSchema = z.object({
    orderLineId: z.string().uuid(),
    condition: ReturnConditionSchema,
    conditionNotes: z.string().optional(),
});
export type ReceiveReturnInput = z.infer<typeof ReceiveReturnInputSchema>;

/**
 * Input for calculating return refund
 */
export const CalculateReturnRefundInputSchema = z.object({
    orderLineId: z.string().uuid(),
});
export type CalculateReturnRefundInput = z.infer<typeof CalculateReturnRefundInputSchema>;

/**
 * Input for processing return refund
 */
export const ProcessReturnRefundInputSchema = z.object({
    orderLineId: z.string().uuid(),
    grossAmount: z.number(),
    discountClawback: z.number().default(0),
    deductions: z.number().default(0),
    deductionNotes: z.string().optional(),
    refundMethod: ReturnRefundMethodSchema.optional(),
});
export type ProcessReturnRefundInput = z.infer<typeof ProcessReturnRefundInputSchema>;

/**
 * Input for completing a return
 */
export const CompleteReturnInputSchema = z.object({
    orderLineId: z.string().uuid(),
});
export type CompleteReturnInput = z.infer<typeof CompleteReturnInputSchema>;

/**
 * Input for cancelling a return
 */
export const CancelReturnInputSchema = z.object({
    orderLineId: z.string().uuid(),
    reason: z.string().optional(),
});
export type CancelReturnInput = z.infer<typeof CancelReturnInputSchema>;

/**
 * Input for manually closing a return
 */
export const CloseReturnManuallyInputSchema = z.object({
    orderLineId: z.string().uuid(),
    reason: z.string(),
});
export type CloseReturnManuallyInput = z.infer<typeof CloseReturnManuallyInputSchema>;

/**
 * Input for creating an exchange order
 */
export const CreateExchangeOrderInputSchema = z.object({
    orderLineId: z.string().uuid(),
    exchangeSkuId: z.string().uuid(),
    exchangeQty: z.number().int().positive(),
});
export type CreateExchangeOrderInput = z.infer<typeof CreateExchangeOrderInputSchema>;

// ============================================
// QUERY RESULT SCHEMAS
// ============================================

/**
 * Line eligibility for return (computed per line)
 */
export const ReturnEligibilitySchema = z.object({
    eligible: z.boolean(),
    reason: z.string().optional(), // 'within_window', 'expired', 'non_returnable', 'already_returned', etc.
    daysRemaining: z.number().nullable(),
    windowExpiringSoon: z.boolean(),
    warning: z.string().optional(), // Soft warnings (product non-returnable, window expired) - allow with caution
});
export type ReturnEligibility = z.infer<typeof ReturnEligibilitySchema>;

/**
 * Order line with return eligibility for initiating returns
 */
export const OrderLineForReturnSchema = z.object({
    id: z.string(),
    orderId: z.string(),
    skuId: z.string(),
    skuCode: z.string(),
    size: z.string(),
    qty: z.number(),
    unitPrice: z.number(),
    lineStatus: z.string(),
    deliveredAt: z.coerce.date().nullable(),
    // Return state
    returnStatus: z.string().nullable(),
    returnQty: z.number().nullable(),
    // Eligibility
    eligibility: ReturnEligibilitySchema,
    // Product info
    productId: z.string().nullable(),
    productName: z.string().nullable(),
    colorName: z.string().nullable(),
    imageUrl: z.string().nullable(),
    isReturnable: z.boolean(),
    nonReturnableReason: z.string().nullable(),
});
export type OrderLineForReturn = z.infer<typeof OrderLineForReturnSchema>;

/**
 * Order with lines for return initiation
 */
export const OrderForReturnSchema = z.object({
    id: z.string(),
    orderNumber: z.string(),
    orderDate: z.coerce.date(),
    totalAmount: z.number(),
    customerName: z.string(),
    customerEmail: z.string().nullable(),
    customerPhone: z.string().nullable(),
    shippingAddress: z.string().nullable(),
    lines: z.array(OrderLineForReturnSchema),
});
export type OrderForReturn = z.infer<typeof OrderForReturnSchema>;

/**
 * Active return (line-level) for returns dashboard
 */
export const ActiveReturnLineSchema = z.object({
    // Line info
    id: z.string(),
    orderId: z.string(),
    orderNumber: z.string(),
    skuId: z.string(),
    skuCode: z.string(),
    size: z.string(),
    qty: z.number(),
    unitPrice: z.number(),
    // Return info
    returnStatus: z.string(),
    returnQty: z.number(),
    returnRequestedAt: z.coerce.date().nullable(),
    returnReasonCategory: z.string().nullable(),
    returnReasonDetail: z.string().nullable(),
    returnResolution: z.string().nullable(),
    returnPickupType: z.string().nullable(),
    returnAwbNumber: z.string().nullable(),
    returnCourier: z.string().nullable(),
    returnPickupScheduledAt: z.coerce.date().nullable(),
    returnReceivedAt: z.coerce.date().nullable(),
    returnCondition: z.string().nullable(),
    returnExchangeOrderId: z.string().nullable(),
    // Customer info
    customerId: z.string().nullable(),
    customerName: z.string(),
    customerEmail: z.string().nullable(),
    customerPhone: z.string().nullable(),
    // Product info
    productId: z.string().nullable(),
    productName: z.string().nullable(),
    colorName: z.string().nullable(),
    imageUrl: z.string().nullable(),
});
export type ActiveReturnLine = z.infer<typeof ActiveReturnLineSchema>;

/**
 * Return action queue item (line needing action)
 */
export const ReturnActionQueueItemSchema = ActiveReturnLineSchema.extend({
    actionNeeded: z.enum([
        'schedule_pickup',
        'receive',
        'process_refund',
        'create_exchange',
        'complete',
    ]),
    daysSinceRequest: z.number(),
});
export type ReturnActionQueueItem = z.infer<typeof ReturnActionQueueItemSchema>;

/**
 * Refund calculation result
 */
export const RefundCalculationResultSchema = z.object({
    orderLineId: z.string(),
    lineTotal: z.number(),
    returnQty: z.number(),
    grossAmount: z.number(),
    discountClawback: z.number(),
    suggestedDeductions: z.number(),
    netAmount: z.number(),
    notes: z.string().optional(),
});
export type RefundCalculationResult = z.infer<typeof RefundCalculationResultSchema>;
