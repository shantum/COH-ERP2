/**
 * Materials Hierarchy Query Server Functions
 *
 * TanStack Start Server Functions for querying Material → Fabric → Colour hierarchy.
 * Provides both hierarchical tree views and flat lists for dropdowns.
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

const getMaterialsHierarchySchema = z.object({
    view: z.enum(['material', 'fabric']).optional().default('material'),
    materialId: z.string().uuid().optional(),
    fabricId: z.string().uuid().optional(),
    search: z.string().optional(),
});

const getMaterialsFlatSchema = z.object({
    level: z.enum(['materials', 'fabrics', 'colours']).default('materials'),
    materialId: z.string().uuid().optional(),
    fabricId: z.string().uuid().optional(),
    activeOnly: z.boolean().optional().default(true),
    search: z.string().optional(),
});

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get full materials hierarchy tree
 *
 * Returns the 3-tier hierarchy with proper nesting:
 * - Material → Fabrics → Colours
 *
 * Supports filtering by materialId, fabricId, or search term.
 * Includes inheritance calculation for cost/lead/minOrder.
 */
export const getMaterialsHierarchy = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getMaterialsHierarchySchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            // Build where clause based on filters
            const where: any = {};

            if (data.materialId) {
                where.id = data.materialId;
            }

            if (data.search) {
                where.name = {
                    contains: data.search,
                    mode: 'insensitive',
                };
            }

            // Fetch materials with nested fabrics and colours
            const materials = await prisma.material.findMany({
                where,
                include: {
                    fabrics: {
                        where: data.fabricId
                            ? { id: data.fabricId }
                            : undefined,
                        include: {
                            colours: {
                                include: {
                                    supplier: true,
                                },
                                orderBy: {
                                    colourName: 'asc',
                                },
                            },
                            supplier: true,
                        },
                        orderBy: {
                            name: 'asc',
                        },
                    },
                },
                orderBy: {
                    name: 'asc',
                },
            });

            // Transform into tree structure with inheritance calculations
            const tree = materials.map((material) => ({
                id: material.id,
                type: 'material' as const,
                name: material.name,
                description: material.description,
                isActive: material.isActive,
                createdAt: material.createdAt.toISOString(),
                updatedAt: material.updatedAt.toISOString(),
                children: material.fabrics.map((fabric) => ({
                    id: fabric.id,
                    type: 'fabric' as const,
                    materialId: fabric.materialId,
                    materialName: material.name,
                    name: fabric.name,
                    constructionType: fabric.constructionType,
                    pattern: fabric.pattern,
                    weight: fabric.weight,
                    weightUnit: fabric.weightUnit,
                    composition: fabric.composition,
                    avgShrinkagePct: fabric.avgShrinkagePct,
                    unit: fabric.unit,
                    costPerUnit: fabric.costPerUnit,
                    defaultLeadTimeDays: fabric.defaultLeadTimeDays,
                    defaultMinOrderQty: fabric.defaultMinOrderQty,
                    supplierId: fabric.supplierId,
                    supplierName: fabric.supplier?.name,
                    isActive: fabric.isActive,
                    colourCount: fabric.colours.length,
                    children: fabric.colours.map((colour) => ({
                        id: colour.id,
                        type: 'colour' as const,
                        fabricId: colour.fabricId,
                        fabricName: fabric.name,
                        materialId: fabric.materialId,
                        materialName: material.name,
                        colourName: colour.colourName,
                        standardColour: colour.standardColour,
                        colourHex: colour.colourHex,
                        // Effective values with inheritance
                        costPerUnit: colour.costPerUnit,
                        effectiveCostPerUnit: colour.costPerUnit ?? fabric.costPerUnit,
                        costInherited: colour.costPerUnit === null,
                        leadTimeDays: colour.leadTimeDays,
                        effectiveLeadTimeDays: colour.leadTimeDays ?? fabric.defaultLeadTimeDays,
                        leadTimeInherited: colour.leadTimeDays === null,
                        minOrderQty: colour.minOrderQty,
                        effectiveMinOrderQty: colour.minOrderQty ?? fabric.defaultMinOrderQty,
                        minOrderInherited: colour.minOrderQty === null,
                        supplierId: colour.supplierId,
                        supplierName: colour.supplier?.name,
                        isActive: colour.isActive,
                        createdAt: colour.createdAt.toISOString(),
                        updatedAt: colour.updatedAt.toISOString(),
                    })),
                })),
            }));

            return {
                success: true,
                tree,
                totalMaterials: materials.length,
                totalFabrics: materials.reduce((sum, m) => sum + m.fabrics.length, 0),
                totalColours: materials.reduce(
                    (sum, m) => sum + m.fabrics.reduce((fSum, f) => fSum + f.colours.length, 0),
                    0
                ),
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get flat list of materials/fabrics/colours
 *
 * Used for dropdowns, autocompletes, and simple lists.
 * Supports filtering by parent and active status.
 */
export const getMaterialsFlat = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getMaterialsFlatSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            if (data.level === 'materials') {
                // Fetch materials
                const materials = await prisma.material.findMany({
                    where: {
                        ...(data.activeOnly && { isActive: true }),
                        ...(data.search && {
                            name: {
                                contains: data.search,
                                mode: 'insensitive',
                            },
                        }),
                    },
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        isActive: true,
                        _count: {
                            select: {
                                fabrics: true,
                            },
                        },
                    },
                    orderBy: {
                        name: 'asc',
                    },
                });

                return {
                    success: true,
                    items: materials.map((m) => ({
                        id: m.id,
                        name: m.name,
                        description: m.description,
                        isActive: m.isActive,
                        fabricCount: m._count.fabrics,
                    })),
                };
            }

            if (data.level === 'fabrics') {
                // Fetch fabrics
                const fabrics = await prisma.fabric.findMany({
                    where: {
                        ...(data.materialId && { materialId: data.materialId }),
                        ...(data.activeOnly && { isActive: true }),
                        ...(data.search && {
                            name: {
                                contains: data.search,
                                mode: 'insensitive',
                            },
                        }),
                    },
                    select: {
                        id: true,
                        materialId: true,
                        name: true,
                        constructionType: true,
                        pattern: true,
                        weight: true,
                        weightUnit: true,
                        composition: true,
                        costPerUnit: true,
                        isActive: true,
                        material: {
                            select: {
                                name: true,
                            },
                        },
                        _count: {
                            select: {
                                colours: true,
                            },
                        },
                    },
                    orderBy: {
                        name: 'asc',
                    },
                });

                return {
                    success: true,
                    items: fabrics.map((f) => ({
                        id: f.id,
                        materialId: f.materialId,
                        materialName: f.material?.name || '',
                        name: f.name,
                        constructionType: f.constructionType,
                        pattern: f.pattern,
                        weight: f.weight,
                        weightUnit: f.weightUnit,
                        composition: f.composition,
                        costPerUnit: f.costPerUnit,
                        isActive: f.isActive,
                        colourCount: f._count.colours,
                    })),
                };
            }

            if (data.level === 'colours') {
                // Fetch colours
                const colours = await prisma.fabricColour.findMany({
                    where: {
                        ...(data.fabricId && { fabricId: data.fabricId }),
                        ...(data.activeOnly && { isActive: true }),
                        ...(data.search && {
                            colourName: {
                                contains: data.search,
                                mode: 'insensitive',
                            },
                        }),
                    },
                    select: {
                        id: true,
                        fabricId: true,
                        colourName: true,
                        standardColour: true,
                        colourHex: true,
                        costPerUnit: true,
                        leadTimeDays: true,
                        minOrderQty: true,
                        isActive: true,
                        fabric: {
                            select: {
                                name: true,
                                costPerUnit: true,
                                defaultLeadTimeDays: true,
                                defaultMinOrderQty: true,
                                material: {
                                    select: {
                                        name: true,
                                    },
                                },
                            },
                        },
                    },
                    orderBy: {
                        colourName: 'asc',
                    },
                });

                return {
                    success: true,
                    items: colours.map((c) => ({
                        id: c.id,
                        fabricId: c.fabricId,
                        fabricName: c.fabric.name,
                        materialName: c.fabric.material?.name || '',
                        colourName: c.colourName,
                        standardColour: c.standardColour,
                        colourHex: c.colourHex,
                        costPerUnit: c.costPerUnit,
                        effectiveCostPerUnit: c.costPerUnit ?? c.fabric.costPerUnit,
                        costInherited: c.costPerUnit === null,
                        leadTimeDays: c.leadTimeDays,
                        effectiveLeadTimeDays: c.leadTimeDays ?? c.fabric.defaultLeadTimeDays,
                        leadTimeInherited: c.leadTimeDays === null,
                        minOrderQty: c.minOrderQty,
                        effectiveMinOrderQty: c.minOrderQty ?? c.fabric.defaultMinOrderQty,
                        minOrderInherited: c.minOrderQty === null,
                        isActive: c.isActive,
                    })),
                };
            }

            throw new Error(`Invalid level: ${data.level}`);
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Get filters metadata for materials hierarchy
 *
 * Returns available filters: materials, construction types, patterns, etc.
 */
export const getMaterialsFilters = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async () => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            // Get unique values for filters
            const [materials, constructionTypes, patterns, suppliers] = await Promise.all([
                prisma.material.findMany({
                    where: { isActive: true },
                    select: {
                        id: true,
                        name: true,
                    },
                    orderBy: {
                        name: 'asc',
                    },
                }),
                prisma.fabric.findMany({
                    where: {
                        constructionType: { not: null },
                        isActive: true,
                    },
                    select: {
                        constructionType: true,
                    },
                    distinct: ['constructionType'],
                }),
                prisma.fabric.findMany({
                    where: {
                        pattern: { not: null },
                        isActive: true,
                    },
                    select: {
                        pattern: true,
                    },
                    distinct: ['pattern'],
                }),
                prisma.supplier.findMany({
                    where: { isActive: true },
                    select: {
                        id: true,
                        name: true,
                    },
                    orderBy: {
                        name: 'asc',
                    },
                }),
            ]);

            return {
                success: true,
                filters: {
                    materials: materials.map((m) => ({ id: m.id, name: m.name })),
                    constructionTypes: constructionTypes
                        .map((ct) => ct.constructionType)
                        .filter((ct): ct is string => ct !== null)
                        .sort(),
                    patterns: patterns
                        .map((p) => p.pattern)
                        .filter((p): p is string => p !== null)
                        .sort(),
                    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
                },
            };
        } finally {
            await prisma.$disconnect();
        }
    });
