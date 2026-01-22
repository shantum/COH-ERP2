/**
 * Reconciliation Zod Schemas
 *
 * Defines strict output types for reconciliation queries.
 * These schemas validate query results at runtime to catch schema drift.
 */
import { z } from 'zod';
export declare const reconciliationHistoryRowSchema: z.ZodObject<{
    id: z.ZodString;
    date: z.ZodCoercedDate<unknown>;
    status: z.ZodString;
    itemsCount: z.ZodNumber;
    adjustments: z.ZodNumber;
    createdBy: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodCoercedDate<unknown>;
}, z.core.$strip>;
export type ReconciliationHistoryRow = z.infer<typeof reconciliationHistoryRowSchema>;
export declare const reconciliationHistoryArraySchema: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    date: z.ZodCoercedDate<unknown>;
    status: z.ZodString;
    itemsCount: z.ZodNumber;
    adjustments: z.ZodNumber;
    createdBy: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodCoercedDate<unknown>;
}, z.core.$strip>>;
export declare const reconciliationItemRowSchema: z.ZodObject<{
    id: z.ZodString;
    skuId: z.ZodString;
    skuCode: z.ZodString;
    productName: z.ZodString;
    colorName: z.ZodString;
    size: z.ZodString;
    systemQty: z.ZodNumber;
    physicalQty: z.ZodNullable<z.ZodNumber>;
    variance: z.ZodNullable<z.ZodNumber>;
    adjustmentReason: z.ZodNullable<z.ZodString>;
    notes: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type ReconciliationItemRow = z.infer<typeof reconciliationItemRowSchema>;
export declare const reconciliationDetailResultSchema: z.ZodObject<{
    id: z.ZodString;
    status: z.ZodString;
    notes: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodCoercedDate<unknown>;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        skuId: z.ZodString;
        skuCode: z.ZodString;
        productName: z.ZodString;
        colorName: z.ZodString;
        size: z.ZodString;
        systemQty: z.ZodNumber;
        physicalQty: z.ZodNullable<z.ZodNumber>;
        variance: z.ZodNullable<z.ZodNumber>;
        adjustmentReason: z.ZodNullable<z.ZodString>;
        notes: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ReconciliationDetailResult = z.infer<typeof reconciliationDetailResultSchema>;
export declare const skuForReconciliationRowSchema: z.ZodObject<{
    id: z.ZodString;
    skuCode: z.ZodString;
    size: z.ZodString;
    productName: z.ZodString;
    colorName: z.ZodString;
}, z.core.$strip>;
export type SkuForReconciliationRow = z.infer<typeof skuForReconciliationRowSchema>;
export declare const skuForReconciliationArraySchema: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    skuCode: z.ZodString;
    size: z.ZodString;
    productName: z.ZodString;
    colorName: z.ZodString;
}, z.core.$strip>>;
//# sourceMappingURL=reconciliation.d.ts.map