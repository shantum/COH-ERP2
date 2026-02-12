/**
 * Fabric Receipt Schemas
 *
 * Zod schemas for fabric receipt entry page.
 * Used for recording inward fabric transactions from parties.
 */

import { z } from 'zod';

// ============================================
// CREATE FABRIC RECEIPT
// ============================================

/**
 * Schema for creating a new fabric receipt (inward transaction)
 */
export const CreateFabricReceiptSchema = z.object({
    fabricColourId: z.string().uuid('Select a fabric colour'),
    qty: z.number().positive('Quantity must be positive'),
    unit: z.enum(['meter', 'kg', 'yard']).default('meter'),
    costPerUnit: z
        .number()
        .positive('Cost must be positive')
        .optional()
        .nullable(),
    partyId: z.string().uuid().optional().nullable(),
    notes: z.string().max(500, 'Notes cannot exceed 500 characters').optional().nullable(),
});

export type CreateFabricReceiptInput = z.infer<typeof CreateFabricReceiptSchema>;

// ============================================
// UPDATE FABRIC RECEIPT
// ============================================

/**
 * Schema for updating an existing fabric receipt
 */
export const UpdateFabricReceiptSchema = z.object({
    id: z.string().uuid('Invalid transaction ID'),
    qty: z.number().positive('Quantity must be positive').optional(),
    costPerUnit: z
        .number()
        .positive('Cost must be positive')
        .optional()
        .nullable(),
    partyId: z.string().uuid().optional().nullable(),
    notes: z.string().max(500, 'Notes cannot exceed 500 characters').optional().nullable(),
});

export type UpdateFabricReceiptInput = z.infer<typeof UpdateFabricReceiptSchema>;

// ============================================
// SEARCH PARAMS
// ============================================

/**
 * URL search params for fabric receipt page
 */
export const FabricReceiptSearchParams = z.object({
    partyId: z.string().uuid().optional().catch(undefined),
    fabricColourId: z.string().uuid().optional().catch(undefined),
    days: z.coerce.number().default(7).catch(7),
});

export type FabricReceiptSearchParamsType = z.infer<typeof FabricReceiptSearchParams>;

// ============================================
// QUERY PARAMS
// ============================================

/**
 * Schema for querying recent fabric receipts
 */
export const GetRecentFabricReceiptsSchema = z.object({
    limit: z.number().int().positive().default(100),
    days: z.number().int().positive().default(7),
    partyId: z.string().uuid().optional().nullable(),
    fabricColourId: z.string().uuid().optional().nullable(),
});

export type GetRecentFabricReceiptsInput = z.infer<typeof GetRecentFabricReceiptsSchema>;
