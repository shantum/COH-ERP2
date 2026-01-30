/**
 * Fabric Mutations Server Functions
 *
 * TanStack Start Server Functions for fabric CRUD operations.
 *
 * NOTE: Most functions in this file are DEPRECATED as of the fabric consolidation.
 * FabricType has been removed. Fabric assignment is now done via BOM (VariationBomLine.fabricColourId).
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import type {
    Fabric,
    Supplier,
} from '@prisma/client';

// ============================================
// RETURN TYPES
// ============================================

// FabricType functions are deprecated - return deprecation error
type DeprecatedResult = {
    success: false;
    error: {
        code: 'DEPRECATED';
        message: string;
    };
};

type FabricWithRelations = Fabric & {
    supplier: Supplier | null;
};

type FabricSuccessResult = {
    success: true;
    fabric: FabricWithRelations;
};

type FabricErrorResult = {
    success: false;
    error: {
        code: 'NOT_FOUND' | 'FORBIDDEN' | 'DEPRECATED';
        message: string;
    };
};

// FabricDeleteResult and TransactionResult types removed - no longer used after fabric consolidation

type SupplierSuccessResult = {
    success: true;
    supplier: Supplier;
};

type SupplierErrorResult = {
    success: false;
    error: {
        code: 'NOT_FOUND' | 'CONFLICT';
        message: string;
    };
};

// ============================================
// INPUT SCHEMAS
// ============================================

// Deprecated - FabricType no longer exists
const createFabricTypeSchema = z.object({
    name: z.string().min(1),
    composition: z.string().optional().nullable(),
    unit: z.string().default('meter'),
    avgShrinkagePct: z.number().optional(),
    defaultCostPerUnit: z.number().optional().nullable(),
    defaultLeadTimeDays: z.number().int().optional().nullable(),
    defaultMinOrderQty: z.number().optional().nullable(),
});

const updateFabricTypeSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1).optional(),
    composition: z.string().optional().nullable(),
    unit: z.string().optional(),
    avgShrinkagePct: z.number().optional(),
    defaultCostPerUnit: z.number().optional().nullable(),
    defaultLeadTimeDays: z.number().int().optional().nullable(),
    defaultMinOrderQty: z.number().optional().nullable(),
});

// Fabric schemas - still used but simplified
const createFabricSchema = z.object({
    materialId: z.string().uuid(), // Now links to Material instead of FabricType
    name: z.string().min(1),
    colorName: z.string().min(1),
    colorHex: z.string().optional().nullable(),
    standardColor: z.string().optional().nullable(),
    pattern: z.string().optional().nullable(),
    unit: z.string().optional().nullable(),
    costPerUnit: z.number().optional().nullable(),
    leadTimeDays: z.number().int().optional().nullable(),
    minOrderQty: z.number().optional().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
});

const updateFabricSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1).optional(),
    colorName: z.string().min(1).optional(),
    colorHex: z.string().optional().nullable(),
    standardColor: z.string().optional().nullable(),
    pattern: z.string().optional().nullable(),
    unit: z.string().optional().nullable(),
    costPerUnit: z.number().optional().nullable(),
    leadTimeDays: z.number().int().optional().nullable(),
    minOrderQty: z.number().optional().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
    isActive: z.boolean().optional(),
});

const deleteFabricSchema = z.object({
    id: z.string().uuid(),
});

// Deprecated - FabricTransaction no longer exists
const createFabricTransactionSchema = z.object({
    fabricId: z.string().uuid(),
    txnType: z.enum(['inward', 'outward']),
    qty: z.number().positive(),
    unit: z.string().min(1),
    reason: z.string().min(1),
    costPerUnit: z.number().optional().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
    referenceId: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
});

const deleteFabricTransactionSchema = z.object({
    id: z.string().uuid(),
});

// Supplier schema
const createSupplierSchema = z.object({
    name: z.string().min(1),
    contactName: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
});

// ============================================
// FABRIC TYPE MUTATIONS - DEPRECATED
// ============================================

/**
 * Create a new fabric type
 * @deprecated FabricType table has been removed. Use Material instead.
 */
export const createFabricType = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createFabricTypeSchema.parse(input))
    .handler(async (): Promise<DeprecatedResult> => {
        return {
            success: false,
            error: {
                code: 'DEPRECATED',
                message: 'FabricType has been removed. Fabric types are now managed as Materials. Use the Materials page to create new materials.',
            },
        };
    });

/**
 * Update a fabric type
 * @deprecated FabricType table has been removed. Use Material instead.
 */
export const updateFabricType = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateFabricTypeSchema.parse(input))
    .handler(async (): Promise<DeprecatedResult> => {
        return {
            success: false,
            error: {
                code: 'DEPRECATED',
                message: 'FabricType has been removed. Fabric types are now managed as Materials.',
            },
        };
    });

// ============================================
// FABRIC (COLOR) MUTATIONS
// ============================================

/**
 * Create a new fabric (color)
 * NOTE: Fabric now links to Material instead of FabricType
 */
export const createFabric = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createFabricSchema.parse(input))
    .handler(async ({ data }): Promise<FabricSuccessResult | FabricErrorResult> => {
        const prisma = await getPrisma();

        // Verify Material exists
        const material = await prisma.material.findUnique({
            where: { id: data.materialId },
        });

        if (!material) {
            return {
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: 'Material not found',
                },
            };
        }

        const fabric = await prisma.fabric.create({
            data: {
                materialId: data.materialId,
                name: data.name,
                colorName: data.colorName,
                colorHex: data.colorHex ?? null,
                standardColor: data.standardColor ?? null,
                pattern: data.pattern ?? null,
                unit: data.unit ?? 'meters',
                costPerUnit: data.costPerUnit ?? null,
                leadTimeDays: data.leadTimeDays ?? null,
                minOrderQty: data.minOrderQty ?? null,
                supplierId: data.supplierId ?? null,
            },
            include: {
                supplier: true,
            },
        });

        return {
            success: true,
            fabric,
        };
    });

/**
 * Update a fabric
 */
export const updateFabric = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateFabricSchema.parse(input))
    .handler(async ({ data }): Promise<FabricSuccessResult | FabricErrorResult> => {
        const prisma = await getPrisma();

        const existing = await prisma.fabric.findUnique({
            where: { id: data.id },
        });

        if (!existing) {
            return {
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: 'Fabric not found',
                },
            };
        }

        const { id, ...updateData } = data;

        const fabric = await prisma.fabric.update({
            where: { id },
            data: updateData,
            include: {
                supplier: true,
            },
        });

        return {
            success: true,
            fabric,
        };
    });

/**
 * Delete (deactivate) a fabric
 * NOTE: Simplified - no longer reassigns variations since fabricId is removed from Variation
 */
export const deleteFabric = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteFabricSchema.parse(input))
    .handler(async ({ data }): Promise<{ success: true; id: string } | FabricErrorResult> => {
        const prisma = await getPrisma();

        const existing = await prisma.fabric.findUnique({
            where: { id: data.id },
        });

        if (!existing) {
            return {
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: 'Fabric not found',
                },
            };
        }

        // Soft delete by setting isActive = false
        await prisma.fabric.update({
            where: { id: data.id },
            data: { isActive: false },
        });

        return {
            success: true,
            id: data.id,
        };
    });

// ============================================
// FABRIC TRANSACTION MUTATIONS - DEPRECATED
// ============================================

/**
 * Create a fabric transaction
 * @deprecated FabricTransaction has been replaced by FabricColourTransaction.
 * Use createColourTransaction from materialsMutations.ts instead.
 */
export const createFabricTransaction = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createFabricTransactionSchema.parse(input))
    .handler(async (): Promise<DeprecatedResult> => {
        return {
            success: false,
            error: {
                code: 'DEPRECATED',
                message: 'FabricTransaction has been replaced by FabricColourTransaction. Use the Materials page to record fabric colour inventory transactions.',
            },
        };
    });

/**
 * Delete a fabric transaction
 * @deprecated FabricTransaction has been replaced by FabricColourTransaction.
 */
export const deleteFabricTransaction = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteFabricTransactionSchema.parse(input))
    .handler(async (): Promise<DeprecatedResult> => {
        return {
            success: false,
            error: {
                code: 'DEPRECATED',
                message: 'FabricTransaction has been replaced by FabricColourTransaction. Use the Ledgers page to manage fabric colour transactions.',
            },
        };
    });

// ============================================
// SUPPLIER MUTATIONS
// ============================================

/**
 * Create a new supplier
 */
export const createSupplier = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createSupplierSchema.parse(input))
    .handler(async ({ data }): Promise<SupplierSuccessResult | SupplierErrorResult> => {
        const prisma = await getPrisma();

        // Check for duplicate name
        const existing = await prisma.supplier.findFirst({
            where: { name: data.name },
        });

        if (existing) {
            return {
                success: false,
                error: {
                    code: 'CONFLICT',
                    message: 'A supplier with this name already exists',
                },
            };
        }

        const supplier = await prisma.supplier.create({
            data: {
                name: data.name,
                contactName: data.contactName ?? null,
                email: data.email ?? null,
                phone: data.phone ?? null,
                address: data.address ?? null,
            },
        });

        return {
            success: true,
            supplier,
        };
    });
