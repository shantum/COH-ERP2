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
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import type {
    Material,
    Fabric,
    FabricColour,
    TrimItem,
    ServiceItem,
    Party as PrismaParty,
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
type ColourWithFabricAndParty = FabricColour & {
    fabric: Fabric & { material: Material };
    party: PrismaParty | null;
};
type TrimWithParty = TrimItem & { party: PrismaParty | null };
type ServiceWithParty = ServiceItem & { party: PrismaParty | null };

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
    colour: ColourWithFabricAndParty;
}

interface UpdateColourResult {
    success: true;
    colour: ColourWithFabricAndParty;
}

interface DeleteColourResult {
    success: true;
    message: string;
}

interface CreateTrimResult {
    success: true;
    trim: TrimWithParty;
}

interface UpdateTrimResult {
    success: true;
    trim: TrimWithParty;
}

interface DeleteTrimResult {
    success: true;
    message: string;
}

interface CreateServiceResult {
    success: true;
    service: ServiceWithParty;
}

interface UpdateServiceResult {
    success: true;
    service: ServiceWithParty;
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
    code: z.string().trim().optional().nullable(),
    standardColour: z.string().optional().nullable(),
    colourHex: z.string().optional().nullable(),
    costPerUnit: z.number().nonnegative().optional().nullable(),
    partyId: z.string().uuid().optional().nullable(),
    leadTimeDays: z.number().int().positive().optional().nullable(),
    minOrderQty: z.number().positive().optional().nullable(),
});

const updateColourSchema = z.object({
    id: z.string().uuid('Invalid colour ID'),
    colourName: z.string().min(1, 'Colour name is required').trim().optional(),
    code: z.string().trim().optional().nullable(),
    standardColour: z.string().optional().nullable(),
    colourHex: z.string().optional().nullable(),
    costPerUnit: z.number().nonnegative().optional().nullable(),
    partyId: z.string().uuid().optional().nullable(),
    leadTimeDays: z.number().int().positive().optional().nullable(),
    minOrderQty: z.number().positive().optional().nullable(),
    isActive: z.boolean().optional(),
    isOutOfStock: z.boolean().optional(),
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
        try {
            const prisma = await getPrisma();
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
        }
    });

/**
 * Update material details
 */
export const updateMaterial = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateMaterialSchema.parse(input))
    .handler(async ({ data }): Promise<UpdateMaterialResult> => {
        try {
            const prisma = await getPrisma();
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
        }
    });

/**
 * Delete a material
 * Will fail if material has fabrics (foreign key constraint)
 */
export const deleteMaterial = createServerFn({ method: 'POST' })
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => deleteMaterialSchema.parse(input))
    .handler(async ({ data }): Promise<DeleteMaterialResult> => {
        try {
            const prisma = await getPrisma();
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
        try {
            const prisma = await getPrisma();
            // Verify material exists
            const material = await prisma.material.findUnique({
                where: { id: data.materialId },
            });

            if (!material) {
                throw new Error('Material not found');
            }

            // Create fabric with proper field mapping
            // NOTE: FabricType table removed in fabric consolidation
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
        }
    });

/**
 * Update fabric details
 */
export const updateFabric = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateFabricSchema.parse(input))
    .handler(async ({ data }): Promise<UpdateFabricResult> => {
        try {
            const prisma = await getPrisma();
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
        }
    });

/**
 * Delete a fabric
 * Will fail if fabric has colours (foreign key constraint)
 */
export const deleteFabric = createServerFn({ method: 'POST' })
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => deleteFabricSchema.parse(input))
    .handler(async ({ data }): Promise<DeleteFabricResult> => {
        try {
            const prisma = await getPrisma();
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
        try {
            const prisma = await getPrisma();
            // Verify fabric exists and get material name for code generation
            const fabric = await prisma.fabric.findUnique({
                where: { id: data.fabricId },
                include: { material: true },
            });

            if (!fabric) {
                throw new Error('Fabric not found');
            }

            // Auto-generate code if not provided
            let code = data.code || null;
            if (!code) {
                const { generateFabricColourCode } = await import('@coh/shared/domain');
                code = generateFabricColourCode(
                    fabric.material?.name ?? 'UNK',
                    fabric.name,
                    data.colourName,
                );
                // Check uniqueness in a single query
                const existingCodes = await prisma.fabricColour.findMany({
                    where: { code: { startsWith: code } },
                    select: { code: true },
                });
                const codeSet = new Set(existingCodes.map((c: { code: string | null }) => c.code));
                if (codeSet.has(code)) {
                    let suffix = 2;
                    while (codeSet.has(`${code}-${suffix}`)) suffix++;
                    code = `${code}-${suffix}`;
                }
            }

            // Create colour
            const colour = await prisma.fabricColour.create({
                data: {
                    fabricId: data.fabricId,
                    colourName: data.colourName,
                    code,
                    standardColour: data.standardColour || null,
                    colourHex: data.colourHex || null,
                    costPerUnit: data.costPerUnit || null,
                    partyId: data.partyId || null,
                    leadTimeDays: data.leadTimeDays || null,
                    minOrderQty: data.minOrderQty || null,
                },
                include: {
                    fabric: {
                        include: {
                            material: true,
                        },
                    },
                    party: true,
                },
            });

            return {
                success: true,
                colour: colour as ColourWithFabricAndParty,
            };
        } catch (error: unknown) {
            if (isPrismaError(error) && error.code === 'P2002') {
                throw new Error(`Colour "${data.colourName}" already exists for this fabric`);
            }
            throw error;
        }
    });

/**
 * Update colour details
 */
export const updateColour = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateColourSchema.parse(input))
    .handler(async ({ data }): Promise<UpdateColourResult> => {
        try {
            const prisma = await getPrisma();
            const colour = await prisma.fabricColour.update({
                where: { id: data.id },
                data: {
                    ...(data.colourName !== undefined && { colourName: data.colourName }),
                    ...(data.code !== undefined && { code: data.code }),
                    ...(data.standardColour !== undefined && { standardColour: data.standardColour }),
                    ...(data.colourHex !== undefined && { colourHex: data.colourHex }),
                    ...(data.costPerUnit !== undefined && { costPerUnit: data.costPerUnit }),
                    ...(data.partyId !== undefined && { partyId: data.partyId }),
                    ...(data.leadTimeDays !== undefined && { leadTimeDays: data.leadTimeDays }),
                    ...(data.minOrderQty !== undefined && { minOrderQty: data.minOrderQty }),
                    ...(data.isActive !== undefined && { isActive: data.isActive }),
                    ...(data.isOutOfStock !== undefined && { isOutOfStock: data.isOutOfStock }),
                },
                include: {
                    fabric: {
                        include: {
                            material: true,
                        },
                    },
                    party: true,
                },
            });

            return {
                success: true,
                colour: colour as ColourWithFabricAndParty,
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
        }
    });

/**
 * Delete a colour
 * Will fail if colour is used in BOMs (foreign key constraint)
 */
export const deleteColour = createServerFn({ method: 'POST' })
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => deleteColourSchema.parse(input))
    .handler(async ({ data }): Promise<DeleteColourResult> => {
        try {
            const prisma = await getPrisma();
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
    partyId: z.string().uuid().optional().nullable(),
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
    partyId: z.string().uuid().optional().nullable(),
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
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => createTrimSchema.parse(input))
    .handler(async ({ data }): Promise<CreateTrimResult> => {
        try {
            const prisma = await getPrisma();
            const trim = await prisma.trimItem.create({
                data: {
                    code: data.code,
                    name: data.name,
                    category: data.category,
                    description: data.description || null,
                    costPerUnit: data.costPerUnit,
                    unit: data.unit,
                    partyId: data.partyId || null,
                    leadTimeDays: data.leadTimeDays || null,
                    minOrderQty: data.minOrderQty || null,
                },
                include: {
                    party: true,
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
        }
    });

/**
 * Update a trim item
 */
export const updateTrim = createServerFn({ method: 'POST' })
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => updateTrimSchema.parse(input))
    .handler(async ({ data }): Promise<UpdateTrimResult> => {
        try {
            const prisma = await getPrisma();
            // Build update data object - only include fields that were provided
            const updateData: Record<string, unknown> = {};
            if (data.code !== undefined) updateData.code = data.code;
            if (data.name !== undefined) updateData.name = data.name;
            if (data.category !== undefined) updateData.category = data.category;
            if (data.description !== undefined) updateData.description = data.description;
            if (data.costPerUnit !== undefined) updateData.costPerUnit = data.costPerUnit;
            if (data.unit !== undefined) updateData.unit = data.unit;
            if (data.partyId !== undefined) updateData.partyId = data.partyId;
            if (data.leadTimeDays !== undefined) updateData.leadTimeDays = data.leadTimeDays;
            if (data.minOrderQty !== undefined) updateData.minOrderQty = data.minOrderQty;
            if (data.isActive !== undefined) updateData.isActive = data.isActive;

            const trim = await prisma.trimItem.update({
                where: { id: data.id },
                data: updateData,
                include: {
                    party: true,
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
        }
    });

/**
 * Delete a trim item
 */
export const deleteTrim = createServerFn({ method: 'POST' })
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => deleteTrimSchema.parse(input))
    .handler(async ({ data }): Promise<DeleteTrimResult> => {
        try {
            const prisma = await getPrisma();
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
    partyId: z.string().uuid().optional().nullable(),
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
    partyId: z.string().uuid().optional().nullable(),
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
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => createServiceSchema.parse(input))
    .handler(async ({ data }): Promise<CreateServiceResult> => {
        try {
            const prisma = await getPrisma();
            const service = await prisma.serviceItem.create({
                data: {
                    code: data.code,
                    name: data.name,
                    category: data.category,
                    description: data.description || null,
                    costPerJob: data.costPerJob,
                    costUnit: data.costUnit,
                    partyId: data.partyId || null,
                    leadTimeDays: data.leadTimeDays || null,
                },
                include: {
                    party: true,
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
        }
    });

/**
 * Update a service item
 */
export const updateService = createServerFn({ method: 'POST' })
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => updateServiceSchema.parse(input))
    .handler(async ({ data }): Promise<UpdateServiceResult> => {
        try {
            const prisma = await getPrisma();
            // Build update data object - only include fields that were provided
            const updateData: Record<string, unknown> = {};
            if (data.code !== undefined) updateData.code = data.code;
            if (data.name !== undefined) updateData.name = data.name;
            if (data.category !== undefined) updateData.category = data.category;
            if (data.description !== undefined) updateData.description = data.description;
            if (data.costPerJob !== undefined) updateData.costPerJob = data.costPerJob;
            if (data.costUnit !== undefined) updateData.costUnit = data.costUnit;
            if (data.partyId !== undefined) updateData.partyId = data.partyId;
            if (data.leadTimeDays !== undefined) updateData.leadTimeDays = data.leadTimeDays;
            if (data.isActive !== undefined) updateData.isActive = data.isActive;

            const service = await prisma.serviceItem.update({
                where: { id: data.id },
                data: updateData,
                include: {
                    party: true,
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
        }
    });

/**
 * Delete a service item
 */
export const deleteService = createServerFn({ method: 'POST' })
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => deleteServiceSchema.parse(input))
    .handler(async ({ data }): Promise<DeleteServiceResult> => {
        try {
            const prisma = await getPrisma();
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
        }
    });

// ============================================
// PARTIES SERVER FUNCTION
// ============================================

export interface Party {
    id: string;
    name: string;
    category: string;
    email: string | null;
    phone: string | null;
    isActive: boolean;
}

interface GetPartiesResult {
    success: true;
    parties: Party[];
}

// ============================================
// COLOUR TRANSACTION MUTATIONS
// ============================================

const createColourTransactionSchema = z.object({
    fabricColourId: z.string().uuid(),
    txnType: z.enum(['inward', 'outward']),
    qty: z.number().positive('Quantity must be positive'),
    unit: z.string().default('meter'),
    reason: z.string().min(1, 'Reason is required'),
    costPerUnit: z.number().nonnegative().optional().nullable(),
    partyId: z.string().uuid().optional().nullable(),
    referenceId: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    receiptDate: z.string().optional().nullable(),
});

interface CreateColourTransactionResult {
    success: true;
    transaction: {
        id: string;
        fabricColourId: string;
        txnType: string;
        qty: number;
        unit: string;
        reason: string;
        costPerUnit: number | null;
        createdAt: Date;
    };
    newBalance: number;
}

/**
 * Create a fabric colour inventory transaction (inward/outward)
 * DB trigger automatically updates FabricColour.currentBalance
 */
export const createColourTransaction = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createColourTransactionSchema.parse(input))
    .handler(async ({ data, context }): Promise<CreateColourTransactionResult> => {
        try {
            const prisma = await getPrisma();

            // Verify fabricColour exists
            const fabricColour = await prisma.fabricColour.findUnique({
                where: { id: data.fabricColourId },
                include: { fabric: { include: { material: true } } },
            });

            if (!fabricColour) {
                throw new Error('Fabric colour not found');
            }

            // Create the transaction
            const newTxn = await prisma.fabricColourTransaction.create({
                data: {
                    fabricColourId: data.fabricColourId,
                    txnType: data.txnType,
                    qty: data.qty,
                    unit: data.unit,
                    reason: data.reason,
                    createdById: context.user.id,
                    ...(data.costPerUnit != null ? { costPerUnit: data.costPerUnit } : {}),
                    ...(data.partyId ? { partyId: data.partyId } : {}),
                    ...(data.referenceId ? { referenceId: data.referenceId } : {}),
                    ...(data.notes ? { notes: data.notes } : {}),
                    ...(data.receiptDate ? { receiptDate: new Date(data.receiptDate) } : {}),
                },
            });

            // Invalidate fabric colour balance cache
            const { fabricColourBalanceCache } = await import('@coh/shared/services/inventory');
            fabricColourBalanceCache.invalidate([data.fabricColourId]);

            // Query updated balance
            const updated = await prisma.fabricColour.findUnique({
                where: { id: data.fabricColourId },
                select: { currentBalance: true },
            });

            return {
                success: true,
                transaction: {
                    id: newTxn.id,
                    fabricColourId: newTxn.fabricColourId,
                    txnType: newTxn.txnType,
                    qty: newTxn.qty,
                    unit: newTxn.unit,
                    reason: newTxn.reason,
                    costPerUnit: newTxn.costPerUnit,
                    createdAt: newTxn.createdAt,
                },
                newBalance: updated?.currentBalance ?? 0,
            };
        } catch (error: unknown) {
            if (isPrismaError(error)) {
                if (error.code === 'P2003') {
                    throw new Error('Invalid reference: fabric colour or party not found');
                }
            }
            throw error;
        }
    });

/**
 * Get all parties
 * Returns a list of all active parties for dropdowns
 */
export const getParties = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<GetPartiesResult> => {
        const prisma = await getPrisma();
        const parties = await prisma.party.findMany({
            where: { isActive: true },
            select: {
                id: true,
                name: true,
                category: true,
                email: true,
                phone: true,
                isActive: true,
            },
            orderBy: { name: 'asc' },
        });

        return {
            success: true,
            parties,
        };
    });

// ============================================
// PARTY MUTATIONS
// ============================================

const createPartySchema = z.object({
    name: z.string().min(1),
    category: z.string().min(1),
    contactName: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
});

type PartySuccessResult = {
    success: true;
    party: PrismaParty;
};

type PartyErrorResult = {
    success: false;
    error: {
        code: 'NOT_FOUND' | 'CONFLICT';
        message: string;
    };
};

/**
 * Create a new party
 */
export const createParty = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createPartySchema.parse(input))
    .handler(async ({ data }): Promise<PartySuccessResult | PartyErrorResult> => {
        const prisma = await getPrisma();

        // Check for duplicate name
        const existing = await prisma.party.findFirst({
            where: { name: data.name },
        });

        if (existing) {
            return {
                success: false,
                error: {
                    code: 'CONFLICT',
                    message: 'A party with this name already exists',
                },
            };
        }

        const party = await prisma.party.create({
            data: {
                name: data.name,
                category: data.category,
                contactName: data.contactName ?? null,
                email: data.email ?? null,
                phone: data.phone ?? null,
                address: data.address ?? null,
            },
        });

        return {
            success: true,
            party,
        };
    });
