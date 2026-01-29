/**
 * Migration Script: Link Variations to FabricColours
 *
 * This script migrates variations from the legacy `fabricId` system to the new
 * `fabricColourId` system by matching variation color names to fabric colours.
 *
 * Run with: npx tsx src/scripts/migrateFabricColourIds.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateFabricColourIds() {
    console.log('Starting fabric colour ID migration...\n');

    // Find all variations without fabricColourId
    const variationsWithoutColour = await prisma.variation.findMany({
        where: {
            fabricColourId: null,
        },
        include: {
            product: {
                select: { name: true },
            },
            fabric: {
                include: {
                    colours: {
                        where: { isActive: true },
                        select: {
                            id: true,
                            colourName: true,
                        },
                    },
                },
            },
        },
    });

    console.log(`Found ${variationsWithoutColour.length} variations without fabricColourId\n`);

    let matched = 0;
    let unmatched = 0;
    const unmatchedList: Array<{ product: string; variation: string; fabric: string; availableColours: string[] }> = [];

    for (const variation of variationsWithoutColour) {
        const fabricColours = variation.fabric.colours;

        // Try to find a matching colour by name (case-insensitive)
        const matchingColour = fabricColours.find(
            (fc) => fc.colourName.toLowerCase().trim() === variation.colorName.toLowerCase().trim()
        );

        if (matchingColour) {
            // Update the variation with the fabricColourId
            await prisma.variation.update({
                where: { id: variation.id },
                data: { fabricColourId: matchingColour.id },
            });
            matched++;
            console.log(`✓ Matched: ${variation.product.name} / ${variation.colorName} → ${matchingColour.colourName}`);
        } else {
            unmatched++;
            unmatchedList.push({
                product: variation.product.name,
                variation: variation.colorName,
                fabric: variation.fabric.name,
                availableColours: fabricColours.map((c) => c.colourName),
            });
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Migration complete!`);
    console.log(`  Matched: ${matched}`);
    console.log(`  Unmatched: ${unmatched}`);

    if (unmatchedList.length > 0) {
        console.log('\nUnmatched variations (need manual review):');
        console.log('-'.repeat(60));
        for (const item of unmatchedList) {
            console.log(`  Product: ${item.product}`);
            console.log(`  Variation Color: "${item.variation}"`);
            console.log(`  Fabric: ${item.fabric}`);
            console.log(`  Available Colours: ${item.availableColours.length > 0 ? item.availableColours.join(', ') : '(none)'}`);
            console.log('');
        }
    }
}

migrateFabricColourIds()
    .catch((error) => {
        console.error('Migration failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
