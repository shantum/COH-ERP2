/**
 * Migrate Variation FabricColour Script
 *
 * This script links Variations to FabricColour records by matching:
 * - The Fabric's materialId
 * - The Variation's colorName to FabricColour's colourName
 *
 * Purpose: Populate the Variation.fabricColourId field for variations
 * that have a fabricId but no fabricColourId.
 *
 * Usage: npx ts-node src/scripts/migrateVariationFabricColour.ts [--dry-run]
 *
 * Options:
 *   --dry-run   Preview changes without applying (default)
 *   --live      Actually perform the migration
 *   --help, -h  Show help message
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MigrationResult {
    updated: number;
    noMatch: number;
    alreadySet: number;
    errors: string[];
}

async function migrateVariationFabricColour(dryRun: boolean): Promise<MigrationResult> {
    console.log('='.repeat(60));
    console.log('Migrate Variation FabricColour');
    console.log('='.repeat(60));
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
    console.log('');

    const result: MigrationResult = {
        updated: 0,
        noMatch: 0,
        alreadySet: 0,
        errors: [],
    };

    // Find all variations that have a fabricId but no fabricColourId
    const variations = await prisma.variation.findMany({
        where: {
            fabricId: { not: '' },
            fabricColourId: null,
        },
        include: {
            fabric: {
                include: {
                    colours: true,
                    material: { select: { id: true, name: true } },
                },
            },
            product: { select: { name: true } },
        },
        orderBy: [
            { product: { name: 'asc' } },
            { colorName: 'asc' },
        ],
    });

    // Also count variations that already have fabricColourId set
    const alreadySetCount = await prisma.variation.count({
        where: {
            fabricColourId: { not: null },
        },
    });
    result.alreadySet = alreadySetCount;

    console.log(`Found ${variations.length} variations needing migration`);
    console.log(`Already set: ${alreadySetCount} variations`);
    console.log('');

    if (variations.length === 0) {
        console.log('No variations need migration. Database is up to date!');
        return result;
    }

    // Group by match status for better logging
    const matched: typeof variations = [];
    const unmatched: typeof variations = [];

    for (const variation of variations) {
        // Find matching FabricColour by colourName (case-insensitive)
        const matchingColour = variation.fabric.colours.find(
            (c) => c.colourName.toLowerCase() === variation.colorName.toLowerCase()
        );

        if (matchingColour) {
            matched.push(variation);
        } else {
            unmatched.push(variation);
        }
    }

    console.log(`Matched: ${matched.length} variations`);
    console.log(`No match found: ${unmatched.length} variations`);
    console.log('');

    // Process matched variations
    if (matched.length > 0) {
        console.log('-'.repeat(60));
        console.log('Variations to update:');
        console.log('-'.repeat(60));

        if (dryRun) {
            // In dry-run, process one by one for logging
            for (const variation of matched) {
                const matchingColour = variation.fabric.colours.find(
                    (c) => c.colourName.toLowerCase() === variation.colorName.toLowerCase()
                );

                if (matchingColour) {
                    console.log(`  [DRY-RUN] ${variation.product.name} - ${variation.colorName}`);
                    console.log(`    Fabric: ${variation.fabric.name} (${variation.fabric.material?.name ?? 'No Material'})`);
                    console.log(`    FabricColour: ${matchingColour.colourName} (${matchingColour.id.slice(0, 8)}...)`);
                    result.updated++;
                }
            }
        } else {
            // In live mode, process individually (handles slow remote connections)
            for (const variation of matched) {
                const matchingColour = variation.fabric.colours.find(
                    (c) => c.colourName.toLowerCase() === variation.colorName.toLowerCase()
                );

                if (matchingColour) {
                    try {
                        await prisma.variation.update({
                            where: { id: variation.id },
                            data: { fabricColourId: matchingColour.id },
                        });
                        console.log(`  Updated: ${variation.product.name} - ${variation.colorName} → ${matchingColour.id.slice(0, 8)}...`);
                        result.updated++;
                    } catch (error: unknown) {
                        const message = error instanceof Error ? error.message : 'Unknown error';
                        result.errors.push(`${variation.product.name} - ${variation.colorName}: ${message}`);
                        console.error(`  Error: ${variation.product.name} - ${variation.colorName}: ${message}`);
                    }
                }
            }
        }
    }

    // Log unmatched variations
    if (unmatched.length > 0) {
        console.log('');
        console.log('-'.repeat(60));
        console.log('Variations without matching FabricColour:');
        console.log('-'.repeat(60));

        for (const variation of unmatched) {
            console.log(`  ${variation.product.name} - ${variation.colorName}`);
            console.log(`    Fabric: ${variation.fabric.name} (${variation.fabric.material?.name ?? 'No Material'})`);
            console.log(`    Available colours: ${variation.fabric.colours.map((c) => c.colourName).join(', ') || '(none)'}`);
            result.noMatch++;
        }

        console.log('');
        console.log('Note: These variations need manual FabricColour creation or colorName correction.');
    }

    // Summary
    console.log('');
    console.log('='.repeat(60));
    console.log('Summary:');
    console.log('='.repeat(60));
    console.log(`  Already set: ${result.alreadySet}`);
    console.log(`  Updated: ${result.updated}`);
    console.log(`  No match: ${result.noMatch}`);
    console.log(`  Errors: ${result.errors.length}`);

    if (dryRun) {
        console.log('');
        console.log('This was a dry run. Run with --live to apply changes.');
    }

    return result;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const dryRun = !args.includes('--live');

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: npx ts-node src/scripts/migrateVariationFabricColour.ts [options]

Options:
  --dry-run   Preview changes without applying (default)
  --live      Actually perform the migration
  --help, -h  Show this help message

This script finds all Variations that have a fabricId but no fabricColourId,
and attempts to match them to the correct FabricColour by color name.
        `);
        return;
    }

    try {
        await migrateVariationFabricColour(dryRun);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Migration failed:', message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
