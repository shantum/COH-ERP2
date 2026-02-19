/**
 * BOM Consumption Server Functions
 *
 * Size-based consumption management: grid view, import, update, reset, and product mapping.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';
import { recalculateVariationAndSkuBomCosts } from '@coh/shared/services/bom';
import { sortBySizeOrder, getMainFabricRole, type MutationResult, type DbRecord } from './bomHelpers';

// ============================================
// INPUT SCHEMAS
// ============================================

const importConsumptionSchema = z.object({
    imports: z.array(z.object({
        productId: z.string().uuid('Invalid product ID'),
        sizes: z.record(z.string(), z.number().nonnegative()),
    })),
});

const updateSizeConsumptionsSchema = z.object({
    productId: z.string().uuid('Invalid product ID'),
    roleId: z.string().uuid('Invalid role ID'),
    consumptions: z.array(z.object({
        size: z.string().min(1, 'Size is required'),
        quantity: z.number().nonnegative(),
    })),
});

const consumptionGridParamsSchema = z.object({
    role: z.string().optional(),
    type: z.string().optional(),
});

const updateConsumptionGridSchema = z.object({
    updates: z.array(z.object({
        productId: z.string().uuid(),
        size: z.string(),
        quantity: z.number().nonnegative(),
    })),
    roleId: z.string().uuid(),
});

// ============================================
// RESULT TYPES
// ============================================

export interface ConsumptionGridRow {
    productId: string;
    productName: string;
    styleCode: string | null;
    category: string | null;
    gender: string | null;
    imageUrl: string | null;
    variationCount: number;
    skuCount: number;
    defaultQuantity: number | null;
    sizes: Record<string, { quantity: number | null; skuCount: number }>;
}

export interface ConsumptionGridResult {
    roleId: string;
    roleName: string;
    roleType: string;
    sizes: string[];
    rows: ConsumptionGridRow[];
}

export interface ImportConsumptionResult {
    productsImported: number;
    skusUpdated: number;
}

export interface ProductForMappingResult {
    id: string;
    name: string;
    styleCode: string | null;
    category: string | null;
    imageUrl: string | null;
    gender: string | null;
    hasConsumption: boolean;
    avgConsumption: number;
}

// ============================================
// SERVER FUNCTIONS
// ============================================

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
            const mainFabricRole = await getMainFabricRole(prisma);

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
            const productMap = new Map(products.map((p: DbRecord) => [p.id, p]));

            // Build batch operations
            const skuUpdates: { skuId: string; quantity: number }[] = [];

            for (const imp of imports) {
                const product = productMap.get(imp.productId) as DbRecord;
                if (!product || !imp.sizes) continue;

                for (const variation of product.variations as DbRecord[]) {
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
            await prisma.$transaction(async (tx: PrismaTransaction) => {
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

            // Trigger BOM cost recalculation for all affected variations (fire and forget)
            (async () => {
                try {
                    // Get unique variation IDs from the updates
                    const skuIds = skuUpdates.map((u) => u.skuId);
                    const skusWithVariations = await prisma.sku.findMany({
                        where: { id: { in: skuIds } },
                        select: { id: true, variationId: true },
                    });

                    // Group by variation and recalculate
                    const variationIds = [...new Set(skusWithVariations.map((s) => s.variationId))];
                    for (const variationId of variationIds) {
                        await recalculateVariationAndSkuBomCosts(prisma, variationId);
                    }
                } catch (err) {
                    console.error('[importConsumption] BOM cost recalculation failed:', err);
                }
            })();

            return {
                success: true,
                data: {
                    productsImported: uniqueProducts,
                    skusUpdated: skuUpdates.length,
                },
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Import failed';
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
        const allSkus = product.variations.flatMap((v: DbRecord) => v.skus);
        const skusToUpdate = allSkus.filter((sku: DbRecord) => sizeQuantityMap.has(sku.size));

        // Get role to check if it's main fabric (for backward compat)
        const role = await prisma.componentRole.findUnique({
            where: { id: roleId },
            include: { type: true },
        });

        const isMainFabric = role?.type.code === 'FABRIC' && role.code === 'main';

        try {
            // Batch update in transaction
            let updatedCount = 0;
            await prisma.$transaction(async (tx: PrismaTransaction) => {
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

            // Trigger BOM cost recalculation for all variations (fire and forget)
            (async () => {
                try {
                    const variationIds = product.variations.map((v: DbRecord) => v.id);
                    for (const variationId of variationIds) {
                        await recalculateVariationAndSkuBomCosts(prisma, variationId);
                    }
                } catch (err) {
                    console.error('[updateSizeConsumptions] BOM cost recalculation failed:', err);
                }
            })();

            return {
                success: true,
                data: {
                    updated: updatedCount,
                    sizesUpdated: consumptions.length,
                },
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to update consumptions';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Get consumption grid data for spreadsheet-style editing
 */
export const getConsumptionGrid = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => consumptionGridParamsSchema.parse(input ?? {}))
    .handler(async ({ data }): Promise<MutationResult<ConsumptionGridResult>> => {
        const prisma = await getPrisma();

        try {
            // Get the main fabric role (or specified role)
            let role;
            if (data.role) {
                role = await prisma.componentRole.findFirst({
                    where: { id: data.role },
                    include: { type: true },
                });
            } else {
                role = await prisma.componentRole.findFirst({
                    where: {
                        code: 'main',
                        type: { code: data.type || 'FABRIC' },
                    },
                    include: { type: true },
                });
            }

            if (!role) {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: 'Component role not found' },
                };
            }

            // Get all active products with their SKUs
            const products = await prisma.product.findMany({
                where: { isActive: true },
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
                orderBy: [{ gender: 'asc' }, { category: 'asc' }, { name: 'asc' }],
            });

            // Get all SKU IDs
            const allSkuIds: string[] = [];
            for (const product of products) {
                for (const variation of product.variations as DbRecord[]) {
                    for (const sku of variation.skus as DbRecord[]) {
                        allSkuIds.push(sku.id);
                    }
                }
            }

            // Get SKU BOM lines for this role
            const skuBomLines = await prisma.skuBomLine.findMany({
                where: { skuId: { in: allSkuIds }, roleId: role.id },
            });

            // Create a map of skuId -> quantity
            const skuQuantityMap = new Map<string, number | null>();
            for (const line of skuBomLines) {
                skuQuantityMap.set(line.skuId, line.quantity);
            }

            // Get product templates for default quantities
            const productIds = products.map((p: DbRecord) => p.id);
            const templates = await prisma.productBomTemplate.findMany({
                where: { productId: { in: productIds }, roleId: role.id },
            });

            const templateMap = new Map<string, number | null>();
            for (const t of templates) {
                templateMap.set(t.productId, t.defaultQuantity);
            }

            // Collect all unique sizes
            const sizeSet = new Set<string>();

            for (const product of products) {
                for (const variation of product.variations as DbRecord[]) {
                    for (const sku of variation.skus as DbRecord[]) {
                        sizeSet.add(sku.size);
                    }
                }
            }

            const sizes = sortBySizeOrder(Array.from(sizeSet));

            // Build rows
            const rows: ConsumptionGridRow[] = [];

            for (const product of products) {
                const defaultQuantity = templateMap.get(product.id) ?? null;
                const sizesData: Record<string, { quantity: number | null; skuCount: number }> = {};

                // Initialize all sizes
                for (const size of sizes) {
                    sizesData[size] = { quantity: null, skuCount: 0 };
                }

                let totalSkus = 0;
                for (const variation of product.variations as DbRecord[]) {
                    for (const sku of variation.skus as DbRecord[]) {
                        totalSkus++;
                        const sizeData = sizesData[sku.size];
                        if (sizeData) {
                            sizeData.skuCount++;
                            // Get quantity: SKU BOM line -> legacy fabricConsumption -> template default
                            const bomQty = skuQuantityMap.get(sku.id);
                            if (bomQty !== undefined && bomQty !== null) {
                                sizeData.quantity = bomQty;
                            } else if (sku.fabricConsumption !== null && sizeData.quantity === null) {
                                sizeData.quantity = sku.fabricConsumption;
                            } else if (defaultQuantity !== null && sizeData.quantity === null) {
                                sizeData.quantity = defaultQuantity;
                            }
                        }
                    }
                }

                rows.push({
                    productId: product.id,
                    productName: product.name,
                    styleCode: product.styleCode,
                    category: product.category,
                    gender: product.gender,
                    imageUrl: product.imageUrl,
                    variationCount: (product.variations as DbRecord[]).length,
                    skuCount: totalSkus,
                    defaultQuantity,
                    sizes: sizesData,
                });
            }

            return {
                success: true,
                data: {
                    roleId: role.id,
                    roleName: role.name,
                    roleType: role.type.code,
                    sizes,
                    rows,
                },
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to load consumption grid';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Update consumption grid values
 */
export const updateConsumptionGrid = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateConsumptionGridSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<{ updated: number }>> => {
        const prisma = await getPrisma();
        const { updates, roleId } = data;

        try {
            // Get all products to find their SKUs
            const productIds = [...new Set(updates.map((u) => u.productId))];

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

            // Create map: productId -> size -> skuIds
            const productSizeSkuMap = new Map<string, Map<string, string[]>>();
            for (const product of products) {
                const sizeMap = new Map<string, string[]>();
                for (const variation of product.variations as DbRecord[]) {
                    for (const sku of variation.skus as DbRecord[]) {
                        if (!sizeMap.has(sku.size)) {
                            sizeMap.set(sku.size, []);
                        }
                        sizeMap.get(sku.size)!.push(sku.id);
                    }
                }
                productSizeSkuMap.set(product.id, sizeMap);
            }

            // Check if this is main fabric role for backward compat
            const role = await prisma.componentRole.findUnique({
                where: { id: roleId },
                include: { type: true },
            });

            const isMainFabric = role?.type.code === 'FABRIC' && role.code === 'main';

            let updatedCount = 0;

            await prisma.$transaction(async (tx: PrismaTransaction) => {
                for (const update of updates) {
                    const sizeMap = productSizeSkuMap.get(update.productId);
                    if (!sizeMap) continue;

                    const skuIds = sizeMap.get(update.size);
                    if (!skuIds || skuIds.length === 0) continue;

                    for (const skuId of skuIds) {
                        // Upsert SKU BOM line
                        await tx.skuBomLine.upsert({
                            where: {
                                skuId_roleId: { skuId, roleId },
                            },
                            update: { quantity: update.quantity },
                            create: {
                                skuId,
                                roleId,
                                quantity: update.quantity,
                            },
                        });

                        // Backward compatibility: update legacy fabricConsumption
                        if (isMainFabric) {
                            await tx.sku.update({
                                where: { id: skuId },
                                data: { fabricConsumption: update.quantity },
                            });
                        }

                        updatedCount++;
                    }
                }
            }, { timeout: 60000 });

            // Trigger BOM cost recalculation for all affected variations (fire and forget)
            (async () => {
                try {
                    const variationIds = products.flatMap((p: DbRecord) =>
                        (p.variations as DbRecord[]).map((v: DbRecord) => v.id)
                    );
                    for (const variationId of variationIds) {
                        await recalculateVariationAndSkuBomCosts(prisma, variationId);
                    }
                } catch (err) {
                    console.error('[updateConsumptionGrid] BOM cost recalculation failed:', err);
                }
            })();

            return {
                success: true,
                data: { updated: updatedCount },
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to update consumption grid';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Get products for consumption import mapping
 */
export const getProductsForMapping = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<ProductForMappingResult[]>> => {
        const prisma = await getPrisma();

        try {
            const products = await prisma.product.findMany({
                where: { isActive: true },
                include: {
                    variations: {
                        where: { isActive: true },
                        include: {
                            skus: {
                                where: { isActive: true },
                                select: { id: true, fabricConsumption: true },
                            },
                        },
                    },
                },
                orderBy: { name: 'asc' },
            });

            const result: ProductForMappingResult[] = products.map((product: DbRecord) => {
                const allSkus = product.variations.flatMap((v: DbRecord) => v.skus);
                const consumptions = allSkus
                    .map((s: DbRecord) => s.fabricConsumption)
                    .filter((c: number | null): c is number => c !== null && c > 0);

                return {
                    id: product.id,
                    name: product.name,
                    styleCode: product.styleCode,
                    category: product.category,
                    imageUrl: product.imageUrl,
                    gender: product.gender,
                    hasConsumption: consumptions.length > 0,
                    avgConsumption: consumptions.length > 0
                        ? consumptions.reduce((a: number, b: number) => a + b, 0) / consumptions.length
                        : 0,
                };
            });

            return { success: true, data: result };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to load products';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Reset all consumption data
 */
export const resetConsumption = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<{ deletedBomLines: number; resetSkus: number }>> => {
        const prisma = await getPrisma();

        try {
            // Get main fabric role
            const mainFabricRole = await getMainFabricRole(prisma);

            let deletedBomLines = 0;
            let resetSkus = 0;

            await prisma.$transaction(async (tx: PrismaTransaction) => {
                // Delete SKU BOM lines for main fabric role
                if (mainFabricRole) {
                    const deleteResult = await tx.skuBomLine.deleteMany({
                        where: { roleId: mainFabricRole.id },
                    });
                    deletedBomLines = deleteResult.count;
                }

                // Reset legacy fabricConsumption field to default
                const updateResult = await tx.sku.updateMany({
                    where: { fabricConsumption: { not: 1.5 } },
                    data: { fabricConsumption: 1.5 },
                });
                resetSkus = updateResult.count;
            }, { timeout: 60000 });

            return {
                success: true,
                data: { deletedBomLines, resetSkus },
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to reset consumption';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });
