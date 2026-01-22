/**
 * Production Zod Schemas
 *
 * Defines strict output types for production queries.
 * These schemas validate query results at runtime to catch schema drift.
 */
import { z } from 'zod';
// ============================================
// TAILOR SCHEMAS
// ============================================
export const tailorRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    specializations: z.string().nullable(),
    dailyCapacityMins: z.number(),
    isActive: z.boolean(),
});
// ============================================
// BATCH SCHEMAS
// ============================================
export const batchRowSchema = z.object({
    id: z.string(),
    batchCode: z.string().nullable(),
    batchDate: z.coerce.date(),
    status: z.string(),
    qtyPlanned: z.number(),
    qtyCompleted: z.number(),
    priority: z.string(),
    notes: z.string().nullable(),
    sourceOrderLineId: z.string().nullable(),
    sampleCode: z.string().nullable(),
    sampleName: z.string().nullable(),
    sampleColour: z.string().nullable(),
    sampleSize: z.string().nullable(),
    tailorId: z.string().nullable(),
    tailorName: z.string().nullable(),
    skuId: z.string().nullable(),
    skuCode: z.string().nullable(),
    skuSize: z.string().nullable(),
    isCustomSku: z.boolean(),
    customizationType: z.string().nullable(),
    customizationValue: z.string().nullable(),
    customizationNotes: z.string().nullable(),
    variationId: z.string().nullable(),
    colorName: z.string().nullable(),
    productId: z.string().nullable(),
    productName: z.string().nullable(),
    fabricId: z.string().nullable(),
    fabricName: z.string().nullable(),
});
export const batchOrderLineRowSchema = z.object({
    batchId: z.string(),
    orderLineId: z.string(),
    orderId: z.string(),
    orderNumber: z.string(),
    customerName: z.string(),
});
// ============================================
// CAPACITY SCHEMAS
// ============================================
export const capacityRowSchema = z.object({
    tailorId: z.string(),
    tailorName: z.string(),
    dailyCapacityMins: z.number(),
    allocatedMins: z.number(),
    availableMins: z.number(),
    utilizationPct: z.string(),
});
// ============================================
// PENDING BY SKU SCHEMAS
// ============================================
export const pendingBatchSchema = z.object({
    id: z.string(),
    batchCode: z.string().nullable(),
    batchDate: z.coerce.date(),
    qtyPlanned: z.number(),
    qtyCompleted: z.number(),
    qtyPending: z.number(),
    status: z.string(),
    tailor: z.object({
        id: z.string(),
        name: z.string().nullable(),
    }).nullable(),
});
export const pendingBySkuResultSchema = z.object({
    batches: z.array(pendingBatchSchema),
    totalPending: z.number(),
});
// ============================================
// ARRAY SCHEMAS FOR VALIDATION
// ============================================
export const tailorRowArraySchema = z.array(tailorRowSchema);
export const batchRowArraySchema = z.array(batchRowSchema);
export const batchOrderLineRowArraySchema = z.array(batchOrderLineRowSchema);
export const capacityRowArraySchema = z.array(capacityRowSchema);
//# sourceMappingURL=production.js.map