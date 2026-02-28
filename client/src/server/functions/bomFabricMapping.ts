/**
 * BOM Fabric Mapping Server Functions
 *
 * Fabric-to-variation assignment: link fabric colours, get assignments, clear mappings.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';
import { getMainFabricRole, type MutationResult } from './bomHelpers';

// ============================================
// INPUT SCHEMAS
// ============================================

const linkFabricToVariationSchema = z.object({
    colourId: z.string().uuid('Invalid colour ID'),
    variationIds: z.array(z.string().uuid()).min(1, 'At least one variation ID is required'),
    roleId: z.string().uuid().optional(),
});

const getFabricAssignmentsSchema = z.object({
    roleId: z.string().optional(),
});

const linkVariationsToColourSchema = z.object({
    colourId: z.string(),
    variationIds: z.array(z.string()),
    roleId: z.string().optional(),
});

const clearVariationsFabricMappingSchema = z.object({
    variationIds: z.array(z.string()).min(1, 'At least one variation ID is required'),
    roleId: z.string().optional(),
});

// ============================================
// RESULT TYPES
// ============================================

export interface LinkFabricResult {
    fabricColour: {
        id: string;
        name: string;
        fabricName: string;
    };
    linked: {
        total: number;
    };
}

export interface FabricAssignment {
    variationId: string;
    colourId: string;
    colourName: string;
    colourHex?: string;
    fabricId: string;
    fabricName: string;
    materialId: string;
    materialName: string;
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Link fabric colour to multiple variations
 * Creates VariationBomLine records for the main fabric role
 * NOTE: BOM is now the single source of truth for fabric assignment
 */
export const linkFabricToVariation = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => linkFabricToVariationSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<LinkFabricResult>> => {
        const prisma = await getPrisma();
        const { colourId, variationIds, roleId } = data;

        // Verify the colour exists
        const colour = await prisma.fabricColour.findUnique({
            where: { id: colourId },
            include: { fabric: true },
        });

        if (!colour) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Fabric colour not found' },
            };
        }

        // Get the main fabric role if not specified
        let targetRoleId = roleId;
        if (!targetRoleId) {
            const mainFabricRole = await getMainFabricRole(prisma);
            if (!mainFabricRole) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Main fabric role not configured' },
                };
            }
            targetRoleId = mainFabricRole.id;
        }

        // Verify variations exist and get their productIds
        const variations = await prisma.variation.findMany({
            where: { id: { in: variationIds } },
            select: { id: true, colorName: true, productId: true, product: { select: { name: true, defaultFabricConsumption: true } } },
        });

        if (variations.length !== variationIds.length) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'One or more variations not found' },
            };
        }

        // Get unique productIds to ensure ProductBomTemplates exist
        const productIds = [...new Set(variations.map(v => v.productId))];
        // Build product default consumption map
        const productDefaultMap = new Map(
            variations.map(v => [v.productId, v.product.defaultFabricConsumption as number | null])
        );

        try {
            // OPTIMIZED: Batch operations instead of sequential loop
            const results = await prisma.$transaction(async (tx: PrismaTransaction) => {
                // Ensure ProductBomTemplate exists for each product+role
                // This is required for BOM cost calculation to work
                for (const productId of productIds) {
                    await tx.productBomTemplate.upsert({
                        where: {
                            productId_roleId: { productId, roleId: targetRoleId! },
                        },
                        update: {}, // Don't change existing template
                        create: {
                            productId,
                            roleId: targetRoleId!,
                            defaultQuantity: productDefaultMap.get(productId) ?? 1.5,
                            quantityUnit: 'meter',
                            wastagePercent: 5, // 5% wastage default
                        },
                    });
                }

                // 1. Find existing BOM lines for these variations
                const existingBomLines = await tx.variationBomLine.findMany({
                    where: {
                        variationId: { in: variationIds },
                        roleId: targetRoleId,
                    },
                    select: { variationId: true },
                });

                const existingVariationIds = new Set(existingBomLines.map((b: { variationId: string }) => b.variationId));

                // 2. Batch update existing BOM lines (single query)
                if (existingVariationIds.size > 0) {
                    await tx.variationBomLine.updateMany({
                        where: {
                            variationId: { in: Array.from(existingVariationIds) },
                            roleId: targetRoleId,
                        },
                        data: { fabricColourId: colourId },
                    });
                }

                // 3. Batch create new BOM lines (single query)
                const newVariationIds = variationIds.filter((id) => !existingVariationIds.has(id));
                if (newVariationIds.length > 0) {
                    await tx.variationBomLine.createMany({
                        data: newVariationIds.map((variationId) => ({
                            variationId,
                            roleId: targetRoleId,
                            fabricColourId: colourId,
                        })),
                    });
                }

                // BOM cost recalculation handled by DB triggers

                return { updated: variationIds };
            }, { timeout: 30000 });

            return {
                success: true,
                data: {
                    fabricColour: {
                        id: colour.id,
                        name: colour.colourName,
                        fabricName: colour.fabric.name,
                    },
                    linked: {
                        total: results.updated.length,
                    },
                },
            };
        } catch (error: unknown) {
            console.error('[bom] linkFabricToVariation failed:', error);
            const message = error instanceof Error ? error.message : 'Failed to link fabric';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Get Fabric Assignments for Fabric Mapping view
 * Returns all fabric assignments for variations
 */
export const getFabricAssignments = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getFabricAssignmentsSchema.parse(input))
    .handler(async ({ data }: { data: z.infer<typeof getFabricAssignmentsSchema> }): Promise<{ assignments: FabricAssignment[] }> => {
        const prisma = await getPrisma();

        let roleId = data.roleId;

        // Get the main fabric role if not specified
        if (!roleId) {
            const mainFabricRole = await getMainFabricRole(prisma);
            if (!mainFabricRole) {
                throw new Error('Main fabric role not configured');
            }
            roleId = mainFabricRole.id;
        }

        // Fetch all variation BOM lines with fabric colour assignments
        const bomLines = await prisma.variationBomLine.findMany({
            where: {
                roleId,
                fabricColourId: { not: null },
            },
            select: {
                variationId: true,
                fabricColourId: true,
                fabricColour: {
                    select: {
                        id: true,
                        colourName: true,
                        colourHex: true,
                        fabricId: true,
                        fabric: {
                            select: {
                                id: true,
                                name: true,
                                materialId: true,
                                material: {
                                    select: {
                                        id: true,
                                        name: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        // Transform to flat response
        const assignments: FabricAssignment[] = bomLines.map((line) => ({
            variationId: line.variationId,
            colourId: line.fabricColour?.id || '',
            colourName: line.fabricColour?.colourName || '',
            colourHex: line.fabricColour?.colourHex || undefined,
            fabricId: line.fabricColour?.fabric?.id || '',
            fabricName: line.fabricColour?.fabric?.name || '',
            materialId: line.fabricColour?.fabric?.material?.id || '',
            materialName: line.fabricColour?.fabric?.material?.name || '',
        }));

        return { assignments };
    });

/**
 * Link Variations to Fabric Colour
 * Creates VariationBomLine records for the main fabric role
 */
export const linkVariationsToColour = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => linkVariationsToColourSchema.parse(input))
    .handler(async ({ data }: { data: z.infer<typeof linkVariationsToColourSchema> }): Promise<{
        success: boolean;
        fabricColour?: { id: string; name: string; fabricName: string };
        linked?: { total: number };
        error?: { code: string; message: string };
    }> => {
        const prisma = await getPrisma();

        try {
            const { colourId, variationIds, roleId } = data;

            if (!variationIds || variationIds.length === 0) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'variationIds array is required' },
                };
            }

            // Verify the colour exists
            const colour = await prisma.fabricColour.findUnique({
                where: { id: colourId },
                include: { fabric: true },
            });

            if (!colour) {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: 'Fabric colour not found' },
                };
            }

            // Get the main fabric role if not specified
            let targetRoleId = roleId;
            if (!targetRoleId) {
                const mainFabricRole = await getMainFabricRole(prisma);
                if (!mainFabricRole) {
                    return {
                        success: false,
                        error: { code: 'SERVER_ERROR', message: 'Main fabric role not configured' },
                    };
                }
                targetRoleId = mainFabricRole.id;
            }

            // Verify variations exist and get their productIds
            const variations = await prisma.variation.findMany({
                where: { id: { in: variationIds } },
                select: { id: true, colorName: true, productId: true, product: { select: { name: true, defaultFabricConsumption: true } } },
            });

            if (variations.length !== variationIds.length) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'One or more variations not found' },
                };
            }

            // Get unique productIds to ensure ProductBomTemplates exist
            const productIds = [...new Set(variations.map(v => v.productId))];
            const productDefaultMap2 = new Map(
                variations.map(v => [v.productId, v.product.defaultFabricConsumption as number | null])
            );

            // Create/update BOM lines - BOM is now the single source of truth for fabric
            const results = await prisma.$transaction(async (tx) => {
                // Ensure ProductBomTemplate exists for each product+role
                // This is required for BOM cost calculation to work
                for (const productId of productIds) {
                    await tx.productBomTemplate.upsert({
                        where: {
                            productId_roleId: { productId, roleId: targetRoleId! },
                        },
                        update: {}, // Don't change existing template
                        create: {
                            productId,
                            roleId: targetRoleId!,
                            defaultQuantity: productDefaultMap2.get(productId) ?? 1.5,
                            quantityUnit: 'meter',
                            wastagePercent: 5, // 5% wastage default
                        },
                    });
                }

                const updated: string[] = [];

                for (const variation of variations) {
                    // Create/update the BOM line with the fabric colour
                    await tx.variationBomLine.upsert({
                        where: {
                            variationId_roleId: {
                                variationId: variation.id,
                                roleId: targetRoleId!,
                            },
                        },
                        update: { fabricColourId: colourId },
                        create: {
                            variationId: variation.id,
                            roleId: targetRoleId!,
                            fabricColourId: colourId,
                        },
                    });

                    updated.push(variation.id);
                }

                // BOM cost recalculation handled by DB triggers

                return { updated };
            }, {
                timeout: 30000,
            });

            return {
                success: true,
                fabricColour: {
                    id: colour.id,
                    name: colour.colourName,
                    fabricName: colour.fabric.name,
                },
                linked: {
                    total: results.updated.length,
                },
            };
        } catch (error: unknown) {
            console.error('[bom] linkVariationsToColour failed:', error);
            const message = error instanceof Error ? error.message : 'Failed to link variations';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Clear Fabric Mapping for Variations
 * Removes the fabric colour assignment from variations and deletes BOM lines
 */
export const clearVariationsFabricMapping = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => clearVariationsFabricMappingSchema.parse(input))
    .handler(async ({ data }: { data: z.infer<typeof clearVariationsFabricMappingSchema> }): Promise<{
        success: boolean;
        cleared?: { total: number };
        error?: { code: string; message: string };
    }> => {
        const prisma = await getPrisma();

        try {
            const { variationIds, roleId } = data;

            // Get the main fabric role if not specified
            let targetRoleId = roleId;
            if (!targetRoleId) {
                const mainFabricRole = await getMainFabricRole(prisma);
                if (!mainFabricRole) {
                    return {
                        success: false,
                        error: { code: 'SERVER_ERROR', message: 'Main fabric role not configured' },
                    };
                }
                targetRoleId = mainFabricRole.id;
            }

            // Verify variations exist
            const variations = await prisma.variation.findMany({
                where: { id: { in: variationIds } },
                select: { id: true },
            });

            if (variations.length === 0) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'No valid variations found' },
                };
            }

            // Clear fabric assignments by deleting BOM lines
            // NOTE: BOM is now the single source of truth - no variation fields to update
            await prisma.$transaction(async (tx) => {
                // Delete the BOM lines for the main fabric role
                await tx.variationBomLine.deleteMany({
                    where: {
                        variationId: { in: variationIds },
                        roleId: targetRoleId!,
                    },
                });
            }, {
                timeout: 30000,
            });

            return {
                success: true,
                cleared: { total: variations.length },
            };
        } catch (error: unknown) {
            console.error('[bom] clearVariationsFabricMapping failed:', error);
            const message = error instanceof Error ? error.message : 'Failed to clear fabric mapping';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });
