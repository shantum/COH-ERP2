/**
 * Fabric Invoice Schemas
 *
 * Zod schemas for fabric invoice upload, review, and listing.
 */

import { z } from 'zod';

// ============================================
// SEARCH PARAMS (URL)
// ============================================

export const FabricInvoiceSearchParams = z.object({
    status: z.enum(['draft', 'confirmed', 'cancelled']).optional().catch(undefined),
    partyId: z.string().uuid().optional().catch(undefined),
    page: z.coerce.number().int().positive().default(1).catch(1),
    view: z.enum(['upload', 'history']).default('history').catch('history'),
    invoiceId: z.string().uuid().optional().catch(undefined),
});

export type FabricInvoiceSearchParamsType = z.infer<typeof FabricInvoiceSearchParams>;

// ============================================
// LINE UPDATE
// ============================================

export const UpdateInvoiceLineSchema = z.object({
    id: z.string().uuid(),
    description: z.string().nullable().optional(),
    hsnCode: z.string().nullable().optional(),
    qty: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
    rate: z.number().nullable().optional(),
    amount: z.number().nullable().optional(),
    gstPercent: z.number().nullable().optional(),
    gstAmount: z.number().nullable().optional(),
    fabricColourId: z.string().uuid().nullable().optional(),
    matchedTxnId: z.string().uuid().nullable().optional(),
    matchType: z.enum(['auto_matched', 'manual_matched', 'new_entry']).nullable().optional(),
});

export type UpdateInvoiceLine = z.infer<typeof UpdateInvoiceLineSchema>;

// ============================================
// BULK UPDATE BODY
// ============================================

export const UpdateInvoiceLinesBodySchema = z.object({
    lines: z.array(UpdateInvoiceLineSchema).min(1),
    invoiceNumber: z.string().nullable().optional(),
    invoiceDate: z.string().nullable().optional(),
    partyId: z.string().uuid().nullable().optional(),
    subtotal: z.number().nullable().optional(),
    gstAmount: z.number().nullable().optional(),
    totalAmount: z.number().nullable().optional(),
});

export type UpdateInvoiceLinesBody = z.infer<typeof UpdateInvoiceLinesBodySchema>;
