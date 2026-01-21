/**
 * Materials Hierarchy Mutations Server Functions
 *
 * TanStack Start Server Functions for Material → Fabric → Colour hierarchy.
 * Handles CRUD operations for all three levels with proper validation.
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

// Material schemas
const createMaterialSchema = z.object({
    name: z.string().min(1, 'Material name is required').trim(),
    description: z.string().optional().nullable(),
});

const updateMaterialSchema = z.object({
    id: z.string().uuid('Invalid material ID'),
    name: z.string().min(1, 'Material name is required').trim().optional(),
    description: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
});

const deleteMaterialSchema = z.object({
    id: z.string().uuid('Invalid material ID'),
});

// Fabric schemas
const createFabricSchema = z.object({
    materialId: z.string().uuid('Invalid material ID'),
    name: z.string().min(1, 'Fabric name is required').trim(),
    constructionType: z.string().optional().nullable(),
    pattern: z.string().optional().nullable(),
    weight: z.number().positive().optional().nullable(),
    weightUnit: z.string().optional().nullable(),
    composition: z.string().optional().nullable(),
    avgShrinkagePct: z.number().min(0).max(100).optional().nullable(),
    unit: z.string().optional().nullable(),
    defaultCostPerUnit: z.number().nonnegative().optional().nullable(),
    defaultLeadTimeDays: z.number().int().positive().optional().nullable(),
    defaultMinOrderQty: z.number().positive().optional().nullable(),
});

const updateFabricSchema = z.object({
    id: z.string().uuid('Invalid fabric ID'),
    name: z.string().min(1, 'Fabric name is required').trim().optional(),
    constructionType: z.string().optional().nullable(),
    pattern: z.string().optional().nullable(),
    weight: z.number().positive().optional().nullable(),
    weightUnit: z.string().optional().nullable(),
    composition: z.string().optional().nullable(),
    avgShrinkagePct: z.number().min(0).max(100).optional().nullable(),
    unit: z.string().optional().nullable(),
    defaultCostPerUnit: z.number().nonnegative().optional().nullable(),
    defaultLeadTimeDays: z.number().int().positive().optional().nullable(),
    defaultMinOrderQty: z.number().positive().optional().nullable(),
    isActive: z.boolean().optional(),
});

const deleteFabricSchema = z.object({
    id: z.string().uuid('Invalid fabric ID'),
});

// Colour schemas
const createColourSchema = z.object({
    fabricId: z.string().uuid('Invalid fabric ID'),
    colourName: z.string().min(1, 'Colour name is required').trim(),
    standardColour: z.string().optional().nullable(),
    colourHex: z.string().optional().nullable(),
    costPerUnit: z.number().nonnegative().optional().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
    leadTimeDays: z.number().int().positive().optional().nullable(),
    minOrderQty: z.number().positive().optional().nullable(),
});

const updateColourSchema = z.object({
    id: z.string().uuid('Invalid colour ID'),
    colourName: z.string().min(1, 'Colour name is required').trim().optional(),
    standardColour: z.string().optional().nullable(),
    colourHex: z.string().optional().nullable(),
    costPerUnit: z.number().nonnegative().optional().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
    leadTimeDays: z.number().int().positive().optional().nullable(),
    minOrderQty: z.number().positive().optional().nullable(),
    isActive: z.boolean().optional(),
});

const deleteColourSchema = z.object({
    id: z.string().uuid('Invalid colour ID'),
});

// ============================================
// MATERIAL MUTATIONS
// ============================================

/**
 * Create a new material (top level)
 */
export const createMaterial = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createMaterialSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const material = await prisma.material.create({
                data: {
                    name: data.name,
                    description: data.description || null,
                },
            });

            return {
                success: true,
                material,
            };
        } catch (error: any) {
            // Handle unique constraint violation
            if (error.code === 'P2002') {
                throw new Error(`Material "${data.name}" already exists`);
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Update material details
 */
export const updateMaterial = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateMaterialSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const material = await prisma.material.update({
                where: { id: data.id },
                data: {
                    ...(data.name !== undefined && { name: data.name }),
                    ...(data.description !== undefined && { description: data.description }),
                    ...(data.isActive !== undefined && { isActive: data.isActive }),
                },
            });

            return {
                success: true,
                material,
            };
        } catch (error: any) {
            if (error.code === 'P2025') {
                throw new Error('Material not found');
            }
            if (error.code === 'P2002') {
                throw new Error(`Material "${data.name}" already exists`);
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Delete a material
 * Will fail if material has fabrics (foreign key constraint)
 */
export const deleteMaterial = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteMaterialSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            await prisma.material.delete({
                where: { id: data.id },
            });

            return {
                success: true,
                message: 'Material deleted successfully',
            };
        } catch (error: any) {
            if (error.code === 'P2025') {
                throw new Error('Material not found');
            }
            if (error.code === 'P2003') {
                throw new Error('Cannot delete material with existing fabrics. Delete all fabrics first.');
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

// ============================================
// FABRIC MUTATIONS
// ============================================

/**
 * Create a fabric under a material
 */
export const createFabric = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createFabricSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            // Verify material exists
            const material = await prisma.material.findUnique({
                where: { id: data.materialId },
            });

            if (!material) {
                throw new Error('Material not found');
            }

            // Create fabric with proper field mapping
            const fabric = await prisma.fabric.create({
                data: {
                    materialId: data.materialId,
                    name: data.name,
                    constructionType: data.constructionType || null,
                    pattern: data.pattern || null,
                    weight: data.weight || null,
                    weightUnit: data.weightUnit || null,
                    composition: data.composition || null,
                    avgShrinkagePct: data.avgShrinkagePct || null,
                    unit: data.unit || null,
                    costPerUnit: data.defaultCostPerUnit || null,
                    defaultLeadTimeDays: data.defaultLeadTimeDays || null,
                    defaultMinOrderQty: data.defaultMinOrderQty || null,
                    // Legacy fields required by schema
                    fabricTypeId: 'legacy-placeholder', // Will be updated once migration completes
                    colorName: 'N/A',
                },
                include: {
                    material: true,
                },
            });

            return {
                success: true,
                fabric,
            };
        } catch (error: any) {
            if (error.code === 'P2002') {
                throw new Error(`Fabric "${data.name}" already exists under this material`);
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Update fabric details
 */
export const updateFabric = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateFabricSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const fabric = await prisma.fabric.update({
                where: { id: data.id },
                data: {
                    ...(data.name !== undefined && { name: data.name }),
                    ...(data.constructionType !== undefined && { constructionType: data.constructionType }),
                    ...(data.pattern !== undefined && { pattern: data.pattern }),
                    ...(data.weight !== undefined && { weight: data.weight }),
                    ...(data.weightUnit !== undefined && { weightUnit: data.weightUnit }),
                    ...(data.composition !== undefined && { composition: data.composition }),
                    ...(data.avgShrinkagePct !== undefined && { avgShrinkagePct: data.avgShrinkagePct }),
                    ...(data.unit !== undefined && { unit: data.unit }),
                    ...(data.defaultCostPerUnit !== undefined && { costPerUnit: data.defaultCostPerUnit }),
                    ...(data.defaultLeadTimeDays !== undefined && { defaultLeadTimeDays: data.defaultLeadTimeDays }),
                    ...(data.defaultMinOrderQty !== undefined && { defaultMinOrderQty: data.defaultMinOrderQty }),
                    ...(data.isActive !== undefined && { isActive: data.isActive }),
                },
                include: {
                    material: true,
                },
            });

            return {
                success: true,
                fabric,
            };
        } catch (error: any) {
            if (error.code === 'P2025') {
                throw new Error('Fabric not found');
            }
            if (error.code === 'P2002') {
                throw new Error(`Fabric "${data.name}" already exists`);
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Delete a fabric
 * Will fail if fabric has colours (foreign key constraint)
 */
export const deleteFabric = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteFabricSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            await prisma.fabric.delete({
                where: { id: data.id },
            });

            return {
                success: true,
                message: 'Fabric deleted successfully',
            };
        } catch (error: any) {
            if (error.code === 'P2025') {
                throw new Error('Fabric not found');
            }
            if (error.code === 'P2003') {
                throw new Error('Cannot delete fabric with existing colours or product variations. Delete all colours first.');
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

// ============================================
// COLOUR MUTATIONS
// ============================================

/**
 * Create a colour under a fabric
 */
export const createColour = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createColourSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            // Verify fabric exists
            const fabric = await prisma.fabric.findUnique({
                where: { id: data.fabricId },
            });

            if (!fabric) {
                throw new Error('Fabric not found');
            }

            // Create colour
            const colour = await prisma.fabricColour.create({
                data: {
                    fabricId: data.fabricId,
                    colourName: data.colourName,
                    standardColour: data.standardColour || null,
                    colourHex: data.colourHex || null,
                    costPerUnit: data.costPerUnit || null,
                    supplierId: data.supplierId || null,
                    leadTimeDays: data.leadTimeDays || null,
                    minOrderQty: data.minOrderQty || null,
                },
                include: {
                    fabric: {
                        include: {
                            material: true,
                        },
                    },
                    supplier: true,
                },
            });

            return {
                success: true,
                colour,
            };
        } catch (error: any) {
            if (error.code === 'P2002') {
                throw new Error(`Colour "${data.colourName}" already exists for this fabric`);
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Update colour details
 */
export const updateColour = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateColourSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const colour = await prisma.fabricColour.update({
                where: { id: data.id },
                data: {
                    ...(data.colourName !== undefined && { colourName: data.colourName }),
                    ...(data.standardColour !== undefined && { standardColour: data.standardColour }),
                    ...(data.colourHex !== undefined && { colourHex: data.colourHex }),
                    ...(data.costPerUnit !== undefined && { costPerUnit: data.costPerUnit }),
                    ...(data.supplierId !== undefined && { supplierId: data.supplierId }),
                    ...(data.leadTimeDays !== undefined && { leadTimeDays: data.leadTimeDays }),
                    ...(data.minOrderQty !== undefined && { minOrderQty: data.minOrderQty }),
                    ...(data.isActive !== undefined && { isActive: data.isActive }),
                },
                include: {
                    fabric: {
                        include: {
                            material: true,
                        },
                    },
                    supplier: true,
                },
            });

            return {
                success: true,
                colour,
            };
        } catch (error: any) {
            if (error.code === 'P2025') {
                throw new Error('Colour not found');
            }
            if (error.code === 'P2002') {
                throw new Error(`Colour "${data.colourName}" already exists`);
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Delete a colour
 * Will fail if colour is used in BOMs (foreign key constraint)
 */
export const deleteColour = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteColourSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            await prisma.fabricColour.delete({
                where: { id: data.id },
            });

            return {
                success: true,
                message: 'Colour deleted successfully',
            };
        } catch (error: any) {
            if (error.code === 'P2025') {
                throw new Error('Colour not found');
            }
            if (error.code === 'P2003') {
                throw new Error('Cannot delete colour that is used in product BOMs. Remove BOM references first.');
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });
