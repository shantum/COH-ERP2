/**
 * Reconciliation Zod Schemas
 *
 * Defines strict output types for reconciliation Kysely queries.
 * These schemas validate query results at runtime to catch schema drift.
 */

import { z } from 'zod';

// ============================================
// HISTORY SCHEMAS
// ============================================

export const reconciliationHistoryRowSchema = z.object({
    id: z.string(),
    date: z.coerce.date(),
    status: z.string(),
    itemsCount: z.number(),
    adjustments: z.number(),
    createdBy: z.string().nullable(),
    createdAt: z.coerce.date(),
});

export type ReconciliationHistoryRow = z.infer<typeof reconciliationHistoryRowSchema>;

export const reconciliationHistoryArraySchema = z.array(reconciliationHistoryRowSchema);

// ============================================
// ITEM SCHEMAS
// ============================================

export const reconciliationItemRowSchema = z.object({
    id: z.string(),
    skuId: z.string(),
    skuCode: z.string(),
    productName: z.string(),
    colorName: z.string(),
    size: z.string(),
    systemQty: z.number(),
    physicalQty: z.number().nullable(),
    variance: z.number().nullable(),
    adjustmentReason: z.string().nullable(),
    notes: z.string().nullable(),
});

export type ReconciliationItemRow = z.infer<typeof reconciliationItemRowSchema>;

// ============================================
// DETAIL SCHEMAS
// ============================================

export const reconciliationDetailResultSchema = z.object({
    id: z.string(),
    status: z.string(),
    notes: z.string().nullable(),
    createdAt: z.coerce.date(),
    items: z.array(reconciliationItemRowSchema),
});

export type ReconciliationDetailResult = z.infer<typeof reconciliationDetailResultSchema>;

// ============================================
// SKU FOR RECONCILIATION SCHEMAS
// ============================================

export const skuForReconciliationRowSchema = z.object({
    id: z.string(),
    skuCode: z.string(),
    size: z.string(),
    productName: z.string(),
    colorName: z.string(),
});

export type SkuForReconciliationRow = z.infer<typeof skuForReconciliationRowSchema>;

export const skuForReconciliationArraySchema = z.array(skuForReconciliationRowSchema);
