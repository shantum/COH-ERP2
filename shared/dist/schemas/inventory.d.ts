/**
 * Inventory Zod Schemas
 *
 * Defines strict output types for inventory queries.
 * These schemas validate query results at runtime to catch schema drift.
 */
import { z } from 'zod';
export declare const inventorySkuRowSchema: z.ZodObject<{
    skuId: z.ZodString;
    skuCode: z.ZodString;
    size: z.ZodString;
    mrp: z.ZodNumber;
    targetStockQty: z.ZodNumber;
    isCustomSku: z.ZodBoolean;
    variationId: z.ZodString;
    colorName: z.ZodString;
    variationImageUrl: z.ZodNullable<z.ZodString>;
    productId: z.ZodString;
    productName: z.ZodString;
    productType: z.ZodString;
    gender: z.ZodString;
    category: z.ZodString;
    productImageUrl: z.ZodNullable<z.ZodString>;
    fabricId: z.ZodString;
    fabricName: z.ZodNullable<z.ZodString>;
    shopifyAvailableQty: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export type InventorySkuRow = z.infer<typeof inventorySkuRowSchema>;
export declare const inventorySkuRowArraySchema: z.ZodArray<z.ZodObject<{
    skuId: z.ZodString;
    skuCode: z.ZodString;
    size: z.ZodString;
    mrp: z.ZodNumber;
    targetStockQty: z.ZodNumber;
    isCustomSku: z.ZodBoolean;
    variationId: z.ZodString;
    colorName: z.ZodString;
    variationImageUrl: z.ZodNullable<z.ZodString>;
    productId: z.ZodString;
    productName: z.ZodString;
    productType: z.ZodString;
    gender: z.ZodString;
    category: z.ZodString;
    productImageUrl: z.ZodNullable<z.ZodString>;
    fabricId: z.ZodString;
    fabricName: z.ZodNullable<z.ZodString>;
    shopifyAvailableQty: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>>;
export declare const inventoryBalanceSchema: z.ZodObject<{
    totalInward: z.ZodNumber;
    totalOutward: z.ZodNumber;
    currentBalance: z.ZodNumber;
}, z.core.$strip>;
export type InventoryBalanceRow = z.infer<typeof inventoryBalanceSchema>;
//# sourceMappingURL=inventory.d.ts.map