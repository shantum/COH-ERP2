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
import type {
    Material,
    Fabric,
    FabricColour,
    TrimItem,
    ServiceItem,
    Supplier as PrismaSupplier,
} from '@prisma/client';

// ============================================
// PRISMA ERROR HELPER
// ============================================

/**
 * Type guard for Prisma errors with a code property
 */
function isPrismaError(error: unknown): error is { code: string; message: string } {
    return (
        error instanceof Error &&
        'code' in error &&
        typeof (error as { code: unknown }).code === 'string'
    );
}

// ============================================
// RETURN TYPES
// ============================================

// Material return types
type FabricWithMaterial = Fabric & { material: Material };
type ColourWithFabricAndSupplier = FabricColour & {
    fabric: Fabric & { material: Material };
    supplier: PrismaSupplier | null;
};
type TrimWithSupplier = TrimItem & { supplier: PrismaSupplier | null };
type ServiceWithVendor = ServiceItem & { vendor: PrismaSupplier | null };

interface CreateMaterialResult {
    success: true;
    material: Material;
}

interface UpdateMaterialResult {
    success: true;
    material: Material;
}

interface DeleteMaterialResult {
    success: true;
    message: string;
}

interface CreateFabricResult {
    success: true;
    fabric: FabricWithMaterial;
}

interface UpdateFabricResult {
    success: true;
    fabric: FabricWithMaterial;
}

interface DeleteFabricResult {
    success: true;
    message: string;
}

interface CreateColourResult {
    success: true;
    colour: ColourWithFabricAndSupplier;
}

interface UpdateColourResult {
    success: true;
    colour: ColourWithFabricAndSupplier;
}

interface DeleteColourResult {
    success: true;
    message: string;
}

interface CreateTrimResult {
    success: true;
    trim: TrimWithSupplier;
}

interface UpdateTrimResult {
    success: true;
    trim: TrimWithSupplier;
}

interface DeleteTrimResult {
    success: true;
    message: string;
}

interface CreateServiceResult {
    success: true;
    service: ServiceWithVendor;
}

interface UpdateServiceResult {
    success: true;
    service: ServiceWithVendor;
}

interface DeleteServiceResult {
    success: true;
    message: string;
}

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
    .handler(async ({ data }): Promise<CreateMaterialResult> => {
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
        } catch (error: unknown) {
            // Handle unique constraint violation
            if (isPrismaError(error) && error.code === 'P2002') {
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
    .handler(async ({ data }): Promise<UpdateMaterialResult> => {
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
        } catch (error: unknown) {
            if (isPrismaError(error)) {
                if (error.code === 'P2025') {
                    throw new Error('Material not found');
                }
                if (error.code === 'P2002') {
                    throw new Error(`Material "${data.name}" already exists`);
                }
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
    .handler(async ({ data }): Promise<DeleteMaterialResult> => {
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
        } catch (error: unknown) {
            if (isPrismaError(error)) {
                if (error.code === 'P2025') {
                    throw new Error('Material not found');
                }
                if (error.code === 'P2003') {
                    throw new Error('Cannot delete material with existing fabrics. Delete all fabrics first.');
                }
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
    .handler(async ({ data }): Promise<CreateFabricResult> => {
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
                fabric: fabric as FabricWithMaterial,
            };
        } catch (error: unknown) {
            if (isPrismaError(error) && error.code === 'P2002') {
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
    .handler(async ({ data }): Promise<UpdateFabricResult> => {
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
                fabric: fabric as FabricWithMaterial,
            };
        } catch (error: unknown) {
            if (isPrismaError(error)) {
                if (error.code === 'P2025') {
                    throw new Error('Fabric not found');
                }
                if (error.code === 'P2002') {
                    throw new Error(`Fabric "${data.name}" already exists`);
                }
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
    .handler(async ({ data }): Promise<DeleteFabricResult> => {
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
        } catch (error: unknown) {
            if (isPrismaError(error)) {
                if (error.code === 'P2025') {
                    throw new Error('Fabric not found');
                }
                if (error.code === 'P2003') {
                    throw new Error('Cannot delete fabric with existing colours or product variations. Delete all colours first.');
                }
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
    .handler(async ({ data }): Promise<CreateColourResult> => {
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
                colour: colour as ColourWithFabricAndSupplier,
            };
        } catch (error: unknown) {
            if (isPrismaError(error) && error.code === 'P2002') {
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
    .handler(async ({ data }): Promise<UpdateColourResult> => {
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
                colour: colour as ColourWithFabricAndSupplier,
            };
        } catch (error: unknown) {
            if (isPrismaError(error)) {
                if (error.code === 'P2025') {
                    throw new Error('Colour not found');
                }
                if (error.code === 'P2002') {
                    throw new Error(`Colour "${data.colourName}" already exists`);
                }
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
    .handler(async ({ data }): Promise<DeleteColourResult> => {
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
        } catch (error: unknown) {
            if (isPrismaError(error)) {
                if (error.code === 'P2025') {
                    throw new Error('Colour not found');
                }
                if (error.code === 'P2003') {
                    throw new Error('Cannot delete colour that is used in product BOMs. Remove BOM references first.');
                }
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

// ============================================
// TRIM MUTATIONS
// ============================================

const createTrimSchema = z.object({
    code: z.string().min(1, 'Trim code is required').trim(),
    name: z.string().min(1, 'Trim name is required').trim(),
    category: z.string().min(1, 'Category is required'),
    description: z.string().optional().nullable(),
    costPerUnit: z.number().nonnegative().default(0),
    unit: z.string().default('piece'),
    supplierId: z.string().uuid().optional().nullable(),
    leadTimeDays: z.number().int().positive().optional().nullable(),
    minOrderQty: z.number().positive().optional().nullable(),
});

const updateTrimSchema = z.object({
    id: z.string().uuid('Invalid trim ID'),
    code: z.string().min(1, 'Trim code is required').trim().optional(),
    name: z.string().min(1, 'Trim name is required').trim().optional(),
    category: z.string().optional(),
    description: z.string().optional().nullable(),
    costPerUnit: z.number().nonnegative().optional().nullable(),
    unit: z.string().optional(),
    supplierId: z.string().uuid().optional().nullable(),
    leadTimeDays: z.number().int().positive().optional().nullable(),
    minOrderQty: z.number().positive().optional().nullable(),
    isActive: z.boolean().optional(),
});

const deleteTrimSchema = z.object({
    id: z.string().uuid('Invalid trim ID'),
});

/**
 * Create a new trim item
 */
export const createTrim = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createTrimSchema.parse(input))
    .handler(async ({ data }): Promise<CreateTrimResult> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const trim = await prisma.trimItem.create({
                data: {
                    code: data.code,
                    name: data.name,
                    category: data.category,
                    description: data.description || null,
                    costPerUnit: data.costPerUnit,
                    unit: data.unit,
                    supplierId: data.supplierId || null,
                    leadTimeDays: data.leadTimeDays || null,
                    minOrderQty: data.minOrderQty || null,
                },
                include: {
                    supplier: true,
                },
            });

            return {
                success: true,
                trim,
            };
        } catch (error: unknown) {
            if (isPrismaError(error) && error.code === 'P2002') {
                throw new Error(`Trim with code "${data.code}" already exists`);
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Update a trim item
 */
export const updateTrim = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateTrimSchema.parse(input))
    .handler(async ({ data }): Promise<UpdateTrimResult> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            // Build update data object - only include fields that were provided
            const updateData: Record<string, unknown> = {};
            if (data.code !== undefined) updateData.code = data.code;
            if (data.name !== undefined) updateData.name = data.name;
            if (data.category !== undefined) updateData.category = data.category;
            if (data.description !== undefined) updateData.description = data.description;
            if (data.costPerUnit !== undefined) updateData.costPerUnit = data.costPerUnit;
            if (data.unit !== undefined) updateData.unit = data.unit;
            if (data.supplierId !== undefined) updateData.supplierId = data.supplierId;
            if (data.leadTimeDays !== undefined) updateData.leadTimeDays = data.leadTimeDays;
            if (data.minOrderQty !== undefined) updateData.minOrderQty = data.minOrderQty;
            if (data.isActive !== undefined) updateData.isActive = data.isActive;

            const trim = await prisma.trimItem.update({
                where: { id: data.id },
                data: updateData,
                include: {
                    supplier: true,
                },
            });

            return {
                success: true,
                trim,
            };
        } catch (error: unknown) {
            if (isPrismaError(error)) {
                if (error.code === 'P2025') {
                    throw new Error('Trim not found');
                }
                if (error.code === 'P2002') {
                    throw new Error(`Trim with code "${data.code}" already exists`);
                }
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Delete a trim item
 */
export const deleteTrim = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteTrimSchema.parse(input))
    .handler(async ({ data }): Promise<DeleteTrimResult> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            await prisma.trimItem.delete({
                where: { id: data.id },
            });

            return {
                success: true,
                message: 'Trim deleted successfully',
            };
        } catch (error: unknown) {
            if (isPrismaError(error)) {
                if (error.code === 'P2025') {
                    throw new Error('Trim not found');
                }
                if (error.code === 'P2003') {
                    throw new Error('Cannot delete trim that is used in BOMs. Remove BOM references first.');
                }
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

// ============================================
// SERVICE MUTATIONS
// ============================================

const createServiceSchema = z.object({
    code: z.string().min(1, 'Service code is required').trim(),
    name: z.string().min(1, 'Service name is required').trim(),
    category: z.string().min(1, 'Category is required'),
    description: z.string().optional().nullable(),
    costPerJob: z.number().nonnegative().default(0),
    costUnit: z.string().default('per_piece'),
    vendorId: z.string().uuid().optional().nullable(),
    leadTimeDays: z.number().int().positive().optional().nullable(),
});

const updateServiceSchema = z.object({
    id: z.string().uuid('Invalid service ID'),
    code: z.string().min(1, 'Service code is required').trim().optional(),
    name: z.string().min(1, 'Service name is required').trim().optional(),
    category: z.string().optional(),
    description: z.string().optional().nullable(),
    costPerJob: z.number().nonnegative().optional().nullable(),
    costUnit: z.string().optional(),
    vendorId: z.string().uuid().optional().nullable(),
    leadTimeDays: z.number().int().positive().optional().nullable(),
    isActive: z.boolean().optional(),
});

const deleteServiceSchema = z.object({
    id: z.string().uuid('Invalid service ID'),
});

/**
 * Create a new service item
 */
export const createService = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createServiceSchema.parse(input))
    .handler(async ({ data }): Promise<CreateServiceResult> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const service = await prisma.serviceItem.create({
                data: {
                    code: data.code,
                    name: data.name,
                    category: data.category,
                    description: data.description || null,
                    costPerJob: data.costPerJob,
                    costUnit: data.costUnit,
                    vendorId: data.vendorId || null,
                    leadTimeDays: data.leadTimeDays || null,
                },
                include: {
                    vendor: true,
                },
            });

            return {
                success: true,
                service,
            };
        } catch (error: unknown) {
            if (isPrismaError(error) && error.code === 'P2002') {
                throw new Error(`Service with code "${data.code}" already exists`);
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Update a service item
 */
export const updateService = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateServiceSchema.parse(input))
    .handler(async ({ data }): Promise<UpdateServiceResult> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            // Build update data object - only include fields that were provided
            const updateData: Record<string, unknown> = {};
            if (data.code !== undefined) updateData.code = data.code;
            if (data.name !== undefined) updateData.name = data.name;
            if (data.category !== undefined) updateData.category = data.category;
            if (data.description !== undefined) updateData.description = data.description;
            if (data.costPerJob !== undefined) updateData.costPerJob = data.costPerJob;
            if (data.costUnit !== undefined) updateData.costUnit = data.costUnit;
            if (data.vendorId !== undefined) updateData.vendorId = data.vendorId;
            if (data.leadTimeDays !== undefined) updateData.leadTimeDays = data.leadTimeDays;
            if (data.isActive !== undefined) updateData.isActive = data.isActive;

            const service = await prisma.serviceItem.update({
                where: { id: data.id },
                data: updateData,
                include: {
                    vendor: true,
                },
            });

            return {
                success: true,
                service,
            };
        } catch (error: unknown) {
            if (isPrismaError(error)) {
                if (error.code === 'P2025') {
                    throw new Error('Service not found');
                }
                if (error.code === 'P2002') {
                    throw new Error(`Service with code "${data.code}" already exists`);
                }
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Delete a service item
 */
export const deleteService = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteServiceSchema.parse(input))
    .handler(async ({ data }): Promise<DeleteServiceResult> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            await prisma.serviceItem.delete({
                where: { id: data.id },
            });

            return {
                success: true,
                message: 'Service deleted successfully',
            };
        } catch (error: unknown) {
            if (isPrismaError(error)) {
                if (error.code === 'P2025') {
                    throw new Error('Service not found');
                }
                if (error.code === 'P2003') {
                    throw new Error('Cannot delete service that is used in BOMs. Remove BOM references first.');
                }
            }
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    });

// ============================================
// COLOUR TRANSACTION MUTATIONS
// ============================================

const createColourTransactionSchema = z.object({
    colourId: z.string().uuid('Invalid colour ID'),
    qty: z.number().positive('Quantity must be positive'),
    reason: z.string().min(1, 'Reason is required'),
    notes: z.string().optional().nullable(),
    costPerUnit: z.number().nonnegative().optional().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
});

/**
 * Create a fabric colour transaction (inward/outward)
 *
 * NOTE: FabricColour inventory tracking is not yet implemented.
 * The FabricColour model doesn't have a separate transaction table.
 * This function is stubbed to allow the UI to compile and show a proper error.
 */
export const createColourTransaction = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createColourTransactionSchema.parse(input))
    .handler(async (): Promise<never> => {
        // FabricColour transactions are not implemented yet
        // The schema only has FabricTransaction which links to the legacy Fabric model
        throw new Error('Colour inventory tracking is not yet implemented. Please use the Fabrics page for inventory transactions.');
    });

// ============================================
// SUPPLIERS SERVER FUNCTION
// ============================================

export interface Supplier {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    isActive: boolean;
}

interface GetSuppliersResult {
    success: true;
    suppliers: Supplier[];
}

/**
 * Get all suppliers
 * Returns a list of all active suppliers for dropdowns
 */
export const getSuppliers = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<GetSuppliersResult> => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const suppliers = await prisma.supplier.findMany({
                where: { isActive: true },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    isActive: true,
                },
                orderBy: { name: 'asc' },
            });

            return {
                success: true,
                suppliers,
            };
        } finally {
            await prisma.$disconnect();
        }
    });
