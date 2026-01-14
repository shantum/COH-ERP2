/**
 * Split Incorrectly Merged Products Script
 * 
 * This script separates products that were incorrectly merged when they should
 * be separate men's and women's versions. For each product with mixed gender
 * Shopify IDs, it:
 * 1. Identifies variations that came from different gender Shopify products
 * 2. Creates separate products for each gender
 * 3. Moves variations to the correct product
 * 
 * Run with: node scripts/split_mixed_gender_products.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('=== Split Incorrectly Merged Men/Women Products ===\n');

    // Find products with multiple Shopify IDs
    const products = await prisma.product.findMany({
        where: { NOT: { shopifyProductIds: { equals: [] } } },
        include: { variations: true }
    });

    let splitCount = 0;

    for (const product of products) {
        if (product.shopifyProductIds.length < 2) continue;

        // Check if the linked Shopify products have mixed genders
        const genderMap = {}; // shopifyId -> gender

        for (const sid of product.shopifyProductIds) {
            const cache = await prisma.shopifyProductCache.findUnique({ where: { id: sid } });
            if (cache) {
                const raw = JSON.parse(cache.rawData);
                const gender = (raw.tags || '').includes('_related_women') ? 'women' :
                    (raw.tags || '').includes('_related_men') ? 'men' : 'unisex';
                genderMap[sid] = gender;
            }
        }

        // Get unique genders
        const genders = [...new Set(Object.values(genderMap))];

        // If all same gender, no split needed
        if (genders.length <= 1) {
            console.log(`✓ "${product.name}" - all ${genders[0] || 'unisex'}, no split needed`);
            continue;
        }

        // Need to split this product
        console.log(`\n--- Splitting: "${product.name}" ---`);
        console.log(`  Current gender: ${product.gender}`);
        console.log(`  Mixed genders: ${genders.join(', ')}`);

        // Group Shopify IDs by gender
        const idsByGender = {};
        for (const [sid, gender] of Object.entries(genderMap)) {
            if (!idsByGender[gender]) idsByGender[gender] = [];
            idsByGender[gender].push(sid);
        }

        // Keep the original product for its current gender (or first gender if unisex)
        const keepGender = genders.includes(product.gender) ? product.gender : genders[0];
        const gendersToSplit = genders.filter(g => g !== keepGender);

        console.log(`  Keeping "${product.name}" for: ${keepGender}`);

        // Update the kept product with only its gender's Shopify IDs
        await prisma.product.update({
            where: { id: product.id },
            data: {
                gender: keepGender,
                shopifyProductIds: idsByGender[keepGender],
                shopifyProductId: idsByGender[keepGender][0]
            }
        });

        // Create new products for other genders
        for (const gender of gendersToSplit) {
            console.log(`  Creating new product for: ${gender}`);

            // Get the handle from the first Shopify product of this gender
            const firstSid = idsByGender[gender][0];
            const cache = await prisma.shopifyProductCache.findUnique({ where: { id: firstSid } });
            const raw = cache ? JSON.parse(cache.rawData) : {};

            // Create the new product
            const newProduct = await prisma.product.create({
                data: {
                    name: product.name,
                    styleCode: null,
                    category: product.category,
                    productType: product.productType,
                    gender: gender,
                    fabricTypeId: product.fabricTypeId,
                    baseProductionTimeMins: product.baseProductionTimeMins,
                    defaultFabricConsumption: product.defaultFabricConsumption,
                    trimsCost: product.trimsCost,
                    liningCost: product.liningCost,
                    packagingCost: product.packagingCost,
                    imageUrl: raw.image?.src || null,
                    shopifyProductId: firstSid,
                    shopifyProductIds: idsByGender[gender],
                    shopifyHandle: raw.handle
                }
            });

            console.log(`    Created: ${newProduct.id}`);

            // Move variations that came from this gender's Shopify products
            for (const variation of product.variations) {
                const varGender = genderMap[variation.shopifySourceProductId];
                if (varGender === gender) {
                    await prisma.variation.update({
                        where: { id: variation.id },
                        data: { productId: newProduct.id }
                    });
                    console.log(`    Moved variation: ${variation.colorName}`);
                }
            }

            splitCount++;
        }
    }

    console.log('\n=== Summary ===');
    console.log(`Split ${splitCount} products into separate men/women versions`);

    // Verify
    console.log('\n=== Verification ===');
    const mixedProducts = [];
    const updatedProducts = await prisma.product.findMany({
        where: { NOT: { shopifyProductIds: { equals: [] } } }
    });

    for (const p of updatedProducts) {
        if (p.shopifyProductIds.length < 2) continue;

        const genders = new Set();
        for (const sid of p.shopifyProductIds) {
            const cache = await prisma.shopifyProductCache.findUnique({ where: { id: sid } });
            if (cache) {
                const raw = JSON.parse(cache.rawData);
                const g = (raw.tags || '').includes('_related_women') ? 'women' :
                    (raw.tags || '').includes('_related_men') ? 'men' : 'unisex';
                genders.add(g);
            }
        }
        if (genders.size > 1) {
            mixedProducts.push(p.name);
        }
    }

    if (mixedProducts.length === 0) {
        console.log('✓ No products with mixed gender Shopify IDs remain');
    } else {
        console.log(`✗ ${mixedProducts.length} products still have mixed genders: ${mixedProducts.join(', ')}`);
    }
}

main()
    .catch(e => {
        console.error('Error:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
