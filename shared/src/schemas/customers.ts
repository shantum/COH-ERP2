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

export const recentOrderSchema = z.object({
    id: z.string(),
    orderNumber: z.string(),
    totalAmount: z.number().nullable(),
    status: z.string(),
    orderDate: z.coerce.date(),
});

export type RecentOrder = z.infer<typeof recentOrderSchema>;

export const customerDetailResultSchema = z.object({
    id: z.string(),
    email: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    phone: z.string().nullable(),
    tier: z.string(),
    tags: z.string().nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    ordersCount: z.number(),
    recentOrders: z.array(recentOrderSchema),
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
