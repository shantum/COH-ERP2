/**
 * Backfill Shopify Product IDs
 *
 * One-time script to link existing products in the database to their Shopify counterparts.
 * Matches by product name (title).
 *
 * Usage:
 *   cd server
 *   node scripts/backfill-product-ids.js
 *
 * Options:
 *   --dry-run    Show what would be updated without making changes
 */

import { PrismaClient } from '@prisma/client';
import shopifyClient from '../src/services/shopify.js';

const prisma = new PrismaClient();
const isDryRun = process.argv.includes('--dry-run');

async function backfillProductIds() {
    console.log('='.repeat(60));
    console.log('Backfill Shopify Product IDs');
    console.log(isDryRun ? '(DRY RUN - no changes will be made)' : '');
    console.log('='.repeat(60));

    try {
        // Load Shopify config
        await shopifyClient.loadFromDatabase();

        if (!shopifyClient.isConfigured()) {
            console.error('Error: Shopify is not configured. Please configure in Settings.');
            process.exit(1);
        }

        // Fetch all products from Shopify
        console.log('\nFetching products from Shopify...');
        const shopifyProducts = await shopifyClient.getAllProducts();
        console.log(`Found ${shopifyProducts.length} products in Shopify`);

        // Get products without Shopify IDs
        const unlinkedProducts = await prisma.product.findMany({
            where: { shopifyProductId: null },
        });
        console.log(`Found ${unlinkedProducts.length} unlinked products in database`);

        // Build a map of Shopify products by title (lowercase for case-insensitive matching)
        const shopifyByTitle = new Map();
        for (const sp of shopifyProducts) {
            const key = sp.title.toLowerCase().trim();
            if (!shopifyByTitle.has(key)) {
                shopifyByTitle.set(key, sp);
            }
        }

        // Match and update
        let matched = 0;
        let notFound = 0;
        const updates = [];

        for (const product of unlinkedProducts) {
            const key = product.name.toLowerCase().trim();
            const shopifyProduct = shopifyByTitle.get(key);

            if (shopifyProduct) {
                updates.push({
                    product,
                    shopifyProductId: String(shopifyProduct.id),
                    shopifyHandle: shopifyProduct.handle,
                });
                matched++;
            } else {
                notFound++;
                console.log(`  ✗ No match: "${product.name}"`);
            }
        }

        console.log(`\nMatched: ${matched}, Not found: ${notFound}`);

        if (updates.length > 0) {
            console.log('\nUpdating products...');
            for (const { product, shopifyProductId, shopifyHandle } of updates) {
                if (isDryRun) {
                    console.log(`  [DRY RUN] Would link: "${product.name}" -> ${shopifyProductId}`);
                } else {
                    await prisma.product.update({
                        where: { id: product.id },
                        data: { shopifyProductId, shopifyHandle },
                    });
                    console.log(`  ✓ Linked: "${product.name}" -> ${shopifyProductId}`);
                }
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('Summary:');
        console.log(`  - Total Shopify products: ${shopifyProducts.length}`);
        console.log(`  - Unlinked DB products: ${unlinkedProducts.length}`);
        console.log(`  - Successfully matched: ${matched}`);
        console.log(`  - Not found in Shopify: ${notFound}`);
        if (isDryRun) {
            console.log('\n  Run without --dry-run to apply changes.');
        }
        console.log('='.repeat(60));

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

backfillProductIds();
