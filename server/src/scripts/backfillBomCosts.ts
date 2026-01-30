/**
 * Backfill BOM Costs Script
 *
 * One-time script to compute and store BOM costs for all existing
 * SKUs and Variations. Run this after adding the bomCost fields.
 *
 * Usage:
 *   npx ts-node server/src/scripts/backfillBomCosts.ts
 *
 * Or from the server directory:
 *   npx ts-node src/scripts/backfillBomCosts.ts
 */

import { getPrisma } from '@coh/shared/services/db';
import {
    recalculateSkuBomCost,
    recalculateVariationBomCost,
} from '@coh/shared/services/bom';

async function backfillBomCosts() {
    console.log('Starting BOM cost backfill...\n');

    const prisma = await getPrisma();

    // Get all active variations
    const variations = await prisma.variation.findMany({
        where: { isActive: true },
        select: {
            id: true,
            colorName: true,
            product: { select: { name: true } },
            skus: {
                where: { isActive: true },
                select: { id: true, size: true },
            },
        },
    });

    console.log(`Found ${variations.length} active variations to process.\n`);

    let variationsProcessed = 0;
    let skusProcessed = 0;
    let errors = 0;

    for (const variation of variations) {
        try {
            // Recalculate each SKU in this variation
            for (const sku of variation.skus) {
                try {
                    await recalculateSkuBomCost(prisma, sku.id);
                    skusProcessed++;
                } catch (err) {
                    errors++;
                    console.error(`  Error processing SKU ${sku.id} (${sku.size}):`, err);
                }
            }

            // Recalculate variation average
            await recalculateVariationBomCost(prisma, variation.id);
            variationsProcessed++;

            // Progress update every 100 variations
            if (variationsProcessed % 100 === 0) {
                console.log(`  Processed ${variationsProcessed}/${variations.length} variations, ${skusProcessed} SKUs...`);
            }
        } catch (err) {
            errors++;
            console.error(`Error processing variation ${variation.id} (${variation.product.name} - ${variation.colorName}):`, err);
        }
    }

    console.log('\n=== Backfill Complete ===');
    console.log(`Variations processed: ${variationsProcessed}`);
    console.log(`SKUs processed: ${skusProcessed}`);
    console.log(`Errors: ${errors}`);

    // Disconnect prisma
    await prisma.$disconnect();
}

// Run the backfill
backfillBomCosts()
    .then(() => {
        console.log('\nBackfill finished successfully.');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\nBackfill failed:', err);
        process.exit(1);
    });
