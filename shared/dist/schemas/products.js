/**
 * Products Zod Schemas
 *
 * Defines strict output types for product queries.
 * These schemas validate query results at runtime to catch schema drift.
 */
import { z } from 'zod';
// ============================================
// SKU SCHEMAS
// ============================================
export const skuRowSchema = z.object({
    id: z.string(),
    skuCode: z.string(),
    size: z.string(),
    mrp: z.number(),
    isActive: z.boolean(),
    fabricConsumption: z.number(),
    targetStockQty: z.number(),
});
// ============================================
// VARIATION SCHEMAS
// ============================================
export const fabricInfoSchema = z.object({
    id: z.string(),
    name: z.string(),
    colorName: z.string(),
});
export const variationRowSchema = z.object({
    id: z.string(),
    colorName: z.string(),
    standardColor: z.string().nullable(),
    colorHex: z.string().nullable(),
    imageUrl: z.string().nullable(),
    isActive: z.boolean(),
    fabricId: z.string(),
    fabric: fabricInfoSchema.nullable(),
    skus: z.array(skuRowSchema),
});
// ============================================
// PRODUCT SCHEMAS
// ============================================
export const fabricTypeInfoSchema = z.object({
    id: z.string(),
    name: z.string(),
});
export const productWithVariationsSchema = z.object({
    id: z.string(),
    name: z.string(),
    styleCode: z.string().nullable(),
    category: z.string(),
    productType: z.string(),
    gender: z.string(),
    imageUrl: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.coerce.date(),
    fabricType: fabricTypeInfoSchema.nullable(),
    variations: z.array(variationRowSchema),
});
// ============================================
// LIST RESULT SCHEMAS
// ============================================
export const productsListResultSchema = z.object({
    products: z.array(productWithVariationsSchema),
    pagination: z.object({
        page: z.number(),
        limit: z.number(),
        total: z.number(),
        totalPages: z.number(),
    }),
});
//# sourceMappingURL=products.js.map