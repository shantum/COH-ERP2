/**
 * Migration script to clean up product categories
 *
 * Removes gender prefixes from category values since gender is stored separately.
 * E.g., "Men Women Co-Ord Set" -> "co-ord set"
 *
 * Run with: npx tsx scripts/fix-category-data.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Pattern to match gender prefixes (handles multiple genders like "Men Women")
const GENDER_PREFIX_PATTERN = /^(men\s+|women\s+|mens\s+|womens\s+|men's\s+|women's\s+|unisex\s+)+/i;

async function main() {
    console.log('Starting category cleanup migration...\n');

    // Get all products with their current categories
    const products = await prisma.product.findMany({
        select: {
            id: true,
            name: true,
            category: true,
            gender: true,
        },
    });

    console.log(`Found ${products.length} products to check\n`);

    let updatedCount = 0;
    const updates: { id: string; oldCategory: string; newCategory: string }[] = [];

    for (const product of products) {
        const oldCategory = product.category;

        // Skip if already clean or uncategorized
        if (!oldCategory || oldCategory === 'uncategorized') {
            continue;
        }

        // Strip gender prefix(es) and normalize
        const newCategory = oldCategory
            .toLowerCase()
            .replace(GENDER_PREFIX_PATTERN, '')
            .trim();

        // Only update if category changed
        if (newCategory !== oldCategory.toLowerCase()) {
            updates.push({
                id: product.id,
                oldCategory,
                newCategory: newCategory || 'uncategorized',
            });
        }
    }

    console.log(`Found ${updates.length} products with gender prefixes in category\n`);

    if (updates.length === 0) {
        console.log('No updates needed. All categories are clean.');
        return;
    }

    // Show preview
    console.log('Preview of changes:');
    console.log('─'.repeat(80));
    for (const update of updates.slice(0, 20)) {
        console.log(`  "${update.oldCategory}" → "${update.newCategory}"`);
    }
    if (updates.length > 20) {
        console.log(`  ... and ${updates.length - 20} more`);
    }
    console.log('─'.repeat(80));

    // Perform updates
    console.log('\nApplying updates...');

    for (const update of updates) {
        await prisma.product.update({
            where: { id: update.id },
            data: { category: update.newCategory },
        });
        updatedCount++;
    }

    console.log(`\n✓ Updated ${updatedCount} products`);

    // Show unique categories after cleanup
    const uniqueCategories = await prisma.product.groupBy({
        by: ['category'],
        _count: { category: true },
        orderBy: { _count: { category: 'desc' } },
    });

    console.log('\nCategories after cleanup:');
    for (const cat of uniqueCategories) {
        console.log(`  ${cat.category}: ${cat._count.category} products`);
    }
}

main()
    .catch((e) => {
        console.error('Error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
