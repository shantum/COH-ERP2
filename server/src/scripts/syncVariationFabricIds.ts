/**
 * Sync Variation Fabric IDs Script
 *
 * Ensures consistency between Variation.fabricId and Variation.fabricColourId:
 * - If fabricColourId is set, fabricId should match the FabricColour's parent Fabric
 * - This keeps the OLD system (fabricId) in sync with the NEW system (fabricColourId)
 *
 * Usage:
 *   npx tsx src/scripts/syncVariationFabricIds.ts --dry-run  # Preview changes
 *   npx tsx src/scripts/syncVariationFabricIds.ts --live     # Apply changes
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SyncResult {
    total: number;
    alreadySynced: number;
    updated: number;
    errors: string[];
}

async function syncVariationFabricIds(dryRun: boolean): Promise<SyncResult> {
    console.log('='.repeat(60));
    console.log('Sync Variation Fabric IDs');
    console.log('='.repeat(60));
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
    console.log('');

    const result: SyncResult = {
        total: 0,
        alreadySynced: 0,
        updated: 0,
        errors: [],
    };

    // Find all variations where fabricColourId is set
    const variations = await prisma.variation.findMany({
        where: {
            fabricColourId: { not: null },
        },
        include: {
            fabricColour: {
                include: {
                    fabric: true,
                },
            },
            fabric: true,
            product: { select: { name: true } },
        },
    });

    result.total = variations.length;
    console.log(`Found ${variations.length} variations with fabricColourId set`);
    console.log('');

    if (variations.length === 0) {
        console.log('No variations need syncing.');
        return result;
    }

    // Check each variation
    const needsUpdate: typeof variations = [];
    const alreadySynced: typeof variations = [];

    for (const variation of variations) {
        if (!variation.fabricColour) {
            result.errors.push(`${variation.product.name} - ${variation.colorName}: fabricColourId set but FabricColour not found`);
            continue;
        }

        const expectedFabricId = variation.fabricColour.fabricId;
        const currentFabricId = variation.fabricId;

        if (currentFabricId === expectedFabricId) {
            alreadySynced.push(variation);
        } else {
            needsUpdate.push(variation);
        }
    }

    result.alreadySynced = alreadySynced.length;
    console.log(`Already synced: ${alreadySynced.length}`);
    console.log(`Needs update: ${needsUpdate.length}`);
    console.log('');

    // Update variations that need syncing
    if (needsUpdate.length > 0) {
        console.log('-'.repeat(60));
        console.log('Variations to update:');
        console.log('-'.repeat(60));

        for (const variation of needsUpdate) {
            const oldFabric = variation.fabric?.name ?? 'Unknown';
            const newFabric = variation.fabricColour!.fabric.name;
            const colour = variation.fabricColour!.colourName;

            if (dryRun) {
                console.log(`  [DRY-RUN] ${variation.product.name} - ${variation.colorName}`);
                console.log(`    Fabric: ${oldFabric} → ${newFabric}`);
                console.log(`    Colour: ${colour}`);
                result.updated++;
            } else {
                try {
                    await prisma.variation.update({
                        where: { id: variation.id },
                        data: { fabricId: variation.fabricColour!.fabricId },
                    });
                    console.log(`  Updated: ${variation.product.name} - ${variation.colorName}: ${oldFabric} → ${newFabric}`);
                    result.updated++;
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : 'Unknown error';
                    result.errors.push(`${variation.product.name} - ${variation.colorName}: ${message}`);
                    console.error(`  Error: ${variation.product.name} - ${variation.colorName}: ${message}`);
                }
            }
        }
    }

    // Summary
    console.log('');
    console.log('='.repeat(60));
    console.log('Summary:');
    console.log('='.repeat(60));
    console.log(`  Total with fabricColourId: ${result.total}`);
    console.log(`  Already synced: ${result.alreadySynced}`);
    console.log(`  Updated: ${result.updated}`);
    console.log(`  Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
        console.log('');
        console.log('Errors:');
        result.errors.forEach(e => console.log(`  - ${e}`));
    }

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
Usage: npx tsx src/scripts/syncVariationFabricIds.ts [options]

Options:
  --dry-run   Preview changes without applying (default)
  --live      Actually perform the sync
  --help, -h  Show this help message

This script ensures Variation.fabricId matches the parent Fabric of Variation.fabricColourId.
Run this after:
  - Manual fabric mapping via UI
  - Migration from old system
  - Any data import that sets fabricColourId
        `);
        return;
    }

    try {
        await syncVariationFabricIds(dryRun);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Sync failed:', message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
