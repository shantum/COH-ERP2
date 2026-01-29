/**
 * Phase 1: Backfill BOM Lines from Variation.fabricColourId
 *
 * Creates VariationBomLine entries for variations that have fabricColourId set
 * but don't have a corresponding BOM line with that fabric colour.
 *
 * Run with: DATABASE_URL="..." npx tsx src/scripts/backfillBomFromFabricColourId.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillBomLines() {
    console.log('Phase 1: Backfill BOM Lines from fabricColourId\n');
    console.log('='.repeat(60));

    // Get or create the "main" fabric role
    let mainFabricRole = await prisma.componentRole.findFirst({
        where: {
            code: 'main',
            type: { code: 'FABRIC' },
        },
    });

    if (!mainFabricRole) {
        console.log('ERROR: Main fabric role not found. Please ensure ComponentRole is set up.');
        return;
    }

    console.log(`Using role: ${mainFabricRole.name} (${mainFabricRole.id})\n`);

    // Find variations with fabricColourId but no BOM line for that colour
    const variationsWithColourNoBoM = await prisma.variation.findMany({
        where: {
            fabricColourId: { not: null },
            bomLines: {
                none: {
                    fabricColourId: { not: null },
                },
            },
        },
        include: {
            product: { select: { name: true } },
            fabricColour: { select: { colourName: true, fabric: { select: { name: true } } } },
        },
    });

    console.log(`Found ${variationsWithColourNoBoM.length} variations with fabricColourId but no BOM line\n`);

    if (variationsWithColourNoBoM.length === 0) {
        console.log('Nothing to backfill!');
        return;
    }

    // Create BOM lines
    let created = 0;
    let errors = 0;

    for (const variation of variationsWithColourNoBoM) {
        try {
            await prisma.variationBomLine.create({
                data: {
                    variationId: variation.id,
                    roleId: mainFabricRole.id,
                    fabricColourId: variation.fabricColourId!,
                },
            });
            created++;
            console.log(`✓ ${variation.product.name} / ${variation.colorName} → ${variation.fabricColour?.fabric.name} / ${variation.fabricColour?.colourName}`);
        } catch (error: any) {
            // Might already exist with different role, skip
            if (error.code === 'P2002') {
                console.log(`⊘ Skipped (already has BOM line): ${variation.product.name} / ${variation.colorName}`);
            } else {
                errors++;
                console.log(`✗ Error: ${variation.product.name} / ${variation.colorName} - ${error.message}`);
            }
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Backfill complete!');
    console.log(`  Created: ${created}`);
    console.log(`  Errors: ${errors}`);

    // Also report current state
    const totalWithBom = await prisma.variation.count({
        where: { bomLines: { some: { fabricColourId: { not: null } } } },
    });
    const totalVariations = await prisma.variation.count();

    console.log(`\nCurrent coverage: ${totalWithBom}/${totalVariations} variations have BOM fabric links`);
}

backfillBomLines()
    .catch((error) => {
        console.error('Backfill failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
