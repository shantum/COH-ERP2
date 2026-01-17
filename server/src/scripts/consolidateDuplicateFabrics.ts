/**
 * Consolidate Duplicate Fabrics Script
 *
 * This script finds fabrics with the same name under the same material
 * and consolidates them into a single fabric record, moving all colours
 * to the kept fabric.
 *
 * Usage: npx ts-node src/scripts/consolidateDuplicateFabrics.ts [--dry-run]
 *
 * --dry-run: Show what would be done without making changes
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface FabricGroup {
    materialId: string;
    materialName: string;
    fabricName: string;
    fabrics: {
        id: string;
        colourCount: number;
        costPerUnit: number | null;
        leadTimeDays: number | null;
        minOrderQty: number | null;
        supplierId: string | null;
    }[];
}

async function findDuplicateFabrics(): Promise<FabricGroup[]> {
    // Get all fabrics with their materials and colour counts
    const fabrics = await prisma.fabric.findMany({
        include: {
            material: { select: { id: true, name: true } },
            _count: { select: { colours: true } },
        },
        orderBy: [
            { materialId: 'asc' },
            { name: 'asc' },
        ],
    });

    // Group by materialId + name
    const groups = new Map<string, FabricGroup>();

    for (const fabric of fabrics) {
        if (!fabric.materialId) continue;

        const key = `${fabric.materialId}:${fabric.name}`;

        if (!groups.has(key)) {
            groups.set(key, {
                materialId: fabric.materialId,
                materialName: fabric.material?.name || 'Unknown',
                fabricName: fabric.name,
                fabrics: [],
            });
        }

        groups.get(key)!.fabrics.push({
            id: fabric.id,
            colourCount: fabric._count.colours,
            costPerUnit: fabric.costPerUnit,
            leadTimeDays: fabric.leadTimeDays,
            minOrderQty: fabric.minOrderQty,
            supplierId: fabric.supplierId,
        });
    }

    // Filter to only groups with duplicates (more than 1 fabric)
    return Array.from(groups.values()).filter(g => g.fabrics.length > 1);
}

function selectPrimaryFabric(group: FabricGroup): string {
    // Select the fabric with the most data filled in, or the most colours
    const sorted = [...group.fabrics].sort((a, b) => {
        // Prefer fabric with more colours
        if (a.colourCount !== b.colourCount) {
            return b.colourCount - a.colourCount;
        }
        // Then prefer fabric with more fields filled
        const aFields = [a.costPerUnit, a.leadTimeDays, a.minOrderQty, a.supplierId].filter(Boolean).length;
        const bFields = [b.costPerUnit, b.leadTimeDays, b.minOrderQty, b.supplierId].filter(Boolean).length;
        return bFields - aFields;
    });

    return sorted[0].id;
}

async function consolidateFabrics(dryRun: boolean = true) {
    console.log('='.repeat(60));
    console.log('Consolidate Duplicate Fabrics');
    console.log('='.repeat(60));
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
    console.log('');

    const duplicateGroups = await findDuplicateFabrics();

    if (duplicateGroups.length === 0) {
        console.log('No duplicate fabrics found. Database is clean!');
        return;
    }

    console.log(`Found ${duplicateGroups.length} groups of duplicate fabrics:\n`);

    let totalFabricsToDelete = 0;
    let totalColoursToMove = 0;

    for (const group of duplicateGroups) {
        const primaryId = selectPrimaryFabric(group);
        const duplicates = group.fabrics.filter(f => f.id !== primaryId);
        const coloursToMove = duplicates.reduce((sum, f) => sum + f.colourCount, 0);

        totalFabricsToDelete += duplicates.length;
        totalColoursToMove += coloursToMove;

        console.log(`Material: ${group.materialName}`);
        console.log(`  Fabric: "${group.fabricName}" - ${group.fabrics.length} duplicates`);
        console.log(`  Primary: ${primaryId.slice(0, 8)}... (${group.fabrics.find(f => f.id === primaryId)?.colourCount} colours)`);
        console.log(`  Will merge: ${duplicates.length} fabrics with ${coloursToMove} colours total`);

        for (const dup of duplicates) {
            console.log(`    - ${dup.id.slice(0, 8)}... (${dup.colourCount} colours)`);
        }
        console.log('');
    }

    console.log('-'.repeat(60));
    console.log(`Summary:`);
    console.log(`  Fabric groups to consolidate: ${duplicateGroups.length}`);
    console.log(`  Fabric records to delete: ${totalFabricsToDelete}`);
    console.log(`  Colours to reassign: ${totalColoursToMove}`);
    console.log('-'.repeat(60));
    console.log('');

    if (dryRun) {
        console.log('This was a dry run. Run with --live to apply changes.');
        return;
    }

    // Perform the consolidation
    console.log('Starting consolidation...\n');

    for (const group of duplicateGroups) {
        const primaryId = selectPrimaryFabric(group);
        const duplicateIds = group.fabrics.filter(f => f.id !== primaryId).map(f => f.id);

        console.log(`Consolidating "${group.fabricName}" under ${group.materialName}...`);

        await prisma.$transaction(async (tx) => {
            // Move all colours from duplicates to primary fabric
            const coloursResult = await tx.fabricColour.updateMany({
                where: { fabricId: { in: duplicateIds } },
                data: { fabricId: primaryId },
            });
            console.log(`  Moved ${coloursResult.count} colours to primary fabric`);

            // Move all Variation references from duplicates to primary fabric
            const variationsResult = await tx.variation.updateMany({
                where: { fabricId: { in: duplicateIds } },
                data: { fabricId: primaryId },
            });
            if (variationsResult.count > 0) {
                console.log(`  Moved ${variationsResult.count} variation references to primary fabric`);
            }

            // Move all FabricTransaction references from duplicates to primary fabric
            const txnResult = await tx.fabricTransaction.updateMany({
                where: { fabricId: { in: duplicateIds } },
                data: { fabricId: primaryId },
            });
            if (txnResult.count > 0) {
                console.log(`  Moved ${txnResult.count} transaction references to primary fabric`);
            }

            // Move all FabricOrder references from duplicates to primary fabric
            const orderResult = await tx.fabricOrder.updateMany({
                where: { fabricId: { in: duplicateIds } },
                data: { fabricId: primaryId },
            });
            if (orderResult.count > 0) {
                console.log(`  Moved ${orderResult.count} order references to primary fabric`);
            }

            // Move all FabricReconciliationItem references from duplicates to primary fabric
            const reconResult = await tx.fabricReconciliationItem.updateMany({
                where: { fabricId: { in: duplicateIds } },
                data: { fabricId: primaryId },
            });
            if (reconResult.count > 0) {
                console.log(`  Moved ${reconResult.count} reconciliation item references to primary fabric`);
            }

            // Delete the duplicate fabric records
            const deleteResult = await tx.fabric.deleteMany({
                where: { id: { in: duplicateIds } },
            });
            console.log(`  Deleted ${deleteResult.count} duplicate fabric records`);
        });

        console.log(`  Done!\n`);
    }

    console.log('='.repeat(60));
    console.log('Consolidation complete!');
    console.log('='.repeat(60));
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = !args.includes('--live');

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: npx ts-node src/scripts/consolidateDuplicateFabrics.ts [options]

Options:
  --dry-run   Show what would be done without making changes (default)
  --live      Actually perform the consolidation
  --help, -h  Show this help message
        `);
        return;
    }

    try {
        await consolidateFabrics(dryRun);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
