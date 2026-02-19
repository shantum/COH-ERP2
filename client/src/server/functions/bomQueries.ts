/**
 * BOM Query Server Functions
 *
 * Read-only queries for BOM data: variation BOM, product BOM, available components,
 * component roles, size consumptions, and cost config.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import { SIZE_ORDER, type MutationResult, type DbRecord } from './bomHelpers';

// ============================================
// INPUT SCHEMAS
// ============================================

const variationIdSchema = z.object({
    variationId: z.string().uuid('Invalid variation ID'),
});

const productIdSchema = z.object({
    productId: z.string().uuid('Invalid product ID'),
});

const roleIdQuerySchema = z.object({
    productId: z.string().uuid('Invalid product ID'),
    roleId: z.string().uuid('Invalid role ID'),
});

// ============================================
// RESULT TYPES
// ============================================

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

export interface CostConfigResult {
    laborRatePerMin: number;
    defaultPackagingCost: number;
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

        const result: BomLineResult[] = lines.map((line: DbRecord) => ({
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

        const result: BomLineResult[] = templates.map((t: DbRecord) => ({
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

        const fabrics = fabricColours.map((c: DbRecord) => ({
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
                trims: trims.map((t: DbRecord) => ({
                    id: t.id,
                    type: 'TRIM',
                    code: t.code,
                    name: t.name,
                    category: t.category,
                    costPerUnit: t.costPerUnit,
                    unit: t.unit,
                })),
                services: services.map((s: DbRecord) => ({
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

        const result: ComponentRoleResult[] = roles.map((r: DbRecord) => ({
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
        const allSkus = product.variations.flatMap((v: DbRecord) => v.skus);
        const skuIds = allSkus.map((s: DbRecord) => s.id);

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
                const indexA = (SIZE_ORDER as readonly string[]).indexOf(a[0]);
                const indexB = (SIZE_ORDER as readonly string[]).indexOf(b[0]);
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

/**
 * Get cost config (global defaults)
 */
export const getCostConfig = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<CostConfigResult>> => {
        const prisma = await getPrisma();

        try {
            // Get from CostConfig table
            const config = await prisma.costConfig.findFirst();

            return {
                success: true,
                data: {
                    laborRatePerMin: config?.laborRatePerMin ?? 2.5,
                    defaultPackagingCost: config?.defaultPackagingCost ?? 50,
                },
            };
        } catch {
            // If CostConfig doesn't exist, return defaults
            return {
                success: true,
                data: {
                    laborRatePerMin: 2.5,
                    defaultPackagingCost: 50,
                },
            };
        }
    });
