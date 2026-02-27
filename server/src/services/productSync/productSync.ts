/**
 * Product Sync Service — Single Product Sync
 *
 * 1:1 mapping: one Shopify product = one ERP Product.
 * Each Shopify product represents ONE COLOR of a design.
 * Shopify "Variant" (size) = ERP "Sku".
 * The Variation layer has exactly one entry per Product (holds color name + Shopify source).
 *
 * Sibling colors (e.g. same shirt in Red, Black, Blue) are separate ERP Products
 * with the same name. Shopify links them via `custom.product_variants` metafield.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { ShopifyProductWithImages, ShopifyVariantWithInventory, SyncResult } from './types.js';
import shopifyClient from '../shopify/index.js';
import { resolveProductCategory } from '../../config/mappings/index.js';
import { deriveTaxonomy } from '@coh/shared/config/productTaxonomy';
import logger from '../../utils/logger.js';
import { buildVariantImageMap, groupVariantsByColor, resolveOptionPositions } from './variantUtils.js';
import { syncSingleSku } from './skuSync.js';

const log = logger.child({ module: 'product-sync' });

/**
 * Copy ProductBomTemplate records from source product to target product.
 * Only copies if target has no templates yet. Uses skipDuplicates for idempotency.
 */
export async function copyProductBomTemplates(
    prisma: PrismaClient,
    sourceProductId: string,
    targetProductId: string,
): Promise<number> {
    // Check if target already has templates
    const existingCount = await prisma.productBomTemplate.count({
        where: { productId: targetProductId },
    });
    if (existingCount > 0) return 0;

    // Fetch source templates
    const sourceTemplates = await prisma.productBomTemplate.findMany({
        where: { productId: sourceProductId },
    });
    if (sourceTemplates.length === 0) return 0;

    // Copy to target product
    const result = await prisma.productBomTemplate.createMany({
        data: sourceTemplates.map(t => ({
            productId: targetProductId,
            roleId: t.roleId,
            trimItemId: t.trimItemId,
            serviceItemId: t.serviceItemId,
            defaultQuantity: t.defaultQuantity,
            quantityUnit: t.quantityUnit,
            wastagePercent: t.wastagePercent,
            notes: t.notes,
        })),
        skipDuplicates: true,
    });

    if (result.count > 0) {
        log.info({ from: sourceProductId, to: targetProductId, count: result.count }, 'Copied ProductBomTemplate records');
    }
    return result.count;
}

/**
 * Sync a single product from Shopify to the database
 * 1:1 mapping: one Shopify product = one ERP product.
 * Matches by shopifyProductId (unique). Creates new if not found.
 */
export async function syncSingleProduct(
    prisma: PrismaClient,
    shopifyProduct: ShopifyProductWithImages,
): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0 };

    const shopifyProductId = String(shopifyProduct.id);
    const mainImageUrl = shopifyProduct.image?.src || shopifyProduct.images?.[0]?.src || null;
    const gender = shopifyClient.extractGenderFromMetafields(null, shopifyProduct.product_type, shopifyProduct.tags || null);
    const variantImageMap = buildVariantImageMap(shopifyProduct);

    // ============================================
    // FIND OR CREATE PRODUCT (1:1 by shopifyProductId)
    // ============================================

    let product = await prisma.product.findUnique({
        where: { shopifyProductId },
    });

    if (!product) {
        const category = resolveProductCategory({
            product_type: shopifyProduct.product_type,
            tags: shopifyProduct.tags,
        });
        const taxonomy = deriveTaxonomy(category);
        product = await prisma.product.create({
            data: {
                name: shopifyProduct.title,
                shopifyProductId,
                shopifyHandle: shopifyProduct.handle,
                category,
                garmentGroup: taxonomy.garmentGroup,
                googleProductCategoryId: taxonomy.googleCategoryId,
                productType: 'basic',
                gender: gender || 'unisex',
                baseProductionTimeMins: 60,
                imageUrl: mainImageUrl,
            },
        });
        result.created++;
    } else {
        // Product exists — refresh key fields from Shopify
        const updates: Prisma.ProductUpdateInput = {};
        if (mainImageUrl && mainImageUrl !== product.imageUrl) updates.imageUrl = mainImageUrl;
        if (shopifyProduct.handle && shopifyProduct.handle !== product.shopifyHandle) {
            updates.shopifyHandle = shopifyProduct.handle;
        }
        if (gender && gender !== product.gender) updates.gender = gender;
        if (shopifyProduct.title !== product.name) updates.name = shopifyProduct.title;

        const resolvedCategory = resolveProductCategory({
            product_type: shopifyProduct.product_type,
            tags: shopifyProduct.tags,
        });
        if (resolvedCategory !== product.category) {
            const taxonomy = deriveTaxonomy(resolvedCategory);
            updates.category = resolvedCategory;
            updates.garmentGroup = taxonomy.garmentGroup;
            updates.googleProductCategoryId = taxonomy.googleCategoryId;
        }

        if (Object.keys(updates).length > 0) {
            await prisma.product.update({
                where: { id: product.id },
                data: updates,
            });
        }
    }

    result.productId = product.id;

    // ============================================
    // SYNC VARIATIONS & SKUs
    // ============================================

    const variantsByColor = groupVariantsByColor(
        shopifyProduct.variants as ShopifyVariantWithInventory[],
        shopifyProduct.options,
    );
    const { sizeKey } = shopifyProduct.options?.length
        ? resolveOptionPositions(shopifyProduct.options)
        : { sizeKey: 'option2' as const };

    for (const [colorName, variants] of Object.entries(variantsByColor)) {
        const firstVariantId = variants[0]?.id;
        const variationImageUrl = variantImageMap[firstVariantId] || mainImageUrl;

        // Priority 1: match by shopifySourceProductId (handles color renames on Shopify)
        // Priority 2: match by colorName
        let variation = await prisma.variation.findFirst({
            where: { productId: product.id, shopifySourceProductId: shopifyProductId },
        });

        if (variation && variation.colorName !== colorName) {
            log.info({ variationId: variation.id, old: variation.colorName, new: colorName }, 'Shopify color renamed, updating variation');
            await prisma.variation.update({
                where: { id: variation.id },
                data: { colorName },
            });
            variation = { ...variation, colorName };
            result.updated++;
        }

        if (!variation) {
            variation = await prisma.variation.findFirst({
                where: { productId: product.id, colorName },
            });
        }

        // Priority 3: variation ANYWHERE by shopifySourceProductId → MOVE to this product
        if (!variation) {
            variation = await prisma.variation.findFirst({
                where: { shopifySourceProductId: shopifyProductId },
            });
            if (variation) {
                const sourceProductId = variation.productId;
                await prisma.variation.update({
                    where: { id: variation.id },
                    data: { productId: product.id },
                });
                log.info({ variationId: variation.id, from: sourceProductId, to: product.id, colorName }, 'Moved variation to correct product');

                // Copy ProductBomTemplate from source product if new product has none
                await copyProductBomTemplates(prisma, sourceProductId, product.id);

                variation = { ...variation, productId: product.id };
                result.updated++;
            }
        }

        // Priority 4: create new variation
        if (!variation) {
            variation = await prisma.variation.create({
                data: {
                    productId: product.id,
                    colorName,
                    imageUrl: variationImageUrl,
                    shopifySourceProductId: shopifyProductId,
                    shopifySourceHandle: shopifyProduct.handle,
                },
            });
            result.created++;
        } else {
            const variationUpdates: Record<string, string | null> = {};
            if (!variation.shopifySourceProductId) {
                variationUpdates.shopifySourceProductId = shopifyProductId;
                variationUpdates.shopifySourceHandle = shopifyProduct.handle;
            }
            if (variationImageUrl && variationImageUrl !== variation.imageUrl) {
                variationUpdates.imageUrl = variationImageUrl;
            }

            if (Object.keys(variationUpdates).length > 0) {
                await prisma.variation.update({
                    where: { id: variation.id },
                    data: variationUpdates,
                });
                result.updated++;
            }
        }

        // Process SKUs for each variant
        for (const variant of variants) {
            const skuResult = await syncSingleSku(prisma, variant, variation.id, shopifyProduct.handle, colorName, sizeKey);
            result.created += skuResult.created;
            result.updated += skuResult.updated;
        }
    }

    return result;
}
