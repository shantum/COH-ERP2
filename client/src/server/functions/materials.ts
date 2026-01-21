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

// ============================================
// TRIMS QUERY FUNCTIONS
// ============================================

const getTrimsSchema = z.object({
    category: z.string().optional(),
    search: z.string().optional(),
});

/**
 * Get trims catalog
 *
 * Returns flat list of trim items with supplier info.
 * Supports filtering by category and search term.
 */
export const getTrims = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getTrimsSchema.parse(input ?? {}))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const trims = await prisma.trimItem.findMany({
                where: {
                    ...(data.category && { category: data.category }),
                    ...(data.search && {
                        OR: [
                            { name: { contains: data.search, mode: 'insensitive' as const } },
                            { code: { contains: data.search, mode: 'insensitive' as const } },
                        ],
                    }),
                },
                include: {
                    supplier: { select: { id: true, name: true } },
                    _count: {
                        select: {
                            productBomTemplates: true,
                        },
                    },
                },
                orderBy: [{ category: 'asc' }, { name: 'asc' }],
            });

            const items = trims.map((t) => ({
                id: t.id,
                code: t.code,
                name: t.name,
                category: t.category,
                description: t.description,
                costPerUnit: t.costPerUnit,
                unit: t.unit,
                supplierId: t.supplierId,
                supplierName: t.supplier?.name || null,
                leadTimeDays: t.leadTimeDays,
                minOrderQty: t.minOrderQty,
                usageCount: t._count.productBomTemplates,
                isActive: t.isActive,
                createdAt: t.createdAt.toISOString(),
                updatedAt: t.updatedAt.toISOString(),
            }));

            return {
                success: true,
                items,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

// ============================================
// SERVICES QUERY FUNCTIONS
// ============================================

const getServicesSchema = z.object({
    category: z.string().optional(),
    search: z.string().optional(),
});

/**
 * Get services catalog
 *
 * Returns flat list of service items with vendor info.
 * Supports filtering by category and search term.
 */
export const getServices = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getServicesSchema.parse(input ?? {}))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const services = await prisma.serviceItem.findMany({
                where: {
                    ...(data.category && { category: data.category }),
                    ...(data.search && {
                        OR: [
                            { name: { contains: data.search, mode: 'insensitive' as const } },
                            { code: { contains: data.search, mode: 'insensitive' as const } },
                        ],
                    }),
                },
                include: {
                    vendor: { select: { id: true, name: true } },
                    _count: {
                        select: {
                            productBomTemplates: true,
                        },
                    },
                },
                orderBy: [{ category: 'asc' }, { name: 'asc' }],
            });

            const items = services.map((s) => ({
                id: s.id,
                code: s.code,
                name: s.name,
                category: s.category,
                description: s.description,
                costPerJob: s.costPerJob,
                costUnit: s.costUnit,
                vendorId: s.vendorId,
                vendorName: s.vendor?.name || null,
                leadTimeDays: s.leadTimeDays,
                usageCount: s._count.productBomTemplates,
                isActive: s.isActive,
                createdAt: s.createdAt.toISOString(),
                updatedAt: s.updatedAt.toISOString(),
            }));

            return {
                success: true,
                items,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

// ============================================
// MATERIALS FILTERS
// ============================================

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

// ============================================
// MATERIALS TREE FUNCTIONS (for TanStack Table)
// ============================================

const getMaterialsTreeSchema = z.object({
    lazyLoad: z.boolean().optional().default(false),
});

/**
 * Get materials tree for TanStack Table display
 *
 * Returns the 3-tier hierarchy: Material → Fabric → Colour
 * with counts and stock information for display.
 */
export const getMaterialsTree = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getMaterialsTreeSchema.parse(input ?? {}))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            // For lazy loading, only fetch top-level materials
            if (data.lazyLoad) {
                const materials = await prisma.material.findMany({
                    include: {
                        _count: {
                            select: { fabrics: true },
                        },
                    },
                    orderBy: { name: 'asc' },
                });

                const items = materials.map((m) => ({
                    id: m.id,
                    type: 'material' as const,
                    name: m.name,
                    description: m.description,
                    isActive: m.isActive,
                    fabricCount: m._count.fabrics,
                    colourCount: 0, // Will be loaded lazily
                    totalStock: 0,
                    hasChildren: m._count.fabrics > 0,
                    children: undefined,
                }));

                return {
                    success: true,
                    items,
                    summary: {
                        totalMaterials: materials.length,
                        totalFabrics: 0,
                        totalColours: 0,
                    },
                };
            }

            // Full tree load (non-lazy)
            const materials = await prisma.material.findMany({
                include: {
                    fabrics: {
                        include: {
                            colours: {
                                include: {
                                    supplier: { select: { id: true, name: true } },
                                },
                                orderBy: { colourName: 'asc' },
                            },
                            supplier: { select: { id: true, name: true } },
                        },
                        orderBy: { name: 'asc' },
                    },
                },
                orderBy: { name: 'asc' },
            });

            // Build tree - using inline type assertions for the response
            const items = materials.map((material) => ({
                id: material.id,
                type: 'material' as const,
                name: material.name,
                description: material.description,
                isActive: material.isActive,
                fabricCount: material.fabrics.length,
                colourCount: material.fabrics.reduce((sum, f) => sum + f.colours.length, 0),
                totalStock: 0, // Could calculate from inventory if needed
                hasChildren: material.fabrics.length > 0,
                children: material.fabrics.map((fabric) => ({
                    id: fabric.id,
                    type: 'fabric' as const,
                    name: fabric.name,
                    materialId: fabric.materialId,
                    materialName: material.name,
                    constructionType: fabric.constructionType,
                    pattern: fabric.pattern,
                    weight: fabric.weight,
                    weightUnit: fabric.weightUnit,
                    composition: fabric.composition,
                    avgShrinkagePct: fabric.avgShrinkagePct,
                    unit: fabric.unit,
                    costPerUnit: fabric.costPerUnit,
                    leadTimeDays: fabric.defaultLeadTimeDays,
                    minOrderQty: fabric.defaultMinOrderQty,
                    supplierId: fabric.supplierId,
                    supplierName: fabric.supplier?.name,
                    isActive: fabric.isActive,
                    colourCount: fabric.colours.length,
                    hasChildren: fabric.colours.length > 0,
                    children: fabric.colours.map((colour) => ({
                        id: colour.id,
                        type: 'colour' as const,
                        name: colour.colourName,
                        colourName: colour.colourName,
                        fabricId: colour.fabricId,
                        fabricName: fabric.name,
                        materialId: fabric.materialId,
                        materialName: material.name,
                        standardColour: colour.standardColour,
                        colourHex: colour.colourHex,
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
                        connectedProducts: 0, // Could count VariationBomLine references
                    })),
                })),
            }));

            return {
                success: true,
                items,
                summary: {
                    totalMaterials: materials.length,
                    totalFabrics: materials.reduce((sum, m) => sum + m.fabrics.length, 0),
                    totalColours: materials.reduce(
                        (sum, m) => sum + m.fabrics.reduce((fSum, f) => fSum + f.colours.length, 0),
                        0
                    ),
                },
            };
        } finally {
            await prisma.$disconnect();
        }
    });

const getMaterialsTreeChildrenSchema = z.object({
    parentId: z.string().uuid('Invalid parent ID'),
    parentType: z.enum(['material', 'fabric']),
});

/**
 * Get children for lazy loading in tree view
 */
export const getMaterialsTreeChildren = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getMaterialsTreeChildrenSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            if (data.parentType === 'material') {
                // Get fabrics under this material
                const fabrics = await prisma.fabric.findMany({
                    where: { materialId: data.parentId },
                    include: {
                        material: { select: { name: true } },
                        supplier: { select: { id: true, name: true } },
                        _count: { select: { colours: true } },
                    },
                    orderBy: { name: 'asc' },
                });

                const items = fabrics.map((fabric) => ({
                    id: fabric.id,
                    type: 'fabric' as const,
                    name: fabric.name,
                    materialId: fabric.materialId,
                    materialName: fabric.material?.name,
                    constructionType: fabric.constructionType,
                    pattern: fabric.pattern,
                    weight: fabric.weight,
                    weightUnit: fabric.weightUnit,
                    composition: fabric.composition,
                    avgShrinkagePct: fabric.avgShrinkagePct,
                    unit: fabric.unit,
                    costPerUnit: fabric.costPerUnit,
                    leadTimeDays: fabric.defaultLeadTimeDays,
                    minOrderQty: fabric.defaultMinOrderQty,
                    supplierId: fabric.supplierId,
                    supplierName: fabric.supplier?.name,
                    isActive: fabric.isActive,
                    colourCount: fabric._count.colours,
                    hasChildren: fabric._count.colours > 0,
                }));

                return { success: true, items };
            } else {
                // Get colours under this fabric
                const colours = await prisma.fabricColour.findMany({
                    where: { fabricId: data.parentId },
                    include: {
                        fabric: {
                            include: {
                                material: { select: { name: true } },
                            },
                        },
                        supplier: { select: { id: true, name: true } },
                    },
                    orderBy: { colourName: 'asc' },
                });

                const items = colours.map((colour) => ({
                    id: colour.id,
                    type: 'colour' as const,
                    name: colour.colourName,
                    colourName: colour.colourName,
                    fabricId: colour.fabricId,
                    fabricName: colour.fabric.name,
                    materialId: colour.fabric.materialId,
                    materialName: colour.fabric.material?.name,
                    standardColour: colour.standardColour,
                    colourHex: colour.colourHex,
                    costPerUnit: colour.costPerUnit,
                    effectiveCostPerUnit: colour.costPerUnit ?? colour.fabric.costPerUnit,
                    costInherited: colour.costPerUnit === null,
                    leadTimeDays: colour.leadTimeDays,
                    effectiveLeadTimeDays: colour.leadTimeDays ?? colour.fabric.defaultLeadTimeDays,
                    leadTimeInherited: colour.leadTimeDays === null,
                    minOrderQty: colour.minOrderQty,
                    effectiveMinOrderQty: colour.minOrderQty ?? colour.fabric.defaultMinOrderQty,
                    minOrderInherited: colour.minOrderQty === null,
                    supplierId: colour.supplierId,
                    supplierName: colour.supplier?.name,
                    isActive: colour.isActive,
                }));

                return { success: true, items };
            }
        } finally {
            await prisma.$disconnect();
        }
    });

// ============================================
// COLOUR TRANSACTIONS
// ============================================

const getColourTransactionsSchema = z.object({
    colourId: z.string().uuid('Invalid colour ID'),
    limit: z.number().int().positive().optional().default(50),
});

/**
 * Get transactions for a fabric colour
 *
 * NOTE: FabricColour uses a different inventory model than legacy Fabric.
 * This returns an empty result with a message as colour transactions
 * are not yet implemented in the schema.
 */
export const getColourTransactions = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getColourTransactionsSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            // Verify colour exists
            const colour = await prisma.fabricColour.findUnique({
                where: { id: data.colourId },
                select: { id: true, colourName: true },
            });

            if (!colour) {
                return {
                    success: false,
                    error: 'Colour not found',
                };
            }

            // FabricColour inventory transactions are not yet implemented
            // Return empty items with a message
            return {
                success: true,
                items: [],
                message: 'Colour inventory tracking is not yet implemented',
            };
        } finally {
            await prisma.$disconnect();
        }
    });

// ============================================
// VARIATION SEARCH (for LinkProductsModal)
// ============================================

const searchVariationsSchema = z.object({
    q: z.string().optional().default(''),
    limit: z.number().int().positive().optional().default(50),
});

/**
 * Search product variations for fabric linking
 */
export const searchVariations = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => searchVariationsSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        try {
            const where: Record<string, unknown> = { isActive: true };

            if (data.q && data.q.length >= 2) {
                where.OR = [
                    { colorName: { contains: data.q, mode: 'insensitive' } },
                    { product: { name: { contains: data.q, mode: 'insensitive' } } },
                    { product: { styleCode: { contains: data.q, mode: 'insensitive' } } },
                ];
            }

            const variations = await prisma.variation.findMany({
                where,
                include: {
                    product: {
                        select: { id: true, name: true, styleCode: true },
                    },
                    fabric: {
                        select: { id: true, name: true },
                    },
                    bomLines: {
                        where: {
                            role: {
                                code: 'main',
                                type: { code: 'FABRIC' },
                            },
                        },
                        include: {
                            fabricColour: {
                                select: { id: true, colourName: true },
                            },
                        },
                        take: 1,
                    },
                },
                orderBy: [
                    { product: { name: 'asc' } },
                    { colorName: 'asc' },
                ],
                take: data.limit,
            });

            const results = variations.map((v) => {
                const mainFabricLine = v.bomLines[0];
                return {
                    id: v.id,
                    colorName: v.colorName,
                    imageUrl: v.imageUrl,
                    product: {
                        id: v.product.id,
                        name: v.product.name,
                        styleCode: v.product.styleCode,
                    },
                    currentFabric: v.fabric ? {
                        id: v.fabric.id,
                        name: v.fabric.name,
                    } : null,
                    currentFabricColour: mainFabricLine?.fabricColour ? {
                        id: mainFabricLine.fabricColour.id,
                        colourName: mainFabricLine.fabricColour.colourName,
                    } : null,
                    hasMainFabricAssignment: !!mainFabricLine?.fabricColourId,
                };
            });

            return {
                success: true,
                items: results,
            };
        } finally {
            await prisma.$disconnect();
        }
    });
