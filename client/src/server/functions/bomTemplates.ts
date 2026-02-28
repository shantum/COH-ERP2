/**
 * BOM Template Server Functions
 *
 * Product-level BOM template management: get full BOM, update templates, update product BOM.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';
import type { MutationResult, DbRecord } from './bomHelpers';

// ============================================
// INPUT SCHEMAS
// ============================================

const productIdSchema = z.object({
    productId: z.string().uuid('Invalid product ID'),
});

const updateTemplateSchema = z.object({
    productId: z.string().uuid('Invalid product ID'),
    lines: z.array(z.object({
        id: z.string().uuid().optional(),
        roleId: z.string().uuid(),
        defaultQuantity: z.number().nonnegative().nullable().optional(),
        quantityUnit: z.string().optional(),
        wastagePercent: z.number().nonnegative().max(100).nullable().optional(),
        trimItemId: z.string().uuid().nullable().optional(),
        serviceItemId: z.string().uuid().nullable().optional(),
    })),
});

const updateProductBomSchema = z.object({
    productId: z.string().uuid('Invalid product ID'),
    template: z.array(z.object({
        roleId: z.string().uuid(),
        componentType: z.enum(['FABRIC', 'TRIM', 'SERVICE']),
        componentId: z.string().uuid().nullable().optional(),
        resolvedQuantity: z.number().nonnegative().nullable().optional(),
        resolvedCost: z.number().nonnegative().nullable().optional(),
    })).optional(),
});

// ============================================
// RESULT TYPES
// ============================================

export interface ProductBomTemplateLine {
    id: string;
    roleId: string;
    roleCode: string;
    roleName: string;
    typeCode: string;
    defaultQuantity: number | null;
    quantityUnit: string | null;
    wastagePercent: number | null;
    trimItemId: string | null;
    trimItem: { id: string; name: string; code: string; costPerUnit: number } | null;
    serviceItemId: string | null;
    serviceItem: { id: string; name: string; code: string; costPerJob: number } | null;
}

export interface VariationBomData {
    id: string;
    colorName: string;
    bomLines: Array<{
        id: string;
        roleId: string;
        roleCode: string;
        typeCode: string;
        quantity: number | null;
        fabricColourId: string | null;
        fabricColour: {
            id: string;
            name: string;
            colourHex: string | null;
            costPerUnit: number | null;
            fabric: { costPerUnit: number | null };
        } | null;
        trimItemId: string | null;
        trimItem: { id: string; name: string; code: string; costPerUnit: number } | null;
        serviceItemId: string | null;
        serviceItem: { id: string; name: string; code: string; costPerJob: number } | null;
    }>;
}

export interface SkuBomData {
    id: string;
    skuCode: string;
    size: string;
    variationId: string;
    colorName: string;
    colorHex: string | null;
    bomLines: Array<{
        id: string;
        roleId: string;
        roleCode: string;
        quantity: number | null;
        overrideCost: number | null;
        notes: string | null;
    }>;
}

export interface ProductBomResult {
    templates: ProductBomTemplateLine[];
    variations: VariationBomData[];
    skus: SkuBomData[];
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get full BOM for a product (templates + variations)
 */
export const getProductBom = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => productIdSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<ProductBomResult>> => {
        const prisma = await getPrisma();
        const { productId } = data;

        try {
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

            // Get product templates
            const templates = await prisma.productBomTemplate.findMany({
                where: { productId },
                include: {
                    role: { include: { type: true } },
                    trimItem: true,
                    serviceItem: true,
                },
                orderBy: { role: { sortOrder: 'asc' } },
            });

            // Get variations with their BOM lines and SKUs
            const variations = await prisma.variation.findMany({
                where: { productId, isActive: true },
                include: {
                    bomLines: {
                        include: {
                            role: { include: { type: true } },
                            fabricColour: {
                                include: { fabric: true },
                            },
                            trimItem: true,
                            serviceItem: true,
                        },
                    },
                    skus: {
                        where: { isActive: true },
                        select: {
                            id: true,
                            skuCode: true,
                            size: true,
                            variationId: true,
                            bomLines: {
                                include: {
                                    role: { include: { type: true } },
                                },
                            },
                        },
                        orderBy: { size: 'asc' },
                    },
                },
                orderBy: { colorName: 'asc' },
            });

            // Flatten SKU data from all variations
            const allSkus: SkuBomData[] = [];
            for (const v of variations as DbRecord[]) {
                for (const sku of (v.skus || []) as DbRecord[]) {
                    allSkus.push({
                        id: sku.id,
                        skuCode: sku.skuCode,
                        size: sku.size,
                        variationId: sku.variationId,
                        colorName: v.colorName,
                        colorHex: v.colorHex,
                        bomLines: (sku.bomLines || []).map((bl: DbRecord) => ({
                            id: bl.id,
                            roleId: bl.roleId,
                            roleCode: bl.role.code,
                            quantity: bl.quantity,
                            overrideCost: bl.overrideCost,
                            notes: bl.notes,
                        })),
                    });
                }
            }

            const result: ProductBomResult = {
                templates: templates.map((t: DbRecord) => ({
                    id: t.id,
                    roleId: t.roleId,
                    roleCode: t.role.code,
                    roleName: t.role.name,
                    typeCode: t.role.type.code,
                    defaultQuantity: t.defaultQuantity,
                    quantityUnit: t.quantityUnit,
                    wastagePercent: t.wastagePercent,
                    trimItemId: t.trimItemId,
                    trimItem: t.trimItem ? {
                        id: t.trimItem.id,
                        name: t.trimItem.name,
                        code: t.trimItem.code,
                        costPerUnit: t.trimItem.costPerUnit,
                    } : null,
                    serviceItemId: t.serviceItemId,
                    serviceItem: t.serviceItem ? {
                        id: t.serviceItem.id,
                        name: t.serviceItem.name,
                        code: t.serviceItem.code,
                        costPerJob: t.serviceItem.costPerJob,
                    } : null,
                })),
                skus: allSkus,
                variations: variations.map((v: DbRecord) => ({
                    id: v.id,
                    colorName: v.colorName,
                    bomLines: v.bomLines.map((line: DbRecord) => ({
                        id: line.id,
                        roleId: line.roleId,
                        roleCode: line.role.code,
                        typeCode: line.role.type.code,
                        quantity: line.quantity,
                        fabricColourId: line.fabricColourId,
                        fabricColour: line.fabricColour ? {
                            id: line.fabricColour.id,
                            name: `${line.fabricColour.fabric.name} - ${line.fabricColour.colourName}`,
                            colourHex: line.fabricColour.colourHex,
                            costPerUnit: line.fabricColour.costPerUnit,
                            fabric: { costPerUnit: line.fabricColour.fabric.costPerUnit },
                        } : null,
                        trimItemId: line.trimItemId,
                        trimItem: line.trimItem ? {
                            id: line.trimItem.id,
                            name: line.trimItem.name,
                            code: line.trimItem.code,
                            costPerUnit: line.trimItem.costPerUnit,
                        } : null,
                        serviceItemId: line.serviceItemId,
                        serviceItem: line.serviceItem ? {
                            id: line.serviceItem.id,
                            name: line.serviceItem.name,
                            code: line.serviceItem.code,
                            costPerJob: line.serviceItem.costPerJob,
                        } : null,
                    })),
                })),
            };

            return { success: true, data: result };
        } catch (error: unknown) {
            console.error('[bom] getProductBom failed:', error);
            const message = error instanceof Error ? error.message : 'Failed to load product BOM';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Update product BOM template
 */
export const updateTemplate = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateTemplateSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<{ updated: number; created: number }>> => {
        const prisma = await getPrisma();
        const { productId, lines } = data;

        try {
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

            let updated = 0;
            let created = 0;

            await prisma.$transaction(async (tx: PrismaTransaction) => {
                // Get existing templates
                const existing = await tx.productBomTemplate.findMany({
                    where: { productId },
                });

                const existingRoleIds = new Set(existing.map((e: DbRecord) => e.roleId));
                const newRoleIds = new Set(lines.map((l) => l.roleId));

                // Delete templates not in the new list
                const toDelete = existing.filter((e: DbRecord) => !newRoleIds.has(e.roleId));
                for (const t of toDelete) {
                    await tx.productBomTemplate.delete({ where: { id: t.id } });
                }

                // Upsert templates
                for (const line of lines) {
                    if (existingRoleIds.has(line.roleId)) {
                        await tx.productBomTemplate.updateMany({
                            where: { productId, roleId: line.roleId },
                            data: {
                                defaultQuantity: line.defaultQuantity ?? 1,
                                quantityUnit: line.quantityUnit || 'unit',
                                wastagePercent: line.wastagePercent ?? 0,
                                trimItemId: line.trimItemId || null,
                                serviceItemId: line.serviceItemId || null,
                            },
                        });
                        updated++;
                    } else {
                        await tx.productBomTemplate.create({
                            data: {
                                productId,
                                roleId: line.roleId,
                                defaultQuantity: line.defaultQuantity ?? 1,
                                quantityUnit: line.quantityUnit || 'unit',
                                wastagePercent: line.wastagePercent ?? 0,
                                trimItemId: line.trimItemId || null,
                                serviceItemId: line.serviceItemId || null,
                            },
                        });
                        created++;
                    }
                }
            }, { timeout: 30000 });

            return {
                success: true,
                data: { updated, created },
            };
        } catch (error: unknown) {
            console.error('[bom] updateTemplate failed:', error);
            const message = error instanceof Error ? error.message : 'Failed to update template';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Update full product BOM (template + variations)
 */
export const updateProductBom = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateProductBomSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<{ success: boolean }>> => {
        const prisma = await getPrisma();
        const { productId, template } = data;

        try {
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

            if (template) {
                await prisma.$transaction(async (tx: PrismaTransaction) => {
                    // Clear existing templates
                    await tx.productBomTemplate.deleteMany({ where: { productId } });

                    // Create new templates
                    for (const line of template) {
                        await tx.productBomTemplate.create({
                            data: {
                                productId,
                                roleId: line.roleId,
                                defaultQuantity: line.resolvedQuantity ?? 1,
                                trimItemId: line.componentType === 'TRIM' ? line.componentId : null,
                                serviceItemId: line.componentType === 'SERVICE' ? line.componentId : null,
                            },
                        });
                    }
                }, { timeout: 30000 });
            }

            return { success: true, data: { success: true } };
        } catch (error: unknown) {
            console.error('[bom] updateProductBom failed:', error);
            const message = error instanceof Error ? error.message : 'Failed to update product BOM';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });
