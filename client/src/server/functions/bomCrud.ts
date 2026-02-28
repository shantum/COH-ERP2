/**
 * BOM CRUD Server Functions
 *
 * Create, update, and delete BOM lines at product, variation, or SKU level.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import type { MutationResult } from './bomHelpers';

// ============================================
// INPUT SCHEMAS
// ============================================

const createBomLineSchema = z.object({
    // Target level - exactly one must be provided
    productId: z.string().uuid().optional(),
    variationId: z.string().uuid().optional(),
    skuId: z.string().uuid().optional(),
    // Component role
    roleId: z.string().uuid('Role ID is required'),
    // Component (at least one required for variation/SKU levels)
    fabricColourId: z.string().uuid().optional().nullable(),
    trimItemId: z.string().uuid().optional().nullable(),
    serviceItemId: z.string().uuid().optional().nullable(),
    // Quantities
    quantity: z.number().nonnegative().optional().nullable(),
    quantityUnit: z.string().optional().default('meter'),
    wastagePercent: z.number().nonnegative().max(100).optional().default(0),
    overrideCost: z.number().nonnegative().optional().nullable(),
    notes: z.string().optional().nullable(),
}).refine(
    (data) => data.productId || data.variationId || data.skuId,
    { message: 'One of productId, variationId, or skuId is required' }
);

const updateBomLineSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    level: z.enum(['product', 'variation', 'sku']),
    // Component updates
    fabricColourId: z.string().uuid().optional().nullable(),
    trimItemId: z.string().uuid().optional().nullable(),
    serviceItemId: z.string().uuid().optional().nullable(),
    // Quantity updates
    quantity: z.number().nonnegative().optional().nullable(),
    quantityUnit: z.string().optional(),
    wastagePercent: z.number().nonnegative().max(100).optional().nullable(),
    overrideCost: z.number().nonnegative().optional().nullable(),
    notes: z.string().optional().nullable(),
});

const deleteBomLineSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    level: z.enum(['product', 'variation', 'sku']),
});

// ============================================
// RESULT TYPES
// ============================================

export interface CreateBomLineResult {
    id: string;
    level: 'product' | 'variation' | 'sku';
    roleId: string;
}

export interface UpdateBomLineResult {
    id: string;
    level: 'product' | 'variation' | 'sku';
    updated: boolean;
}

export interface DeleteBomLineResult {
    id: string;
    level: 'product' | 'variation' | 'sku';
    deleted: boolean;
}

// ============================================
// MUTATION SERVER FUNCTIONS
// ============================================

/**
 * Create a BOM line at product, variation, or SKU level
 */
export const createBomLine = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createBomLineSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<CreateBomLineResult>> => {
        const prisma = await getPrisma();
        const {
            productId,
            variationId,
            skuId,
            roleId,
            fabricColourId,
            trimItemId,
            serviceItemId,
            quantity,
            quantityUnit,
            wastagePercent,
            overrideCost,
            notes,
        } = data;

        // Verify the role exists
        const role = await prisma.componentRole.findUnique({
            where: { id: roleId },
        });

        if (!role) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Component role not found' },
            };
        }

        try {
            let result: { id: string };
            let level: 'product' | 'variation' | 'sku';

            if (productId) {
                // Product-level template
                level = 'product';
                result = await prisma.productBomTemplate.upsert({
                    where: {
                        productId_roleId: { productId, roleId },
                    },
                    update: {
                        trimItemId: trimItemId || null,
                        serviceItemId: serviceItemId || null,
                        defaultQuantity: quantity ?? 1,
                        quantityUnit: quantityUnit || 'meter',
                        wastagePercent: wastagePercent ?? 0,
                        notes: notes || null,
                    },
                    create: {
                        productId,
                        roleId,
                        trimItemId: trimItemId || null,
                        serviceItemId: serviceItemId || null,
                        defaultQuantity: quantity ?? 1,
                        quantityUnit: quantityUnit || 'meter',
                        wastagePercent: wastagePercent ?? 0,
                        notes: notes || null,
                    },
                });
            } else if (variationId) {
                // Variation-level BOM line
                level = 'variation';
                result = await prisma.variationBomLine.upsert({
                    where: {
                        variationId_roleId: { variationId, roleId },
                    },
                    update: {
                        fabricColourId: fabricColourId || null,
                        trimItemId: trimItemId || null,
                        serviceItemId: serviceItemId || null,
                        quantity,
                        wastagePercent,
                        notes: notes || null,
                    },
                    create: {
                        variationId,
                        roleId,
                        fabricColourId: fabricColourId || null,
                        trimItemId: trimItemId || null,
                        serviceItemId: serviceItemId || null,
                        quantity,
                        wastagePercent,
                        notes: notes || null,
                    },
                });
            } else if (skuId) {
                // SKU-level BOM line
                level = 'sku';
                result = await prisma.skuBomLine.upsert({
                    where: {
                        skuId_roleId: { skuId, roleId },
                    },
                    update: {
                        fabricColourId: fabricColourId || null,
                        trimItemId: trimItemId || null,
                        serviceItemId: serviceItemId || null,
                        quantity,
                        wastagePercent,
                        overrideCost: overrideCost ?? null,
                        notes: notes || null,
                    },
                    create: {
                        skuId,
                        roleId,
                        fabricColourId: fabricColourId || null,
                        trimItemId: trimItemId || null,
                        serviceItemId: serviceItemId || null,
                        quantity,
                        wastagePercent,
                        overrideCost: overrideCost ?? null,
                        notes: notes || null,
                    },
                });
            } else {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'One of productId, variationId, or skuId is required' },
                };
            }

            // BOM cost recalculation handled by DB triggers

            return {
                success: true,
                data: { id: result.id, level, roleId },
            };
        } catch (error: unknown) {
            console.error('[bom] createBomLine failed:', error);
            const message = error instanceof Error ? error.message : 'Failed to create BOM line';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Update a BOM line
 */
export const updateBomLine = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateBomLineSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<UpdateBomLineResult>> => {
        const prisma = await getPrisma();
        const {
            lineId,
            level,
            fabricColourId,
            trimItemId,
            serviceItemId,
            quantity,
            quantityUnit,
            wastagePercent,
            overrideCost,
            notes,
        } = data;

        try {
            if (level === 'product') {
                await prisma.productBomTemplate.update({
                    where: { id: lineId },
                    data: {
                        ...(trimItemId !== undefined && { trimItemId: trimItemId || null }),
                        ...(serviceItemId !== undefined && { serviceItemId: serviceItemId || null }),
                        ...(quantity !== undefined && { defaultQuantity: quantity ?? 1 }),
                        ...(quantityUnit !== undefined && { quantityUnit }),
                        ...(wastagePercent !== undefined && { wastagePercent: wastagePercent ?? 0 }),
                        ...(notes !== undefined && { notes: notes || null }),
                    },
                });
            } else if (level === 'variation') {
                await prisma.variationBomLine.update({
                    where: { id: lineId },
                    data: {
                        ...(fabricColourId !== undefined && { fabricColourId: fabricColourId || null }),
                        ...(trimItemId !== undefined && { trimItemId: trimItemId || null }),
                        ...(serviceItemId !== undefined && { serviceItemId: serviceItemId || null }),
                        ...(quantity !== undefined && { quantity }),
                        ...(wastagePercent !== undefined && { wastagePercent }),
                        ...(notes !== undefined && { notes: notes || null }),
                    },
                });
            } else if (level === 'sku') {
                await prisma.skuBomLine.update({
                    where: { id: lineId },
                    data: {
                        ...(fabricColourId !== undefined && { fabricColourId: fabricColourId || null }),
                        ...(trimItemId !== undefined && { trimItemId: trimItemId || null }),
                        ...(serviceItemId !== undefined && { serviceItemId: serviceItemId || null }),
                        ...(quantity !== undefined && { quantity }),
                        ...(wastagePercent !== undefined && { wastagePercent }),
                        ...(overrideCost !== undefined && { overrideCost: overrideCost ?? null }),
                        ...(notes !== undefined && { notes: notes || null }),
                    },
                });
            } else {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Invalid level' },
                };
            }

            // BOM cost recalculation handled by DB triggers

            return {
                success: true,
                data: { id: lineId, level, updated: true },
            };
        } catch (error: unknown) {
            console.error('[bom] updateBomLine failed:', error);
            const message = error instanceof Error ? error.message : 'Failed to update BOM line';
            if (message.includes('Record to update not found')) {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: 'BOM line not found' },
                };
            }
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Delete a BOM line
 */
export const deleteBomLine = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteBomLineSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<DeleteBomLineResult>> => {
        const prisma = await getPrisma();
        const { lineId, level } = data;

        try {
            if (level === 'product') {
                await prisma.productBomTemplate.delete({
                    where: { id: lineId },
                });
            } else if (level === 'variation') {
                await prisma.variationBomLine.delete({
                    where: { id: lineId },
                });
            } else if (level === 'sku') {
                await prisma.skuBomLine.delete({
                    where: { id: lineId },
                });
            } else {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Invalid level' },
                };
            }

            // BOM cost recalculation handled by DB triggers

            return {
                success: true,
                data: { id: lineId, level, deleted: true },
            };
        } catch (error: unknown) {
            console.error('[bom] deleteBomLine failed:', error);
            const message = error instanceof Error ? error.message : 'Failed to delete BOM line';
            if (message.includes('Record to delete does not exist')) {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: 'BOM line not found' },
                };
            }
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });
