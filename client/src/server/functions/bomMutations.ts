/**
 * BOM (Bill of Materials) Server Functions
 *
 * TanStack Start Server Functions for BOM operations.
 * 3-level cascade hierarchy: Product → Variation → SKU
 *
 * Resolution rules:
 * - Lower levels override higher levels
 * - Fabric colour MUST be set at Variation level
 * - Quantity can be overridden at SKU level for size-specific consumption
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

const variationIdSchema = z.object({
    variationId: z.string().uuid('Invalid variation ID'),
});

const productIdSchema = z.object({
    productId: z.string().uuid('Invalid product ID'),
});

// skuIdSchema reserved for future use (SKU-level BOM operations)

const roleIdQuerySchema = z.object({
    productId: z.string().uuid('Invalid product ID'),
    roleId: z.string().uuid('Invalid role ID'),
});

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

const importConsumptionSchema = z.object({
    imports: z.array(z.object({
        productId: z.string().uuid('Invalid product ID'),
        sizes: z.record(z.string(), z.number().nonnegative()),
    })),
});

const linkFabricToVariationSchema = z.object({
    colourId: z.string().uuid('Invalid colour ID'),
    variationIds: z.array(z.string().uuid()).min(1, 'At least one variation ID is required'),
    roleId: z.string().uuid().optional(),
});

const updateSizeConsumptionsSchema = z.object({
    productId: z.string().uuid('Invalid product ID'),
    roleId: z.string().uuid('Invalid role ID'),
    consumptions: z.array(z.object({
        size: z.string().min(1, 'Size is required'),
        quantity: z.number().nonnegative(),
    })),
});

// ============================================
// RESULT TYPES
// ============================================

export interface MutationResult<T> {
    success: boolean;
    data?: T;
    error?: {
        code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN';
        message: string;
    };
}

export interface BomLineResult {
    id: string;
    roleId: string;
    roleCode: string;
    roleName: string;
    typeCode: string;
    quantity: number | null;
    wastagePercent: number | null;
    fabricColourId?: string | null;
    fabricColour?: {
        id: string;
        name: string;
        colourHex?: string | null;
    } | null;
    trimItemId?: string | null;
    trimItem?: { id: string; name: string; code: string } | null;
    serviceItemId?: string | null;
    serviceItem?: { id: string; name: string; code: string } | null;
}

export interface AvailableComponentsResult {
    fabrics: Array<{
        id: string;
        type: string;
        name: string;
        fabricId: string;
        fabricName: string;
        colourName: string;
        materialName?: string;
        costPerUnit: number | null;
        colourHex?: string | null;
    }>;
    trims: Array<{
        id: string;
        type: string;
        code: string;
        name: string;
        category: string;
        costPerUnit: number;
        unit: string;
    }>;
    services: Array<{
        id: string;
        type: string;
        code: string;
        name: string;
        category: string;
        costPerJob: number;
        costUnit: string;
    }>;
}

export interface ComponentRoleResult {
    id: string;
    code: string;
    name: string;
    typeId: string;
    type: {
        id: string;
        code: string;
        name: string;
    };
    isRequired: boolean;
    allowMultiple: boolean;
    defaultQuantity: number | null;
    defaultUnit: string | null;
    sortOrder: number;
}

export interface SizeConsumptionResult {
    productId: string;
    productName: string;
    roleId: string;
    roleName: string;
    roleType: string;
    unit: string;
    defaultQuantity: number | null;
    sizes: Array<{
        size: string;
        quantity: number | null;
        skuCount: number;
    }>;
    totalSkus: number;
    totalVariations: number;
}

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

export interface ImportConsumptionResult {
    productsImported: number;
    skusUpdated: number;
}

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

// ============================================
// PRISMA HELPER
// ============================================

interface PrismaGlobal {
    prisma: ReturnType<typeof createPrismaClient>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaClientType = any;

function createPrismaClient(): PrismaClientType {
    return null;
}

async function getPrisma(): Promise<PrismaClientType> {
    const { PrismaClient } = await import('@prisma/client');
    const globalForPrisma = globalThis as unknown as PrismaGlobal;
    const prisma = globalForPrisma.prisma ?? new PrismaClient();
    if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.prisma = prisma;
    }
    return prisma;
}

// ============================================
// QUERY SERVER FUNCTIONS
// ============================================

/**
 * Get BOM for a variation
 * Returns all BOM lines for the variation including fabric, trim, and service assignments
 */
export const getBomForVariation = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => variationIdSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<BomLineResult[]>> => {
        const prisma = await getPrisma();
        const { variationId } = data;

        // Verify variation exists
        const variation = await prisma.variation.findUnique({
            where: { id: variationId },
            select: { id: true },
        });

        if (!variation) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Variation not found' },
            };
        }

        const lines = await prisma.variationBomLine.findMany({
            where: { variationId },
            include: {
                role: { include: { type: true } },
                fabricColour: {
                    include: { fabric: true },
                },
                trimItem: true,
                serviceItem: true,
            },
            orderBy: { role: { sortOrder: 'asc' } },
        });

        const result: BomLineResult[] = lines.map((line: PrismaClientType) => ({
            id: line.id,
            roleId: line.roleId,
            roleCode: line.role.code,
            roleName: line.role.name,
            typeCode: line.role.type.code,
            quantity: line.quantity,
            wastagePercent: line.wastagePercent,
            fabricColourId: line.fabricColourId,
            fabricColour: line.fabricColour ? {
                id: line.fabricColour.id,
                name: `${line.fabricColour.fabric.name} - ${line.fabricColour.colourName}`,
                colourHex: line.fabricColour.colourHex,
            } : null,
            trimItemId: line.trimItemId,
            trimItem: line.trimItem ? {
                id: line.trimItem.id,
                name: line.trimItem.name,
                code: line.trimItem.code,
            } : null,
            serviceItemId: line.serviceItemId,
            serviceItem: line.serviceItem ? {
                id: line.serviceItem.id,
                name: line.serviceItem.name,
                code: line.serviceItem.code,
            } : null,
        }));

        return { success: true, data: result };
    });

/**
 * Get BOM template for a product
 * Returns product-level BOM templates (structure + defaults)
 */
export const getBomForProduct = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => productIdSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<BomLineResult[]>> => {
        const prisma = await getPrisma();
        const { productId } = data;

        // Verify product exists
        const product = await prisma.product.findUnique({
            where: { id: productId },
            select: { id: true },
        });

        if (!product) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Product not found' },
            };
        }

        const templates = await prisma.productBomTemplate.findMany({
            where: { productId },
            include: {
                role: { include: { type: true } },
                trimItem: true,
                serviceItem: true,
            },
            orderBy: { role: { sortOrder: 'asc' } },
        });

        const result: BomLineResult[] = templates.map((t: PrismaClientType) => ({
            id: t.id,
            roleId: t.roleId,
            roleCode: t.role.code,
            roleName: t.role.name,
            typeCode: t.role.type.code,
            quantity: t.defaultQuantity,
            wastagePercent: t.wastagePercent,
            // Product templates don't have fabric colours - those are set at variation level
            fabricColourId: null,
            fabricColour: null,
            trimItemId: t.trimItemId,
            trimItem: t.trimItem ? {
                id: t.trimItem.id,
                name: t.trimItem.name,
                code: t.trimItem.code,
            } : null,
            serviceItemId: t.serviceItemId,
            serviceItem: t.serviceItem ? {
                id: t.serviceItem.id,
                name: t.serviceItem.name,
                code: t.serviceItem.code,
            } : null,
        }));

        return { success: true, data: result };
    });

/**
 * Get available components for BOM selection
 * Returns all fabric colours, trims, and services available for BOM assignment
 */
export const getAvailableComponents = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<AvailableComponentsResult>> => {
        const prisma = await getPrisma();

        const [fabricColours, trims, services] = await Promise.all([
            prisma.fabricColour.findMany({
                where: { isActive: true },
                include: {
                    fabric: {
                        include: {
                            material: { select: { id: true, name: true } },
                        },
                    },
                },
                orderBy: [{ fabric: { name: 'asc' } }, { colourName: 'asc' }],
            }),
            prisma.trimItem.findMany({
                where: { isActive: true },
                orderBy: [{ category: 'asc' }, { name: 'asc' }],
            }),
            prisma.serviceItem.findMany({
                where: { isActive: true },
                orderBy: [{ category: 'asc' }, { name: 'asc' }],
            }),
        ]);

        const fabrics = fabricColours.map((c: PrismaClientType) => ({
            id: c.id,
            type: 'FABRIC',
            name: `${c.fabric.name} - ${c.colourName}`,
            fabricId: c.fabricId,
            fabricName: c.fabric.name,
            colourName: c.colourName,
            materialName: c.fabric.material?.name,
            costPerUnit: c.costPerUnit ?? c.fabric.costPerUnit,
            colourHex: c.colourHex,
        }));

        return {
            success: true,
            data: {
                fabrics,
                trims: trims.map((t: PrismaClientType) => ({
                    id: t.id,
                    type: 'TRIM',
                    code: t.code,
                    name: t.name,
                    category: t.category,
                    costPerUnit: t.costPerUnit,
                    unit: t.unit,
                })),
                services: services.map((s: PrismaClientType) => ({
                    id: s.id,
                    type: 'SERVICE',
                    code: s.code,
                    name: s.name,
                    category: s.category,
                    costPerJob: s.costPerJob,
                    costUnit: s.costUnit,
                })),
            },
        };
    });

/**
 * Get component roles
 * Returns all component roles from the database (for dropdown selection)
 */
export const getComponentRoles = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<ComponentRoleResult[]>> => {
        const prisma = await getPrisma();

        const roles = await prisma.componentRole.findMany({
            include: { type: true },
            orderBy: [{ type: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
        });

        const result: ComponentRoleResult[] = roles.map((r: PrismaClientType) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            typeId: r.typeId,
            type: {
                id: r.type.id,
                code: r.type.code,
                name: r.type.name,
            },
            isRequired: r.isRequired,
            allowMultiple: r.allowMultiple,
            defaultQuantity: r.defaultQuantity,
            defaultUnit: r.defaultUnit,
            sortOrder: r.sortOrder,
        }));

        return { success: true, data: result };
    });

/**
 * Get size-based consumptions for a product
 * Returns consumption by size for a specific role (aggregated across all colors)
 */
export const getSizeConsumptions = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => roleIdQuerySchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<SizeConsumptionResult>> => {
        const prisma = await getPrisma();
        const { productId, roleId } = data;

        // Get product with all variations and SKUs
        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: {
                variations: {
                    where: { isActive: true },
                    include: {
                        skus: {
                            where: { isActive: true },
                            orderBy: { size: 'asc' },
                        },
                    },
                },
            },
        });

        if (!product) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Product not found' },
            };
        }

        // Get the role details
        const role = await prisma.componentRole.findUnique({
            where: { id: roleId },
            include: { type: true },
        });

        if (!role) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Component role not found' },
            };
        }

        // Get product template for default quantity
        const template = await prisma.productBomTemplate.findFirst({
            where: { productId, roleId },
        });

        // Collect all SKU IDs
        const allSkus = product.variations.flatMap((v: PrismaClientType) => v.skus);
        const skuIds = allSkus.map((s: PrismaClientType) => s.id);

        // Get SKU-level BOM lines for this role
        const skuBomLines = await prisma.skuBomLine.findMany({
            where: { skuId: { in: skuIds }, roleId },
        });

        // Create a map of skuId -> quantity
        const skuQuantityMap = new Map<string, number | null>();
        for (const line of skuBomLines) {
            skuQuantityMap.set(line.skuId, line.quantity);
        }

        // Aggregate by size - get unique sizes and their consumption
        const sizeConsumptionMap = new Map<string, { quantity: number | null; skuCount: number }>();
        const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL'];

        for (const sku of allSkus) {
            const size = sku.size;
            const existing = sizeConsumptionMap.get(size);

            // Get quantity: SKU BOM line → template default → SKU fabricConsumption (legacy)
            const bomQty = skuQuantityMap.get(sku.id);
            let quantity: number | null;
            if (bomQty !== undefined) {
                quantity = bomQty;
            } else {
                quantity = template?.defaultQuantity ?? sku.fabricConsumption ?? null;
            }

            if (existing) {
                if (existing.quantity === null && quantity !== null) {
                    existing.quantity = quantity;
                }
                existing.skuCount++;
            } else {
                sizeConsumptionMap.set(size, { quantity, skuCount: 1 });
            }
        }

        // Sort sizes in standard order
        const sizes = Array.from(sizeConsumptionMap.entries())
            .sort((a, b) => {
                const indexA = sizeOrder.indexOf(a[0]);
                const indexB = sizeOrder.indexOf(b[0]);
                if (indexA === -1 && indexB === -1) return a[0].localeCompare(b[0]);
                if (indexA === -1) return 1;
                if (indexB === -1) return -1;
                return indexA - indexB;
            })
            .map(([size, data]) => ({
                size,
                quantity: data.quantity,
                skuCount: data.skuCount,
            }));

        return {
            success: true,
            data: {
                productId,
                productName: product.name,
                roleId,
                roleName: role.name,
                roleType: role.type.code,
                unit: template?.quantityUnit || 'meter',
                defaultQuantity: template?.defaultQuantity ?? null,
                sizes,
                totalSkus: allSkus.length,
                totalVariations: product.variations.length,
            },
        };
    });

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
                        overrideCost: overrideCost || null,
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
                        overrideCost: overrideCost || null,
                        notes: notes || null,
                    },
                });
            } else {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'One of productId, variationId, or skuId is required' },
                };
            }

            return {
                success: true,
                data: { id: result.id, level, roleId },
            };
        } catch (error) {
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
                        ...(overrideCost !== undefined && { overrideCost: overrideCost || null }),
                        ...(notes !== undefined && { notes: notes || null }),
                    },
                });
            } else {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Invalid level' },
                };
            }

            return {
                success: true,
                data: { id: lineId, level, updated: true },
            };
        } catch (error) {
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

            return {
                success: true,
                data: { id: lineId, level, deleted: true },
            };
        } catch (error) {
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

/**
 * Import consumption data for multiple products
 * Body: { imports: [{ productId, sizes: { XS: 1.2, S: 1.3, ... } }] }
 */
export const importConsumption = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => importConsumptionSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<ImportConsumptionResult>> => {
        const prisma = await getPrisma();
        const { imports } = data;

        if (!imports || imports.length === 0) {
            return { success: true, data: { productsImported: 0, skusUpdated: 0 } };
        }

        try {
            // Get the main fabric role
            const mainFabricRole = await prisma.componentRole.findFirst({
                where: {
                    code: 'main',
                    type: { code: 'FABRIC' },
                },
            });

            if (!mainFabricRole) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Main fabric role not found' },
                };
            }

            // Get all products with their SKUs
            const productIds = imports.map((i) => i.productId);
            const products = await prisma.product.findMany({
                where: { id: { in: productIds } },
                include: {
                    variations: {
                        where: { isActive: true },
                        include: {
                            skus: {
                                where: { isActive: true },
                                select: { id: true, size: true },
                            },
                        },
                    },
                },
            });

            // Create map of productId -> product
            const productMap = new Map(products.map((p: PrismaClientType) => [p.id, p]));

            // Build batch operations
            const skuUpdates: { skuId: string; quantity: number }[] = [];

            for (const imp of imports) {
                const product = productMap.get(imp.productId) as PrismaClientType;
                if (!product || !imp.sizes) continue;

                for (const variation of product.variations as PrismaClientType[]) {
                    for (const sku of variation.skus) {
                        const quantity = imp.sizes[sku.size];
                        if (quantity === undefined || quantity === null) continue;

                        const numQuantity = typeof quantity === 'number' ? quantity : parseFloat(String(quantity));
                        if (isNaN(numQuantity)) continue;

                        skuUpdates.push({ skuId: sku.id, quantity: numQuantity });
                    }
                }
            }

            if (skuUpdates.length === 0) {
                return { success: true, data: { productsImported: 0, skusUpdated: 0 } };
            }

            // Batch update in transaction
            await prisma.$transaction(async (tx: PrismaClientType) => {
                // Update Sku.fabricConsumption (legacy backward compat)
                for (const update of skuUpdates) {
                    await tx.sku.update({
                        where: { id: update.skuId },
                        data: { fabricConsumption: update.quantity },
                    });
                }

                // Delete existing BOM lines for these SKUs
                const skuIds = skuUpdates.map((u) => u.skuId);
                await tx.skuBomLine.deleteMany({
                    where: {
                        skuId: { in: skuIds },
                        roleId: mainFabricRole.id,
                    },
                });

                // Batch create all BOM lines
                await tx.skuBomLine.createMany({
                    data: skuUpdates.map((u) => ({
                        skuId: u.skuId,
                        roleId: mainFabricRole.id,
                        quantity: u.quantity,
                    })),
                });
            }, { timeout: 60000 });

            const uniqueProducts = new Set(imports.map((i) => i.productId)).size;

            return {
                success: true,
                data: {
                    productsImported: uniqueProducts,
                    skusUpdated: skuUpdates.length,
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Import failed';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Link fabric colour to multiple variations
 * Creates VariationBomLine records for the main fabric role
 * Also updates variation.fabricId to maintain hierarchy consistency
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
            const mainFabricRole = await prisma.componentRole.findFirst({
                where: {
                    code: 'main',
                    type: { code: 'FABRIC' },
                },
            });
            if (!mainFabricRole) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Main fabric role not configured' },
                };
            }
            targetRoleId = mainFabricRole.id;
        }

        // Verify variations exist
        const variations = await prisma.variation.findMany({
            where: { id: { in: variationIds } },
            select: { id: true, colorName: true, product: { select: { name: true } } },
        });

        if (variations.length !== variationIds.length) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'One or more variations not found' },
            };
        }

        try {
            // Create/update BOM lines AND update variation.fabricId in a transaction
            const results = await prisma.$transaction(async (tx: PrismaClientType) => {
                const updated: string[] = [];

                for (const variation of variations) {
                    // 1. Update the variation's fabricId to match the colour's parent fabric
                    await tx.variation.update({
                        where: { id: variation.id },
                        data: { fabricId: colour.fabricId },
                    });

                    // 2. Create/update the BOM line with the fabric colour
                    await tx.variationBomLine.upsert({
                        where: {
                            variationId_roleId: {
                                variationId: variation.id,
                                roleId: targetRoleId,
                            },
                        },
                        update: { fabricColourId: colourId },
                        create: {
                            variationId: variation.id,
                            roleId: targetRoleId,
                            fabricColourId: colourId,
                        },
                    });

                    updated.push(variation.id);
                }

                return { updated };
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
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to link fabric';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Update size consumptions for a product
 * Bulk update consumption by size (applies to ALL SKUs of that size across all colors)
 */
export const updateSizeConsumptions = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateSizeConsumptionsSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<{ updated: number; sizesUpdated: number }>> => {
        const prisma = await getPrisma();
        const { productId, roleId, consumptions } = data;

        // Get product with all SKUs
        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: {
                variations: {
                    where: { isActive: true },
                    include: {
                        skus: {
                            where: { isActive: true },
                            select: { id: true, size: true },
                        },
                    },
                },
            },
        });

        if (!product) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Product not found' },
            };
        }

        // Create size → quantity map from request
        const sizeQuantityMap = new Map<string, number>();
        for (const c of consumptions) {
            if (c.size && c.quantity !== undefined && c.quantity !== null) {
                sizeQuantityMap.set(c.size, c.quantity);
            }
        }

        // Collect all SKUs by size
        const allSkus = product.variations.flatMap((v: PrismaClientType) => v.skus);
        const skusToUpdate = allSkus.filter((sku: PrismaClientType) => sizeQuantityMap.has(sku.size));

        // Get role to check if it's main fabric (for backward compat)
        const role = await prisma.componentRole.findUnique({
            where: { id: roleId },
            include: { type: true },
        });

        const isMainFabric = role?.type.code === 'FABRIC' && role.code === 'main';

        try {
            // Batch update in transaction
            let updatedCount = 0;
            await prisma.$transaction(async (tx: PrismaClientType) => {
                for (const sku of skusToUpdate) {
                    const quantity = sizeQuantityMap.get(sku.size)!;

                    // Upsert SKU BOM line
                    await tx.skuBomLine.upsert({
                        where: {
                            skuId_roleId: { skuId: sku.id, roleId },
                        },
                        update: { quantity },
                        create: {
                            skuId: sku.id,
                            roleId,
                            quantity,
                        },
                    });

                    // Backward compatibility: also update legacy fabricConsumption field
                    if (isMainFabric) {
                        await tx.sku.update({
                            where: { id: sku.id },
                            data: { fabricConsumption: quantity },
                        });
                    }

                    updatedCount++;
                }
            }, { timeout: 30000 });

            return {
                success: true,
                data: {
                    updated: updatedCount,
                    sizesUpdated: consumptions.length,
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update consumptions';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });
