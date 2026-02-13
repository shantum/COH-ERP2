/**
 * Products Mutations Server Functions
 *
 * TanStack Start Server Functions for product CRUD operations.
 * Handles 3-tier product hierarchy: Product → Variation → SKU
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';

// ============================================
// EXPORTED RESPONSE TYPES
// ============================================

/**
 * Success response for product mutations
 * Data contains the Prisma model with relations
 */
export interface ProductMutationSuccess {
    success: true;
    data: Record<string, unknown>;
}

/**
 * Error response for product mutations
 */
export interface ProductMutationError {
    success: false;
    error: { message: string };
}

/**
 * Union type for product mutation responses
 * Handlers return this discriminated union
 */
export type ProductMutationResponse = ProductMutationSuccess | ProductMutationError;

/**
 * Delete product success response
 */
export interface DeleteProductSuccess {
    success: true;
    data: { message: string };
}

export type DeleteProductResponse = DeleteProductSuccess | ProductMutationError;

// ============================================
// INPUT SCHEMAS
// ============================================

const createProductSchema = z.object({
    name: z.string().min(1, 'Product name is required').trim(),
    styleCode: z.string().optional().nullable(),
    category: z.string().min(1, 'Category is required'),
    productType: z.string().min(1, 'Product type is required'),
    gender: z.string().default('unisex'),
    baseProductionTimeMins: z.number().int().positive().default(60),
    defaultFabricConsumption: z.number().positive().optional().nullable(),
    imageUrl: z.string().url().optional().nullable(),
});

const updateProductSchema = z.object({
    id: z.string().uuid('Invalid product ID'),
    name: z.string().min(1).trim().optional(),
    styleCode: z.string().optional().nullable(),
    category: z.string().min(1).optional(),
    productType: z.string().min(1).optional(),
    gender: z.string().optional(),
    baseProductionTimeMins: z.number().int().positive().optional(),
    defaultFabricConsumption: z.number().positive().optional().nullable(),
    imageUrl: z.string().url().optional().nullable(),
    isActive: z.boolean().optional(),
    packagingCost: z.number().nonnegative().optional().nullable(),
});

const deleteProductSchema = z.object({
    id: z.string().uuid('Invalid product ID'),
});

// NOTE: fabricId has been REMOVED from Variation table.
// Fabric assignment is now ONLY via BOM lines (VariationBomLine.fabricColourId).
const createVariationSchema = z.object({
    productId: z.string().uuid('Invalid product ID'),
    colorName: z.string().min(1, 'Color name is required').trim(),
    standardColor: z.string().optional().nullable(),
    colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color hex').optional().nullable(),
    imageUrl: z.string().url().optional().nullable(),
    hasLining: z.boolean().default(false),
});

const updateVariationSchema = z.object({
    id: z.string().uuid('Invalid variation ID'),
    colorName: z.string().min(1).trim().optional(),
    standardColor: z.string().optional().nullable(),
    colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color hex').optional().nullable(),
    imageUrl: z.string().url().optional().nullable(),
    hasLining: z.boolean().optional(),
    isActive: z.boolean().optional(),
    packagingCost: z.number().nonnegative().optional().nullable(),
    laborMinutes: z.number().positive().optional().nullable(),
});

const createSkuSchema = z.object({
    variationId: z.string().uuid('Invalid variation ID'),
    size: z.string().min(1, 'Size is required').trim(),
    skuCode: z.string().min(1, 'SKU code is required').trim(),
    fabricConsumption: z.number().positive().default(1.5),
    mrp: z.number().positive('MRP must be greater than 0'),
    targetStockQty: z.number().int().nonnegative().default(10),
    targetStockMethod: z.string().default('day14'),
});

const updateSkuSchema = z.object({
    id: z.string().uuid('Invalid SKU ID'),
    fabricConsumption: z.number().positive().optional(),
    mrp: z.number().positive().optional(),
    targetStockQty: z.number().int().nonnegative().optional(),
    targetStockMethod: z.string().optional(),
    isActive: z.boolean().optional(),
    packagingCost: z.number().nonnegative().optional().nullable(),
    laborMinutes: z.number().positive().optional().nullable(),
});

// ============================================
// PRODUCT CRUD
// ============================================

/**
 * Create a new product
 *
 * Creates a product with the specified details. Returns the created product
 * with fabric type relation.
 */
export const createProduct = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createProductSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const prisma = await getPrisma();
                const product = await prisma.product.create({
                    data: {
                        name: data.name,
                        styleCode: data.styleCode || null,
                        category: data.category,
                        productType: data.productType,
                        gender: data.gender || 'unisex',
                        baseProductionTimeMins: data.baseProductionTimeMins || 60,
                        defaultFabricConsumption: data.defaultFabricConsumption || null,
                        imageUrl: data.imageUrl || null,
                    },
                });

                return { success: true, data: product };
        } catch (error: unknown) {
            console.error('Create product error:', error);
            const message = error instanceof Error ? error.message : 'Failed to create product';
            return { success: false, error: { message } };
        }
    });

/**
 * Update an existing product
 *
 * Updates product fields. Only provided fields are updated.
 * NOTE: Fabric info comes from variation BOM lines, not product-level fields.
 */
export const updateProduct = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateProductSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const prisma = await getPrisma();
                // Build update data with only provided fields
                const updateData: Record<string, unknown> = {};
                if (data.name !== undefined) updateData.name = data.name;
                if (data.styleCode !== undefined) updateData.styleCode = data.styleCode || null;
                if (data.category !== undefined) updateData.category = data.category;
                if (data.productType !== undefined) updateData.productType = data.productType;
                if (data.gender !== undefined) updateData.gender = data.gender;
                if (data.baseProductionTimeMins !== undefined) updateData.baseProductionTimeMins = data.baseProductionTimeMins;
                if (data.defaultFabricConsumption !== undefined) updateData.defaultFabricConsumption = data.defaultFabricConsumption;
                if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
                if (data.isActive !== undefined) updateData.isActive = data.isActive;
                if (data.packagingCost !== undefined) updateData.packagingCost = data.packagingCost;

                const product = await prisma.product.update({
                    where: { id: data.id },
                    data: updateData,
                });

                return { success: true, data: product };
        } catch (error: unknown) {
            console.error('Update product error:', error);
            const message = error instanceof Error ? error.message : 'Failed to update product';
            return { success: false, error: { message } };
        }
    });

/**
 * Delete a product (soft delete)
 *
 * Sets isActive to false instead of deleting from database.
 */
export const deleteProduct = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteProductSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const prisma = await getPrisma();
                await prisma.product.update({
                    where: { id: data.id },
                    data: { isActive: false },
                });

                return { success: true, data: { message: 'Product deactivated' } };
        } catch (error: unknown) {
            console.error('Delete product error:', error);
            const message = error instanceof Error ? error.message : 'Failed to delete product';
            return { success: false, error: { message } };
        }
    });

// ============================================
// VARIATION CRUD
// ============================================

/**
 * Create a variation (color variant) under a product
 *
 * Creates a variation with the specified color and fabric.
 * Returns the created variation with fabric relation.
 */
export const createVariation = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createVariationSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const prisma = await getPrisma();
                const variation = await prisma.variation.create({
                    data: {
                        productId: data.productId,
                        colorName: data.colorName,
                        standardColor: data.standardColor || null,
                        colorHex: data.colorHex || null,
                        // NOTE: fabricId removed - fabric is now assigned via BOM
                        imageUrl: data.imageUrl || null,
                        hasLining: data.hasLining || false,
                    },
                    include: {
                        product: true,
                    },
                });

                return { success: true, data: variation };
        } catch (error: unknown) {
            console.error('Create variation error:', error);
            const message = error instanceof Error ? error.message : 'Failed to create variation';
            return { success: false, error: { message } };
        }
    });

/**
 * Update an existing variation
 *
 * Updates variation fields. Fabric assignment is now managed via BOM.
 */
export const updateVariation = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateVariationSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const prisma = await getPrisma();
                // Build update data with only provided fields
                // Note: fabricId/fabricColourId no longer set here - use BOM
                const updateData: Record<string, unknown> = {};
                if (data.colorName !== undefined) updateData.colorName = data.colorName;
                if (data.standardColor !== undefined) updateData.standardColor = data.standardColor || null;
                if (data.colorHex !== undefined) updateData.colorHex = data.colorHex;
                if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
                if (data.hasLining !== undefined) updateData.hasLining = data.hasLining;
                if (data.isActive !== undefined) updateData.isActive = data.isActive;
                if (data.packagingCost !== undefined) updateData.packagingCost = data.packagingCost;
                if (data.laborMinutes !== undefined) updateData.laborMinutes = data.laborMinutes;

                const variation = await prisma.variation.update({
                    where: { id: data.id },
                    data: updateData,
                    include: {
                        // NOTE: fabric removed - now via BOM
                        product: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                });

                return { success: true, data: variation };
        } catch (error: unknown) {
            console.error('Update variation error:', error);
            const message = error instanceof Error ? error.message : 'Failed to update variation';
            return { success: false, error: { message } };
        }
    });

// ============================================
// SKU CRUD
// ============================================

/**
 * Create an SKU (size-specific sellable unit) under a variation
 *
 * Creates an SKU with the specified size, code, and pricing.
 * Returns the created SKU.
 */
export const createSku = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createSkuSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const prisma = await getPrisma();
                const sku = await prisma.sku.create({
                    data: {
                        variationId: data.variationId,
                        size: data.size,
                        skuCode: data.skuCode,
                        fabricConsumption: data.fabricConsumption || 1.5,
                        mrp: data.mrp,
                        targetStockQty: data.targetStockQty || 10,
                        targetStockMethod: data.targetStockMethod || 'day14',
                    },
                    include: {
                        variation: {
                            include: {
                                product: true,
                                // NOTE: fabric removed - now via BOM
                            },
                        },
                    },
                });

                return { success: true, data: sku };
        } catch (error: unknown) {
            console.error('Create SKU error:', error);
            const message = error instanceof Error ? error.message : 'Failed to create SKU';
            return { success: false, error: { message } };
        }
    });

/**
 * Update an existing SKU
 *
 * Updates SKU fields. Cost fields use costing cascade (null = inherit from Variation/Product).
 */
export const updateSku = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateSkuSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const prisma = await getPrisma();
                // Build update data with only provided fields
                const updateData: Record<string, unknown> = {};
                if (data.fabricConsumption !== undefined) updateData.fabricConsumption = data.fabricConsumption;
                if (data.mrp !== undefined) updateData.mrp = data.mrp;
                if (data.targetStockQty !== undefined) updateData.targetStockQty = data.targetStockQty;
                if (data.targetStockMethod !== undefined) updateData.targetStockMethod = data.targetStockMethod;
                if (data.isActive !== undefined) updateData.isActive = data.isActive;
                if (data.packagingCost !== undefined) updateData.packagingCost = data.packagingCost;
                if (data.laborMinutes !== undefined) updateData.laborMinutes = data.laborMinutes;

                const sku = await prisma.sku.update({
                    where: { id: data.id },
                    data: updateData,
                    include: {
                        variation: {
                            include: {
                                product: true,
                                // NOTE: fabric removed - now via BOM
                            },
                        },
                    },
                });

                return { success: true, data: sku };
        } catch (error: unknown) {
            console.error('Update SKU error:', error);
            const message = error instanceof Error ? error.message : 'Failed to update SKU';
            return { success: false, error: { message } };
        }
    });

// ============================================
// STYLE CODE UPDATE
// ============================================

const updateStyleCodeSchema = z.object({
    id: z.string().uuid('Invalid product ID'),
    styleCode: z.string().nullable(),
});

/**
 * Update a product's style code
 *
 * Used by the Style Codes tab for quick inline editing.
 * Style codes must be unique across all products.
 */
export const updateStyleCode = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateStyleCodeSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const prisma = await getPrisma();
                const product = await prisma.product.update({
                    where: { id: data.id },
                    data: { styleCode: data.styleCode },
                });

                return { success: true as const, data: { id: product.id, styleCode: product.styleCode } };
        } catch (error: unknown) {
            console.error('Update style code error:', error);
            const message = error instanceof Error ? error.message : 'Failed to update style code';
            return { success: false as const, error: { message } };
        }
    });

// ============================================
// STYLE CODE BULK IMPORT
// ============================================

const importStyleCodesSchema = z.object({
    rows: z.array(z.object({
        barcode: z.string(),
        styleCode: z.string(),
    })),
});

/**
 * Bulk import style codes from CSV data
 *
 * Matches SKU barcodes to find products, then updates style codes.
 * Multiple products can share the same style code (same pattern).
 * Skips products that already have a style code set.
 */
export const importStyleCodes = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => importStyleCodesSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const prisma = await getPrisma();
                const { rows } = data;

                // Get unique barcodes to look up
                const uniqueBarcodes = [...new Set(rows.map(r => r.barcode))];

                // Find matching SKUs with their Product IDs
                const skus = await prisma.sku.findMany({
                    where: { skuCode: { in: uniqueBarcodes } },
                    select: {
                        skuCode: true,
                        variation: {
                            select: {
                                productId: true,
                                product: {
                                    select: {
                                        id: true,
                                        name: true,
                                        styleCode: true,
                                    },
                                },
                            },
                        },
                    },
                });

                // Create barcode -> product mapping
                const barcodeToProduct = new Map<string, { id: string; name: string; currentStyleCode: string | null }>();
                for (const sku of skus) {
                    barcodeToProduct.set(sku.skuCode, {
                        id: sku.variation.productId,
                        name: sku.variation.product.name,
                        currentStyleCode: sku.variation.product.styleCode,
                    });
                }

                // Track unique barcodes not found
                const barcodesNotFound = new Set<string>();

                // Build product -> style code mapping (deduplicate by product)
                // Multiple products CAN share the same style code
                const productUpdates = new Map<string, string>();
                const productsAlreadySet = new Set<string>();

                for (const row of rows) {
                    const product = barcodeToProduct.get(row.barcode);
                    if (!product) {
                        barcodesNotFound.add(row.barcode);
                        continue;
                    }

                    // Skip if product already has a style code in DB
                    if (product.currentStyleCode) {
                        productsAlreadySet.add(product.id);
                        continue;
                    }

                    // Queue for update (first occurrence wins for this product)
                    // Note: Multiple different products can have the same style code
                    if (!productUpdates.has(product.id)) {
                        productUpdates.set(product.id, row.styleCode);
                    }
                }

                // Perform updates (style codes can be shared across products)
                let updated = 0;
                let errors = 0;

                for (const [productId, styleCode] of productUpdates) {
                    try {
                        await prisma.product.update({
                            where: { id: productId },
                            data: { styleCode },
                        });
                        updated++;
                    } catch (err) {
                        console.error(`Failed to update product ${productId}:`, err);
                        errors++;
                    }
                }

                return {
                    success: true as const,
                    updated,
                    notFound: barcodesNotFound.size,
                    duplicates: productsAlreadySet.size,
                    errors,
                };
        } catch (error: unknown) {
            console.error('Import style codes error:', error);
            const message = error instanceof Error ? error.message : 'Failed to import style codes';
            return { success: false as const, error: { message }, updated: 0, notFound: 0, duplicates: 0, errors: 0 };
        }
    });
