/**
 * Merge Duplicate Products Script
 * 
 * This script consolidates products with duplicate names by:
 * 1. Finding all products with the same name
 * 2. Keeping the oldest product (first created)
 * 3. Moving all variations from duplicate products to the kept product
 * 4. Collecting all Shopify product IDs into the kept product
 * 5. Deleting the duplicate products
 * 
 * Run with: node scripts/merge_duplicate_products.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('=== Merge Duplicate Products ===\n');

    // Find products with duplicate names
    const duplicates = await prisma.$queryRaw`
        SELECT name, array_agg(id ORDER BY "createdAt") as ids, COUNT(*) as count
        FROM "Product"
        GROUP BY name
        HAVING COUNT(*) > 1
        ORDER BY count DESC
    `;

    console.log(`Found ${duplicates.length} product names with duplicates\n`);

    if (duplicates.length === 0) {
        console.log('No duplicates to merge. Exiting.');
        return;
    }

    let totalMerged = 0;
    let totalVariationsMoved = 0;

    for (const dup of duplicates) {
        const [keepId, ...removeIds] = dup.ids;

        console.log(`\n--- Merging: "${dup.name}" ---`);
        console.log(`  Keeping: ${keepId}`);
        console.log(`  Removing: ${removeIds.length} duplicate(s): ${removeIds.join(', ')}`);

        // Get the product we're keeping
        const keepProduct = await prisma.product.findUnique({
            where: { id: keepId },
            include: { variations: true }
        });

        if (!keepProduct) {
            console.log(`  ERROR: Could not find product ${keepId} to keep`);
            continue;
        }

        // Collect all Shopify IDs
        const allShopifyIds = new Set(keepProduct.shopifyProductIds || []);
        if (keepProduct.shopifyProductId) {
            allShopifyIds.add(keepProduct.shopifyProductId);
        }

        // Collect existing color names in the kept product
        const existingColors = new Set(keepProduct.variations.map(v => v.colorName));

        for (const removeId of removeIds) {
            const toRemove = await prisma.product.findUnique({
                where: { id: removeId },
                include: { variations: true }
            });

            if (!toRemove) {
                console.log(`  WARNING: Could not find duplicate ${removeId}`);
                continue;
            }

            // Collect Shopify ID
            if (toRemove.shopifyProductId) {
                allShopifyIds.add(toRemove.shopifyProductId);
            }
            for (const sid of (toRemove.shopifyProductIds || [])) {
                allShopifyIds.add(sid);
            }

            // Move variations that don't exist in kept product
            for (const variation of toRemove.variations) {
                if (existingColors.has(variation.colorName)) {
                    // Color already exists - merge SKUs instead
                    const targetVariation = keepProduct.variations.find(v => v.colorName === variation.colorName);
                    if (targetVariation) {
                        // Move SKUs from duplicate variation to target
                        const movedSkus = await prisma.sku.updateMany({
                            where: { variationId: variation.id },
                            data: { variationId: targetVariation.id }
                        });
                        console.log(`    Moved ${movedSkus.count} SKUs from "${variation.colorName}" variation`);

                        // Delete the now-empty duplicate variation
                        await prisma.variation.delete({ where: { id: variation.id } });
                    }
                } else {
                    // Move entire variation to kept product
                    await prisma.variation.update({
                        where: { id: variation.id },
                        data: { productId: keepId }
                    });
                    existingColors.add(variation.colorName);
                    totalVariationsMoved++;
                    console.log(`    Moved variation: ${variation.colorName}`);
                }
            }

            // Clear shopifyProductId before delete (if unique constraint would fail)
            await prisma.product.update({
                where: { id: removeId },
                data: { shopifyProductId: null }
            });

            // Delete the duplicate product
            await prisma.product.delete({ where: { id: removeId } });
            totalMerged++;
            console.log(`    Deleted duplicate product ${removeId}`);
        }

        // Update kept product with all Shopify IDs
        await prisma.product.update({
            where: { id: keepId },
            data: {
                shopifyProductIds: Array.from(allShopifyIds)
            }
        });
        console.log(`  Updated shopifyProductIds: ${Array.from(allShopifyIds).join(', ')}`);
    }

    console.log('\n=== Summary ===');
    console.log(`Merged ${totalMerged} duplicate products`);
    console.log(`Moved ${totalVariationsMoved} variations`);

    // Verify
    console.log('\n=== Verification ===');
    const remainingDuplicates = await prisma.$queryRaw`
        SELECT name, COUNT(*) as count
        FROM "Product"
        GROUP BY name
        HAVING COUNT(*) > 1
    `;

    if (remainingDuplicates.length === 0) {
        console.log('✓ No duplicate product names remain');
    } else {
        console.log(`✗ ${remainingDuplicates.length} product names still have duplicates`);
    }
}

main()
    .catch(e => {
        console.error('Error:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
