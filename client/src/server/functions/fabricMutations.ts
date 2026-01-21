/**
 * Fabric Mutations Server Functions
 *
 * TanStack Start Server Functions for fabric CRUD operations.
 * Handles fabric types, fabrics (colors), transactions, and suppliers.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// INPUT SCHEMAS
// ============================================

// Fabric Type schemas
const createFabricTypeSchema = z.object({
    name: z.string().min(1, 'Name is required').trim(),
    composition: z.string().optional().nullable(),
    unit: z.enum(['meter', 'kg']).default('meter'),
    avgShrinkagePct: z.number().min(0).max(100).optional().default(0),
    defaultCostPerUnit: z.number().positive().optional().nullable(),
    defaultLeadTimeDays: z.number().int().positive().optional().nullable(),
    defaultMinOrderQty: z.number().positive().optional().nullable(),
});

const updateFabricTypeSchema = z.object({
    id: z.string().uuid('Invalid fabric type ID'),
    name: z.string().min(1, 'Name is required').trim().optional(),
    composition: z.string().optional().nullable(),
    unit: z.enum(['meter', 'kg']).optional(),
    avgShrinkagePct: z.number().min(0).max(100).optional(),
    defaultCostPerUnit: z.number().positive().nullable().optional(),
    defaultLeadTimeDays: z.number().int().positive().nullable().optional(),
    defaultMinOrderQty: z.number().positive().nullable().optional(),
});

// Fabric (color) schemas
const createFabricSchema = z.object({
    fabricTypeId: z.string().uuid('Invalid fabric type ID'),
    name: z.string().min(1, 'Name is required').trim(),
    colorName: z.string().min(1, 'Color name is required').trim(),
    standardColor: z.string().optional().nullable(),
    colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional().default('#6B8E9F'),
    costPerUnit: z.number().positive().optional().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
    leadTimeDays: z.number().int().positive().optional().nullable(),
    minOrderQty: z.number().positive().optional().nullable(),
});

const updateFabricSchema = z.object({
    fabricId: z.string().uuid('Invalid fabric ID'),
    name: z.string().min(1).trim().optional(),
    colorName: z.string().min(1).trim().optional(),
    standardColor: z.string().optional().nullable(),
    colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional(),
    costPerUnit: z.number().positive().nullable().optional(),
    supplierId: z.string().uuid().nullable().optional(),
    leadTimeDays: z.number().int().positive().nullable().optional(),
    minOrderQty: z.number().positive().nullable().optional(),
    isActive: z.boolean().optional(),
});

const deleteFabricSchema = z.object({
    fabricId: z.string().uuid('Invalid fabric ID'),
});

// Transaction schemas
const createTransactionSchema = z.object({
    fabricId: z.string().uuid('Invalid fabric ID'),
    txnType: z.enum(['inward', 'outward']),
    qty: z.number().positive('Quantity must be positive'),
    unit: z.enum(['meter', 'kg']).default('meter'),
    reason: z.string().min(1, 'Reason is required'),
    referenceId: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    costPerUnit: z.number().positive().optional().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
});

const deleteTransactionSchema = z.object({
    txnId: z.string().uuid('Invalid transaction ID'),
});

// Supplier schemas
const createSupplierSchema = z.object({
    name: z.string().min(1, 'Name is required').trim(),
    contactName: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
});

// ============================================
// FABRIC TYPE MUTATIONS
// ============================================

/**
 * Create a new fabric type
 */
export const createFabricType = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createFabricTypeSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const fabricType = await prisma.fabricType.create({
                data: {
                    name: data.name,
                    composition: data.composition || null,
                    unit: data.unit,
                    avgShrinkagePct: data.avgShrinkagePct || 0,
                    defaultCostPerUnit: data.defaultCostPerUnit ?? null,
                    defaultLeadTimeDays: data.defaultLeadTimeDays ?? null,
                    defaultMinOrderQty: data.defaultMinOrderQty ?? null,
                },
            });

            return {
                success: true,
                fabricType,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Update a fabric type
 */
export const updateFabricType = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateFabricTypeSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            // Check if trying to rename Default fabric type
            const existing = await prisma.fabricType.findUnique({
                where: { id: data.id },
            });

            if (!existing) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_FOUND' as const,
                        message: 'Fabric type not found',
                    },
                };
            }

            if (existing.name === 'Default' && data.name && data.name !== 'Default') {
                return {
                    success: false,
                    error: {
                        code: 'FORBIDDEN' as const,
                        message: 'Cannot rename the Default fabric type',
                    },
                };
            }

            const { id, ...updateData } = data;

            const fabricType = await prisma.fabricType.update({
                where: { id },
                data: updateData,
            });

            return {
                success: true,
                fabricType,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

// ============================================
// FABRIC (COLOR) MUTATIONS
// ============================================

/**
 * Create a new fabric (color)
 */
export const createFabric = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createFabricSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            // Prevent adding colors to the Default fabric type
            const fabricType = await prisma.fabricType.findUnique({
                where: { id: data.fabricTypeId },
            });

            if (!fabricType) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_FOUND' as const,
                        message: 'Fabric type not found',
                    },
                };
            }

            if (fabricType.name === 'Default') {
                return {
                    success: false,
                    error: {
                        code: 'FORBIDDEN' as const,
                        message: 'Cannot add colors to the Default fabric type',
                    },
                };
            }

            const fabric = await prisma.fabric.create({
                data: {
                    fabricTypeId: data.fabricTypeId,
                    name: data.name,
                    colorName: data.colorName,
                    standardColor: data.standardColor || null,
                    colorHex: data.colorHex,
                    costPerUnit: data.costPerUnit ?? null,
                    supplierId: data.supplierId || null,
                    leadTimeDays: data.leadTimeDays ?? null,
                    minOrderQty: data.minOrderQty ?? null,
                },
                include: {
                    fabricType: true,
                    supplier: true,
                },
            });

            return {
                success: true,
                fabric,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Update a fabric (color)
 */
export const updateFabric = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateFabricSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const { fabricId, ...updateData } = data;

            // Build update object, handling null values for inheritance
            const update: Record<string, unknown> = {};

            if (updateData.name !== undefined) update.name = updateData.name;
            if (updateData.colorName !== undefined) update.colorName = updateData.colorName;
            if (updateData.colorHex !== undefined) update.colorHex = updateData.colorHex;
            if (updateData.isActive !== undefined) update.isActive = updateData.isActive;

            // Handle nullable fields - allow explicit null for inheritance
            if ('standardColor' in updateData) update.standardColor = updateData.standardColor || null;
            if ('supplierId' in updateData) update.supplierId = updateData.supplierId || null;
            if ('costPerUnit' in updateData) update.costPerUnit = updateData.costPerUnit;
            if ('leadTimeDays' in updateData) update.leadTimeDays = updateData.leadTimeDays;
            if ('minOrderQty' in updateData) update.minOrderQty = updateData.minOrderQty;

            const fabric = await prisma.fabric.update({
                where: { id: fabricId },
                data: update,
                include: {
                    fabricType: true,
                    supplier: true,
                },
            });

            return {
                success: true,
                fabric,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Delete a fabric (soft delete)
 * Automatically reassigns any product variations to the default fabric
 */
export const deleteFabric = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteFabricSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const fabric = await prisma.fabric.findUnique({
                where: { id: data.fabricId },
                include: {
                    fabricType: true,
                    _count: {
                        select: {
                            transactions: true,
                            variations: true,
                        },
                    },
                },
            });

            if (!fabric) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_FOUND' as const,
                        message: 'Fabric not found',
                    },
                };
            }

            // Find the default fabric to reassign variations
            const defaultFabric = await prisma.fabric.findFirst({
                where: {
                    fabricType: { name: 'Default' },
                    isActive: true,
                },
            });

            if (!defaultFabric) {
                return {
                    success: false,
                    error: {
                        code: 'INTERNAL_ERROR' as const,
                        message: 'Default fabric not found. Cannot delete.',
                    },
                };
            }

            // Prevent deleting the default fabric itself
            if (fabric.id === defaultFabric.id) {
                return {
                    success: false,
                    error: {
                        code: 'FORBIDDEN' as const,
                        message: 'Cannot delete the default fabric',
                    },
                };
            }

            let variationsReassigned = 0;

            // Reassign any variations using this fabric to the default fabric
            if (fabric._count.variations > 0) {
                const result = await prisma.variation.updateMany({
                    where: { fabricId: data.fabricId },
                    data: { fabricId: defaultFabric.id },
                });
                variationsReassigned = result.count;
            }

            // Soft delete - set isActive to false
            await prisma.fabric.update({
                where: { id: data.fabricId },
                data: { isActive: false },
            });

            // Check if fabric type has any remaining active fabrics
            // If not, delete the fabric type (except Default)
            let fabricTypeDeleted = false;
            const fabricTypeRecord = await prisma.fabricType.findUnique({
                where: { id: fabric.fabricTypeId },
                include: {
                    _count: {
                        select: {
                            fabrics: { where: { isActive: true } },
                        },
                    },
                },
            });

            if (
                fabricTypeRecord &&
                fabricTypeRecord.name !== 'Default' &&
                fabricTypeRecord._count.fabrics === 0
            ) {
                await prisma.fabricType.delete({
                    where: { id: fabric.fabricTypeId },
                });
                fabricTypeDeleted = true;
            }

            return {
                success: true,
                id: data.fabricId,
                hadTransactions: fabric._count.transactions > 0,
                variationsReassigned,
                fabricTypeDeleted,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

// ============================================
// TRANSACTION MUTATIONS
// ============================================

/**
 * Create a fabric transaction (inward/outward)
 */
export const createFabricTransaction = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createTransactionSchema.parse(input))
    .handler(async ({ data, context }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const transaction = await prisma.fabricTransaction.create({
                data: {
                    fabricId: data.fabricId,
                    txnType: data.txnType,
                    qty: data.qty,
                    unit: data.unit,
                    reason: data.reason,
                    referenceId: data.referenceId || null,
                    notes: data.notes || null,
                    costPerUnit: data.costPerUnit ?? null,
                    supplierId: data.supplierId || null,
                    createdById: context.user.id,
                },
                include: {
                    createdBy: { select: { id: true, name: true } },
                    supplier: { select: { id: true, name: true } },
                },
            });

            return {
                success: true,
                transaction,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Delete a fabric transaction (admin only)
 */
export const deleteFabricTransaction = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteTransactionSchema.parse(input))
    .handler(async ({ data, context }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            // Check if user is admin
            if (context.user.role !== 'admin') {
                return {
                    success: false,
                    error: {
                        code: 'FORBIDDEN' as const,
                        message: 'Only admins can delete transactions',
                    },
                };
            }

            const transaction = await prisma.fabricTransaction.findUnique({
                where: { id: data.txnId },
            });

            if (!transaction) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_FOUND' as const,
                        message: 'Transaction not found',
                    },
                };
            }

            await prisma.fabricTransaction.delete({
                where: { id: data.txnId },
            });

            return {
                success: true,
                id: data.txnId,
            };
        } finally {
            await prisma.$disconnect();
        }
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
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const supplier = await prisma.supplier.create({
                data: {
                    name: data.name,
                    contactName: data.contactName || null,
                    email: data.email || null,
                    phone: data.phone || null,
                    address: data.address || null,
                },
            });

            return {
                success: true,
                supplier,
            };
        } finally {
            await prisma.$disconnect();
        }
    });
