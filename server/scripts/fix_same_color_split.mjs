/**
 * Fix Same-Color Split Script
 * 
 * When a product has the same color for both men and women (e.g., Breton Stripe
 * Pullover - Nautical Blue), the SKUs need to be split between two products.
 * 
 * This script:
 * 1. Builds a map of SKU → gender from Shopify cache
 * 2. For each product with mixed-gender SKUs in the same variation:
 *    - Creates the missing gender product
 *    - Moves SKUs to the correct variation
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
    return 'unisex';
}

async function main() {
    console.log('=== Fix Same-Color Gender Split ===\n');

    // Build a complete SKU → gender map from Shopify cache
    const shopifyCache = await prisma.shopifyProductCache.findMany();
    const skuGenderMap = {};

    for (const cache of shopifyCache) {
        const raw = JSON.parse(cache.rawData);
        const gender = extractGenderFromTags(raw.tags);
        for (const v of raw.variants || []) {
            if (v.sku) {
                skuGenderMap[v.sku] = {
                    gender,
                    shopifyProductId: cache.id,
                    handle: raw.handle,
                    title: raw.title
                };
            }
        }
    }

    console.log(`Built SKU map with ${Object.keys(skuGenderMap).length} entries\n`);

    // Get all products with their variations and SKUs
    const products = await prisma.product.findMany({
        include: {
            variations: {
                include: { skus: true }
            }
        }
    });

    let fixCount = 0;

    for (const product of products) {
        for (const variation of product.variations) {
            // Group SKUs by gender
            const skusByGender = { men: [], women: [], unisex: [] };

            for (const sku of variation.skus) {
                const info = skuGenderMap[sku.skuCode];
                if (info) {
                    skusByGender[info.gender].push({ sku, info });
                }
            }

            // Check if there's a gender mismatch
            const wrongGenderSkus = skusByGender[product.gender === 'men' ? 'women' : 'men'];

            if (wrongGenderSkus.length > 0 && product.gender !== 'unisex') {
                const targetGender = wrongGenderSkus[0].info.gender;
                console.log(`\n--- Mixed SKUs in "${product.name}" (${product.gender}) ---`);
                console.log(`  Variation: ${variation.colorName}`);
                console.log(`  Found ${wrongGenderSkus.length} ${targetGender} SKUs`);

                // Find or create target product
                let targetProduct = await prisma.product.findFirst({
                    where: { name: product.name, gender: targetGender }
                });

                if (!targetProduct) {
                    const firstInfo = wrongGenderSkus[0].info;
                    console.log(`  Creating ${targetGender} product...`);
                    targetProduct = await prisma.product.create({
                        data: {
                            name: product.name,
                            category: product.category,
                            productType: product.productType,
                            gender: targetGender,
                            fabricTypeId: product.fabricTypeId,
                            baseProductionTimeMins: product.baseProductionTimeMins,
                            shopifyProductId: firstInfo.shopifyProductId,
                            shopifyProductIds: [firstInfo.shopifyProductId],
                            shopifyHandle: firstInfo.handle
                        }
                    });
                }

                // Find or create target variation
                let targetVariation = await prisma.variation.findFirst({
                    where: { productId: targetProduct.id, colorName: variation.colorName }
                });

                if (!targetVariation) {
                    const firstInfo = wrongGenderSkus[0].info;
                    console.log(`  Creating ${targetGender} variation...`);
                    targetVariation = await prisma.variation.create({
                        data: {
                            productId: targetProduct.id,
                            colorName: variation.colorName,
                            fabricId: variation.fabricId,
                            imageUrl: variation.imageUrl,
                            shopifySourceProductId: firstInfo.shopifyProductId,
                            shopifySourceHandle: firstInfo.handle
                        }
                    });
                }

                // Move SKUs
                for (const { sku, info } of wrongGenderSkus) {
                    await prisma.sku.update({
                        where: { id: sku.id },
                        data: { variationId: targetVariation.id }
                    });
                    console.log(`  Moved SKU ${sku.skuCode} to ${targetGender}`);
                    fixCount++;
                }

                // Update target product's shopifyProductIds
                const firstInfo = wrongGenderSkus[0].info;
                if (!targetProduct.shopifyProductIds.includes(firstInfo.shopifyProductId)) {
                    await prisma.product.update({
                        where: { id: targetProduct.id },
                        data: { shopifyProductIds: { push: firstInfo.shopifyProductId } }
                    });
                }
            }
        }
    }

    console.log('\n=== Summary ===');
    console.log(`Moved ${fixCount} SKUs to correct gender products`);

    // Verify Breton Stripe
    console.log('\n=== Breton Stripe Verification ===');
    const bretonProducts = await prisma.product.findMany({
        where: { name: { contains: 'Breton' } },
        include: { variations: { include: { skus: true } } }
    });

    for (const p of bretonProducts) {
        console.log(`\n"${p.name}" (${p.gender}):`);
        for (const v of p.variations) {
            console.log(`  - ${v.colorName}: ${v.skus.length} SKUs`);
        }
    }
}

main()
    .catch(e => console.error('Error:', e))
    .finally(() => prisma.$disconnect());
