/**
 * Customers Zod Schemas
 *
 * Defines strict output types for customer queries.
 * These schemas validate query results at runtime to catch schema drift.
 */

import { z } from 'zod';
import { customerTierSchema } from './common.js';

// ============================================
// LIST SCHEMAS
// ============================================

export const customerListItemSchema = z.object({
    id: z.string(),
    email: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    phone: z.string().nullable(),
    totalOrders: z.number(),
    lifetimeValue: z.number(),
    customerTier: customerTierSchema,
    createdAt: z.coerce.date(),
});

export type CustomerListItem = z.infer<typeof customerListItemSchema>;

export const customersListResultSchema = z.object({
    customers: z.array(customerListItemSchema),
    pagination: z.object({
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
        hasMore: z.boolean(),
    }),
});

export type CustomersListResult = z.infer<typeof customersListResultSchema>;

// ============================================
// DETAIL SCHEMAS
// ============================================

export const orderLineSchema = z.object({
    id: z.string(),
    qty: z.number(),
    unitPrice: z.number().nullable().optional(),
    lineStatus: z.string().nullable().optional(),
    returnStatus: z.string().nullable().optional(),
    returnReasonCategory: z.string().nullable().optional(),
    returnReasonDetail: z.string().nullable().optional(),
    returnResolution: z.string().nullable().optional(),
    returnCondition: z.string().nullable().optional(),
    rtoCondition: z.string().nullable().optional(),
    rtoInitiatedAt: z.coerce.date().nullable().optional(),
    notes: z.string().nullable().optional(),
    refundAmount: z.number().nullable().optional(),
    sku: z.object({
        size: z.string().nullable(),
        variation: z.object({
            colorName: z.string().nullable(),
            colorHex: z.string().nullable(),
            imageUrl: z.string().nullable(),
            product: z.object({
                name: z.string().nullable(),
                imageUrl: z.string().nullable(),
            }).nullable(),
            fabricColour: z.object({
                fabric: z.object({
                    name: z.string().nullable(),
                }).nullable(),
            }).nullable(),
        }).nullable(),
    }).nullable(),
});

export type OrderLineDetail = z.infer<typeof orderLineSchema>;

export const recentOrderSchema = z.object({
    id: z.string(),
    orderNumber: z.string(),
    totalAmount: z.number().nullable(),
    status: z.string(),
    orderDate: z.coerce.date(),
    internalNotes: z.string().nullable().optional(),
    paymentMethod: z.string().nullable().optional(),
    channel: z.string().nullable().optional(),
    isExchange: z.boolean().optional(),
    orderLines: z.array(orderLineSchema).optional(),
});

export type RecentOrder = z.infer<typeof recentOrderSchema>;

export const colorAffinitySchema = z.object({
    color: z.string(),
    hex: z.string().optional(),
    qty: z.number(),
});

export const productAffinitySchema = z.object({
    productName: z.string(),
    qty: z.number(),
});

export const fabricAffinitySchema = z.object({
    fabricType: z.string(),
    qty: z.number(),
});

export type ColorAffinity = z.infer<typeof colorAffinitySchema>;
export type ProductAffinity = z.infer<typeof productAffinitySchema>;
export type FabricAffinity = z.infer<typeof fabricAffinitySchema>;

// ============================================
// ANALYSIS SCHEMAS (computed server-side)
// ============================================

export const returnAnalysisSchema = z.object({
    reasonBreakdown: z.array(z.object({
        reason: z.string(),
        count: z.number(),
    })),
    resolutionBreakdown: z.array(z.object({
        resolution: z.string(),
        count: z.number(),
    })),
    rtoConditionBreakdown: z.array(z.object({
        condition: z.string(),
        count: z.number(),
    })),
    totalReturnedLines: z.number(),
    totalRtoLines: z.number(),
});

export type ReturnAnalysis = z.infer<typeof returnAnalysisSchema>;

export const revenueTimelineSchema = z.array(z.object({
    month: z.string(),
    revenue: z.number(),
    orders: z.number(),
}));

export type RevenueTimeline = z.infer<typeof revenueTimelineSchema>;

export const paymentBreakdownSchema = z.array(z.object({
    method: z.string(),
    count: z.number(),
    total: z.number(),
}));

export type PaymentBreakdown = z.infer<typeof paymentBreakdownSchema>;

// ============================================
// DETAIL RESULT
// ============================================

export const customerDetailResultSchema = z.object({
    id: z.string(),
    email: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    phone: z.string().nullable(),
    tier: z.string().nullable(),
    customerTier: z.string().nullable(),
    tags: z.string().nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    // Stats
    totalOrders: z.number(),
    lifetimeValue: z.number(),
    avgOrderValue: z.number(),
    returnRate: z.number(),
    returnCount: z.number(),
    exchangeCount: z.number(),
    rtoCount: z.number(),
    rtoOrderCount: z.number(),
    rtoValue: z.number(),
    storeCreditBalance: z.number(),
    firstOrderDate: z.coerce.date().nullable(),
    lastOrderDate: z.coerce.date().nullable(),
    acceptsMarketing: z.boolean(),
    defaultAddress: z.any().nullable(),
    // Style DNA
    colorAffinity: z.array(colorAffinitySchema).nullable(),
    productAffinity: z.array(productAffinitySchema).nullable(),
    fabricAffinity: z.array(fabricAffinitySchema).nullable(),
    // Orders with lines
    orders: z.array(recentOrderSchema).nullable(),
    // Analysis
    returnAnalysis: returnAnalysisSchema.nullable(),
    revenueTimeline: revenueTimelineSchema.nullable(),
    paymentBreakdown: paymentBreakdownSchema.nullable(),
    // Order notes (timeline of internal notes)
    orderNotes: z.array(z.object({
        orderNumber: z.string(),
        note: z.string(),
        orderDate: z.coerce.date(),
    })).nullable(),
});

export type CustomerDetailResult = z.infer<typeof customerDetailResultSchema>;

// ============================================
// STATS SCHEMAS
// ============================================

export const customerStatsResultSchema = z.object({
    customerId: z.string(),
    lifetimeValue: z.number(),
    orderCount: z.number(),
    avgOrderValue: z.number(),
    rtoCount: z.number(),
    rtoRate: z.number(),
    returns: z.number(),
    exchanges: z.number(),
    returnRate: z.number(),
    tier: customerTierSchema,
    firstOrderDate: z.coerce.date().nullable(),
    lastOrderDate: z.coerce.date().nullable(),
});

export type CustomerStatsResult = z.infer<typeof customerStatsResultSchema>;
