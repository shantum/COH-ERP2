/**
 * Product Sync Service — Dry-Run (read-only preview)
 */

import type { PrismaClient } from '@prisma/client';
import type {
    DryRunOrphan,
    DryRunProductAction,
    DryRunResult,
    DryRunSkuAction,
    DryRunVariationAction,
    ShopifyProductWithImages,
    ShopifyVariantWithInventory,
} from './types.js';
import shopifyClient from '../shopify/index.js';
import { resolveProductCategory } from '../../config/mappings/index.js';
import { groupVariantsByColor, resolveOptionPositions } from './variantUtils.js';

/**
 * Dry-run: simulate the 1:1 sync and return what WOULD change.
 * All read-only — no writes to the database.
 */
export async function dryRunSync(
    prisma: PrismaClient,
    shopifyProducts: ShopifyProductWithImages[],
): Promise<DryRunResult> {
    const products: DryRunProductAction[] = [];
    const variations: DryRunVariationAction[] = [];
    const skuMoves: DryRunSkuAction[] = [];
    // Track which variations get "claimed" by a Shopify product
    const claimedVariationIds = new Set<string>();
    let bomTemplateCopyCount = 0;

    for (const sp of shopifyProducts) {
        const shopifyProductId = String(sp.id);
        const gender = shopifyClient.extractGenderFromMetafields(null, sp.product_type, sp.tags || null);
        const mainImageUrl = sp.image?.src || sp.images?.[0]?.src || null;

        // 1. Would we find or create the product?
        const existing = await prisma.product.findUnique({
            where: { shopifyProductId },
        });

        if (existing) {
            const fieldChanges: Record<string, { from: string | null; to: string | null }> = {};
            if (sp.title !== existing.name) fieldChanges.name = { from: existing.name, to: sp.title };
            if (gender && gender !== existing.gender) fieldChanges.gender = { from: existing.gender, to: gender };
            if (sp.handle && sp.handle !== existing.shopifyHandle) fieldChanges.handle = { from: existing.shopifyHandle, to: sp.handle };
            const resolvedCat = resolveProductCategory({ product_type: sp.product_type, tags: sp.tags });
            if (resolvedCat !== existing.category) fieldChanges.category = { from: existing.category, to: resolvedCat };
            if (mainImageUrl && mainImageUrl !== existing.imageUrl) fieldChanges.imageUrl = { from: existing.imageUrl, to: mainImageUrl };

            products.push({
                shopifyProductId, title: sp.title, handle: sp.handle,
                action: 'update',
                ...(Object.keys(fieldChanges).length > 0 ? { fieldChanges } : {}),
            });
        } else {
            products.push({
                shopifyProductId, title: sp.title, handle: sp.handle,
                action: 'create',
            });
        }

        // 2. Check variations
        const variantsByColor = groupVariantsByColor(
            sp.variants as ShopifyVariantWithInventory[],
            sp.options,
        );
        const { sizeKey } = sp.options?.length
            ? resolveOptionPositions(sp.options)
            : { sizeKey: 'option2' as const };

        for (const [colorName, variants] of Object.entries(variantsByColor)) {
            // Would we find a variation?
            let variation = existing
                ? await prisma.variation.findFirst({
                    where: { productId: existing.id, shopifySourceProductId: shopifyProductId },
                })
                : null;
            if (!variation && existing) {
                variation = await prisma.variation.findFirst({
                    where: { productId: existing.id, colorName },
                });
            }

            if (variation) {
                claimedVariationIds.add(variation.id);
                variations.push({
                    shopifyProductId, colorName, action: 'exists', productTitle: sp.title,
                });
            }

            // Priority 3: variation ANYWHERE by shopifySourceProductId → would MOVE
            if (!variation) {
                variation = await prisma.variation.findFirst({
                    where: { shopifySourceProductId: shopifyProductId },
                });
                if (variation) {
                    claimedVariationIds.add(variation.id);
                    variations.push({
                        shopifyProductId, colorName, action: 'move', productTitle: sp.title,
                        fromProductId: variation.productId,
                    });
                    // Check if BOM templates would be copied
                    if (existing) {
                        const targetTemplateCount = await prisma.productBomTemplate.count({ where: { productId: existing.id } });
                        if (targetTemplateCount === 0) {
                            const sourceTemplateCount = await prisma.productBomTemplate.count({ where: { productId: variation.productId } });
                            if (sourceTemplateCount > 0) bomTemplateCopyCount++;
                        }
                    }
                }
            }

            // Priority 4: create
            if (!variation) {
                variations.push({
                    shopifyProductId, colorName, action: 'create', productTitle: sp.title,
                });
            }

            // 3. Check SKUs — would any move?
            for (const variant of variants) {
                const shopifyVariantId = String(variant.id);
                const sizeValue = variant[sizeKey];
                const skuCode = variant.sku?.trim() ||
                    `${sp.handle}-${colorName}-${sizeValue || 'OS'}`.replace(/\s+/g, '-').toUpperCase();

                const existingSku = await prisma.sku.findFirst({
                    where: {
                        OR: [{ shopifyVariantId }, { skuCode }],
                    },
                });

                if (existingSku) {
                    if (variation && existingSku.variationId !== variation.id) {
                        skuMoves.push({
                            shopifyVariantId, skuCode: existingSku.skuCode,
                            action: 'move',
                            fromVariationId: existingSku.variationId,
                            toVariationId: variation.id,
                        });
                    }
                    // If product is new (no existing), the SKU will also move
                    if (!existing) {
                        skuMoves.push({
                            shopifyVariantId, skuCode: existingSku.skuCode,
                            action: 'move',
                            fromVariationId: existingSku.variationId,
                            toVariationId: '(new variation)',
                        });
                    }
                } else {
                    skuMoves.push({
                        shopifyVariantId, skuCode,
                        action: 'create',
                    });
                }
            }
        }
    }

    // 4. Find orphaned variations (on products with multiple shopifyProductIds, variations whose
    //    shopifySourceProductId doesn't match the product's primary shopifyProductId)
    const orphanedVariations: DryRunOrphan[] = [];
    const consolidatedProducts = await prisma.product.findMany({
        where: { shopifyProductIds: { isEmpty: false } },
        select: { id: true, name: true, shopifyProductId: true, shopifyProductIds: true },
    });

    for (const p of consolidatedProducts) {
        if (p.shopifyProductIds.length <= 1) continue;
        // Variations on this product that belong to a DIFFERENT Shopify product
        const vars = await prisma.variation.findMany({
            where: {
                productId: p.id,
                shopifySourceProductId: { not: p.shopifyProductId ?? undefined },
            },
            select: { id: true, colorName: true, _count: { select: { skus: true } } },
        });
        for (const v of vars) {
            if (!claimedVariationIds.has(v.id)) {
                orphanedVariations.push({
                    variationId: v.id,
                    colorName: v.colorName,
                    productName: p.name,
                    productId: p.id,
                    skuCount: v._count.skus,
                });
            }
        }
    }

    const summary = {
        products: {
            create: products.filter(p => p.action === 'create').length,
            update: products.filter(p => p.action === 'update').length,
        },
        variations: {
            create: variations.filter(v => v.action === 'create').length,
            existing: variations.filter(v => v.action === 'exists').length,
            move: variations.filter(v => v.action === 'move').length,
        },
        skus: {
            create: skuMoves.filter(s => s.action === 'create').length,
            update: skuMoves.filter(s => s.action === 'update').length,
            move: skuMoves.filter(s => s.action === 'move').length,
        },
        bomTemplateCopies: bomTemplateCopyCount,
        orphanedVariations: orphanedVariations.length,
    };

    return { summary, products, variations, skuMoves, orphanedVariations };
}
