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
