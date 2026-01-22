/**
 * Inventory Zod Schemas
 *
 * Defines strict output types for inventory queries.
 * These schemas validate query results at runtime to catch schema drift.
 */
import { z } from 'zod';
// ============================================
// SKU ROW SCHEMAS
// ============================================
export const inventorySkuRowSchema = z.object({
    skuId: z.string(),
    skuCode: z.string(),
    size: z.string(),
    mrp: z.number(),
    targetStockQty: z.number(),
    isCustomSku: z.boolean(),
    variationId: z.string(),
    colorName: z.string(),
    variationImageUrl: z.string().nullable(),
    productId: z.string(),
    productName: z.string(),
    productType: z.string(),
    gender: z.string(),
    category: z.string(),
    productImageUrl: z.string().nullable(),
    fabricId: z.string(),
    fabricName: z.string().nullable(),
    shopifyAvailableQty: z.number().nullable(),
});
export const inventorySkuRowArraySchema = z.array(inventorySkuRowSchema);
// ============================================
// BALANCE SCHEMAS
// ============================================
// Note: Named differently from types/index.ts InventoryBalance to avoid collision
export const inventoryBalanceSchema = z.object({
    totalInward: z.number(),
    totalOutward: z.number(),
    currentBalance: z.number(),
});
//# sourceMappingURL=inventory.js.map