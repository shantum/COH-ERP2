/**
 * Products Zod Schemas
 *
 * Defines strict output types for product queries.
 * These schemas validate query results at runtime to catch schema drift.
 */
import { z } from 'zod';
export declare const skuRowSchema: z.ZodObject<{
    id: z.ZodString;
    skuCode: z.ZodString;
    size: z.ZodString;
    mrp: z.ZodNumber;
    isActive: z.ZodBoolean;
    fabricConsumption: z.ZodNumber;
    targetStockQty: z.ZodNumber;
}, z.core.$strip>;
export type SkuRow = z.infer<typeof skuRowSchema>;
export declare const fabricInfoSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    colorName: z.ZodString;
}, z.core.$strip>;
export declare const variationRowSchema: z.ZodObject<{
    id: z.ZodString;
    colorName: z.ZodString;
    standardColor: z.ZodNullable<z.ZodString>;
    colorHex: z.ZodNullable<z.ZodString>;
    imageUrl: z.ZodNullable<z.ZodString>;
    isActive: z.ZodBoolean;
    fabricId: z.ZodString;
    fabric: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        colorName: z.ZodString;
    }, z.core.$strip>>;
    skus: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        skuCode: z.ZodString;
        size: z.ZodString;
        mrp: z.ZodNumber;
        isActive: z.ZodBoolean;
        fabricConsumption: z.ZodNumber;
        targetStockQty: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type VariationRow = z.infer<typeof variationRowSchema>;
export declare const fabricTypeInfoSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
}, z.core.$strip>;
export declare const productWithVariationsSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    styleCode: z.ZodNullable<z.ZodString>;
    category: z.ZodString;
    productType: z.ZodString;
    gender: z.ZodString;
    imageUrl: z.ZodNullable<z.ZodString>;
    isActive: z.ZodBoolean;
    createdAt: z.ZodCoercedDate<unknown>;
    fabricType: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
    }, z.core.$strip>>;
    variations: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        colorName: z.ZodString;
        standardColor: z.ZodNullable<z.ZodString>;
        colorHex: z.ZodNullable<z.ZodString>;
        imageUrl: z.ZodNullable<z.ZodString>;
        isActive: z.ZodBoolean;
        fabricId: z.ZodString;
        fabric: z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            colorName: z.ZodString;
        }, z.core.$strip>>;
        skus: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            skuCode: z.ZodString;
            size: z.ZodString;
            mrp: z.ZodNumber;
            isActive: z.ZodBoolean;
            fabricConsumption: z.ZodNumber;
            targetStockQty: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ProductWithVariations = z.infer<typeof productWithVariationsSchema>;
export declare const productsListResultSchema: z.ZodObject<{
    products: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        styleCode: z.ZodNullable<z.ZodString>;
        category: z.ZodString;
        productType: z.ZodString;
        gender: z.ZodString;
        imageUrl: z.ZodNullable<z.ZodString>;
        isActive: z.ZodBoolean;
        createdAt: z.ZodCoercedDate<unknown>;
        fabricType: z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
        }, z.core.$strip>>;
        variations: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            colorName: z.ZodString;
            standardColor: z.ZodNullable<z.ZodString>;
            colorHex: z.ZodNullable<z.ZodString>;
            imageUrl: z.ZodNullable<z.ZodString>;
            isActive: z.ZodBoolean;
            fabricId: z.ZodString;
            fabric: z.ZodNullable<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                colorName: z.ZodString;
            }, z.core.$strip>>;
            skus: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                skuCode: z.ZodString;
                size: z.ZodString;
                mrp: z.ZodNumber;
                isActive: z.ZodBoolean;
                fabricConsumption: z.ZodNumber;
                targetStockQty: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    pagination: z.ZodObject<{
        page: z.ZodNumber;
        limit: z.ZodNumber;
        total: z.ZodNumber;
        totalPages: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export type ProductsListResult = z.infer<typeof productsListResultSchema>;
//# sourceMappingURL=products.d.ts.map