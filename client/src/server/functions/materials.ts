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
import type { Prisma } from '@prisma/client';
import { getPrisma } from '@coh/shared/services/db';
import { getFabricSalesMetricsKysely, type FabricSalesMetrics } from '@coh/shared/services/db/queries';

// ============================================
// CACHES
// ============================================

/**
 * Cache for 30-day fabric sales metrics (shared across all users)
 * TTL: 5 minutes - 30-day window is naturally stable, slight staleness is acceptable
 */
let fabricMetricsCache: {
    data: Map<string, FabricSalesMetrics> | null;
    timestamp: number;
} = { data: null, timestamp: 0 };

const FABRIC_METRICS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached fabric metrics or fetch fresh data
 */
async function getFabricMetricsCached(): Promise<Map<string, FabricSalesMetrics>> {
    const now = Date.now();
    if (fabricMetricsCache.data && (now - fabricMetricsCache.timestamp) < FABRIC_METRICS_CACHE_TTL) {
        return fabricMetricsCache.data;
    }

    const data = await getFabricSalesMetricsKysely();
    fabricMetricsCache = { data, timestamp: now };
    return data;
}

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
        const prisma = await getPrisma();
            // Build where clause based on filters
            const where: Prisma.MaterialWhereInput = {};

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
                                    party: true,
                                },
                                orderBy: {
                                    colourName: 'asc',
                                },
                            },
                            party: true,
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
            const tree = materials.map((material: typeof materials[number]) => ({
                id: material.id,
                type: 'material' as const,
                name: material.name,
                description: material.description,
                isActive: material.isActive,
                createdAt: material.createdAt.toISOString(),
                updatedAt: material.updatedAt.toISOString(),
                children: material.fabrics.map((fabric: typeof material.fabrics[number]) => ({
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
                    partyId: fabric.partyId,
                    partyName: fabric.party?.name,
                    isActive: fabric.isActive,
                    colourCount: fabric.colours.length,
                    children: fabric.colours.map((colour: typeof fabric.colours[number]) => ({
                        id: colour.id,
                        type: 'colour' as const,
                        code: colour.code ?? null,
                        fabricId: colour.fabricId,
                        fabricName: fabric.name,
                        materialId: fabric.materialId,
                        materialName: material.name,
                        colourName: colour.colourName,
                        standardColour: colour.standardColour,
                        colourHex: colour.colourHex,
                        // Inherit unit from parent fabric
                        unit: fabric.unit,
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
                        partyId: colour.partyId,
                        partyName: colour.party?.name,
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
                totalFabrics: materials.reduce((sum: number, m: typeof materials[number]) => sum + m.fabrics.length, 0),
                totalColours: materials.reduce(
                    (sum: number, m: typeof materials[number]) => sum + m.fabrics.reduce((fSum: number, f: typeof m.fabrics[number]) => fSum + f.colours.length, 0),
                    0
                ),
            };
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
        const prisma = await getPrisma();
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
                    items: materials.map((m: typeof materials[number]) => ({
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
                    items: fabrics.map((f: typeof fabrics[number]) => ({
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
                    items: colours.map((c: typeof colours[number]) => ({
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
 * Returns flat list of trim items with party info.
 * Supports filtering by category and search term.
 */
export const getTrims = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getTrimsSchema.parse(input ?? {}))
    .handler(async ({ data }) => {
        const prisma = await getPrisma();
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
                    party: { select: { id: true, name: true } },
                    _count: {
                        select: {
                            productBomTemplates: true,
                        },
                    },
                },
                orderBy: [{ category: 'asc' }, { name: 'asc' }],
            });

            const items = trims.map((t: typeof trims[number]) => ({
                id: t.id,
                code: t.code,
                name: t.name,
                category: t.category,
                description: t.description,
                costPerUnit: t.costPerUnit,
                unit: t.unit,
                partyId: t.partyId,
                partyName: t.party?.name || null,
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
 * Returns flat list of service items with party info.
 * Supports filtering by category and search term.
 */
export const getServices = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getServicesSchema.parse(input ?? {}))
    .handler(async ({ data }) => {
        const prisma = await getPrisma();
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
                    party: { select: { id: true, name: true } },
                    _count: {
                        select: {
                            productBomTemplates: true,
                        },
                    },
                },
                orderBy: [{ category: 'asc' }, { name: 'asc' }],
            });

            const items = services.map((s: typeof services[number]) => ({
                id: s.id,
                code: s.code,
                name: s.name,
                category: s.category,
                description: s.description,
                costPerJob: s.costPerJob,
                costUnit: s.costUnit,
                partyId: s.partyId,
                partyName: s.party?.name || null,
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
    });

// ============================================
// MATERIALS FILTERS
// ============================================

/** Materials filters response type */
export interface MaterialsFiltersResponse {
    success: true;
    filters: {
        materials: Array<{ id: string; name: string }>;
        constructionTypes: string[];
        patterns: string[];
        parties: Array<{ id: string; name: string }>;
    };
}

/**
 * Get filters metadata for materials hierarchy
 *
 * Returns available filters: materials, construction types, patterns, etc.
 */
export const getMaterialsFilters = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MaterialsFiltersResponse> => {
        const prisma = await getPrisma();
            // Get unique values for filters
            const [materials, constructionTypes, patterns, parties] = await Promise.all([
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
                prisma.party.findMany({
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
                    materials: materials.map((m: typeof materials[number]) => ({ id: m.id, name: m.name })),
                    constructionTypes: constructionTypes
                        .map((ct: typeof constructionTypes[number]) => ct.constructionType)
                        .filter((ct: string | null): ct is string => ct !== null)
                        .sort(),
                    patterns: patterns
                        .map((p: typeof patterns[number]) => p.pattern)
                        .filter((p: string | null): p is string => p !== null)
                        .sort(),
                    parties: parties.map((s: typeof parties[number]) => ({ id: s.id, name: s.name })),
                },
            };
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
        const prisma = await getPrisma();
            // For lazy loading, only fetch top-level materials
            if (data.lazyLoad) {
                const materials = await prisma.material.findMany({
                    where: { isActive: true },
                    include: {
                        _count: {
                            select: { fabrics: { where: { isActive: true } } },
                        },
                    },
                    orderBy: { name: 'asc' },
                });

                const items = materials.map((m: typeof materials[number]) => ({
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
                where: { isActive: true },
                include: {
                    fabrics: {
                        where: { isActive: true },
                        include: {
                            colours: {
                                where: { isActive: true },
                                include: {
                                    party: { select: { id: true, name: true } },
                                    variationBomLines: {
                                        include: {
                                            variation: {
                                                include: {
                                                    product: {
                                                        select: { id: true, name: true, styleCode: true },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                                orderBy: { colourName: 'asc' },
                            },
                            party: { select: { id: true, name: true } },
                        },
                        orderBy: { name: 'asc' },
                    },
                },
                orderBy: { name: 'asc' },
            });

            // Collect all colour IDs to batch-fetch balances
            const allColourIds: string[] = [];
            for (const material of materials) {
                for (const fabric of material.fabrics) {
                    for (const colour of fabric.colours) {
                        allColourIds.push(colour.id);
                    }
                }
            }

            // Batch fetch balances and 30-day metrics in parallel
            const [balanceMap, salesMetricsMap] = await Promise.all([
                // Balance calculation
                (async () => {
                    const map = new Map<string, number>();
                    if (allColourIds.length > 0) {
                        const aggregations = await prisma.fabricColourTransaction.groupBy({
                            by: ['fabricColourId', 'txnType'],
                            where: { fabricColourId: { in: allColourIds } },
                            _sum: { qty: true },
                        });

                        // Build totals per colour
                        const colourTotals = new Map<string, { inward: number; outward: number }>();
                        for (const agg of aggregations) {
                            if (!colourTotals.has(agg.fabricColourId)) {
                                colourTotals.set(agg.fabricColourId, { inward: 0, outward: 0 });
                            }
                            const totals = colourTotals.get(agg.fabricColourId)!;
                            if (agg.txnType === 'inward') {
                                totals.inward = Number(agg._sum.qty) || 0;
                            } else if (agg.txnType === 'outward') {
                                totals.outward = Number(agg._sum.qty) || 0;
                            }
                        }

                        // Calculate balance: inward - outward
                        for (const [colourId, totals] of colourTotals) {
                            map.set(colourId, totals.inward - totals.outward);
                        }
                    }
                    return map;
                })(),
                // 30-day sales metrics (cached)
                getFabricMetricsCached(),
            ]);

            // Build tree - using inline type assertions for the response
            const items = materials.map((material: typeof materials[number]) => ({
                id: material.id,
                type: 'material' as const,
                name: material.name,
                description: material.description,
                isActive: material.isActive,
                fabricCount: material.fabrics.length,
                colourCount: material.fabrics.reduce((sum: number, f: typeof material.fabrics[number]) => sum + f.colours.length, 0),
                totalStock: 0, // Could calculate from inventory if needed
                hasChildren: material.fabrics.length > 0,
                children: material.fabrics.map((fabric: typeof material.fabrics[number]) => {
                    // Calculate totals for this fabric by summing all colour values
                    let fabricTotalStock = 0;
                    let fabricSales30DayValue = 0;
                    let fabricSales30DayUnits = 0;
                    let fabricConsumption30Day = 0;

                    for (const colour of fabric.colours) {
                        fabricTotalStock += balanceMap.get(colour.id) ?? 0;
                        const metrics = salesMetricsMap.get(colour.id);
                        if (metrics) {
                            fabricSales30DayValue += metrics.sales30DayValue;
                            fabricSales30DayUnits += metrics.sales30DayUnits;
                            fabricConsumption30Day += metrics.consumption30Day;
                        }
                    }

                    return {
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
                    partyId: fabric.partyId,
                    partyName: fabric.party?.name,
                    isActive: fabric.isActive,
                    colourCount: fabric.colours.length,
                    totalStock: fabricTotalStock,
                    // 30-day metrics aggregated from all colours
                    sales30DayValue: fabricSales30DayValue,
                    sales30DayUnits: fabricSales30DayUnits,
                    consumption30Day: fabricConsumption30Day,
                    hasChildren: fabric.colours.length > 0,
                    children: fabric.colours.map((colour: typeof fabric.colours[number]) => {
                        const colourMetrics = salesMetricsMap.get(colour.id);
                        return {
                        id: colour.id,
                        type: 'colour' as const,
                        code: colour.code ?? null,
                        name: colour.colourName,
                        colourName: colour.colourName,
                        fabricId: colour.fabricId,
                        fabricName: fabric.name,
                        materialId: fabric.materialId,
                        materialName: material.name,
                        standardColour: colour.standardColour,
                        colourHex: colour.colourHex,
                        // Inherit unit from parent fabric
                        unit: fabric.unit,
                        costPerUnit: colour.costPerUnit,
                        effectiveCostPerUnit: colour.costPerUnit ?? fabric.costPerUnit,
                        costInherited: colour.costPerUnit === null,
                        leadTimeDays: colour.leadTimeDays,
                        effectiveLeadTimeDays: colour.leadTimeDays ?? fabric.defaultLeadTimeDays,
                        leadTimeInherited: colour.leadTimeDays === null,
                        minOrderQty: colour.minOrderQty,
                        effectiveMinOrderQty: colour.minOrderQty ?? fabric.defaultMinOrderQty,
                        minOrderInherited: colour.minOrderQty === null,
                        partyId: colour.partyId,
                        partyName: colour.party?.name,
                        isActive: colour.isActive,
                        isOutOfStock: colour.isOutOfStock,
                        // Inventory balance from FabricColourTransaction
                        currentBalance: balanceMap.get(colour.id) ?? 0,
                        // 30-day sales metrics
                        sales30DayValue: colourMetrics?.sales30DayValue ?? 0,
                        sales30DayUnits: colourMetrics?.sales30DayUnits ?? 0,
                        consumption30Day: colourMetrics?.consumption30Day ?? 0,
                        // Extract unique products from variation BOM lines
                        connectedProducts: (() => {
                            const productMap = new Map<string, { id: string; name: string; styleCode?: string }>();
                            colour.variationBomLines.forEach((bomLine: typeof colour.variationBomLines[number]) => {
                                const product = bomLine.variation?.product;
                                if (product && !productMap.has(product.id)) {
                                    productMap.set(product.id, {
                                        id: product.id,
                                        name: product.name,
                                        styleCode: product.styleCode ?? undefined,
                                    });
                                }
                            });
                            return Array.from(productMap.values());
                        })(),
                        productCount: (() => {
                            const productIds = new Set<string>();
                            colour.variationBomLines.forEach((bomLine: typeof colour.variationBomLines[number]) => {
                                const product = bomLine.variation?.product;
                                if (product) productIds.add(product.id);
                            });
                            return productIds.size;
                        })(),
                    };
                    }),
                };
                }),
            }));

            return {
                success: true,
                items,
                summary: {
                    totalMaterials: materials.length,
                    totalFabrics: materials.reduce((sum: number, m: typeof materials[number]) => sum + m.fabrics.length, 0),
                    totalColours: materials.reduce(
                        (sum: number, m: typeof materials[number]) => sum + m.fabrics.reduce((fSum: number, f: typeof m.fabrics[number]) => fSum + f.colours.length, 0),
                        0
                    ),
                },
            };
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
        const prisma = await getPrisma();
            if (data.parentType === 'material') {
                // Get fabrics under this material
                const fabrics = await prisma.fabric.findMany({
                    where: { materialId: data.parentId, isActive: true },
                    include: {
                        material: { select: { name: true } },
                        party: { select: { id: true, name: true } },
                        _count: { select: { colours: { where: { isActive: true } } } },
                    },
                    orderBy: { name: 'asc' },
                });

                const items = fabrics.map((fabric: typeof fabrics[number]) => ({
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
                    partyId: fabric.partyId,
                    partyName: fabric.party?.name,
                    isActive: fabric.isActive,
                    colourCount: fabric._count.colours,
                    hasChildren: fabric._count.colours > 0,
                }));

                return { success: true, items };
            } else {
                // Get colours under this fabric
                const colours = await prisma.fabricColour.findMany({
                    where: { fabricId: data.parentId, isActive: true },
                    include: {
                        fabric: {
                            include: {
                                material: { select: { name: true } },
                            },
                        },
                        party: { select: { id: true, name: true } },
                        variationBomLines: {
                            include: {
                                variation: {
                                    include: {
                                        product: {
                                            select: { id: true, name: true, styleCode: true },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    orderBy: { colourName: 'asc' },
                });

                // Batch calculate balances for these colours
                const colourIds = colours.map((c: typeof colours[number]) => c.id);
                const balanceMap = new Map<string, number>();
                if (colourIds.length > 0) {
                    const aggregations = await prisma.fabricColourTransaction.groupBy({
                        by: ['fabricColourId', 'txnType'],
                        where: { fabricColourId: { in: colourIds } },
                        _sum: { qty: true },
                    });

                    const colourTotals = new Map<string, { inward: number; outward: number }>();
                    for (const agg of aggregations) {
                        if (!colourTotals.has(agg.fabricColourId)) {
                            colourTotals.set(agg.fabricColourId, { inward: 0, outward: 0 });
                        }
                        const totals = colourTotals.get(agg.fabricColourId)!;
                        if (agg.txnType === 'inward') {
                            totals.inward = Number(agg._sum.qty) || 0;
                        } else if (agg.txnType === 'outward') {
                            totals.outward = Number(agg._sum.qty) || 0;
                        }
                    }

                    for (const [colourId, totals] of colourTotals) {
                        balanceMap.set(colourId, totals.inward - totals.outward);
                    }
                }

                const items = colours.map((colour: typeof colours[number]) => {
                    // Extract unique products from variation BOM lines
                    const productMap = new Map<string, { id: string; name: string; styleCode?: string }>();
                    colour.variationBomLines.forEach((bomLine: typeof colour.variationBomLines[number]) => {
                        const product = bomLine.variation?.product;
                        if (product && !productMap.has(product.id)) {
                            productMap.set(product.id, {
                                id: product.id,
                                name: product.name,
                                styleCode: product.styleCode ?? undefined,
                            });
                        }
                    });
                    const connectedProducts = Array.from(productMap.values());

                    return {
                        id: colour.id,
                        type: 'colour' as const,
                        code: colour.code ?? null,
                        name: colour.colourName,
                        colourName: colour.colourName,
                        fabricId: colour.fabricId,
                        fabricName: colour.fabric.name,
                        materialId: colour.fabric.materialId,
                        materialName: colour.fabric.material?.name,
                        standardColour: colour.standardColour,
                        colourHex: colour.colourHex,
                        // Inherit unit from parent fabric
                        unit: colour.fabric.unit,
                        costPerUnit: colour.costPerUnit,
                        effectiveCostPerUnit: colour.costPerUnit ?? colour.fabric.costPerUnit,
                        costInherited: colour.costPerUnit === null,
                        leadTimeDays: colour.leadTimeDays,
                        effectiveLeadTimeDays: colour.leadTimeDays ?? colour.fabric.defaultLeadTimeDays,
                        leadTimeInherited: colour.leadTimeDays === null,
                        minOrderQty: colour.minOrderQty,
                        effectiveMinOrderQty: colour.minOrderQty ?? colour.fabric.defaultMinOrderQty,
                        minOrderInherited: colour.minOrderQty === null,
                        partyId: colour.partyId,
                        partyName: colour.party?.name,
                        isActive: colour.isActive,
                        isOutOfStock: colour.isOutOfStock,
                        // Inventory balance from FabricColourTransaction
                        currentBalance: balanceMap.get(colour.id) ?? 0,
                        connectedProducts,
                        productCount: connectedProducts.length,
                    };
                });

                return { success: true, items };
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
        const prisma = await getPrisma();
        const colour = await prisma.fabricColour.findUnique({
            where: { id: data.colourId },
            select: { id: true, colourName: true, currentBalance: true },
        });

        if (!colour) {
            return { success: false as const, error: 'Colour not found' };
        }

        const transactions = await prisma.fabricColourTransaction.findMany({
            where: { fabricColourId: data.colourId },
            select: {
                id: true,
                txnType: true,
                qty: true,
                unit: true,
                reason: true,
                costPerUnit: true,
                referenceId: true,
                notes: true,
                createdAt: true,
                party: { select: { id: true, name: true } },
                createdBy: { select: { id: true, name: true } },
                invoiceLine: {
                    select: {
                        id: true,
                        invoiceId: true,
                        invoice: { select: { invoiceNumber: true, status: true } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: data.limit,
        });

        return {
            success: true as const,
            items: transactions,
            currentBalance: colour.currentBalance,
        };
    });

// ============================================
// VARIATION SEARCH (for LinkProductsModal)
// ============================================

const searchVariationsSchema = z.object({
    q: z.string().optional().default(''),
    limit: z.number().int().positive().optional().default(50),
});

// ============================================
// FLAT FABRIC COLOURS (for consolidated view)
// ============================================

const getFabricColoursFlatSchema = z.object({
    search: z.string().optional(),
    materialId: z.string().uuid().optional(),
    activeOnly: z.boolean().optional().default(true),
});

/** Linked product info with thumbnail */
export interface LinkedProduct {
    id: string;
    name: string;
    styleCode: string | null;
    imageUrl: string | null;
}

/** Row shape returned by getFabricColoursFlat */
export interface FabricColourFlatRow {
    // Colour fields
    id: string;
    code: string | null;
    colourName: string;
    standardColour: string | null;
    colourHex: string | null;
    isOutOfStock: boolean;
    isActive: boolean;
    // Fabric fields
    fabricId: string;
    fabricName: string;
    pattern: string | null;
    composition: string | null;
    weight: number | null;
    weightUnit: string | null;
    constructionType: 'knit' | 'woven' | null;
    unit: 'kg' | 'm' | string | null;
    // Material fields
    materialId: string;
    materialName: string;
    // Cost/Lead/Min with inheritance
    costPerUnit: number | null;
    effectiveCostPerUnit: number | null;
    costInherited: boolean;
    leadTimeDays: number | null;
    effectiveLeadTimeDays: number | null;
    leadTimeInherited: boolean;
    minOrderQty: number | null;
    effectiveMinOrderQty: number | null;
    minOrderInherited: boolean;
    // Party
    partyId: string | null;
    partyName: string | null;
    // Stock
    currentBalance: number;
    // 30-day metrics
    sales30DayValue: number;
    sales30DayUnits: number;
    consumption30Day: number;
    // Connected products count and details
    productCount: number;
    linkedProducts: LinkedProduct[];
}

/**
 * Get flat list of all fabric colours
 *
 * Returns a flat array of colour rows with fabric and material info embedded.
 * Designed for a simple table view without hierarchy.
 */
export const getFabricColoursFlat = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getFabricColoursFlatSchema.parse(input ?? {}))
    .handler(async ({ data }): Promise<{ success: true; items: FabricColourFlatRow[]; total: number }> => {
        const prisma = await getPrisma();

        // Build where clause
        const where: Record<string, unknown> = {};
        if (data.activeOnly) {
            where.isActive = true;
        }
        if (data.materialId) {
            where.fabric = { materialId: data.materialId };
        }
        if (data.search) {
            where.OR = [
                { colourName: { contains: data.search, mode: 'insensitive' } },
                { code: { contains: data.search, mode: 'insensitive' } },
                { fabric: { name: { contains: data.search, mode: 'insensitive' } } },
                { fabric: { material: { name: { contains: data.search, mode: 'insensitive' } } } },
            ];
        }

        // Fetch all colours with fabric and material
        const colours = await prisma.fabricColour.findMany({
            where,
            include: {
                fabric: {
                    include: {
                        material: { select: { id: true, name: true } },
                    },
                },
                party: { select: { id: true, name: true } },
                variationBomLines: {
                    select: {
                        variation: {
                            select: {
                                productId: true,
                                imageUrl: true,
                                product: {
                                    select: {
                                        id: true,
                                        name: true,
                                        styleCode: true,
                                        imageUrl: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
            orderBy: [
                { fabric: { material: { name: 'asc' } } },
                { fabric: { name: 'asc' } },
                { colourName: 'asc' },
            ],
        });

        // Collect colour IDs for batch balance fetch
        const colourIds = colours.map((c) => c.id);

        // Batch fetch balances and 30-day metrics in parallel
        const [balanceMap, salesMetricsMap] = await Promise.all([
            // Balance calculation
            (async () => {
                const map = new Map<string, number>();
                if (colourIds.length > 0) {
                    const aggregations = await prisma.fabricColourTransaction.groupBy({
                        by: ['fabricColourId', 'txnType'],
                        where: { fabricColourId: { in: colourIds } },
                        _sum: { qty: true },
                    });

                    const colourTotals = new Map<string, { inward: number; outward: number }>();
                    for (const agg of aggregations) {
                        if (!colourTotals.has(agg.fabricColourId)) {
                            colourTotals.set(agg.fabricColourId, { inward: 0, outward: 0 });
                        }
                        const totals = colourTotals.get(agg.fabricColourId)!;
                        if (agg.txnType === 'inward') {
                            totals.inward = Number(agg._sum.qty) || 0;
                        } else if (agg.txnType === 'outward') {
                            totals.outward = Number(agg._sum.qty) || 0;
                        }
                    }

                    for (const [colourId, totals] of colourTotals) {
                        map.set(colourId, totals.inward - totals.outward);
                    }
                }
                return map;
            })(),
            // 30-day sales metrics (cached)
            getFabricMetricsCached(),
        ]);

        // Transform to flat rows
        const items: FabricColourFlatRow[] = colours.map((colour) => {
            const fabric = colour.fabric;
            const material = fabric.material;
            const metrics = salesMetricsMap.get(colour.id);

            // Collect unique products with their thumbnails
            const productMap = new Map<string, LinkedProduct>();
            colour.variationBomLines.forEach((bomLine) => {
                const variation = bomLine.variation;
                if (variation?.product && !productMap.has(variation.product.id)) {
                    productMap.set(variation.product.id, {
                        id: variation.product.id,
                        name: variation.product.name,
                        styleCode: variation.product.styleCode,
                        // Prefer variation image, fall back to product image
                        imageUrl: variation.imageUrl || variation.product.imageUrl,
                    });
                }
            });
            const linkedProducts = Array.from(productMap.values());

            return {
                // Colour
                id: colour.id,
                code: colour.code ?? null,
                colourName: colour.colourName,
                standardColour: colour.standardColour,
                colourHex: colour.colourHex,
                isOutOfStock: colour.isOutOfStock,
                isActive: colour.isActive,
                // Fabric
                fabricId: fabric.id,
                fabricName: fabric.name,
                pattern: fabric.pattern,
                composition: fabric.composition,
                weight: fabric.weight ? Number(fabric.weight) : null,
                weightUnit: fabric.weightUnit,
                constructionType: fabric.constructionType as 'knit' | 'woven' | null,
                unit: fabric.unit,
                // Material
                materialId: material?.id ?? '',
                materialName: material?.name ?? '',
                // Cost/Lead/Min with inheritance
                costPerUnit: colour.costPerUnit ? Number(colour.costPerUnit) : null,
                effectiveCostPerUnit: colour.costPerUnit ? Number(colour.costPerUnit) : (fabric.costPerUnit ? Number(fabric.costPerUnit) : null),
                costInherited: colour.costPerUnit === null,
                leadTimeDays: colour.leadTimeDays,
                effectiveLeadTimeDays: colour.leadTimeDays ?? fabric.defaultLeadTimeDays,
                leadTimeInherited: colour.leadTimeDays === null,
                minOrderQty: colour.minOrderQty ? Number(colour.minOrderQty) : null,
                effectiveMinOrderQty: colour.minOrderQty ? Number(colour.minOrderQty) : (fabric.defaultMinOrderQty ? Number(fabric.defaultMinOrderQty) : null),
                minOrderInherited: colour.minOrderQty === null,
                // Party
                partyId: colour.partyId,
                partyName: colour.party?.name ?? null,
                // Stock
                currentBalance: balanceMap.get(colour.id) ?? 0,
                // 30-day metrics
                sales30DayValue: metrics?.sales30DayValue ?? 0,
                sales30DayUnits: metrics?.sales30DayUnits ?? 0,
                consumption30Day: metrics?.consumption30Day ?? 0,
                // Products
                productCount: linkedProducts.length,
                linkedProducts,
            };
        });

        return {
            success: true,
            items,
            total: items.length,
        };
    });

/**
 * Search product variations for fabric linking
 */
export const searchVariations = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => searchVariationsSchema.parse(input))
    .handler(async ({ data }) => {
        const prisma = await getPrisma();
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

            const results = variations.map((v: typeof variations[number]) => {
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
                    // NOTE: fabric relation removed from Variation - now via BOM
                    currentFabric: null,
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
    });
