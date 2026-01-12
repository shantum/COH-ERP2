/**
 * Reversal script: Fix inventory for shipped orders that were never allocated
 *
 * Problem: Orders shipped without going through allocation still had OUTWARD/SALE
 * transactions created, incorrectly deducting inventory.
 *
 * Solution: Find shipped lines where allocatedAt IS NULL and delete their
 * OUTWARD/SALE transactions to restore inventory balance.
 *
 * Usage:
 *   node src/scripts/reverseUnallocatedShipments.js          # Dry run (default)
 *   node src/scripts/reverseUnallocatedShipments.js --live   # Actually delete
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function reverseUnallocatedShipments(dryRun = true) {
    console.log('='.repeat(60));
    console.log(`Reverse Unallocated Shipments - ${dryRun ? 'DRY RUN' : 'LIVE MODE'}`);
    console.log('='.repeat(60));
    console.log();

    // Find shipped lines that were never allocated
    const affectedLines = await prisma.orderLine.findMany({
        where: {
            lineStatus: 'shipped',
            allocatedAt: null,
        },
        include: {
            order: { select: { orderNumber: true } },
            sku: { select: { skuCode: true } },
        },
    });

    console.log(`Found ${affectedLines.length} shipped lines without allocation\n`);

    if (affectedLines.length === 0) {
        console.log('No affected lines found. Nothing to do.');
        return;
    }

    let totalReversed = 0;
    let linesWithTransactions = 0;

    for (const line of affectedLines) {
        // Find OUTWARD/SALE transactions for this line
        const transactions = await prisma.inventoryTransaction.findMany({
            where: {
                referenceId: line.id,
                txnType: 'outward',
                reason: 'sale',
            },
        });

        if (transactions.length > 0) {
            linesWithTransactions++;
            const totalQty = transactions.reduce((sum, t) => sum + t.qty, 0);

            console.log(`Order #${line.order.orderNumber} | SKU: ${line.sku?.skuCode || 'N/A'} | ${transactions.length} txn(s) | qty: ${totalQty}`);

            if (!dryRun) {
                await prisma.inventoryTransaction.deleteMany({
                    where: {
                        referenceId: line.id,
                        txnType: 'outward',
                        reason: 'sale',
                    },
                });
            }

            totalReversed += transactions.length;
        }
    }

    console.log();
    console.log('='.repeat(60));
    console.log(`Summary:`);
    console.log(`  - Shipped lines without allocation: ${affectedLines.length}`);
    console.log(`  - Lines with OUTWARD transactions: ${linesWithTransactions}`);
    console.log(`  - Transactions ${dryRun ? 'to reverse' : 'reversed'}: ${totalReversed}`);
    console.log('='.repeat(60));

    if (dryRun && totalReversed > 0) {
        console.log('\nTo actually reverse these transactions, run:');
        console.log('  node src/scripts/reverseUnallocatedShipments.js --live');
    }
}

// Run: node src/scripts/reverseUnallocatedShipments.js [--live]
const dryRun = !process.argv.includes('--live');

reverseUnallocatedShipments(dryRun)
    .then(() => {
        console.log('\nDone.');
        process.exit(0);
    })
    .catch(e => {
        console.error('Error:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
