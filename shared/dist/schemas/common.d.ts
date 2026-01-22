/**
 * Common Zod Schemas
 *
 * Base schemas used by other domain schemas.
 * This file should NOT import from index.ts to avoid circular dependencies.
 */
import { z } from 'zod';
export declare const uuidSchema: z.ZodString;
export declare const dateStringSchema: z.ZodString;
export declare const paginationSchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const sortOrderSchema: z.ZodEnum<{
    asc: "asc";
    desc: "desc";
}>;
export declare const orderStatusSchema: z.ZodEnum<{
    shipped: "shipped";
    delivered: "delivered";
    cancelled: "cancelled";
    pending: "pending";
    allocated: "allocated";
    picked: "picked";
    packed: "packed";
}>;
export declare const lineStatusSchema: z.ZodEnum<{
    shipped: "shipped";
    delivered: "delivered";
    cancelled: "cancelled";
    pending: "pending";
    allocated: "allocated";
    picked: "picked";
    packed: "packed";
}>;
export declare const paymentMethodSchema: z.ZodEnum<{
    cod: "cod";
    prepaid: "prepaid";
    credit: "credit";
}>;
export declare const customerTierSchema: z.ZodEnum<{
    new: "new";
    bronze: "bronze";
    silver: "silver";
    gold: "gold";
    platinum: "platinum";
}>;
export declare const transactionTypeSchema: z.ZodEnum<{
    inward: "inward";
    outward: "outward";
    reserved: "reserved";
    adjustment: "adjustment";
    unreserved: "unreserved";
}>;
//# sourceMappingURL=common.d.ts.map