/**
 * Production Zod Schemas
 *
 * Defines strict output types for production queries.
 * These schemas validate query results at runtime to catch schema drift.
 */
import { z } from 'zod';
export declare const tailorRowSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    specializations: z.ZodNullable<z.ZodString>;
    dailyCapacityMins: z.ZodNumber;
    isActive: z.ZodBoolean;
}, z.core.$strip>;
export type TailorRow = z.infer<typeof tailorRowSchema>;
export declare const batchRowSchema: z.ZodObject<{
    id: z.ZodString;
    batchCode: z.ZodNullable<z.ZodString>;
    batchDate: z.ZodCoercedDate<unknown>;
    status: z.ZodString;
    qtyPlanned: z.ZodNumber;
    qtyCompleted: z.ZodNumber;
    priority: z.ZodString;
    notes: z.ZodNullable<z.ZodString>;
    sourceOrderLineId: z.ZodNullable<z.ZodString>;
    sampleCode: z.ZodNullable<z.ZodString>;
    sampleName: z.ZodNullable<z.ZodString>;
    sampleColour: z.ZodNullable<z.ZodString>;
    sampleSize: z.ZodNullable<z.ZodString>;
    tailorId: z.ZodNullable<z.ZodString>;
    tailorName: z.ZodNullable<z.ZodString>;
    skuId: z.ZodNullable<z.ZodString>;
    skuCode: z.ZodNullable<z.ZodString>;
    skuSize: z.ZodNullable<z.ZodString>;
    isCustomSku: z.ZodBoolean;
    customizationType: z.ZodNullable<z.ZodString>;
    customizationValue: z.ZodNullable<z.ZodString>;
    customizationNotes: z.ZodNullable<z.ZodString>;
    variationId: z.ZodNullable<z.ZodString>;
    colorName: z.ZodNullable<z.ZodString>;
    productId: z.ZodNullable<z.ZodString>;
    productName: z.ZodNullable<z.ZodString>;
    fabricId: z.ZodNullable<z.ZodString>;
    fabricName: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type BatchRow = z.infer<typeof batchRowSchema>;
export declare const batchOrderLineRowSchema: z.ZodObject<{
    batchId: z.ZodString;
    orderLineId: z.ZodString;
    orderId: z.ZodString;
    orderNumber: z.ZodString;
    customerName: z.ZodString;
}, z.core.$strip>;
export type BatchOrderLineRow = z.infer<typeof batchOrderLineRowSchema>;
export declare const capacityRowSchema: z.ZodObject<{
    tailorId: z.ZodString;
    tailorName: z.ZodString;
    dailyCapacityMins: z.ZodNumber;
    allocatedMins: z.ZodNumber;
    availableMins: z.ZodNumber;
    utilizationPct: z.ZodString;
}, z.core.$strip>;
export type CapacityRow = z.infer<typeof capacityRowSchema>;
export declare const pendingBatchSchema: z.ZodObject<{
    id: z.ZodString;
    batchCode: z.ZodNullable<z.ZodString>;
    batchDate: z.ZodCoercedDate<unknown>;
    qtyPlanned: z.ZodNumber;
    qtyCompleted: z.ZodNumber;
    qtyPending: z.ZodNumber;
    status: z.ZodString;
    tailor: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const pendingBySkuResultSchema: z.ZodObject<{
    batches: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        batchCode: z.ZodNullable<z.ZodString>;
        batchDate: z.ZodCoercedDate<unknown>;
        qtyPlanned: z.ZodNumber;
        qtyCompleted: z.ZodNumber;
        qtyPending: z.ZodNumber;
        status: z.ZodString;
        tailor: z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    totalPending: z.ZodNumber;
}, z.core.$strip>;
export type PendingBySkuResult = z.infer<typeof pendingBySkuResultSchema>;
export declare const tailorRowArraySchema: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    specializations: z.ZodNullable<z.ZodString>;
    dailyCapacityMins: z.ZodNumber;
    isActive: z.ZodBoolean;
}, z.core.$strip>>;
export declare const batchRowArraySchema: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    batchCode: z.ZodNullable<z.ZodString>;
    batchDate: z.ZodCoercedDate<unknown>;
    status: z.ZodString;
    qtyPlanned: z.ZodNumber;
    qtyCompleted: z.ZodNumber;
    priority: z.ZodString;
    notes: z.ZodNullable<z.ZodString>;
    sourceOrderLineId: z.ZodNullable<z.ZodString>;
    sampleCode: z.ZodNullable<z.ZodString>;
    sampleName: z.ZodNullable<z.ZodString>;
    sampleColour: z.ZodNullable<z.ZodString>;
    sampleSize: z.ZodNullable<z.ZodString>;
    tailorId: z.ZodNullable<z.ZodString>;
    tailorName: z.ZodNullable<z.ZodString>;
    skuId: z.ZodNullable<z.ZodString>;
    skuCode: z.ZodNullable<z.ZodString>;
    skuSize: z.ZodNullable<z.ZodString>;
    isCustomSku: z.ZodBoolean;
    customizationType: z.ZodNullable<z.ZodString>;
    customizationValue: z.ZodNullable<z.ZodString>;
    customizationNotes: z.ZodNullable<z.ZodString>;
    variationId: z.ZodNullable<z.ZodString>;
    colorName: z.ZodNullable<z.ZodString>;
    productId: z.ZodNullable<z.ZodString>;
    productName: z.ZodNullable<z.ZodString>;
    fabricId: z.ZodNullable<z.ZodString>;
    fabricName: z.ZodNullable<z.ZodString>;
}, z.core.$strip>>;
export declare const batchOrderLineRowArraySchema: z.ZodArray<z.ZodObject<{
    batchId: z.ZodString;
    orderLineId: z.ZodString;
    orderId: z.ZodString;
    orderNumber: z.ZodString;
    customerName: z.ZodString;
}, z.core.$strip>>;
export declare const capacityRowArraySchema: z.ZodArray<z.ZodObject<{
    tailorId: z.ZodString;
    tailorName: z.ZodString;
    dailyCapacityMins: z.ZodNumber;
    allocatedMins: z.ZodNumber;
    availableMins: z.ZodNumber;
    utilizationPct: z.ZodString;
}, z.core.$strip>>;
//# sourceMappingURL=production.d.ts.map