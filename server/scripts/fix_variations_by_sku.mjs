/**
 * Fix Variations Gender Script
 * 
 * This script analyzes each variation's SKUs, traces them back to their
 * Shopify source product, determines the correct gender from tags, and
 * moves variations to the correct gender-specific product.
 * 
 * Run with: node scripts/fix_variations_by_sku.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function extractGenderFromTags(tags) {
    if (!tags) return 'unisex';
    const tagLower = tags.toLowerCase();

    if (tagLower.includes('_related_women')) return 'women';
    if (tagLower.includes('_related_men')) return 'men';
    if (tagLower.includes('women') || tagLower.includes('woman')) return 'women';
    if (tagLower.includes(' men') || tagLower.includes('men ') ||
        tagLower.startsWith('men') || tagLower.includes(',men')) return 'men';
    if (tagLower.includes('unisex')) return 'unisex';

    return 'unisex';
}

async function main() {
    console.log('=== Fix Variations by SKU Trace ===\n');

    // Get all products with their variations and SKUs
    const products = await prisma.product.findMany({
        include: {
            variations: {
                include: {
                    skus: true
                }
            }
        }
    });

    // Build a map of SKU code -> Shopify source info
    const skuSourceMap = {};

    // Get all Shopify product cache entries and build the map
    const shopifyCache = await prisma.shopifyProductCache.findMany();

    for (const cache of shopifyCache) {
        const raw = JSON.parse(cache.rawData);
        const gender = extractGenderFromTags(raw.tags);

        for (const variant of raw.variants || []) {
            if (variant.sku) {
                skuSourceMap[variant.sku] = {
                    shopifyProductId: cache.id,
                    gender: gender,
                    handle: raw.handle,
                    title: raw.title,
                    tags: raw.tags
                };
            }
        }
    }

    console.log(`Built SKU source map with ${Object.keys(skuSourceMap).length} SKUs\n`);

    let fixCount = 0;

    // For each product, check if its variations are in the correct place
    for (const product of products) {
        for (const variation of product.variations) {
            // Get the first SKU to determine the source
            const firstSku = variation.skus[0];
            if (!firstSku) continue;

            const source = skuSourceMap[firstSku.skuCode];
            if (!source) continue;

            // Check if this variation is in the wrong product (wrong gender)
            if (source.gender !== product.gender && source.gender !== 'unisex' && product.gender !== 'unisex') {
                console.log(`\n--- Misplaced variation found ---`);
                console.log(`  Variation: "${variation.colorName}" (product: "${product.name}")`);
                console.log(`  Current product gender: ${product.gender}`);
                console.log(`  SKU ${firstSku.skuCode} belongs to: ${source.gender} (from tags)`);
                console.log(`  Source handle: ${source.handle}`);

                // Find or create the correct product (same name, correct gender)
                let targetProduct = await prisma.product.findFirst({
                    where: {
                        name: product.name,
                        gender: source.gender
                    }
                });

                if (!targetProduct) {
                    console.log(`  Creating new ${source.gender} product for "${product.name}"`);
                    targetProduct = await prisma.product.create({
                        data: {
                            name: product.name,
                            category: product.category,
                            productType: product.productType,
                            gender: source.gender,
                            fabricTypeId: product.fabricTypeId,
                            baseProductionTimeMins: product.baseProductionTimeMins,
                            shopifyProductId: source.shopifyProductId,
                            shopifyProductIds: [source.shopifyProductId],
                            shopifyHandle: source.handle
                        }
                    });
                }

                // Check if target product already has this color
                const existingVariation = await prisma.variation.findFirst({
                    where: { productId: targetProduct.id, colorName: variation.colorName }
                });

                if (existingVariation) {
                    // Move SKUs to existing variation
                    await prisma.sku.updateMany({
                        where: { variationId: variation.id },
                        data: { variationId: existingVariation.id }
                    });
                    // Delete empty variation
                    await prisma.variation.delete({ where: { id: variation.id } });
                    console.log(`  Merged SKUs into existing variation`);
                } else {
                    // Move the entire variation
                    await prisma.variation.update({
                        where: { id: variation.id },
                        data: {
                            productId: targetProduct.id,
                            shopifySourceProductId: source.shopifyProductId,
                            shopifySourceHandle: source.handle
                        }
                    });
                    console.log(`  Moved variation to ${source.gender} product`);
                }

                // Update target product's shopifyProductIds if needed
                if (!targetProduct.shopifyProductIds.includes(source.shopifyProductId)) {
                    await prisma.product.update({
                        where: { id: targetProduct.id },
                        data: {
                            shopifyProductIds: { push: source.shopifyProductId }
                        }
                    });
                }

                fixCount++;
            }

            // Update shopifySourceProductId if missing
            if (!variation.shopifySourceProductId && source) {
                await prisma.variation.update({
                    where: { id: variation.id },
                    data: {
                        shopifySourceProductId: source.shopifyProductId,
                        shopifySourceHandle: source.handle
                    }
                });
            }
        }
    }

    console.log('\n=== Summary ===');
    console.log(`Fixed ${fixCount} misplaced variations`);

    // Delete empty products
    const emptyProducts = await prisma.product.findMany({
        where: {
            variations: { none: {} }
        }
    });

    if (emptyProducts.length > 0) {
        console.log(`\nRemoving ${emptyProducts.length} empty products...`);
        for (const ep of emptyProducts) {
            // Clear shopifyProductId before delete
            await prisma.product.update({
                where: { id: ep.id },
                data: { shopifyProductId: null }
            });
            await prisma.product.delete({ where: { id: ep.id } });
            console.log(`  Deleted empty product: "${ep.name}" (${ep.gender})`);
        }
    }

    // Verification
    console.log('\n=== Verification ===');
    const finalProducts = await prisma.product.findMany({
        where: { name: { contains: 'Pima Crew' } },
        include: { variations: true }
    });

    for (const p of finalProducts) {
        console.log(`\n"${p.name}" (${p.gender}): ${p.variations.length} variations`);
        p.variations.forEach(v => console.log(`  - ${v.colorName}`));
    }
}

main()
    .catch(e => {
        console.error('Error:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
