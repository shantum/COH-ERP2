/**
 * Migrate Fabric Transactions Script
 *
 * This script migrates FabricTransaction records to FabricColourTransaction
 * by matching the Fabric's colorName to a FabricColour under that fabric.
 *
 * For each FabricTransaction:
 * 1. Look up the Fabric by fabricId
 * 2. Find the FabricColour under that fabric where colourName matches Fabric.colorName
 * 3. Create a new FabricColourTransaction with the same data
 * 4. Add "[migrated]" prefix to notes to mark migrated transactions
 *
 * The script is idempotent - it skips transactions that already have a
 * matching FabricColourTransaction (based on referenceId + createdAt).
 *
 * Usage: npx ts-node src/scripts/migrateFabricTransactions.ts [--dry-run]
 *
 * Options:
 *   --dry-run   Preview changes without applying (default)
 *   --live      Actually perform the migration
 *   --help, -h  Show help message
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MigrationResult {
    migrated: number;
    skippedAlreadyMigrated: number;
    skippedNoMatch: number;
    errors: string[];
}

async function migrateFabricTransactions(dryRun: boolean): Promise<MigrationResult> {
    console.log('='.repeat(60));
    console.log('Migrate Fabric Transactions to FabricColour Transactions');
    console.log('='.repeat(60));
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
    console.log('');

    const result: MigrationResult = {
        migrated: 0,
        skippedAlreadyMigrated: 0,
        skippedNoMatch: 0,
        errors: [],
    };

    // Get all FabricTransactions with their Fabric data
    const fabricTransactions = await prisma.fabricTransaction.findMany({
        include: {
            fabric: {
                include: {
                    colours: true,
                    material: { select: { name: true } },
                },
            },
        },
        orderBy: { createdAt: 'asc' },
    });

    console.log(`Found ${fabricTransactions.length} FabricTransaction records`);
    console.log('');

    if (fabricTransactions.length === 0) {
        console.log('No transactions to migrate.');
        return result;
    }

    // Get all existing FabricColourTransactions to check for duplicates
    // We'll use a composite key of fabricColourId + createdAt + notes containing [migrated]
    const existingColourTxns = await prisma.fabricColourTransaction.findMany({
        where: {
            notes: { contains: '[migrated]' },
        },
        select: {
            fabricColourId: true,
            createdAt: true,
            qty: true,
            txnType: true,
        },
    });

    // Create a lookup set for quick duplicate detection
    const existingTxnKeys = new Set(
        existingColourTxns.map((t) =>
            `${t.fabricColourId}:${t.createdAt.toISOString()}:${t.txnType}:${t.qty}`
        )
    );

    console.log(`Existing migrated FabricColourTransactions: ${existingColourTxns.length}`);
    console.log('');

    // Group transactions by migration status
    const toMigrate: typeof fabricTransactions = [];
    const noMatch: typeof fabricTransactions = [];
    const alreadyMigrated: typeof fabricTransactions = [];

    for (const txn of fabricTransactions) {
        // Find matching FabricColour - match by Fabric's colorName
        const matchingColour = txn.fabric.colours.find(
            (c) => c.colourName.toLowerCase() === txn.fabric.colorName.toLowerCase()
        );

        if (!matchingColour) {
            noMatch.push(txn);
            continue;
        }

        // Check if already migrated
        const txnKey = `${matchingColour.id}:${txn.createdAt.toISOString()}:${txn.txnType}:${txn.qty}`;
        if (existingTxnKeys.has(txnKey)) {
            alreadyMigrated.push(txn);
            continue;
        }

        toMigrate.push(txn);
    }

    console.log(`To migrate: ${toMigrate.length}`);
    console.log(`Already migrated: ${alreadyMigrated.length}`);
    console.log(`No matching FabricColour: ${noMatch.length}`);
    console.log('');

    result.skippedAlreadyMigrated = alreadyMigrated.length;
    result.skippedNoMatch = noMatch.length;

    // Process transactions to migrate
    if (toMigrate.length > 0) {
        console.log('-'.repeat(60));
        console.log('Transactions to migrate:');
        console.log('-'.repeat(60));

        if (dryRun) {
            for (const txn of toMigrate) {
                const matchingColour = txn.fabric.colours.find(
                    (c) => c.colourName.toLowerCase() === txn.fabric.colorName.toLowerCase()
                );

                console.log(`  [DRY-RUN] ${txn.txnType} ${txn.qty} ${txn.unit}`);
                console.log(`    Fabric: ${txn.fabric.name} - ${txn.fabric.colorName}`);
                console.log(`    FabricColour: ${matchingColour?.colourName} (${matchingColour?.id.slice(0, 8)}...)`);
                console.log(`    Reason: ${txn.reason}`);
                console.log(`    Date: ${txn.createdAt.toISOString()}`);
                result.migrated++;
            }
        } else {
            // Use transaction for safety
            await prisma.$transaction(async (tx) => {
                for (const txn of toMigrate) {
                    const matchingColour = txn.fabric.colours.find(
                        (c) => c.colourName.toLowerCase() === txn.fabric.colorName.toLowerCase()
                    );

                    if (!matchingColour) continue;

                    try {
                        // Create the new FabricColourTransaction
                        const migratedNotes = txn.notes
                            ? `[migrated] ${txn.notes}`
                            : '[migrated]';

                        await tx.fabricColourTransaction.create({
                            data: {
                                fabricColourId: matchingColour.id,
                                txnType: txn.txnType,
                                qty: txn.qty,
                                unit: txn.unit,
                                reason: txn.reason,
                                costPerUnit: txn.costPerUnit,
                                supplierId: txn.supplierId,
                                referenceId: txn.referenceId,
                                notes: migratedNotes,
                                createdById: txn.createdById,
                                createdAt: txn.createdAt, // Preserve original timestamp
                            },
                        });

                        console.log(`  Migrated: ${txn.txnType} ${txn.qty} ${txn.unit} - ${txn.fabric.name} ${txn.fabric.colorName}`);
                        result.migrated++;
                    } catch (error: unknown) {
                        const message = error instanceof Error ? error.message : 'Unknown error';
                        result.errors.push(`Transaction ${txn.id}: ${message}`);
                        console.error(`  Error: ${txn.id}: ${message}`);
                    }
                }
            });
        }
    }

    // Log unmatched transactions
    if (noMatch.length > 0) {
        console.log('');
        console.log('-'.repeat(60));
        console.log('Transactions without matching FabricColour:');
        console.log('-'.repeat(60));

        // Group by fabric for cleaner output
        const byFabric = new Map<string, typeof noMatch>();
        for (const txn of noMatch) {
            const key = `${txn.fabric.name} - ${txn.fabric.colorName}`;
            if (!byFabric.has(key)) {
                byFabric.set(key, []);
            }
            byFabric.get(key)!.push(txn);
        }

        for (const [fabricKey, txns] of byFabric) {
            console.log(`  ${fabricKey}: ${txns.length} transactions`);
            console.log(`    Available colours: ${txns[0].fabric.colours.map((c) => c.colourName).join(', ') || '(none)'}`);
        }

        console.log('');
        console.log('Note: These transactions need FabricColour records created first.');
    }

    // Summary
    console.log('');
    console.log('='.repeat(60));
    console.log('Summary:');
    console.log('='.repeat(60));
    console.log(`  Migrated: ${result.migrated}`);
    console.log(`  Skipped (already migrated): ${result.skippedAlreadyMigrated}`);
    console.log(`  Skipped (no matching colour): ${result.skippedNoMatch}`);
    console.log(`  Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
        console.log('');
        console.log('Errors:');
        for (const error of result.errors) {
            console.log(`  - ${error}`);
        }
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
Usage: npx ts-node src/scripts/migrateFabricTransactions.ts [options]

Options:
  --dry-run   Preview changes without applying (default)
  --live      Actually perform the migration
  --help, -h  Show this help message

This script migrates FabricTransaction records to FabricColourTransaction
by matching the Fabric's colorName to a FabricColour under that fabric.

The script is idempotent - it skips transactions that have already been
migrated (identified by "[migrated]" prefix in notes).
        `);
        return;
    }

    try {
        await migrateFabricTransactions(dryRun);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Migration failed:', message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
