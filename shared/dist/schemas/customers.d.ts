/**
 * Customers Zod Schemas
 *
 * Defines strict output types for customer queries.
 * These schemas validate query results at runtime to catch schema drift.
 */
import { z } from 'zod';
export declare const customerListItemSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    firstName: z.ZodNullable<z.ZodString>;
    lastName: z.ZodNullable<z.ZodString>;
    phone: z.ZodNullable<z.ZodString>;
    totalOrders: z.ZodNumber;
    lifetimeValue: z.ZodNumber;
    customerTier: z.ZodEnum<{
        new: "new";
        bronze: "bronze";
        silver: "silver";
        gold: "gold";
        platinum: "platinum";
    }>;
    createdAt: z.ZodCoercedDate<unknown>;
}, z.core.$strip>;
export type CustomerListItem = z.infer<typeof customerListItemSchema>;
export declare const customersListResultSchema: z.ZodObject<{
    customers: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        email: z.ZodString;
        firstName: z.ZodNullable<z.ZodString>;
        lastName: z.ZodNullable<z.ZodString>;
        phone: z.ZodNullable<z.ZodString>;
        totalOrders: z.ZodNumber;
        lifetimeValue: z.ZodNumber;
        customerTier: z.ZodEnum<{
            new: "new";
            bronze: "bronze";
            silver: "silver";
            gold: "gold";
            platinum: "platinum";
        }>;
        createdAt: z.ZodCoercedDate<unknown>;
    }, z.core.$strip>>;
    pagination: z.ZodObject<{
        total: z.ZodNumber;
        limit: z.ZodNumber;
        offset: z.ZodNumber;
        hasMore: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>;
export type CustomersListResult = z.infer<typeof customersListResultSchema>;
export declare const recentOrderSchema: z.ZodObject<{
    id: z.ZodString;
    orderNumber: z.ZodString;
    totalAmount: z.ZodNullable<z.ZodNumber>;
    status: z.ZodString;
    orderDate: z.ZodCoercedDate<unknown>;
}, z.core.$strip>;
export type RecentOrder = z.infer<typeof recentOrderSchema>;
export declare const customerDetailResultSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    firstName: z.ZodNullable<z.ZodString>;
    lastName: z.ZodNullable<z.ZodString>;
    phone: z.ZodNullable<z.ZodString>;
    tier: z.ZodString;
    tags: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodCoercedDate<unknown>;
    updatedAt: z.ZodCoercedDate<unknown>;
    ordersCount: z.ZodNumber;
    recentOrders: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        orderNumber: z.ZodString;
        totalAmount: z.ZodNullable<z.ZodNumber>;
        status: z.ZodString;
        orderDate: z.ZodCoercedDate<unknown>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type CustomerDetailResult = z.infer<typeof customerDetailResultSchema>;
export declare const customerStatsResultSchema: z.ZodObject<{
    customerId: z.ZodString;
    lifetimeValue: z.ZodNumber;
    orderCount: z.ZodNumber;
    avgOrderValue: z.ZodNumber;
    rtoCount: z.ZodNumber;
    rtoRate: z.ZodNumber;
    returns: z.ZodNumber;
    exchanges: z.ZodNumber;
    returnRate: z.ZodNumber;
    tier: z.ZodEnum<{
        new: "new";
        bronze: "bronze";
        silver: "silver";
        gold: "gold";
        platinum: "platinum";
    }>;
    firstOrderDate: z.ZodNullable<z.ZodCoercedDate<unknown>>;
    lastOrderDate: z.ZodNullable<z.ZodCoercedDate<unknown>>;
}, z.core.$strip>;
export type CustomerStatsResult = z.infer<typeof customerStatsResultSchema>;
//# sourceMappingURL=customers.d.ts.map